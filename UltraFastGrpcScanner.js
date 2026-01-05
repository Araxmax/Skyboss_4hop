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
exports.UltraFastGrpcScanner = void 0;
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
dotenv.config();
/* =========================
   HFT-OPTIMIZED gRPC SCANNER
========================= */
const RPC_URL = process.env.RPC_URL || '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const POOLS = constants_1.PREDEFINED_POOLS;
const MIN_PROFIT_THRESHOLD_DECIMAL = new decimal_js_1.default(constants_1.MIN_PROFIT_THRESHOLD);
class UltraFastGrpcScanner {
    constructor() {
        this.isRunning = false;
        this.priceCheckCount = 0;
        this.lastSignalTime = 0;
        this.updateCount = 0;
        this.startTime = 0;
        this.subscriptionIds = [];
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
        // PROCESSED commitment for absolute minimum latency
        this.connection = new web3_js_1.Connection(RPC_URL, {
            commitment: 'processed',
            wsEndpoint: RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://'),
            disableRetryOnRateLimit: false,
        });
        this.poolPrices = new Map();
        this.lastPriceUpdate = new Map();
        this.csvLogger = new SimpleCsvLogger_1.SimpleCsvLogger('./logs', 'UltraFastScanner');
        this.dummyWallet = web3_js_2.Keypair.generate();
        // HFT OPTIMIZATION: Pre-compute all constants
        this.tradeAmountDecimal = new decimal_js_1.default(process.env.TRADE_USD || "25");
        this.tradeAmountBN = new bn_js_1.default(this.tradeAmountDecimal.mul(1e6).floor().toString());
        const slippage = parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.03") / 100;
        this.slippagePercentage = common_sdk_1.Percentage.fromDecimal(new decimal_js_1.default(slippage));
        this.pool005Pubkey = new web3_js_1.PublicKey(POOLS[0].address);
        this.pool001Pubkey = new web3_js_1.PublicKey(POOLS[1].address);
        // Initialize DynamicProfitCalculator for accurate fee calculations
        this.profitCalculator = new DynamicProfitCalculator_1.DynamicProfitCalculator(this.connection, {
            priorityFeeLamports: parseInt(process.env.PRIORITY_FEE_LAMPORTS || "50000"),
            computeUnits: 400000,
            minimumProfitUSDC: parseFloat(process.env.MIN_PROFIT_USDC || "0.001"),
            solPriceUSD: 125, // Initial estimate, will be updated with pool prices
        });
        console.log('[HFT] 🚀 ULTRA-FAST HFT Scanner initialized');
        console.log(`[HFT] Mode: PROCESSED commitment (minimum latency)`);
        console.log(`[HFT] Trade Amount: $${this.tradeAmountDecimal.toString()} USDC`);
    }
    /**
     * Initialize Orca SDK + PRE-FETCH pool objects
     */
    async initializeOrcaSDK() {
        try {
            const anchorWallet = new anchor_1.Wallet(this.dummyWallet);
            this.whirlpoolContext = whirlpools_sdk_1.WhirlpoolContext.from(this.connection, anchorWallet, undefined, undefined, { userDefaultConfirmCommitment: "processed" } // HFT: Use processed
            );
            this.whirlpoolClient = (0, whirlpools_sdk_1.buildWhirlpoolClient)(this.whirlpoolContext);
            // HFT OPTIMIZATION: Pre-fetch and cache pool objects
            console.log("[HFT] Pre-fetching pool objects...");
            this.pool005Object = await this.whirlpoolClient.getPool(this.pool005Pubkey);
            this.pool001Object = await this.whirlpoolClient.getPool(this.pool001Pubkey);
            console.log("[HFT] ✓ Pool objects cached for fast quotes");
        }
        catch (error) {
            console.error(`[HFT] Failed to initialize: ${error.message}`);
            throw error;
        }
    }
    /**
     * Decode sqrt price (optimized)
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
     * Process price update - HOT PATH (ZERO logging, immediate arbitrage check)
     */
    processPriceUpdate(poolAddress, poolName, data) {
        try {
            const now = Date.now();
            this.updateCount++;
            const sqrtPriceX64 = this.decodeSqrtPrice(data);
            const price = this.sqrtPriceToPrice(sqrtPriceX64);
            this.poolPrices.set(poolAddress, price);
            this.lastPriceUpdate.set(poolAddress, now);
            // HFT OPTIMIZATION: Check arbitrage on EVERY update (no threshold filtering)
            this.checkArbitrageHFT();
        }
        catch (error) {
            // Suppress all errors on hot path
        }
    }
    /**
     * Subscribe to account changes (PROCESSED mode)
     */
    async subscribeToAccounts() {
        console.log('\n[HFT] Setting up real-time subscriptions...');
        const subscriptionPromises = POOLS.map(async (pool) => {
            try {
                const poolPubkey = new web3_js_1.PublicKey(pool.address);
                const subId = this.connection.onAccountChange(poolPubkey, (accountInfo) => {
                    if (accountInfo && accountInfo.data) {
                        this.processPriceUpdate(pool.address, pool.name, accountInfo.data);
                    }
                }, 'processed' // Minimum latency
                );
                this.subscriptionIds.push(subId);
                console.log(`[HFT] ✓ Subscribed to ${pool.name}`);
            }
            catch (error) {
                console.error(`[HFT] Subscription error for ${pool.name}: ${error.message}`);
            }
        });
        await Promise.all(subscriptionPromises);
        console.log(`[HFT] ✅ ${this.subscriptionIds.length} subscriptions ACTIVE`);
    }
    /**
     * Initial price fetch
     */
    async fetchInitialPrices() {
        console.log('[HFT] Fetching initial prices...');
        const poolPubkeys = POOLS.map(p => new web3_js_1.PublicKey(p.address));
        try {
            const accountInfos = await this.connection.getMultipleAccountsInfo(poolPubkeys, { commitment: 'processed' });
            for (let i = 0; i < POOLS.length; i++) {
                const pool = POOLS[i];
                const accountInfo = accountInfos[i];
                if (accountInfo && accountInfo.data) {
                    this.processPriceUpdate(pool.address, pool.name, accountInfo.data);
                }
            }
            const price005 = this.poolPrices.get(POOLS[0].address);
            const price001 = this.poolPrices.get(POOLS[1].address);
            if (price005 && price001) {
                console.log(`[HFT] Pool 0.05%: $${price005.toFixed(6)}`);
                console.log(`[HFT] Pool 0.01%: $${price001.toFixed(6)}`);
                const spread = price005.minus(price001).abs().div(decimal_js_1.default.min(price005, price001)).mul(100);
                console.log(`[HFT] Initial spread: ${spread.toFixed(4)}%`);
            }
        }
        catch (error) {
            console.error(`[HFT] Initial fetch error: ${error.message}`);
        }
    }
    /**
     * HFT-OPTIMIZED arbitrage check - PARALLEL quotes, NO pre-filtering
     */
    async checkArbitrageHFT() {
        if (this.poolPrices.size < 2)
            return;
        const pool005 = POOLS[0];
        const pool001 = POOLS[1];
        const price005 = this.poolPrices.get(pool005.address);
        const price001 = this.poolPrices.get(pool001.address);
        if (!price005 || !price001)
            return;
        this.priceCheckCount++;
        // Calculate spread for logging ONLY if profitable
        const priceDiff = price005.minus(price001).abs();
        const minPrice = price005.lt(price001) ? price005 : price001;
        const spreadPct = priceDiff.div(minPrice);
        const quoteStartTime = Date.now();
        try {
            // CRITICAL FIX: Fetch fresh pool objects AND refresh their data to get latest on-chain state
            const pool005Fresh = await this.whirlpoolClient.getPool(this.pool005Pubkey);
            const pool001Fresh = await this.whirlpoolClient.getPool(this.pool001Pubkey);
            // Force refresh to get the absolute latest on-chain data (fixes stale cache bug)
            await Promise.all([
                pool005Fresh.refreshData(),
                pool001Fresh.refreshData()
            ]);
            // HFT OPTIMIZATION: Fetch BOTH quote directions in PARALLEL with fresh pools
            const [result_dir1, result_dir2] = await Promise.all([
                this.getQuoteDirection1(pool005Fresh, pool001Fresh),
                this.getQuoteDirection2(pool001Fresh, pool005Fresh),
            ]);
            const quoteEndTime = Date.now();
            const quoteTime = quoteEndTime - quoteStartTime;
            this.totalQuoteTime += quoteTime;
            this.quoteCount++;
            // Pick the most profitable direction
            const direction1 = `${pool005.name} -> ${pool001.name}`;
            const direction2 = `${pool001.name} -> ${pool005.name}`;
            let bestDirection = direction1;
            let bestProfitPct = result_dir1.profitPct;
            let isProfitable = result_dir1.isProfitable;
            let finalOut = result_dir1.finalOut;
            if (result_dir2.profitPct.gt(result_dir1.profitPct)) {
                bestDirection = direction2;
                bestProfitPct = result_dir2.profitPct;
                isProfitable = result_dir2.isProfitable;
                finalOut = result_dir2.finalOut;
            }
            // LOG EVERYTHING TO CSV (every single check)
            let failureReason = '';
            if (!isProfitable) {
                if (bestProfitPct.lessThan(0)) {
                    failureReason = `Negative profit ${bestProfitPct.mul(100).toFixed(4)}% after fees and slippage`;
                }
                else {
                    failureReason = `Profit ${bestProfitPct.mul(100).toFixed(4)}% below minimum ${MIN_PROFIT_THRESHOLD_DECIMAL.mul(100).toFixed(2)}%`;
                }
            }
            const logEntry = {
                price_001_pool: price001.toNumber(),
                price_005_pool: price005.toNumber(),
                spread_usd: priceDiff.toNumber(),
                spread_pct: spreadPct.mul(100).toNumber(),
                net_profit_pct: bestProfitPct.mul(100).toNumber(),
                trade_possible: isProfitable,
                failure_reason: failureReason
            };
            this.csvLogger.logTrade(logEntry);
            // Console logging - only for profitable or every 100th check
            if (isProfitable) {
                this.profitableSignalCount++;
                const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
                const avgQuoteTime = (this.totalQuoteTime / this.quoteCount).toFixed(0);
                console.log(`\n${'='.repeat(70)}`);
                console.log(`🚨 PROFITABLE OPPORTUNITY #${this.profitableSignalCount} 🚨`);
                console.log(`${'='.repeat(70)}`);
                console.log(`Direction: ${bestDirection}`);
                console.log(`Profit: ${bestProfitPct.mul(100).toFixed(4)}% ($${bestProfitPct.mul(this.tradeAmountDecimal).toFixed(4)})`);
                console.log(`Quote Time: ${quoteTime}ms (avg: ${avgQuoteTime}ms)`);
                console.log(`Pool 0.05%: $${price005.toFixed(6)}`);
                console.log(`Pool 0.01%: $${price001.toFixed(6)}`);
                console.log(`Spread: ${spreadPct.mul(100).toFixed(4)}%`);
                console.log(`Runtime: ${elapsed}s | Checks: ${this.priceCheckCount} | Updates: ${this.updateCount}`);
                console.log(`${'='.repeat(70)}\n`);
                // Write signal
                const now = Date.now();
                if (now - this.lastSignalTime > 1000) {
                    const signal = {
                        base: "USDC",
                        direction: bestDirection,
                        profit_pct: bestProfitPct.mul(100).toNumber(),
                        trade_usdc: this.tradeAmountDecimal.toNumber(),
                        timestamp: now,
                    };
                    fs_1.default.writeFileSync('signal.json', JSON.stringify(signal, null, 2));
                    console.log(`✅ Signal written to signal.json\n`);
                    this.lastSignalTime = now;
                }
            }
            else {
                // Log unprofitable opportunities every 100th check (reduce console spam)
                if (this.priceCheckCount % 100 === 0) {
                    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
                    const avgQuoteTime = (this.totalQuoteTime / this.quoteCount).toFixed(0);
                    console.log(`[${this.priceCheckCount}] [${elapsed}s] Spread: ${spreadPct.mul(100).toFixed(4)}% | Best profit: ${bestProfitPct.mul(100).toFixed(4)}% (min: ${MIN_PROFIT_THRESHOLD_DECIMAL.mul(100).toFixed(2)}%) | Quote: ${quoteTime}ms (avg: ${avgQuoteTime}ms)`);
                }
            }
        }
        catch (error) {
            // Suppress quote errors on hot path
            if (this.priceCheckCount % 500 === 0) {
                console.error(`[HFT] Quote error: ${error.message}`);
            }
        }
    }
    /**
     * Get quote for Direction 1: Buy 0.05% → Sell 0.01%
     * Uses fresh pool objects passed as parameters
     * Uses DynamicProfitCalculator for accurate net profit after ALL fees
     */
    async getQuoteDirection1(pool005, pool001, logDetails = false) {
        try {
            // Swap 1: USDC -> SOL on 0.05% pool
            const quote1 = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(pool005, // Fresh pool data from caller
            new web3_js_1.PublicKey(constants_1.USDC_MINT), this.tradeAmountBN, this.slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher);
            // Swap 2: SOL -> USDC on 0.01% pool
            const quote2 = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(pool001, // Fresh pool data from caller
            new web3_js_1.PublicKey(constants_1.SOL_MINT), quote1.estimatedAmountOut, this.slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher);
            // Get current SOL price from pool prices
            const currentSOLPrice = this.poolPrices.get(POOLS[0].address) || new decimal_js_1.default(125);
            // Use DynamicProfitCalculator for accurate net profit after ALL fees
            const analysis = this.profitCalculator.analyzeProfitability(this.tradeAmountDecimal, quote1, quote2, currentSOLPrice, 0.0005, // 0.05% fee for pool005
            0.0001, // 0.01% fee for pool001
            logDetails);
            return {
                profitPct: analysis.netProfitPct.div(100), // Convert from percentage to decimal
                isProfitable: analysis.meetsMinimum,
                finalOut: analysis.swap2Output
            };
        }
        catch (error) {
            console.error(`[HFT] Direction 1 quote error: ${error.message}`);
            return { profitPct: new decimal_js_1.default(-1), isProfitable: false, finalOut: new decimal_js_1.default(0) };
        }
    }
    /**
     * Get quote for Direction 2: Buy 0.01% → Sell 0.05%
     * Uses fresh pool objects passed as parameters
     * Uses DynamicProfitCalculator for accurate net profit after ALL fees
     */
    async getQuoteDirection2(pool001, pool005, logDetails = false) {
        try {
            // Swap 1: USDC -> SOL on 0.01% pool
            const quote1 = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(pool001, // Fresh pool data from caller
            new web3_js_1.PublicKey(constants_1.USDC_MINT), this.tradeAmountBN, this.slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher);
            // Swap 2: SOL -> USDC on 0.05% pool
            const quote2 = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(pool005, // Fresh pool data from caller
            new web3_js_1.PublicKey(constants_1.SOL_MINT), quote1.estimatedAmountOut, this.slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher);
            // Get current SOL price from pool prices
            const currentSOLPrice = this.poolPrices.get(POOLS[0].address) || new decimal_js_1.default(125);
            // Use DynamicProfitCalculator for accurate net profit after ALL fees
            const analysis = this.profitCalculator.analyzeProfitability(this.tradeAmountDecimal, quote1, quote2, currentSOLPrice, 0.0001, // 0.01% fee for pool001
            0.0005, // 0.05% fee for pool005
            logDetails);
            return {
                profitPct: analysis.netProfitPct.div(100), // Convert from percentage to decimal
                isProfitable: analysis.meetsMinimum,
                finalOut: analysis.swap2Output
            };
        }
        catch (error) {
            console.error(`[HFT] Direction 2 quote error: ${error.message}`);
            return { profitPct: new decimal_js_1.default(-1), isProfitable: false, finalOut: new decimal_js_1.default(0) };
        }
    }
    /**
     * Start HFT scanner
     */
    async start() {
        console.log('\n' + '='.repeat(70));
        console.log('🚀 ULTRA-FAST HFT SCANNER 🚀');
        console.log('='.repeat(70));
        console.log('Optimizations:');
        console.log('  ⚡ NO spread filtering - check every update');
        console.log('  ⚡ Parallel quote fetching - both directions simultaneously');
        console.log('  ⚡ Pre-cached pool objects - zero refetch overhead');
        console.log('  ⚡ Minimal logging - only profitable signals');
        console.log('  ⚡ PROCESSED commitment - minimum latency');
        console.log('='.repeat(70));
        this.isRunning = true;
        this.startTime = Date.now();
        // Initialize Orca SDK + pre-fetch pools
        console.log('\n[HFT] Initializing Orca SDK...');
        await this.initializeOrcaSDK();
        // Fetch initial prices
        await this.fetchInitialPrices();
        // Subscribe to streaming updates
        await this.subscribeToAccounts();
        console.log('\n[HFT] 🔥 SCANNER LIVE - HFT MODE ACTIVE!');
        console.log('[HFT] Checking arbitrage on EVERY price update');
        console.log('[HFT] Press Ctrl+C to stop\n');
        // Heartbeat timer - show activity every 30 seconds
        setInterval(() => {
            const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
            const avgQuoteTime = this.quoteCount > 0 ? (this.totalQuoteTime / this.quoteCount).toFixed(0) : 'N/A';
            const updatesPerMin = this.updateCount > 0 ? (this.updateCount / (parseFloat(elapsed) / 60)).toFixed(1) : '0.0';
            if (this.updateCount === 0) {
                console.log(`[${elapsed}s] ⏳ Scanner active - waiting for pool updates (0 updates received)`);
            }
            else {
                console.log(`[${elapsed}s] ✅ Active - ${this.updateCount} updates (${updatesPerMin}/min) | ${this.priceCheckCount} checks | ${this.profitableSignalCount} signals | Avg quote: ${avgQuoteTime}ms`);
            }
        }, 30000); // Every 30 seconds
    }
    /**
     * Stop and cleanup
     */
    stop() {
        this.isRunning = false;
        for (const subId of this.subscriptionIds) {
            try {
                this.connection.removeAccountChangeListener(subId);
            }
            catch (error) {
                // Ignore cleanup errors
            }
        }
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        const avgUpdatesPerSec = (this.updateCount / parseFloat(elapsed)).toFixed(2);
        const avgQuoteTime = this.quoteCount > 0 ? (this.totalQuoteTime / this.quoteCount).toFixed(0) : '0';
        console.log(`\n[HFT] Scanner stopped`);
        console.log(`[HFT] Runtime: ${elapsed}s`);
        console.log(`[HFT] Total updates: ${this.updateCount} (${avgUpdatesPerSec}/s)`);
        console.log(`[HFT] Total checks: ${this.priceCheckCount}`);
        console.log(`[HFT] Profitable signals: ${this.profitableSignalCount}`);
        console.log(`[HFT] Avg quote time: ${avgQuoteTime}ms`);
    }
}
exports.UltraFastGrpcScanner = UltraFastGrpcScanner;
/* =========================
   MAIN
========================= */
let scannerInstance = null;
async function main() {
    try {
        if (!process.env.HELIUS_API_KEY) {
            throw new Error('HELIUS_API_KEY not set in .env');
        }
        if (!process.env.RPC_URL) {
            throw new Error('RPC_URL not set in .env');
        }
        scannerInstance = new UltraFastGrpcScanner();
        await scannerInstance.start();
        // Keep running
        await new Promise(() => { });
    }
    catch (error) {
        console.error('[HFT] Fatal error:', error.message);
        if (scannerInstance) {
            scannerInstance.stop();
        }
        process.exit(1);
    }
}
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[HFT] Shutting down...');
    if (scannerInstance) {
        scannerInstance.stop();
    }
    process.exit(0);
});
if (require.main === module) {
    main();
}
