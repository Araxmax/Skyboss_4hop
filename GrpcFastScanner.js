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
exports.GrpcFastScanner = void 0;
const web3_js_1 = require("@solana/web3.js");
const decimal_js_1 = __importDefault(require("decimal.js"));
const fs_1 = __importDefault(require("fs"));
const dotenv = __importStar(require("dotenv"));
const constants_1 = require("./constants");
const CsvLogger_1 = require("./CsvLogger");
const RaydiumPriceFetcher_1 = require("./RaydiumPriceFetcher");
dotenv.config();
/* =========================
   HELIUS GRPC STREAMING
========================= */
const RPC_URL = process.env.RPC_URL || '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const POOLS = constants_1.PREDEFINED_POOLS;
const MIN_PROFIT_THRESHOLD_DECIMAL = new decimal_js_1.default(constants_1.MIN_PROFIT_THRESHOLD);
// Helius gRPC endpoint
const GRPC_ENDPOINT = process.env.HELIUS_GRPC_ENDPOINT || 'laserstream-mainnet-ewr.helius-rpc.com:443';
/* =========================
   ULTRA-FAST GRPC SCANNER
========================= */
class GrpcFastScanner {
    constructor() {
        this.isRunning = false;
        this.priceCheckCount = 0;
        this.lastSignalTime = 0;
        this.updateCount = 0;
        this.startTime = 0;
        // WebSocket subscriptions (fastest available in Solana Web3.js)
        this.subscriptionIds = [];
        // Use PROCESSED commitment for maximum speed (2x faster than confirmed)
        this.connection = new web3_js_1.Connection(RPC_URL, {
            commitment: 'processed', // 200-400ms latency (FASTEST)
            wsEndpoint: RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://'),
            disableRetryOnRateLimit: false,
        });
        this.poolPrices = new Map();
        this.lastPriceUpdate = new Map();
        this.csvLogger = new CsvLogger_1.CsvLogger('./logs/scanner');
        console.log('[gRPC] ⚡ ULTRA-FAST gRPC Scanner initialized');
        console.log(`[gRPC] Commitment: PROCESSED (200-400ms latency)`);
        console.log(`[gRPC] Endpoint: ${GRPC_ENDPOINT}`);
        console.log(`[gRPC] API Key: ${HELIUS_API_KEY.substring(0, 8)}...`);
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
     * Process price update (HOT PATH - MAXIMUM SPEED)
     */
    processPriceUpdate(poolAddress, poolName, data) {
        try {
            const now = Date.now();
            this.updateCount++;
            const sqrtPriceX64 = this.decodeSqrtPrice(data);
            const price = this.sqrtPriceToPrice(sqrtPriceX64);
            const oldPrice = this.poolPrices.get(poolAddress);
            this.poolPrices.set(poolAddress, price);
            this.lastPriceUpdate.set(poolAddress, now);
            // Minimal logging on hot path - only log every 10th update or significant changes
            if (this.updateCount % 10 === 0 || !oldPrice) {
                if (oldPrice) {
                    const delta = price.minus(oldPrice);
                    const deltaPercent = delta.div(oldPrice).mul(100);
                    if (deltaPercent.abs().gte(0.01)) { // Only log if >0.01% change
                        console.log(`[⚡${this.updateCount}] ${poolName}: $${price.toFixed(6)} (${deltaPercent.gte(0) ? '+' : ''}${deltaPercent.toFixed(4)}%)`);
                    }
                }
                else {
                    console.log(`[⚡${this.updateCount}] ${poolName}: $${price.toFixed(6)} [INITIAL]`);
                }
            }
            // Check arbitrage immediately (this is the critical path)
            this.checkArbitrageOptimized();
        }
        catch (error) {
            // Suppress error logging on hot path
            if (this.updateCount % 100 === 0) {
                console.error(`[gRPC] Price decode errors: ${error.message}`);
            }
        }
    }
    /**
     * Subscribe to account changes via Helius WebSocket (ULTRA-FAST)
     */
    async subscribeToAccounts() {
        console.log('\n[gRPC] Setting up ULTRA-FAST streaming subscriptions...');
        // Subscribe to all pools in parallel for faster setup
        const subscriptionPromises = POOLS.map(async (pool) => {
            try {
                if (pool.type === 'orca') {
                    // Orca Whirlpool - subscribe to pool account
                    const poolPubkey = new web3_js_1.PublicKey(pool.address);
                    const subId = this.connection.onAccountChange(poolPubkey, (accountInfo) => {
                        if (accountInfo && accountInfo.data) {
                            this.processPriceUpdate(pool.address, pool.name, accountInfo.data);
                        }
                    }, 'processed');
                    this.subscriptionIds.push(subId);
                    console.log(`[gRPC] ✓ Subscribed to ${pool.name} (Orca Whirlpool)`);
                }
                else if (pool.type === 'raydium') {
                    // Raydium AMM - subscribe to both vaults
                    if (!pool.vault_a || !pool.vault_b) {
                        console.error(`[gRPC] Missing vault addresses for ${pool.name}`);
                        return;
                    }
                    const vaultAPubkey = new web3_js_1.PublicKey(pool.vault_a);
                    const vaultBPubkey = new web3_js_1.PublicKey(pool.vault_b);
                    let lastVaultABalance = null;
                    let lastVaultBBalance = null;
                    // Subscribe to SOL vault
                    const subIdA = this.connection.onAccountChange(vaultAPubkey, (accountInfo) => {
                        try {
                            const amount = accountInfo.data.readBigUInt64LE(64);
                            lastVaultABalance = amount;
                            if (lastVaultBBalance !== null) {
                                const solBalance = new decimal_js_1.default(lastVaultABalance.toString()).div(1e9);
                                const usdcBalance = new decimal_js_1.default(lastVaultBBalance.toString()).div(1e6);
                                if (!solBalance.isZero()) {
                                    const price = usdcBalance.div(solBalance);
                                    this.poolPrices.set(pool.address, price);
                                    this.lastPriceUpdate.set(pool.address, Date.now());
                                    this.updateCount++;
                                    this.checkArbitrageOptimized();
                                }
                            }
                        }
                        catch (error) {
                            console.error(`[gRPC] Raydium vault A error: ${error.message}`);
                        }
                    }, 'processed');
                    // Subscribe to USDC vault
                    const subIdB = this.connection.onAccountChange(vaultBPubkey, (accountInfo) => {
                        try {
                            const amount = accountInfo.data.readBigUInt64LE(64);
                            lastVaultBBalance = amount;
                            if (lastVaultABalance !== null) {
                                const solBalance = new decimal_js_1.default(lastVaultABalance.toString()).div(1e9);
                                const usdcBalance = new decimal_js_1.default(lastVaultBBalance.toString()).div(1e6);
                                if (!solBalance.isZero()) {
                                    const price = usdcBalance.div(solBalance);
                                    this.poolPrices.set(pool.address, price);
                                    this.lastPriceUpdate.set(pool.address, Date.now());
                                    this.updateCount++;
                                    this.checkArbitrageOptimized();
                                }
                            }
                        }
                        catch (error) {
                            console.error(`[gRPC] Raydium vault B error: ${error.message}`);
                        }
                    }, 'processed');
                    this.subscriptionIds.push(subIdA, subIdB);
                    console.log(`[gRPC] ✓ Subscribed to ${pool.name} (Raydium AMM - 2 vaults)`);
                }
            }
            catch (error) {
                console.error(`[gRPC] Subscription error for ${pool.name}: ${error.message}`);
            }
        });
        // Wait for all subscriptions to complete
        await Promise.all(subscriptionPromises);
        console.log(`[gRPC] ✅ ${this.subscriptionIds.length} streaming connections ACTIVE (ULTRA-FAST MODE)`);
    }
    /**
     * Initial price fetch (FAST)
     */
    async fetchInitialPrices() {
        console.log('[gRPC] Fetching initial prices (FAST)...');
        try {
            for (const pool of POOLS) {
                if (pool.type === 'orca') {
                    // Fetch Orca Whirlpool account
                    const poolPubkey = new web3_js_1.PublicKey(pool.address);
                    const accountInfo = await this.connection.getAccountInfo(poolPubkey, 'processed');
                    if (accountInfo && accountInfo.data) {
                        this.processPriceUpdate(pool.address, pool.name, accountInfo.data);
                    }
                }
                else if (pool.type === 'raydium') {
                    // Fetch Raydium price from vaults
                    if (pool.vault_a && pool.vault_b) {
                        const price = await (0, RaydiumPriceFetcher_1.fetchRaydiumPrice)(this.connection, pool.vault_a, pool.vault_b);
                        if (price) {
                            this.poolPrices.set(pool.address, price);
                            this.lastPriceUpdate.set(pool.address, Date.now());
                            console.log(`[gRPC] ${pool.name}: $${price.toFixed(6)} [INITIAL]`);
                        }
                    }
                }
            }
        }
        catch (error) {
            console.error(`[gRPC] Initial fetch error: ${error.message}`);
        }
    }
    /**
     * Optimized arbitrage check - ALL POOL PAIRS AND DIRECTIONS
     */
    checkArbitrageOptimized() {
        if (this.poolPrices.size < 2)
            return;
        this.priceCheckCount++;
        // Find best arbitrage opportunity across all pool pairs
        let bestDirection = "";
        let bestProfitPct = new decimal_js_1.default(-1);
        let bestPool1 = POOLS[0];
        let bestPool2 = POOLS[1];
        let bestPrice1 = new decimal_js_1.default(0);
        let bestPrice2 = new decimal_js_1.default(0);
        // Check all possible pool pairs
        for (let i = 0; i < POOLS.length; i++) {
            for (let j = i + 1; j < POOLS.length; j++) {
                const pool1 = POOLS[i];
                const pool2 = POOLS[j];
                const price1 = this.poolPrices.get(pool1.address);
                const price2 = this.poolPrices.get(pool2.address);
                if (!price1 || !price2)
                    continue;
                // Direction 1: Buy on pool1 → Sell on pool2
                const costPerSOL_dir1 = price1.mul(new decimal_js_1.default(1).plus(pool1.fee_rate));
                const revenuePerSOL_dir1 = price2.mul(new decimal_js_1.default(1).minus(pool2.fee_rate));
                const profitPerSOL_dir1 = revenuePerSOL_dir1.minus(costPerSOL_dir1);
                const profitPct_dir1 = profitPerSOL_dir1.div(costPerSOL_dir1);
                // Direction 2: Buy on pool2 → Sell on pool1
                const costPerSOL_dir2 = price2.mul(new decimal_js_1.default(1).plus(pool2.fee_rate));
                const revenuePerSOL_dir2 = price1.mul(new decimal_js_1.default(1).minus(pool1.fee_rate));
                const profitPerSOL_dir2 = revenuePerSOL_dir2.minus(costPerSOL_dir2);
                const profitPct_dir2 = profitPerSOL_dir2.div(costPerSOL_dir2);
                // Check direction 1
                if (profitPct_dir1.gt(bestProfitPct) && profitPct_dir1.gt(0)) {
                    bestProfitPct = profitPct_dir1;
                    bestDirection = `${pool1.name} -> ${pool2.name}`;
                    bestPool1 = pool1;
                    bestPool2 = pool2;
                    bestPrice1 = price1;
                    bestPrice2 = price2;
                }
                // Check direction 2
                if (profitPct_dir2.gt(bestProfitPct) && profitPct_dir2.gt(0)) {
                    bestProfitPct = profitPct_dir2;
                    bestDirection = `${pool2.name} -> ${pool1.name}`;
                    bestPool1 = pool2;
                    bestPool2 = pool1;
                    bestPrice1 = price2;
                    bestPrice2 = price1;
                }
            }
        }
        const isProfitable = bestProfitPct.gt(MIN_PROFIT_THRESHOLD_DECIMAL);
        // Log every 20th check or if profitable (reduced logging for speed)
        if (isProfitable || this.priceCheckCount % 20 === 0) {
            const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
            const updatesPerSec = (this.updateCount / parseFloat(elapsed)).toFixed(1);
            console.log(`\n[CHECK ${this.priceCheckCount}] [${elapsed}s] [${updatesPerSec} updates/s]`);
            // Log all pool prices
            for (const pool of POOLS) {
                const price = this.poolPrices.get(pool.address);
                if (price) {
                    console.log(`  ${pool.name}: $${price.toFixed(6)}`);
                }
            }
            // Calculate spread between best pair
            const priceDiff = bestPrice1.minus(bestPrice2).abs();
            const minPrice = bestPrice1.lt(bestPrice2) ? bestPrice1 : bestPrice2;
            const spreadPct = priceDiff.div(minPrice);
            console.log(`  Spread (${bestPool1.name} vs ${bestPool2.name}): ${spreadPct.mul(100).toFixed(4)}%`);
            console.log(`  Best Direction: ${bestDirection} (${bestProfitPct.mul(100).toFixed(4)}%)`);
            // CSV logging (only log every 20th or if profitable to reduce I/O)
            const logEntry = {
                timestamp: Date.now().toString(),
                datetime: new Date().toISOString(),
                signal_direction: bestDirection,
                price_001_pool: bestPrice2.toNumber(), // approximate for logging
                price_005_pool: bestPrice1.toNumber(), // approximate for logging
                spread: priceDiff.toNumber(),
                spread_pct: spreadPct.mul(100).toNumber(),
                expected_profit_pct: bestProfitPct.mul(100).toNumber(),
                trade_amount_usdc: parseFloat(process.env.TRADE_USD || "480"),
                safety_passed: false,
                safety_errors: "",
                safety_warnings: "",
                sol_balance: 0,
                usdc_balance: 0,
                executed: false,
                dry_run: true,
                swap1_pool: "",
                swap1_success: false,
                swap1_amount_in: 0,
                swap1_amount_out: 0,
                swap1_signature: "",
                swap1_error: "",
                swap2_pool: "",
                swap2_success: false,
                swap2_amount_in: 0,
                swap2_amount_out: 0,
                swap2_signature: "",
                swap2_error: "",
                actual_profit_usdc: 0,
                actual_profit_pct: 0,
                failure_reason: isProfitable ? "" : "Below profit threshold",
                failure_stage: isProfitable ? "" : "scanner",
            };
            this.csvLogger.logTrade(logEntry);
        }
        // Write signal if profitable (rate limited)
        if (isProfitable) {
            const now = Date.now();
            if (now - this.lastSignalTime > 1000) {
                console.log(`\n${'='.repeat(70)}`);
                console.log(`🚨 PROFITABLE OPPORTUNITY DETECTED!`);
                console.log(`${'='.repeat(70)}`);
                console.log(`Best Direction: ${bestDirection}`);
                console.log(`Profit: ${bestProfitPct.mul(100).toFixed(4)}%`);
                console.log(`Time: ${new Date().toLocaleTimeString()}`);
                console.log(`${'='.repeat(70)}\n`);
                const signal = {
                    base: "USDC",
                    direction: bestDirection,
                    profit_pct: bestProfitPct.mul(100).toNumber(),
                    trade_usdc: parseFloat(process.env.TRADE_USD || "480"),
                    timestamp: now,
                };
                fs_1.default.writeFileSync('signal.json', JSON.stringify(signal, null, 2));
                console.log(`✅ Signal written to signal.json\n`);
                this.lastSignalTime = now;
            }
        }
    }
    /**
     * Start gRPC-style streaming scanner
     */
    async start() {
        console.log('\n' + '='.repeat(70));
        console.log('⚡ ULTRA-FAST HELIUS gRPC STREAMING SCANNER ⚡');
        console.log('='.repeat(70));
        console.log('Technology: WebSocket with PROCESSED Commitment');
        console.log('Speed: 200-400ms latency (2x FASTER THAN CONFIRMED)');
        console.log('Features:');
        console.log('  🚀 Real-time streaming updates');
        console.log('  🚀 Ultra-low latency (PROCESSED mode)');
        console.log('  🚀 Minimal logging overhead');
        console.log('  🚀 Parallel subscriptions');
        console.log('  🚀 Hot path optimization');
        console.log('  🚀 Reduced I/O operations');
        console.log('='.repeat(70));
        this.isRunning = true;
        this.startTime = Date.now();
        // Step 1: Fetch initial prices (FAST)
        await this.fetchInitialPrices();
        // Step 2: Subscribe to streaming updates (ULTRA-FAST)
        await this.subscribeToAccounts();
        console.log('\n[gRPC] 🔥 Scanner LIVE in ULTRA-FAST MODE!');
        console.log('[gRPC] Latency: ~200-400ms per update');
        console.log('[gRPC] Press Ctrl+C to stop\n');
    }
    /**
     * Stop and cleanup
     */
    stop() {
        this.isRunning = false;
        // Unsubscribe from all streams
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
        console.log(`\n[gRPC] Scanner stopped`);
        console.log(`[gRPC] Total updates: ${this.updateCount}`);
        console.log(`[gRPC] Total checks: ${this.priceCheckCount}`);
        console.log(`[gRPC] Runtime: ${elapsed}s`);
        console.log(`[gRPC] Avg updates/sec: ${avgUpdatesPerSec}`);
    }
}
exports.GrpcFastScanner = GrpcFastScanner;
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
        scannerInstance = new GrpcFastScanner();
        await scannerInstance.start();
        // Keep running
        await new Promise(() => { });
    }
    catch (error) {
        console.error('[gRPC] Fatal error:', error.message);
        if (scannerInstance) {
            scannerInstance.stop();
        }
        process.exit(1);
    }
}
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[gRPC] Shutting down...');
    if (scannerInstance) {
        scannerInstance.stop();
    }
    process.exit(0);
});
if (require.main === module) {
    main();
}
