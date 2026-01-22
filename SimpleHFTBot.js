"use strict";
/**
 * SIMPLE HFT BOT - WORKS ON WINDOWS
 *
 * Uses RPC polling (no gRPC needed)
 * Real profitability calculation
 * Fast and reliable
 */
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
exports.SimpleHFTBot = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const decimal_js_1 = __importDefault(require("decimal.js"));
const fs_1 = __importDefault(require("fs"));
const dotenv = __importStar(require("dotenv"));
const SwapExecutor_1 = require("./SwapExecutor");
const constants_1 = require("./constants");
dotenv.config();
/* =========================
   SIMPLE HFT BOT
========================= */
class SimpleHFTBot {
    constructor(config) {
        this.isRunning = false;
        this.scanCount = 0;
        this.tradeCount = 0;
        this.successfulTrades = 0;
        this.totalProfit = new decimal_js_1.default(0);
        this.config = config;
        this.connection = new web3_js_1.Connection(config.rpcUrl, "confirmed");
        this.wallet = this.loadWallet(config.walletPath);
        this.swapExecutor = new SwapExecutor_1.SwapExecutor(this.connection, this.wallet, config.maxSlippagePercent / 100, config.maxPriorityFee);
        console.log("\n" + "=".repeat(80));
        console.log("⚡ SIMPLE HFT BOT - INITIALIZED");
        console.log("=".repeat(80));
        console.log(`Wallet: ${this.wallet.publicKey.toBase58()}`);
        console.log(`Mode: ${config.dryRun ? "🧪 DRY RUN" : "💰 LIVE TRADING"}`);
        console.log(`Trade Size: $${config.tradeAmountUSDC}`);
        console.log(`Min Net Profit: $${config.minNetProfitUSDC}`);
        console.log(`Scan Interval: ${config.scanIntervalMs}ms`);
        console.log("=".repeat(80));
    }
    loadWallet(walletPath) {
        const secret = JSON.parse(fs_1.default.readFileSync(walletPath, "utf8"));
        return web3_js_1.Keypair.fromSecretKey(new Uint8Array(secret));
    }
    /**
     * Decode sqrt price from Orca Whirlpool
     */
    decodeSqrtPrice(data) {
        return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
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
     * Fetch Orca pool price
     */
    async fetchOrcaPrice(poolAddress) {
        try {
            const poolPubkey = new web3_js_1.PublicKey(poolAddress);
            const accountInfo = await this.connection.getAccountInfo(poolPubkey, "confirmed");
            if (!accountInfo?.data)
                return null;
            const sqrtPrice = this.decodeSqrtPrice(accountInfo.data);
            return this.sqrtPriceToPrice(sqrtPrice);
        }
        catch (error) {
            console.error(`[Orca] Error fetching ${poolAddress}: ${error.message}`);
            return null;
        }
    }
    /**
     * Fetch Raydium pool price from vaults
     */
    async fetchRaydiumPrice(vaultA, vaultB) {
        try {
            const vaultAPubkey = new web3_js_1.PublicKey(vaultA);
            const vaultBPubkey = new web3_js_1.PublicKey(vaultB);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            const solBalance = new decimal_js_1.default(vaultAInfo.amount.toString()).div(1e9);
            const usdcBalance = new decimal_js_1.default(vaultBInfo.amount.toString()).div(1e6);
            if (solBalance.isZero())
                return null;
            return usdcBalance.div(solBalance);
        }
        catch (error) {
            console.error(`[Raydium] Error fetching vaults: ${error.message}`);
            return null;
        }
    }
    /**
     * Calculate NET profitability with ALL costs
     */
    calculateProfitability(pool1Price, pool2Price, pool1Fee, pool2Fee) {
        const tradeAmount = new decimal_js_1.default(this.config.tradeAmountUSDC);
        const spread = pool1Price.minus(pool2Price).abs();
        const spreadPercent = spread.div(decimal_js_1.default.min(pool1Price, pool2Price));
        // Gross profit
        const grossProfit = tradeAmount.mul(spreadPercent);
        // Swap fees
        const swap1Fee = tradeAmount.mul(pool1Fee);
        const swap2Fee = tradeAmount.mul(pool2Fee);
        const totalSwapFees = swap1Fee.plus(swap2Fee);
        // Slippage
        const slippageLoss = tradeAmount.mul(this.config.maxSlippagePercent / 100);
        // Gas costs
        const computeUnits = 400000;
        const baseFee = 5000;
        const priorityFeeMultiplier = 1 + (spreadPercent.toNumber() * 2);
        const dynamicPriorityFee = Math.min(this.config.basePriorityFee * priorityFeeMultiplier, this.config.maxPriorityFee);
        const priorityFeeLamports = (dynamicPriorityFee * computeUnits) / 1000000;
        const totalGasLamports = priorityFeeLamports + baseFee;
        const solPriceUSD = 135; // Update this dynamically if needed
        const gasCostUSD = new decimal_js_1.default(totalGasLamports).div(1e9).mul(solPriceUSD);
        // Total costs
        const totalCosts = totalSwapFees.plus(slippageLoss).plus(gasCostUSD);
        // Net profit
        const netProfit = grossProfit.minus(totalCosts);
        const netProfitPercent = netProfit.div(tradeAmount).mul(100);
        return {
            isProfitable: netProfit.gte(this.config.minNetProfitUSDC),
            grossProfit,
            totalCosts,
            netProfit,
            netProfitPercent,
            priorityFee: Math.floor(dynamicPriorityFee),
        };
    }
    /**
     * Scan for arbitrage opportunities
     */
    async scan() {
        this.scanCount++;
        const startTime = Date.now();
        try {
            // Get pool configs
            const orcaPool = constants_1.PREDEFINED_POOLS.find(p => p.type === "orca");
            const raydiumPool = constants_1.PREDEFINED_POOLS.find(p => p.type === "raydium");
            if (!orcaPool || !raydiumPool) {
                console.error("[ERROR] Pool configs not found");
                return;
            }
            // Fetch prices in parallel
            const [orcaPrice, raydiumPrice] = await Promise.all([
                this.fetchOrcaPrice(orcaPool.address),
                raydiumPool.vault_a && raydiumPool.vault_b
                    ? this.fetchRaydiumPrice(raydiumPool.vault_a, raydiumPool.vault_b)
                    : Promise.resolve(null),
            ]);
            if (!orcaPrice || !raydiumPrice) {
                console.log(`[SCAN ${this.scanCount}] Failed to fetch prices`);
                return;
            }
            // Calculate spread
            const spread = orcaPrice.minus(raydiumPrice).abs();
            const spreadPercent = spread.div(decimal_js_1.default.min(orcaPrice, raydiumPrice)).mul(100);
            // Log every 20 scans or if spread > 0.5%
            if (this.scanCount % 20 === 0 || spreadPercent.gte(0.5)) {
                console.log(`\n[SCAN ${this.scanCount}] ${new Date().toLocaleTimeString()}`);
                console.log(`  Orca:    $${orcaPrice.toFixed(4)}`);
                console.log(`  Raydium: $${raydiumPrice.toFixed(4)}`);
                console.log(`  Spread:  ${spreadPercent.toFixed(4)}%`);
            }
            // Calculate profitability
            const analysis = this.calculateProfitability(orcaPrice, raydiumPrice, orcaPool.fee_rate, raydiumPool.fee_rate);
            // If profitable, show analysis
            if (analysis.isProfitable || spreadPercent.gte(0.5)) {
                console.log("\n" + "─".repeat(80));
                console.log("📊 OPPORTUNITY ANALYSIS");
                console.log("─".repeat(80));
                console.log(`Orca Price:    $${orcaPrice.toFixed(4)}`);
                console.log(`Raydium Price: $${raydiumPrice.toFixed(4)}`);
                console.log(`Spread:        ${spreadPercent.toFixed(4)}%`);
                console.log();
                console.log(`Trade Amount:  $${this.config.tradeAmountUSDC.toFixed(2)}`);
                console.log(`Gross Profit:  $${analysis.grossProfit.toFixed(4)}`);
                console.log();
                console.log("Costs:");
                console.log(`  Swap Fees:   -$${analysis.totalCosts.toFixed(4)}`);
                console.log(`  Gas:         (included above)`);
                console.log();
                console.log(`Net Profit:    $${analysis.netProfit.toFixed(4)} (${analysis.netProfitPercent.toFixed(2)}%)`);
                console.log(`Profitable:    ${analysis.isProfitable ? "✅ YES" : "❌ NO"}`);
                if (!analysis.isProfitable) {
                    const breakevenSpread = analysis.totalCosts.div(this.config.tradeAmountUSDC).mul(100);
                    console.log();
                    console.log(`Breakeven:     ${breakevenSpread.toFixed(4)}% spread needed`);
                    console.log(`Gap:           ${breakevenSpread.minus(spreadPercent).toFixed(4)}%`);
                }
                console.log("─".repeat(80));
                // Execute if profitable
                if (analysis.isProfitable) {
                    if (this.config.dryRun) {
                        console.log("\n🧪 DRY RUN: Would execute trade");
                        console.log(`   Expected profit: $${analysis.netProfit.toFixed(4)}`);
                    }
                    else {
                        console.log("\n💰 EXECUTING TRADE...");
                        await this.executeTrade(orcaPool.address, raydiumPool.address, orcaPrice, raydiumPrice, analysis);
                    }
                }
            }
            const elapsed = Date.now() - startTime;
            if (this.scanCount % 20 === 0) {
                console.log(`  Scan time: ${elapsed}ms`);
            }
        }
        catch (error) {
            console.error(`[SCAN ${this.scanCount}] Error: ${error.message}`);
        }
    }
    /**
     * Execute trade
     */
    async executeTrade(pool1, pool2, price1, price2, analysis) {
        this.tradeCount++;
        try {
            const direction = price1.lt(price2) ? "pool1-to-pool2" : "pool2-to-pool1";
            const tokenAMint = "So11111111111111111111111111111111111111112"; // SOL
            const tokenBMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
            const result = await this.swapExecutor.executeArbitrage(pool1, pool2, tokenAMint, tokenBMint, new decimal_js_1.default(this.config.tradeAmountUSDC), direction, this.config.maxSlippagePercent / 100, false);
            if (result.success) {
                this.successfulTrades++;
                const actualProfit = result.profit || new decimal_js_1.default(0);
                this.totalProfit = this.totalProfit.plus(actualProfit);
                console.log("\n✅ TRADE SUCCESSFUL");
                console.log(`   Expected: $${analysis.netProfit.toFixed(4)}`);
                console.log(`   Actual:   $${actualProfit.toFixed(4)}`);
                console.log(`   Signature: ${result.bundleSignature || result.swap1?.signature}`);
            }
            else {
                console.log("\n❌ TRADE FAILED");
                console.log(`   Error: ${result.error}`);
            }
            this.printStats();
        }
        catch (error) {
            console.error(`[TRADE] Error: ${error.message}`);
        }
    }
    /**
     * Print statistics
     */
    printStats() {
        const successRate = this.tradeCount > 0
            ? ((this.successfulTrades / this.tradeCount) * 100).toFixed(2)
            : "0.00";
        console.log("\n" + "=".repeat(80));
        console.log("📈 STATISTICS");
        console.log("=".repeat(80));
        console.log(`Scans: ${this.scanCount}`);
        console.log(`Trades: ${this.tradeCount}`);
        console.log(`Successful: ${this.successfulTrades} (${successRate}%)`);
        console.log(`Total Profit: $${this.totalProfit.toFixed(4)}`);
        console.log("=".repeat(80));
    }
    /**
     * Start bot
     */
    async start() {
        if (this.isRunning) {
            console.log("[BOT] Already running");
            return;
        }
        this.isRunning = true;
        console.log("\n🚀 STARTING BOT");
        console.log("Press Ctrl+C to stop\n");
        // Main loop
        while (this.isRunning) {
            await this.scan();
            await new Promise(resolve => setTimeout(resolve, this.config.scanIntervalMs));
        }
    }
    /**
     * Stop bot
     */
    stop() {
        this.isRunning = false;
        console.log("\n🛑 STOPPING BOT");
        this.printStats();
    }
}
exports.SimpleHFTBot = SimpleHFTBot;
/* =========================
   MAIN
========================= */
async function main() {
    const config = {
        rpcUrl: process.env.RPC_URL || "",
        walletPath: process.env.WALLET_PATH || "",
        dryRun: process.env.DRY_RUN?.toLowerCase() !== "false",
        tradeAmountUSDC: parseFloat(process.env.TRADE_USD || "100"),
        minNetProfitUSDC: parseFloat(process.env.MIN_NET_PROFIT_USDC || "0.10"),
        maxSlippagePercent: parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.5"),
        basePriorityFee: parseInt(process.env.BASE_PRIORITY_FEE_LAMPORTS || "50000"),
        maxPriorityFee: parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || "200000"),
        scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS || "2000"), // 2 seconds
    };
    if (!config.rpcUrl || !config.walletPath) {
        console.error("ERROR: RPC_URL and WALLET_PATH required in .env");
        process.exit(1);
    }
    // SAFETY CHECK
    if (!config.dryRun && config.tradeAmountUSDC < 10) {
        console.error("\n" + "=".repeat(80));
        console.error("⚠️  SAFETY WARNING");
        console.error("=".repeat(80));
        console.error(`Trade size $${config.tradeAmountUSDC} is too small for live trading`);
        console.error("Minimum recommended: $25 (better: $100+)");
        console.error();
        console.error("Small trades lose money to fees!");
        console.error();
        console.error("Either:");
        console.error("  1. Set DRY_RUN=true for testing");
        console.error("  2. Set TRADE_USD=25 or higher");
        console.error("=".repeat(80));
        process.exit(1);
    }
    // WARNING for small trades
    if (!config.dryRun && config.tradeAmountUSDC < 50) {
        console.log("\n" + "=".repeat(80));
        console.log("⚠️  WARNING: Small Trade Size");
        console.log("=".repeat(80));
        console.log(`You're trading with $${config.tradeAmountUSDC} (recommended: $100+)`);
        console.log();
        console.log("With $${config.tradeAmountUSDC} trades:");
        console.log("  • Need 0.78%+ spread to break even");
        console.log("  • Need 1.5%+ spread for meaningful profit ($0.15-0.20)");
        console.log("  • Most opportunities will be unprofitable");
        console.log("  • You may lose money during low volatility");
        console.log();
        console.log("This is allowed but HIGH RISK. Continuing in 5 seconds...");
        console.log("Press Ctrl+C to cancel.");
        console.log("=".repeat(80));
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    const bot = new SimpleHFTBot(config);
    // Handle shutdown
    process.on("SIGINT", () => {
        console.log("\n\nShutdown signal received");
        bot.stop();
        process.exit(0);
    });
    await bot.start();
}
if (require.main === module) {
    main().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
