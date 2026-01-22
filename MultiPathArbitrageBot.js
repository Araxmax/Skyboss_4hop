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
exports.MultiPathArbitrageBot = void 0;
const web3_js_1 = require("@solana/web3.js");
const decimal_js_1 = __importDefault(require("decimal.js"));
const dotenv = __importStar(require("dotenv"));
const MultiPathGenerator_1 = require("./MultiPathGenerator");
const MultiPathCalculator_1 = require("./MultiPathCalculator");
const MultiPathDataFetcher_1 = require("./MultiPathDataFetcher");
const MultiPathConstants_1 = require("./MultiPathConstants");
const MultiPathLogger_1 = require("./MultiPathLogger");
dotenv.config();
/* =========================
   MULTI-PATH ARBITRAGE BOT

   Dynamically tests:
   - 1-hop: USDC -> X -> USDC
   - 2-hop: USDC -> X -> Y -> USDC
   - 3-hop: USDC -> X -> Y -> X -> USDC
   - 4-hop: USDC -> X <-> Y

   ONLY EXECUTES if profitable after all fees!
========================= */
class MultiPathArbitrageBot {
    constructor(connection) {
        this.isRunning = false;
        this.scanCount = 0;
        this.connection = connection;
        this.generator = new MultiPathGenerator_1.MultiPathGenerator();
        this.calculator = new MultiPathCalculator_1.MultiPathCalculator();
        this.dataFetcher = new MultiPathDataFetcher_1.MultiPathDataFetcher(connection, this.calculator, 5000 // Fetch every 5 seconds
        );
        this.logger = new MultiPathLogger_1.MultiPathLogger();
        this.priceLogger = new MultiPathLogger_1.PoolPriceLogger();
    }
    /**
     * Start bot
     */
    async start(tradeAmountUSDC = 100) {
        if (this.isRunning) {
            console.log("[Bot] Already running");
            return;
        }
        console.log("\n" + "=".repeat(80));
        console.log(" MULTI-PATH ARBITRAGE BOT");
        console.log("=".repeat(80));
        console.log("Strategy: Dynamic path testing (1-hop, 2-hop, 3-hop, 4-hop)");
        console.log(`Trade Amount: ${tradeAmountUSDC} USDC`);
        console.log("Mode: SIMULATION (No real trades yet)");
        console.log();
        const logPaths = this.logger.getLogPaths();
        console.log(" Logging:");
        console.log(`  Scanner data: ${logPaths.scanner}`);
        console.log(`  Trade data:   ${logPaths.trade}`);
        console.log("=".repeat(80));
        // Validate trade amount
        if (tradeAmountUSDC > MultiPathConstants_1.RISK_PARAMS.MAX_TRADE_SIZE_USD) {
            console.warn(`  Capping trade at $${MultiPathConstants_1.RISK_PARAMS.MAX_TRADE_SIZE_USD} (safety limit)`);
            tradeAmountUSDC = MultiPathConstants_1.RISK_PARAMS.MAX_TRADE_SIZE_USD;
        }
        this.isRunning = true;
        // Generate all paths
        console.log("\n[Bot] Generating all possible paths...");
        const allPaths = this.generator.generateAllPaths();
        (0, MultiPathGenerator_1.printPathSummary)(allPaths);
        // Start data fetcher
        console.log("\n[Bot] Starting real-time data fetcher...");
        this.dataFetcher.start();
        // Wait for initial data
        console.log("[Bot] Waiting 6 seconds for initial pool data...");
        await new Promise(resolve => setTimeout(resolve, 6000));
        // Main scan loop
        console.log("\n[Bot] Starting scan loop...");
        console.log("[Bot] Press Ctrl+C to stop\n");
        const tradeAmount = new decimal_js_1.default(tradeAmountUSDC);
        while (this.isRunning) {
            await this.scanCycle(allPaths, tradeAmount);
            await new Promise(resolve => setTimeout(resolve, 10000)); // Scan every 10 seconds
        }
    }
    /**
     * Run one scan cycle
     */
    async scanCycle(paths, tradeAmount) {
        this.scanCount++;
        const startTime = Date.now();
        console.log("\n" + "═".repeat(80));
        console.log(` SCAN CYCLE #${this.scanCount} - ${new Date().toLocaleTimeString()}`);
        console.log("═".repeat(80));
        // Display DEX prices and spreads
        this.displayDexPrices();
        // Get statistics
        const stats = this.calculator.getPathStatistics(paths, tradeAmount);
        // Simulate all paths
        const allResults = this.calculator.simulateAllPaths(paths, tradeAmount);
        // Log all results to Scanner_data.csv
        this.logger.logScannerData(this.scanCount, allResults);
        // Get tradable opportunities
        const tradableResults = allResults.filter(r => r.isExecutable);
        // Log tradable opportunities to Trade_data.csv
        if (tradableResults.length > 0) {
            this.logger.logTradeData(this.scanCount, tradableResults);
        }
        console.log(`\n Scan Results:`);
        console.log(`  Total paths tested: ${stats.totalPaths}`);
        console.log(`  Executable paths: ${stats.executablePaths}`);
        console.log(`\n  By Type:`);
        console.log(`    1-hop: ${stats.byType["1hop"].executable}/${stats.byType["1hop"].total} executable`);
        console.log(`    2-hop: ${stats.byType["2hop"].executable}/${stats.byType["2hop"].total} executable`);
        console.log(`    3-hop: ${stats.byType["3hop"].executable}/${stats.byType["3hop"].total} executable`);
        console.log(`    4-hop: ${stats.byType["4hop"].executable}/${stats.byType["4hop"].total} executable`);
        if (stats.bestPath) {
            console.log(`\n  Best profit: ${(stats.bestPath.netProfitPct.mul(100)).toFixed(4)}% (${stats.bestPath.pathType})`);
            console.log(`  Avg profit: ${(stats.avgProfit.mul(100)).toFixed(4)}%`);
            console.log("\n" + "─".repeat(80));
            console.log(" BEST OPPORTUNITY FOUND");
            console.log("─".repeat(80));
            this.displayOpportunity(stats.bestPath);
            // Classify opportunity
            const profitPct = stats.bestPath.netProfitPct.toNumber();
            const minProfit = (0, MultiPathConstants_1.getMinProfitThreshold)(stats.bestPath.pathType);
            if (profitPct >= minProfit * 2) {
                console.log("\n🔥 EXCELLENT OPPORTUNITY - WOULD EXECUTE IN PRODUCTION");
            }
            else if (profitPct >= minProfit * 1.5) {
                console.log("\n GOOD OPPORTUNITY - CONSIDER EXECUTING");
            }
            else {
                console.log("\n  MARGINAL OPPORTUNITY - MONITOR");
            }
            console.log("─".repeat(80));
        }
        else {
            console.log(`\n NO PROFITABLE PATHS FOUND`);
            // Show top failure reasons
            if (stats.failureReasons.size > 0) {
                console.log(`\nTop Failure Reasons:`);
                const sortedReasons = Array.from(stats.failureReasons.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3);
                sortedReasons.forEach(([reason, count]) => {
                    console.log(`  - ${reason}: ${count} paths`);
                });
            }
        }
        const elapsed = Date.now() - startTime;
        console.log(`\n  Scan completed in ${elapsed}ms`);
        console.log("═".repeat(80));
    }
    /**
     * Display DEX prices and spreads
     */
    displayDexPrices() {
        console.log("\n DEX PRICES & SPREADS:");
        console.log("─".repeat(80));
        // Get token prices
        const tokenPrices = this.dataFetcher.getTokenPrices();
        const solPrice = tokenPrices.get("SOL");
        const bonkPrice = tokenPrices.get("BONK");
        console.log(`\n Token Prices:`);
        console.log(`  USDC: $1.0000`);
        console.log(`  SOL: $${solPrice?.toFixed(4) || "N/A"}`);
        console.log(`  BONK: $${bonkPrice?.toFixed(8) || "N/A"}`);
        // Display prices per pool group
        this.displayPoolGroupPrices("USDC/SOL", ["orca_usdc_sol", "raydium_usdc_sol", "raydium_clmm_usdc_sol"]);
        this.displayPoolGroupPrices("SOL/BONK", ["raydium_sol_bonk", "orca_sol_bonk", "meteora_sol_bonk"]);
        this.displayPoolGroupPrices("USDC/BONK", ["raydium_usdc_bonk", "orca_usdc_bonk", "meteora_usdc_bonk"]);
        console.log("─".repeat(80));
    }
    /**
     * Display prices for a group of pools
     */
    displayPoolGroupPrices(pairName, poolIds) {
        console.log(`\n${pairName} Pools:`);
        const prices = [];
        for (const poolId of poolIds) {
            const liquidity = this.calculator.getPoolLiquidity(poolId);
            const pool = MultiPathConstants_1.ALL_POOLS.find(p => p.id === poolId);
            if (pool) {
                if (liquidity) {
                    // Calculate price in USD
                    let priceUSD = new decimal_js_1.default(0);
                    const tokenPrices = this.dataFetcher.getTokenPrices();
                    if (pool.tokenASymbol === "USDC") {
                        // USDC is base, so price = tokenB price
                        const tokenBPrice = tokenPrices.get(pool.tokenBSymbol);
                        priceUSD = tokenBPrice || new decimal_js_1.default(0);
                    }
                    else if (pool.tokenBSymbol === "USDC") {
                        // USDC is quote, so price = tokenA price
                        const tokenAPrice = tokenPrices.get(pool.tokenASymbol);
                        priceUSD = tokenAPrice || new decimal_js_1.default(0);
                    }
                    else {
                        // Neither token is USDC (e.g., SOL/BONK)
                        const tokenAPrice = tokenPrices.get(pool.tokenASymbol);
                        const tokenBPrice = tokenPrices.get(pool.tokenBSymbol);
                        if (tokenAPrice && tokenBPrice) {
                            // Price of tokenB in USD
                            priceUSD = tokenBPrice;
                        }
                    }
                    prices.push({
                        poolName: pool.name,
                        dex: pool.dex,
                        price: liquidity.priceAtoB,
                        priceUSD,
                        liquidity: liquidity.liquidityUSD,
                    });
                }
            }
        }
        if (prices.length === 0) {
            console.log(`  ❌ No data available (pools not fetched or SDKs not implemented)`);
            return;
        }
        // Sort by price USD
        prices.sort((a, b) => a.priceUSD.minus(b.priceUSD).toNumber());
        // Display prices with clear DEX names
        console.log(`  ${"DEX".padEnd(15)} ${"Price (USD)".padStart(15)} | ${"Liquidity".padStart(12)}`);
        console.log(`  ${"-".repeat(15)} ${"-".repeat(15)} | ${"-".repeat(12)}`);
        for (const p of prices) {
            const dexName = this.getDexDisplayName(p.dex);
            console.log(`  ${dexName.padEnd(15)} $${p.priceUSD.toFixed(4).padStart(14)} | $${p.liquidity.toFixed(0).padStart(11)}`);
        }
        // Calculate and display spread
        if (prices.length >= 2) {
            const lowest = prices[0];
            const highest = prices[prices.length - 1];
            const spread = highest.priceUSD.minus(lowest.priceUSD).div(lowest.priceUSD).mul(100);
            console.log();
            const lowestDex = this.getDexDisplayName(lowest.dex);
            const highestDex = this.getDexDisplayName(highest.dex);
            console.log(`  ${lowestDex} = $${lowest.priceUSD.toFixed(4)}`);
            console.log(`  ${highestDex} = $${highest.priceUSD.toFixed(4)}`);
            console.log(`  Spread = ${spread.toFixed(4)}%`);
        }
    }
    /**
     * Get display name for DEX
     */
    getDexDisplayName(dex) {
        switch (dex) {
            case "orca": return "Orca";
            case "raydium_amm": return "Raydium AMM";
            case "raydium_clmm": return "Raydium CLMM";
            case "meteora": return "Meteora";
            case "phoenix": return "Phoenix";
            default: return dex;
        }
    }
    /**
     * Display opportunity details
     */
    displayOpportunity(result) {
        console.log(`Path ID: ${result.pathId}`);
        console.log(`Type: ${result.pathType.toUpperCase()}`);
        console.log(`Description: ${result.description}`);
        console.log();
        console.log(` Trade Flow:`);
        console.log(`  Start: ${result.initialUSDC.toFixed(6)} USDC`);
        // Display each swap
        for (let i = 0; i < result.swaps.length; i++) {
            const swap = result.swaps[i];
            console.log();
            console.log(`  Pool ${i + 1}: ${swap.poolName}`);
            console.log(`    In: ${swap.amountIn.toFixed(6)} ${swap.tokenIn}`);
            console.log(`    Out: ${swap.amountOut.toFixed(6)} ${swap.tokenOut}`);
            console.log(`    Fee: ${(swap.feeRate.mul(100)).toFixed(3)}%`);
            console.log(`    Impact: ${(swap.priceImpact.mul(100)).toFixed(4)}%`);
            console.log(`    Liquidity: $${swap.liquidityUSD.toFixed(0)}`);
        }
        console.log();
        console.log(`  End: ${result.finalUSDC.toFixed(6)} USDC`);
        console.log();
        console.log(` Profit Analysis:`);
        console.log(`  Gross: ${result.grossProfitUSDC.toFixed(6)} USDC (${(result.grossProfitPct.mul(100)).toFixed(4)}%)`);
        console.log(`  Fees: ${(result.totalFeesPct.mul(100)).toFixed(4)}%`);
        console.log(`  Net: ${result.netProfitUSDC.toFixed(6)} USDC (${(result.netProfitPct.mul(100)).toFixed(4)}%)`);
        console.log();
        console.log(` Risk Assessment:`);
        console.log(`  Total Impact: ${(result.totalPriceImpact.mul(100)).toFixed(4)}%`);
        console.log(`  Total Liquidity: $${result.totalLiquidityUSD.toFixed(0)}`);
        console.log(`  Min Pool Liquidity: $${result.minPoolLiquidityUSD.toFixed(0)}`);
        console.log(`  Simulation Time: ${result.simulationTimeMs}ms`);
    }
    /**
     * Stop bot
     */
    stop() {
        if (!this.isRunning)
            return;
        console.log("\n[Bot] Stopping...");
        this.isRunning = false;
        this.dataFetcher.stop();
        console.log(`[Bot] Total scans: ${this.scanCount}`);
        console.log("[Bot] Stopped.");
    }
}
exports.MultiPathArbitrageBot = MultiPathArbitrageBot;
/* =========================
   MAIN
========================= */
async function main() {
    const RPC_URL = process.env.RPC_URL || "";
    if (!RPC_URL) {
        console.error("ERROR: RPC_URL not set in .env");
        process.exit(1);
    }
    const connection = new web3_js_1.Connection(RPC_URL, "confirmed");
    const bot = new MultiPathArbitrageBot(connection);
    // Handle graceful shutdown
    process.on("SIGINT", () => {
        console.log("\n\n[Main] Received SIGINT, shutting down...");
        bot.stop();
        process.exit(0);
    });
    // Start bot with $100 USDC
    await bot.start(100);
}
// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
