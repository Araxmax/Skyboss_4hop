"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuickNodeGrpcScanner = void 0;
const web3_js_1 = require("@solana/web3.js");
const decimal_js_1 = __importDefault(require("decimal.js"));
const fs_1 = __importDefault(require("fs"));
const dotenv = __importStar(require("dotenv"));
const constants_1 = require("./constants");
const SimpleCsvLogger_1 = require("./SimpleCsvLogger");
const whirlpools_sdk_1 = require("@orca-so/whirlpools-sdk");
const common_sdk_1 = require("@orca-so/common-sdk");
const anchor_1 = require("@coral-xyz/anchor");
const web3_js_2 = require("@solana/web3.js");
const bn_js_1 = __importDefault(require("bn.js"));
const DynamicProfitCalculator_1 = require("./DynamicProfitCalculator");
const RpcConnectionManager_1 = require("./RpcConnectionManager");
// Yellowstone gRPC imports (QuickNode)
const yellowstone_grpc_1 = __importStar(require("@triton-one/yellowstone-grpc"));
dotenv.config();
/* =========================
   QUICKNODE YELLOWSTONE gRPC SCANNER
   - Uses QuickNode's Yellowstone gRPC for real-time account streaming
   - 50-150ms latency (vs 200-500ms with WebSocket)
   - Maximum HFT performance
========================= */
const RPC_URL = process.env.RPC_URL || '';
const QUICKNODE_GRPC_ENDPOINT = process.env.QUICKNODE_GRPC_ENDPOINT || 'grpc.quicknode.pro:443';
const QUICKNODE_GRPC_TOKEN = process.env.QUICKNODE_GRPC_TOKEN || '';
const USE_QUICKNODE_GRPC = process.env.USE_QUICKNODE_GRPC === 'true';
const POOLS = constants_1.PREDEFINED_POOLS;
const MIN_PROFIT_THRESHOLD_DECIMAL = new decimal_js_1.default(constants_1.MIN_PROFIT_THRESHOLD);
class QuickNodeGrpcScanner {
    constructor() {
        this.isRunning = false;
        this.priceCheckCount = 0;
        this.lastSignalTime = 0;
        this.updateCount = 0;
        this.startTime = 0;
        // Yellowstone gRPC client (QuickNode)
        this.grpcClient = null;
        this.grpcStream = null;
        // Orca SDK (pre-initialized)
        this.whirlpoolContext = null;
        this.whirlpoolClient = null;
        // HFT OPTIMIZATION: Pre-fetched pool objects (reused on every check)
        this.pool005Object = null;
        this.pool001Object = null;
        // Performance tracking
        this.profitableSignalCount = 0;
        this.totalQuoteTime = 0;
        this.quoteCount = 0;
        console.log('[QUICKNODE] Initializing RPC Connection Manager...');
        this.rpcManager = (0, RpcConnectionManager_1.createRpcManagerFromEnv)();
        this.connection = new web3_js_1.Connection(RPC_URL, {
            commitment: 'processed',
            disableRetryOnRateLimit: false,
        });
        this.poolPrices = new Map();
        this.lastPriceUpdate = new Map();
        this.csvLogger = new SimpleCsvLogger_1.SimpleCsvLogger('./logs', 'QuickNodeGrpcScanner');
        this.dummyWallet = web3_js_2.Keypair.generate();
        // HFT OPTIMIZATION: Pre-compute all constants
        this.tradeAmountDecimal = new decimal_js_1.default(process.env.TRADE_USD || "100");
        this.tradeAmountBN = new bn_js_1.default(this.tradeAmountDecimal.mul(1e6).floor().toString());
        const slippage = parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.005") / 100;
        this.slippagePercentage = common_sdk_1.Percentage.fromDecimal(new decimal_js_1.default(slippage));
        this.pool005Pubkey = new web3_js_1.PublicKey(POOLS[0].address);
        this.pool001Pubkey = new web3_js_1.PublicKey(POOLS[1].address);
        // Initialize DynamicProfitCalculator for accurate fee calculations
        this.profitCalculator = new DynamicProfitCalculator_1.DynamicProfitCalculator(this.connection, {
            priorityFeeLamports: parseInt(process.env.BASE_PRIORITY_FEE_LAMPORTS || "100000"),
            computeUnits: 400000,
            minimumProfitUSDC: parseFloat(process.env.MIN_PROFIT_USDC || "0.05"),
            solPriceUSD: 125, // Initial estimate, will be updated
        });
        console.log('[QUICKNODE] 🚀 QuickNode Yellowstone gRPC Scanner initialized');
        console.log(`[QUICKNODE] Mode: PROCESSED commitment (minimum latency)`);
        console.log(`[QUICKNODE] Trade Amount: $${this.tradeAmountDecimal.toString()} USDC`);
        console.log(`[QUICKNODE] gRPC Endpoint: ${QUICKNODE_GRPC_ENDPOINT}`);
    }
    /**
     * Initialize Orca SDK + PRE-FETCH pool objects
     */
    async initializeOrcaSDK() {
        try {
            console.log("[QUICKNODE] Initializing Orca SDK...");
            const anchorWallet = new anchor_1.Wallet(this.dummyWallet);
            this.whirlpoolContext = whirlpools_sdk_1.WhirlpoolContext.from(this.connection, anchorWallet, undefined, undefined, { userDefaultConfirmCommitment: "processed" });
            this.whirlpoolClient = (0, whirlpools_sdk_1.buildWhirlpoolClient)(this.whirlpoolContext);
            // HFT OPTIMIZATION: Pre-fetch and cache pool objects
            console.log("[QUICKNODE] Pre-fetching pool objects...");
            this.pool005Object = await this.whirlpoolClient.getPool(this.pool005Pubkey);
            this.pool001Object = await this.whirlpoolClient.getPool(this.pool001Pubkey);
            console.log("[QUICKNODE] ✓ Pool objects cached for fast quotes");
        }
        catch (error) {
            console.error(`[QUICKNODE] Failed to initialize Orca SDK: ${error.message}`);
            throw error;
        }
    }
    /**
     * Initialize Yellowstone gRPC client (QuickNode)
     */
    async initializeGrpcClient() {
        if (!USE_QUICKNODE_GRPC) {
            throw new Error('USE_QUICKNODE_GRPC must be true in .env');
        }
        if (!QUICKNODE_GRPC_TOKEN) {
            throw new Error('QUICKNODE_GRPC_TOKEN not set in .env');
        }
        try {
            console.log('[QUICKNODE] Initializing Yellowstone gRPC client...');
            console.log(`[QUICKNODE] Connecting to: ${QUICKNODE_GRPC_ENDPOINT}`);
            // Create Yellowstone gRPC client
            this.grpcClient = new yellowstone_grpc_1.default(QUICKNODE_GRPC_ENDPOINT, QUICKNODE_GRPC_TOKEN, undefined);
            console.log('[QUICKNODE] ✓ gRPC client initialized');
        }
        catch (error) {
            console.error(`[QUICKNODE] Failed to initialize gRPC client: ${error.message}`);
            throw error;
        }
    }
    /**
     * Fetch initial prices via RPC (one-time on startup)
     */
    async fetchInitialPrices() {
        try {
            console.log("[QUICKNODE] Fetching initial pool prices...");
            const poolPubkeys = [this.pool005Pubkey, this.pool001Pubkey];
            // CRITICAL FIX: Use RPC Manager with retry logic
            const accountInfos = await this.rpcManager.executeWithRetry(async (conn) => await conn.getMultipleAccountsInfo(poolPubkeys, { commitment: 'processed' }), 'getMultipleAccountsInfo (initial prices)');
            if (!accountInfos || accountInfos.length !== 2) {
                throw new Error('Failed to fetch initial pool data');
            }
            for (let i = 0; i < accountInfos.length; i++) {
                const accountInfo = accountInfos[i];
                if (!accountInfo || !accountInfo.data) {
                    throw new Error(`Pool ${i} data not found`);
                }
                const sqrtPrice = this.decodeSqrtPrice(accountInfo.data);
                const price = this.sqrtPriceToPrice(sqrtPrice);
                this.poolPrices.set(POOLS[i].address, price);
                this.lastPriceUpdate.set(POOLS[i].address, Date.now());
                console.log(`[QUICKNODE] Pool ${POOLS[i].fee_tier}: $${price.toFixed(6)}`);
            }
            // Update SOL price estimate in profit calculator
            const avgPrice = Array.from(this.poolPrices.values()).reduce((a, b) => a.plus(b)).div(2);
            this.profitCalculator.updateSolPrice(avgPrice.toNumber());
            console.log(`[QUICKNODE] Initial spread: ${this.calculateSpread().toFixed(4)}%`);
        }
        catch (error) {
            console.error(`[QUICKNODE] Failed to fetch initial prices: ${error.message}`);
            throw error;
        }
    }
    /**
     * Subscribe to pool accounts via Yellowstone gRPC
     */
    async subscribeToPoolAccounts() {
        if (!this.grpcClient) {
            throw new Error('gRPC client not initialized');
        }
        try {
            console.log('[QUICKNODE] Setting up gRPC subscriptions...');
            // Subscribe to both pool accounts
            const accountsFilter = {
                account: [
                    this.pool005Pubkey.toString(),
                    this.pool001Pubkey.toString(),
                ],
                owner: [],
                filters: [],
            };
            const request = {
                accounts: { pool_monitor: accountsFilter },
                commitment: yellowstone_grpc_1.CommitmentLevel.PROCESSED, // Minimum latency
            };
            // Start gRPC stream
            this.grpcStream = await this.grpcClient.subscribe(request);
            console.log('[QUICKNODE] ✓ Subscribed to SOL/USDC 0.05% [gRPC]');
            console.log('[QUICKNODE] ✓ Subscribed to SOL/USDC 0.01% [gRPC]');
            console.log('[QUICKNODE] ✅ 2 gRPC streams ACTIVE');
        }
        catch (error) {
            console.error(`[QUICKNODE] Failed to subscribe: ${error.message}`);
            throw error;
        }
    }
    /**
     * Process gRPC stream updates
     */
    async processGrpcStream() {
        if (!this.grpcStream) {
            throw new Error('gRPC stream not initialized');
        }
        try {
            console.log('[QUICKNODE] 🔥 SCANNER LIVE - YELLOWSTONE gRPC MODE ACTIVE!');
            console.log('[QUICKNODE] Checking arbitrage on EVERY price update');
            console.log('[QUICKNODE] Press Ctrl+C to stop\n');
            // Process gRPC updates in real-time
            for await (const update of this.grpcStream) {
                if (!this.isRunning)
                    break;
                // Handle account updates
                if (update.account) {
                    const accountUpdate = update.account;
                    const accountPubkey = accountUpdate.account.pubkey;
                    const accountData = Buffer.from(accountUpdate.account.data);
                    // Decode price from account data
                    const sqrtPrice = this.decodeSqrtPrice(accountData);
                    const price = this.sqrtPriceToPrice(sqrtPrice);
                    // Update price map
                    const poolAddress = accountPubkey.toString('base64');
                    const pool = POOLS.find(p => new web3_js_1.PublicKey(p.address).toBuffer().toString('base64') === poolAddress);
                    if (pool) {
                        this.poolPrices.set(pool.address, price);
                        this.lastPriceUpdate.set(pool.address, Date.now());
                        this.updateCount++;
                        // Check arbitrage opportunity
                        await this.checkArbitrage();
                    }
                }
                // Print stats every 30 seconds
                if (this.updateCount % 1000 === 0) {
                    this.printStats();
                }
            }
        }
        catch (error) {
            console.error(`[QUICKNODE] gRPC stream error: ${error.message}`);
            throw error;
        }
    }
    /**
     * Decode sqrt price from pool account data
     */
    decodeSqrtPrice(data) {
        try {
            return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
        }
        catch {
            throw new Error('Invalid whirlpool data');
        }
    }
    /**
     * Convert sqrt price to regular price
     */
    sqrtPriceToPrice(sqrtPriceX64) {
        const sqrtPrice = new decimal_js_1.default(sqrtPriceX64.toString()).div(constants_1.DECIMAL_2_POW_64);
        const price = sqrtPrice.pow(2);
        return price.mul(constants_1.DECIMAL_10_POW_9).div(constants_1.DECIMAL_10_POW_6);
    }
    /**
     * Calculate spread between pools
     */
    calculateSpread() {
        const pool005Price = this.poolPrices.get(POOLS[0].address);
        const pool001Price = this.poolPrices.get(POOLS[1].address);
        if (!pool005Price || !pool001Price) {
            return new decimal_js_1.default(0);
        }
        return pool005Price.minus(pool001Price).div(pool001Price).mul(100).abs();
    }
    /**
     * Check arbitrage opportunity with dynamic profit calculation
     */
    async checkArbitrage() {
        this.priceCheckCount++;
        const pool005Price = this.poolPrices.get(POOLS[0].address);
        const pool001Price = this.poolPrices.get(POOLS[1].address);
        if (!pool005Price || !pool001Price)
            return;
        // Determine direction
        const direction = pool005Price.greaterThan(pool001Price)
            ? '0.05% -> 0.01%'
            : '0.01% -> 0.05%';
        const isBuyFrom005 = pool005Price.greaterThan(pool001Price);
        const pool1 = isBuyFrom005 ? this.pool001Object : this.pool005Object;
        const pool2 = isBuyFrom005 ? this.pool005Object : this.pool001Object;
        try {
            // Get quotes using pre-cached pool objects (FAST!)
            const quoteStartTime = Date.now();
            const quote1 = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(pool1, constants_1.USDC_MINT, this.tradeAmountBN, this.slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher, true);
            const quote2 = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(pool2, constants_1.SOL_MINT, quote1.estimatedAmountOut, this.slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher, true);
            const quoteTime = Date.now() - quoteStartTime;
            this.totalQuoteTime += quoteTime;
            this.quoteCount++;
            // Calculate profit using DynamicProfitCalculator
            const amountIn = new decimal_js_1.default(this.tradeAmountBN.toString()).div(1e6);
            const amountOut = new decimal_js_1.default(quote2.estimatedAmountOut.toString()).div(1e6);
            const profitAnalysis = this.profitCalculator.calculateProfit(amountIn.toNumber(), amountOut.toNumber(), pool005Price.toNumber());
            // Check if profitable after ALL fees
            if (profitAnalysis.isProfitable) {
                this.profitableSignalCount++;
                const now = Date.now();
                // Throttle signal writing (max 1 per second)
                if (now - this.lastSignalTime > 1000) {
                    this.writeSignal(direction, profitAnalysis.netProfit, pool005Price, pool001Price);
                    this.lastSignalTime = now;
                    console.log(`\n[🚨 PROFITABLE OPPORTUNITY]`);
                    console.log(`Direction: ${direction}`);
                    console.log(`Gross Profit: $${profitAnalysis.grossProfit.toFixed(6)} USDC`);
                    console.log(`Total Fees: $${profitAnalysis.totalFees.toFixed(6)} USDC`);
                    console.log(`Net Profit: $${profitAnalysis.netProfit.toFixed(6)} USDC`);
                    console.log(`ROI: ${profitAnalysis.roi.toFixed(2)}%`);
                    console.log(`Quote Time: ${quoteTime}ms\n`);
                }
            }
        }
        catch (error) {
            // Ignore quote errors (stale data, etc.)
        }
    }
    /**
     * Write signal to signal.json
     */
    writeSignal(direction, profit, pool005Price, pool001Price) {
        const signal = {
            timestamp: new Date().toISOString(),
            direction,
            profit_usdc: profit,
            pool_005_price: pool005Price.toNumber(),
            pool_001_price: pool001Price.toNumber(),
            spread_pct: this.calculateSpread().toNumber(),
            trade_amount_usd: this.tradeAmountDecimal.toNumber(),
        };
        fs_1.default.writeFileSync('./signal.json', JSON.stringify(signal, null, 2));
    }
    /**
     * Print performance statistics
     */
    printStats() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        const updatesPerMin = (this.updateCount / elapsed) * 60;
        const avgQuoteTime = this.quoteCount > 0 ? this.totalQuoteTime / this.quoteCount : 0;
        console.log(`[QUICKNODE] Active - ${this.updateCount} updates (${updatesPerMin.toFixed(1)}/min) | ${this.priceCheckCount} checks | ${this.profitableSignalCount} signals | Avg quote: ${avgQuoteTime.toFixed(0)}ms`);
    }
    /**
     * Start scanner
     */
    async start() {
        try {
            this.isRunning = true;
            this.startTime = Date.now();
            // Initialize components
            await this.initializeOrcaSDK();
            await this.initializeGrpcClient();
            await this.fetchInitialPrices();
            await this.subscribeToPoolAccounts();
            // Start processing gRPC stream
            await this.processGrpcStream();
        }
        catch (error) {
            console.error(`[QUICKNODE] Scanner failed: ${error.message}`);
            this.stop();
        }
    }
    /**
     * Stop scanner
     */
    stop() {
        console.log('[QUICKNODE] Stopping scanner...');
        this.isRunning = false;
        if (this.grpcClient) {
            // Close gRPC stream (will break the for-await loop)
            this.grpcStream = null;
        }
        this.printStats();
        console.log('[QUICKNODE] Scanner stopped');
    }
}
exports.QuickNodeGrpcScanner = QuickNodeGrpcScanner;
// ========================================
// MAIN EXECUTION
// ========================================
if (require.main === module) {
    const scanner = new QuickNodeGrpcScanner();
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n[QUICKNODE] Received SIGINT, shutting down gracefully...');
        scanner.stop();
        process.exit(0);
    });
    scanner.start().catch((error) => {
        console.error('[QUICKNODE] Fatal error:', error);
        process.exit(1);
    });
}
