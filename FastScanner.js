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
exports.FastScanner = void 0;
const web3_js_1 = require("@solana/web3.js");
const decimal_js_1 = __importDefault(require("decimal.js"));
const fs_1 = __importDefault(require("fs"));
const dotenv = __importStar(require("dotenv"));
const constants_1 = require("./constants");
const CsvLogger_1 = require("./CsvLogger");
dotenv.config();
/* =========================
   ULTRA-FAST SCANNER CONFIG
========================= */
const RPC_URL = process.env.RPC_URL || '';
const POOLS = constants_1.PREDEFINED_POOLS;
const MIN_PROFIT_THRESHOLD_DECIMAL = new decimal_js_1.default(constants_1.MIN_PROFIT_THRESHOLD);
// Performance settings
const COMMITMENT = 'processed'; // Fastest commitment level
const MAX_RETRIES = 1; // Fast fail
const WEBSOCKET_ENABLED = true;
/* =========================
   HIGH-PERFORMANCE SCANNER
========================= */
class FastScanner {
    constructor() {
        this.isRunning = false;
        this.subscriptionIds = [];
        this.priceCheckCount = 0;
        this.lastSignalTime = 0;
        this.CACHE_TTL_MS = 100; // 100ms cache
        // HTTP connection for queries
        this.connection = new web3_js_1.Connection(RPC_URL, {
            commitment: COMMITMENT,
            confirmTransactionInitialTimeout: 30000,
        });
        // WebSocket connection for subscriptions
        this.wsConnection = new web3_js_1.Connection(RPC_URL, {
            commitment: COMMITMENT,
            wsEndpoint: RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://'),
        });
        this.poolPrices = new Map();
        this.lastPriceUpdate = new Map();
        this.priceCache = new Map();
        this.csvLogger = new CsvLogger_1.CsvLogger('./logs/scanner');
        console.log('[FAST] Ultra-fast scanner initialized');
        console.log('[FAST] Commitment level: processed (fastest)');
        console.log('[FAST] WebSocket enabled: true');
    }
    /**
     * Decode Whirlpool sqrt price (optimized)
     */
    decodeSqrtPrice(data) {
        // Fast path: direct buffer read without validation in hot path
        try {
            return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
        }
        catch {
            throw new Error('Invalid whirlpool data');
        }
    }
    /**
     * Convert sqrt price to regular price (cached)
     */
    sqrtPriceToPrice(sqrtPriceX64) {
        const sqrtPrice = new decimal_js_1.default(sqrtPriceX64.toString()).div(constants_1.DECIMAL_2_POW_64);
        const price = sqrtPrice.pow(2);
        return price.mul(constants_1.DECIMAL_10_POW_9).div(constants_1.DECIMAL_10_POW_6);
    }
    /**
     * Process price update (optimized for speed)
     */
    processPriceUpdate(poolAddress, data) {
        try {
            const now = Date.now();
            // Check cache
            const cached = this.priceCache.get(poolAddress);
            if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
                return; // Use cached price, skip decoding
            }
            const sqrtPriceX64 = this.decodeSqrtPrice(data);
            const price = this.sqrtPriceToPrice(sqrtPriceX64);
            this.poolPrices.set(poolAddress, price);
            this.priceCache.set(poolAddress, { price, timestamp: now });
            this.lastPriceUpdate.set(poolAddress, now);
            // Trigger arbitrage check immediately
            this.checkArbitrageOptimized();
        }
        catch (error) {
            console.error(`[FAST] Price decode error: ${error.message}`);
        }
    }
    /**
     * Subscribe to pool account changes via WebSocket (REAL-TIME)
     */
    async subscribeToPoolUpdates() {
        console.log('[FAST] Setting up WebSocket subscriptions...');
        for (const pool of POOLS) {
            try {
                const poolPubkey = new web3_js_1.PublicKey(pool.address);
                const subId = this.wsConnection.onAccountChange(poolPubkey, (accountInfo) => {
                    if (accountInfo && accountInfo.data) {
                        this.processPriceUpdate(pool.address, accountInfo.data);
                    }
                }, COMMITMENT);
                this.subscriptionIds.push(subId);
                console.log(`[FAST] ✓ Subscribed to ${pool.name}`);
            }
            catch (error) {
                console.error(`[FAST] Subscription error for ${pool.name}: ${error.message}`);
            }
        }
        console.log(`[FAST] Active subscriptions: ${this.subscriptionIds.length}`);
    }
    /**
     * Initial price fetch (parallel)
     */
    async fetchInitialPrices() {
        console.log('[FAST] Fetching initial prices (parallel)...');
        const poolPubkeys = POOLS.map(p => new web3_js_1.PublicKey(p.address));
        try {
            // Use getMultipleAccountsInfo for parallel fetching
            const accountInfos = await this.connection.getMultipleAccountsInfo(poolPubkeys, { commitment: COMMITMENT });
            for (let i = 0; i < POOLS.length; i++) {
                const pool = POOLS[i];
                const accountInfo = accountInfos[i];
                if (accountInfo && accountInfo.data) {
                    this.processPriceUpdate(pool.address, accountInfo.data);
                    console.log(`[FAST] ${pool.name}: $${this.poolPrices.get(pool.address)?.toFixed(6)}`);
                }
            }
        }
        catch (error) {
            console.error(`[FAST] Initial fetch error: ${error.message}`);
        }
    }
    /**
     * Optimized arbitrage calculation (minimal allocations)
     */
    checkArbitrageOptimized() {
        if (this.poolPrices.size < 2)
            return;
        const pool1 = POOLS[0];
        const pool2 = POOLS[1];
        const price1 = this.poolPrices.get(pool1.address);
        const price2 = this.poolPrices.get(pool2.address);
        if (!price1 || !price2)
            return;
        this.priceCheckCount++;
        // Fast calculations
        const priceDiff = price1.minus(price2).abs();
        const minPrice = price1.lt(price2) ? price1 : price2;
        const spreadPct = priceDiff.div(minPrice);
        // Determine direction (optimized)
        const buyLower = price1.lt(price2);
        const direction = buyLower
            ? `${pool1.name} -> ${pool2.name}`
            : `${pool2.name} -> ${pool1.name}`;
        const buyPrice = buyLower ? price1 : price2;
        const sellPrice = buyLower ? price2 : price1;
        const buyFee = buyLower ? pool1.fee_rate : pool2.fee_rate;
        const sellFee = buyLower ? pool2.fee_rate : pool1.fee_rate;
        // Profit calculation
        const cost = buyPrice.mul(new decimal_js_1.default(1 + buyFee));
        const revenue = sellPrice.mul(new decimal_js_1.default(1 - sellFee));
        const profitPct = revenue.minus(cost).div(cost);
        const isProfitable = profitPct.gte(MIN_PROFIT_THRESHOLD_DECIMAL);
        // Only log every 10th check to reduce I/O overhead (unless profitable)
        if (isProfitable || this.priceCheckCount % 10 === 0) {
            console.log(`[${this.priceCheckCount}] ${pool1.name}: $${price1.toFixed(6)} | ${pool2.name}: $${price2.toFixed(6)} | Profit: ${profitPct.mul(100).toFixed(4)}%`);
            // Log to CSV (every 10th or if profitable)
            const logEntry = {
                timestamp: Date.now().toString(),
                datetime: new Date().toISOString(),
                signal_direction: direction,
                price_001_pool: price2.toNumber(),
                price_005_pool: price1.toNumber(),
                spread: priceDiff.toNumber(),
                spread_pct: spreadPct.mul(100).toNumber(),
                expected_profit_pct: profitPct.mul(100).toNumber(),
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
        // Write signal if profitable (rate limited to 1 per second)
        if (isProfitable) {
            const now = Date.now();
            if (now - this.lastSignalTime > 1000) {
                console.log(`\n[✓✓✓] PROFITABLE OPPORTUNITY!`);
                console.log(`      Direction: ${direction}`);
                console.log(`      Profit: ${profitPct.mul(100).toFixed(4)}%`);
                const signal = {
                    base: "USDC",
                    direction: direction,
                    profit_pct: profitPct.mul(100).toNumber(),
                    trade_usdc: parseFloat(process.env.TRADE_USD || "480"),
                    timestamp: now,
                };
                fs_1.default.writeFileSync('signal.json', JSON.stringify(signal, null, 2));
                console.log(`      Signal written!\n`);
                this.lastSignalTime = now;
            }
        }
    }
    /**
     * Start ultra-fast scanner
     */
    async start() {
        console.log('\n' + '='.repeat(70));
        console.log('ULTRA-FAST ARBITRAGE SCANNER');
        console.log('='.repeat(70));
        console.log('Speed optimizations:');
        console.log('  • WebSocket subscriptions (real-time updates)');
        console.log('  • Processed commitment (fastest)');
        console.log('  • Price caching (100ms TTL)');
        console.log('  • Parallel RPC calls');
        console.log('  • Minimal allocations');
        console.log('  • Rate-limited logging');
        console.log('='.repeat(70));
        this.isRunning = true;
        // Step 1: Fetch initial prices
        await this.fetchInitialPrices();
        // Step 2: Set up WebSocket subscriptions for real-time updates
        if (WEBSOCKET_ENABLED) {
            await this.subscribeToPoolUpdates();
        }
        console.log('\n[FAST] Scanner running! Listening for price changes...');
        console.log('[FAST] Press Ctrl+C to stop\n');
    }
    /**
     * Stop scanner and cleanup
     */
    stop() {
        this.isRunning = false;
        // Unsubscribe from all WebSocket subscriptions
        for (const subId of this.subscriptionIds) {
            try {
                this.wsConnection.removeAccountChangeListener(subId);
            }
            catch (error) {
                // Ignore cleanup errors
            }
        }
        console.log(`\n[FAST] Scanner stopped`);
        console.log(`[FAST] Total price checks: ${this.priceCheckCount}`);
    }
}
exports.FastScanner = FastScanner;
/* =========================
   MAIN
========================= */
let scannerInstance = null;
async function main() {
    try {
        scannerInstance = new FastScanner();
        await scannerInstance.start();
        // Keep running
        await new Promise(() => { });
    }
    catch (error) {
        console.error('[FAST] Fatal error:', error.message);
        if (scannerInstance) {
            scannerInstance.stop();
        }
        process.exit(1);
    }
}
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[FAST] Shutting down...');
    if (scannerInstance) {
        scannerInstance.stop();
    }
    process.exit(0);
});
if (require.main === module) {
    main();
}
