"use strict";
/**
 * REAL MULTI-POOL HFT BOT
 *
 * Scans 18+ pools across Orca, Raydium, Meteora
 * Uses QuickNode RPC for real-time price monitoring
 * Executes profitable arbitrage trades automatically
 * Proper fee calculation and risk management
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
exports.RealMultiPoolHFTBot = void 0;
const web3_js_1 = require("@solana/web3.js");
const decimal_js_1 = __importDefault(require("decimal.js"));
const fs_1 = __importDefault(require("fs"));
const dotenv = __importStar(require("dotenv"));
const MultiPoolGrpcScanner_1 = require("./MultiPoolGrpcScanner");
const MultiPoolArbitrageFinder_1 = require("./MultiPoolArbitrageFinder");
const SwapExecutor_1 = require("./SwapExecutor");
const MultiPathConstants_1 = require("./MultiPathConstants");
dotenv.config();
/* =========================
   REAL MULTI-POOL HFT BOT
========================= */
class RealMultiPoolHFTBot {
    constructor(config) {
        this.isRunning = false;
        this.scanCount = 0;
        this.tradeCount = 0;
        this.successfulTrades = 0;
        this.failedTrades = 0;
        this.totalProfitUSD = new decimal_js_1.default(0);
        this.lastOpportunityTime = 0;
        this.opportunitiesFound = 0;
        this.config = config;
        this.connection = new web3_js_1.Connection(config.rpcUrl, "confirmed");
        this.wallet = this.loadWallet(config.walletPath);
        // Initialize scanner
        this.scanner = new MultiPoolGrpcScanner_1.MultiPoolGrpcScanner(config.rpcUrl, config.scanIntervalMs);
        // Initialize arbitrage finder
        this.arbitrageFinder = new MultiPoolArbitrageFinder_1.MultiPoolArbitrageFinder(this.scanner, config.tradeAmountUSD, config.minNetProfitUSD, config.maxSlippagePercent, config.basePriorityFee, config.solPriceUSD);
        // Initialize swap executor
        this.swapExecutor = new SwapExecutor_1.SwapExecutor(this.connection, this.wallet, config.maxSlippagePercent / 100, config.maxPriorityFee);
        this.printHeader();
    }
    /**
     * Load wallet from file
     */
    loadWallet(walletPath) {
        const secret = JSON.parse(fs_1.default.readFileSync(walletPath, "utf8"));
        return web3_js_1.Keypair.fromSecretKey(new Uint8Array(secret));
    }
    /**
     * Print bot header
     */
    printHeader() {
        console.log("\n" + "=".repeat(80));
        console.log("⚡ REAL MULTI-POOL HFT BOT");
        console.log("=".repeat(80));
        console.log(`Wallet:           ${this.wallet.publicKey.toBase58()}`);
        console.log(`Mode:             ${this.config.dryRun ? "🧪 DRY RUN" : "💰 LIVE TRADING"}`);
        console.log(`Total Pools:      ${MultiPathConstants_1.ALL_POOLS.length}`);
        console.log(`Trade Size:       $${this.config.tradeAmountUSD}`);
        console.log(`Min Net Profit:   $${this.config.minNetProfitUSD}`);
        console.log(`Max Slippage:     ${this.config.maxSlippagePercent}%`);
        console.log(`Scan Interval:    ${this.config.scanIntervalMs}ms`);
        console.log(`Priority Fee:     ${this.config.basePriorityFee}-${this.config.maxPriorityFee} µLamports/CU`);
        console.log("=".repeat(80));
        // Print pool breakdown
        const orcaPools = MultiPathConstants_1.ALL_POOLS.filter(p => p.dex === "orca").length;
        const raydiumAmmPools = MultiPathConstants_1.ALL_POOLS.filter(p => p.dex === "raydium_amm").length;
        const raydiumClmmPools = MultiPathConstants_1.ALL_POOLS.filter(p => p.dex === "raydium_clmm").length;
        const meteoraPools = MultiPathConstants_1.ALL_POOLS.filter(p => p.dex === "meteora").length;
        console.log("\n📊 POOL BREAKDOWN:");
        console.log(`   Orca Whirlpool:    ${orcaPools} pools`);
        console.log(`   Raydium AMM:       ${raydiumAmmPools} pools`);
        console.log(`   Raydium CLMM:      ${raydiumClmmPools} pools`);
        console.log(`   Meteora DLMM:      ${meteoraPools} pools`);
        const solUsdcPools = MultiPathConstants_1.ALL_POOLS.filter(p => (p.tokenASymbol === "SOL" && p.tokenBSymbol === "USDC") ||
            (p.tokenASymbol === "USDC" && p.tokenBSymbol === "SOL")).length;
        const bonkSolPools = MultiPathConstants_1.ALL_POOLS.filter(p => (p.tokenASymbol === "BONK" && p.tokenBSymbol === "SOL") ||
            (p.tokenASymbol === "SOL" && p.tokenBSymbol === "BONK")).length;
        const bonkUsdcPools = MultiPathConstants_1.ALL_POOLS.filter(p => (p.tokenASymbol === "BONK" && p.tokenBSymbol === "USDC") ||
            (p.tokenASymbol === "USDC" && p.tokenBSymbol === "BONK")).length;
        console.log("\n🪙 TOKEN PAIRS:");
        console.log(`   SOL/USDC:          ${solUsdcPools} pools`);
        console.log(`   BONK/SOL:          ${bonkSolPools} pools`);
        console.log(`   BONK/USDC:         ${bonkUsdcPools} pools`);
        console.log("=".repeat(80));
    }
    /**
     * Start bot
     */
    async start() {
        if (this.isRunning) {
            console.log("\n[Bot] Already running");
            return;
        }
        this.isRunning = true;
        console.log("\n🚀 STARTING BOT...\n");
        // Start scanner
        console.log("[1/2] Starting multi-pool scanner...");
        await this.scanner.start();
        // Wait for initial data
        console.log("[2/2] Waiting for initial pool data (5 seconds)...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log("\n✅ Bot is now running!");
        console.log("Press Ctrl+C to stop\n");
        // Main scanning loop
        while (this.isRunning) {
            await this.scanForOpportunities();
            await new Promise(resolve => setTimeout(resolve, this.config.scanIntervalMs));
        }
    }
    /**
     * Scan for arbitrage opportunities
     */
    async scanForOpportunities() {
        this.scanCount++;
        try {
            // Find all arbitrage opportunities
            const opportunities = this.arbitrageFinder.findOpportunities();
            if (opportunities.length > 0) {
                this.opportunitiesFound += opportunities.length;
                this.lastOpportunityTime = Date.now();
                // Log summary every 10 scans or if profitable opportunity found
                if (this.scanCount % 10 === 0 || opportunities.length > 0) {
                    const stats = this.scanner.getStats();
                    const tokenPrices = stats.tokenPrices;
                    console.log(`\n[SCAN ${this.scanCount}] ${new Date().toLocaleTimeString()}`);
                    console.log(`  Active Pools: ${stats.activePools}/${stats.totalPools}`);
                    console.log(`  SOL Price:    $${tokenPrices.get("SOL")?.toFixed(2) || "N/A"}`);
                    console.log(`  BONK Price:   $${tokenPrices.get("BONK")?.toFixed(8) || "N/A"}`);
                    console.log(`  Opportunities: ${opportunities.length}`);
                }
                // Get best opportunity
                const best = opportunities[0];
                // Print best opportunity
                this.arbitrageFinder.printOpportunity(best);
                // Execute if profitable enough
                if (best.netProfitUSD.gte(this.config.minNetProfitUSD)) {
                    if (this.config.dryRun) {
                        console.log("\n🧪 DRY RUN: Would execute trade");
                        console.log(`   Expected profit: $${best.netProfitUSD.toFixed(4)}`);
                        console.log(`   Pools: ${best.buyPool.name} → ${best.sellPool.name}`);
                    }
                    else {
                        console.log("\n💰 EXECUTING TRADE...");
                        await this.executeTrade(best);
                    }
                }
                else {
                    console.log(`\n⚠️  Profit too low: $${best.netProfitUSD.toFixed(4)} < $${this.config.minNetProfitUSD}`);
                }
            }
            else {
                // Log every 20 scans even if no opportunities
                if (this.scanCount % 20 === 0) {
                    const stats = this.scanner.getStats();
                    const tokenPrices = stats.tokenPrices;
                    console.log(`\n[SCAN ${this.scanCount}] ${new Date().toLocaleTimeString()}`);
                    console.log(`  Active Pools: ${stats.activePools}/${stats.totalPools}`);
                    console.log(`  SOL Price:    $${tokenPrices.get("SOL")?.toFixed(2) || "N/A"}`);
                    console.log(`  No profitable opportunities`);
                }
            }
        }
        catch (error) {
            console.error(`\n[ERROR] Scan ${this.scanCount}: ${error.message}`);
        }
    }
    /**
     * Execute arbitrage trade
     */
    async executeTrade(opportunity) {
        this.tradeCount++;
        try {
            const startTime = Date.now();
            // Execute via SwapExecutor
            // Map direction from arbitrage nomenclature to pool nomenclature
            const mappedDirection = opportunity.direction === "buy-then-sell"
                ? "pool1-to-pool2"
                : "pool2-to-pool1";
            const result = await this.swapExecutor.executeArbitrage(opportunity.buyPool.address, opportunity.sellPool.address, opportunity.buyPool.tokenA, opportunity.buyPool.tokenB, opportunity.tradeAmountUSD, mappedDirection, this.config.maxSlippagePercent / 100, false // Not atomic - use separate transactions
            );
            const elapsed = Date.now() - startTime;
            if (result.success) {
                this.successfulTrades++;
                const actualProfit = result.profit || new decimal_js_1.default(0);
                this.totalProfitUSD = this.totalProfitUSD.plus(actualProfit);
                console.log("\n" + "✅".repeat(40));
                console.log("✅ TRADE SUCCESSFUL!");
                console.log("✅".repeat(40));
                console.log(`Expected Profit: $${opportunity.netProfitUSD.toFixed(4)}`);
                console.log(`Actual Profit:   $${actualProfit.toFixed(4)}`);
                console.log(`Execution Time:  ${elapsed}ms`);
                console.log(`Swap 1 Sig:      ${result.swap1?.signature || "N/A"}`);
                console.log(`Swap 2 Sig:      ${result.swap2?.signature || "N/A"}`);
                console.log("=".repeat(80));
                this.printStats();
            }
            else {
                this.failedTrades++;
                console.log("\n" + "".repeat(40));
                console.log("❌ TRADE FAILED");
                console.log("❌".repeat(40));
                console.log(`Error: ${result.error || "Unknown error"}`);
                console.log(`Execution Time: ${elapsed}ms`);
                console.log("=".repeat(80));
                this.printStats();
            }
        }
        catch (error) {
            this.failedTrades++;
            console.error(`\n❌ TRADE ERROR: ${error.message}`);
            this.printStats();
        }
    }
    /**
     * Print statistics
     */
    printStats() {
        const successRate = this.tradeCount > 0
            ? ((this.successfulTrades / this.tradeCount) * 100).toFixed(2)
            : "0.00";
        const avgProfitPerTrade = this.successfulTrades > 0
            ? this.totalProfitUSD.div(this.successfulTrades)
            : new decimal_js_1.default(0);
        console.log("\n" + "═".repeat(80));
        console.log("📈 SESSION STATISTICS");
        console.log("═".repeat(80));
        console.log(`Scans:              ${this.scanCount}`);
        console.log(`Opportunities:      ${this.opportunitiesFound}`);
        console.log(`Trades Executed:    ${this.tradeCount}`);
        console.log(`  ✅ Successful:    ${this.successfulTrades} (${successRate}%)`);
        console.log(`  ❌ Failed:        ${this.failedTrades}`);
        console.log(`Total Profit:       $${this.totalProfitUSD.toFixed(4)}`);
        console.log(`Avg Profit/Trade:   $${avgProfitPerTrade.toFixed(4)}`);
        console.log("═".repeat(80));
    }
    /**
     * Stop bot
     */
    stop() {
        if (!this.isRunning)
            return;
        console.log("\n🛑 STOPPING BOT...");
        this.isRunning = false;
        this.scanner.stop();
        console.log("\n✅ Bot stopped");
        this.printStats();
    }
}
exports.RealMultiPoolHFTBot = RealMultiPoolHFTBot;
/* =========================
   MAIN
========================= */
async function main() {
    const config = {
        rpcUrl: process.env.RPC_URL || "",
        walletPath: process.env.WALLET_PATH || "",
        dryRun: process.env.DRY_RUN?.toLowerCase() !== "false",
        tradeAmountUSD: parseFloat(process.env.TRADE_USD || "25"),
        minNetProfitUSD: parseFloat(process.env.MIN_PROFIT_USDC || "0.10"),
        maxSlippagePercent: parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.5"),
        basePriorityFee: parseInt(process.env.BASE_PRIORITY_FEE_LAMPORTS || "100000"),
        maxPriorityFee: parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || "200000"),
        scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS || "2000"),
        solPriceUSD: parseFloat(process.env.SOL_PRICE_USD || "135"),
    };
    if (!config.rpcUrl || !config.walletPath) {
        console.error("\n❌ ERROR: RPC_URL and WALLET_PATH required in .env");
        process.exit(1);
    }
    // Safety checks
    if (!config.dryRun && config.tradeAmountUSD < 10) {
        console.error("\n" + "=".repeat(80));
        console.error("⚠️  SAFETY WARNING");
        console.error("=".repeat(80));
        console.error(`Trade size $${config.tradeAmountUSD} is too small for live trading`);
        console.error("Minimum: $10 (recommended: $25+)");
        console.error("\nEither:");
        console.error("  1. Set DRY_RUN=true for testing");
        console.error("  2. Set TRADE_USD=25 or higher");
        console.error("=".repeat(80));
        process.exit(1);
    }
    // Warning for small trades
    if (!config.dryRun && config.tradeAmountUSD < 50) {
        console.log("\n" + "=".repeat(80));
        console.log("⚠️  WARNING: Small Trade Size");
        console.log("=".repeat(80));
        console.log(`Trading with $${config.tradeAmountUSD} (recommended: $100+)`);
        console.log("\nRisks:");
        console.log("  • Need 0.8%+ spread to break even");
        console.log("  • Most opportunities unprofitable");
        console.log("  • High risk of losses");
        console.log("\nContinuing in 5 seconds... Press Ctrl+C to cancel.");
        console.log("=".repeat(80));
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    const bot = new RealMultiPoolHFTBot(config);
    // Handle shutdown
    process.on("SIGINT", () => {
        console.log("\n\n🛑 Shutdown signal received");
        bot.stop();
        process.exit(0);
    });
    await bot.start();
}
if (require.main === module) {
    main().catch((error) => {
        console.error("\n❌ FATAL ERROR:", error);
        process.exit(1);
    });
}
