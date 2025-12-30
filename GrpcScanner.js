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
exports.HeliusGrpcScanner = void 0;
const web3_js_1 = require("@solana/web3.js");
const decimal_js_1 = __importDefault(require("decimal.js"));
const fs_1 = __importDefault(require("fs"));
const dotenv = __importStar(require("dotenv"));
const constants_1 = require("./constants");
const CsvLogger_1 = require("./CsvLogger");
dotenv.config();
/* =========================
   CONFIGURATION
========================= */
const HELIUS_GRPC_ENDPOINT = process.env.HELIUS_GRPC_ENDPOINT || 'laserstream-mainnet-ewr.helius-rpc.com:443';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_URL = process.env.RPC_URL || '';
const POOLS = constants_1.PREDEFINED_POOLS;
const MIN_PROFIT_THRESHOLD_DECIMAL = new decimal_js_1.default(constants_1.MIN_PROFIT_THRESHOLD);
/* =========================
   HELIUS GRPC CLIENT
========================= */
class HeliusGrpcScanner {
    constructor() {
        this.pollingInterval = null;
        this.isRunning = false;
        this.connection = new web3_js_1.Connection(RPC_URL, 'confirmed');
        this.poolPrices = new Map();
        this.csvLogger = new CsvLogger_1.CsvLogger('./logs/scanner');
    }
    /**
     * Decode Whirlpool account data to get sqrt price
     */
    decodeSqrtPrice(data) {
        if (data.length < 81) {
            throw new Error('Invalid whirlpool data length');
        }
        // sqrt_price is at offset 65-81 (16 bytes, u128)
        return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
    }
    /**
     * Convert sqrt price X64 to regular price (optimized)
     */
    sqrtPriceToPrice(sqrtPriceX64) {
        const sqrtPrice = new decimal_js_1.default(sqrtPriceX64.toString()).div(constants_1.DECIMAL_2_POW_64);
        const price = sqrtPrice.pow(2);
        return price.mul(constants_1.DECIMAL_10_POW_9).div(constants_1.DECIMAL_10_POW_6);
    }
    /**
     * Fetch current pool prices via HTTP RPC (batched for performance)
     */
    async fetchPoolPrices() {
        console.log('\n[gRPC] Fetching pool prices...');
        // Batch RPC calls for better performance
        const poolPublicKeys = POOLS.map(p => new web3_js_1.PublicKey(p.address));
        try {
            const accountInfos = await this.connection.getMultipleAccountsInfo(poolPublicKeys);
            for (let i = 0; i < POOLS.length; i++) {
                const pool = POOLS[i];
                const accountInfo = accountInfos[i];
                if (!accountInfo || !accountInfo.data) {
                    console.error(`[gRPC] Failed to fetch pool: ${pool.name}`);
                    continue;
                }
                try {
                    const sqrtPriceX64 = this.decodeSqrtPrice(accountInfo.data);
                    const price = this.sqrtPriceToPrice(sqrtPriceX64);
                    this.poolPrices.set(pool.address, price);
                    console.log(`[gRPC] ${pool.name}: $${price.toFixed(6)}`);
                }
                catch (error) {
                    console.error(`[gRPC] Error processing ${pool.name}:`, error.message);
                }
            }
        }
        catch (error) {
            console.error(`[gRPC] Error fetching pool prices:`, error.message);
        }
    }
    /**
     * Calculate arbitrage opportunity
     */
    checkArbitrage() {
        if (this.poolPrices.size < 2) {
            return;
        }
        const pool1 = POOLS[0];
        const pool2 = POOLS[1];
        const price1 = this.poolPrices.get(pool1.address);
        const price2 = this.poolPrices.get(pool2.address);
        if (!price1 || !price2) {
            return;
        }
        // Calculate arbitrage
        const priceDiff = price1.minus(price2).abs();
        const minPrice = decimal_js_1.default.min(price1, price2);
        const spreadPct = priceDiff.div(minPrice);
        // Determine direction
        let direction;
        let buyPrice;
        let sellPrice;
        let buyFee;
        let sellFee;
        if (price1.lt(price2)) {
            direction = `${pool1.name} -> ${pool2.name}`;
            buyPrice = price1;
            sellPrice = price2;
            buyFee = pool1.fee_rate;
            sellFee = pool2.fee_rate;
        }
        else {
            direction = `${pool2.name} -> ${pool1.name}`;
            buyPrice = price2;
            sellPrice = price1;
            buyFee = pool2.fee_rate;
            sellFee = pool1.fee_rate;
        }
        // Calculate profit
        const cost = buyPrice.mul(new decimal_js_1.default(1 + buyFee));
        const revenue = sellPrice.mul(new decimal_js_1.default(1 - sellFee));
        const profitPct = revenue.minus(cost).div(cost);
        console.log(`\n[gRPC] Price Update:`);
        console.log(`  ${pool1.name}: $${price1.toFixed(6)}`);
        console.log(`  ${pool2.name}: $${price2.toFixed(6)}`);
        console.log(`  Spread: ${spreadPct.mul(100).toFixed(4)}%`);
        console.log(`  Net Profit: ${profitPct.mul(100).toFixed(4)}%`);
        // Log to CSV for every price check
        const logEntry = {
            timestamp: Date.now().toString(),
            datetime: new Date().toISOString(),
            signal_direction: direction,
            price_001_pool: price2.toNumber(), // pool2 is 0.01%
            price_005_pool: price1.toNumber(), // pool1 is 0.05%
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
            failure_reason: profitPct.gte(MIN_PROFIT_THRESHOLD_DECIMAL) ? "" : "Below profit threshold",
            failure_stage: profitPct.gte(MIN_PROFIT_THRESHOLD_DECIMAL) ? "" : "scanner",
        };
        this.csvLogger.logTrade(logEntry);
        // Check if profitable
        if (profitPct.gte(MIN_PROFIT_THRESHOLD_DECIMAL)) {
            console.log(`\n[✓] PROFITABLE OPPORTUNITY DETECTED!`);
            console.log(`  Direction: ${direction}`);
            console.log(`  Profit: ${profitPct.mul(100).toFixed(4)}%`);
            // Write signal
            const signal = {
                base: "USDC",
                direction: direction,
                profit_pct: profitPct.mul(100).toNumber(),
                trade_usdc: parseFloat(process.env.TRADE_USD || "480"),
                timestamp: Date.now(),
            };
            fs_1.default.writeFileSync('signal.json', JSON.stringify(signal, null, 2));
            console.log(`[✓] Signal written to signal.json`);
        }
        else {
            console.log(`  [×] Not profitable (threshold: ${MIN_PROFIT_THRESHOLD_DECIMAL.mul(100).toFixed(4)}%)`);
        }
    }
    /**
     * Subscribe to pool updates via gRPC
     * Note: Helius gRPC implementation details may vary
     * This is a simplified version that falls back to HTTP polling
     */
    async subscribeToUpdates() {
        console.log('\n' + '='.repeat(70));
        console.log('HELIUS GRPC SCANNER (Real-time Mode)');
        console.log('='.repeat(70));
        console.log(`Endpoint: ${HELIUS_GRPC_ENDPOINT}`);
        console.log(`API Key: ${HELIUS_API_KEY.substring(0, 8)}...`);
        console.log(`Monitoring ${POOLS.length} pools`);
        console.log('='.repeat(70));
        this.isRunning = true;
        // Initial fetch
        await this.fetchPoolPrices();
        this.checkArbitrage();
        // For now, use enhanced HTTP polling as fallback
        // Real gRPC implementation would use Helius-specific proto files
        console.log('\n[gRPC] Using enhanced HTTP polling mode');
        console.log('[gRPC] Checking every 2 seconds for updates...');
        console.log('[gRPC] Press Ctrl+C to stop\n');
        // Use proper interval management with cleanup
        this.pollingInterval = setInterval(async () => {
            if (!this.isRunning) {
                return;
            }
            try {
                await this.fetchPoolPrices();
                this.checkArbitrage();
            }
            catch (error) {
                console.error('[gRPC] Error:', error.message);
            }
        }, 2000); // Check every 2 seconds
    }
    /**
     * Stop the scanner and cleanup resources
     */
    stop() {
        this.isRunning = false;
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        console.log('[gRPC] Scanner stopped and resources cleaned up');
    }
    /**
     * Start the scanner
     */
    async start() {
        if (!HELIUS_API_KEY) {
            throw new Error('HELIUS_API_KEY not set in .env');
        }
        if (!RPC_URL) {
            throw new Error('RPC_URL not set in .env');
        }
        await this.subscribeToUpdates();
    }
}
exports.HeliusGrpcScanner = HeliusGrpcScanner;
/* =========================
   MAIN
========================= */
async function main() {
    try {
        scannerInstance = new HeliusGrpcScanner();
        await scannerInstance.start();
        // Keep running
        await new Promise(() => { });
    }
    catch (error) {
        console.error('Fatal error:', error.message);
        if (scannerInstance) {
            scannerInstance.stop();
        }
        process.exit(1);
    }
}
// Handle graceful shutdown
let scannerInstance = null;
process.on('SIGINT', () => {
    console.log('\n\n[gRPC] Shutting down...');
    if (scannerInstance) {
        scannerInstance.stop();
    }
    process.exit(0);
});
if (require.main === module) {
    main();
}
