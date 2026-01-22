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
exports.FourHopArbitrageSimulator = void 0;
const web3_js_1 = require("@solana/web3.js");
const decimal_js_1 = __importDefault(require("decimal.js"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const FourHopConstants_1 = require("./FourHopConstants");
const FourHopCalculator_1 = require("./FourHopCalculator");
const FourHopDataFetcher_1 = require("./FourHopDataFetcher");
/* =========================
   4-HOP ARBITRAGE SIMULATOR

   PURPOSE: Test calculation logic before implementing real bot

   FEATURES:
   - Pure calculation mode (no transactions)
   - Real-time data fetching from all DEXes
   - Tests ALL possible 4-hop paths
   - Comprehensive CSV logging
   - Risk analysis and validation
========================= */
class FourHopArbitrageSimulator {
    constructor(connection) {
        this.isRunning = false;
        this.simulationCount = 0;
        this.connection = connection;
        this.calculator = new FourHopCalculator_1.FourHopCalculator();
        this.dataFetcher = new FourHopDataFetcher_1.FourHopDataFetcher(connection, this.calculator, 5000 // Fetch every 5 seconds
        );
        // Setup logging
        this.logDir = FourHopConstants_1.FOUR_HOP_LOG_CONFIG.LOG_DIR;
        this.ensureLogDir();
        this.csvPath = path.join(this.logDir, `simulation_${Date.now()}.csv`);
        this.initializeCsvLog();
    }
    /**
     * Ensure log directory exists
     */
    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
            console.log(`[Simulator] Created log directory: ${this.logDir}`);
        }
    }
    /**
     * Initialize CSV log file with headers
     */
    initializeCsvLog() {
        const header = FourHopConstants_1.FOUR_HOP_LOG_CONFIG.CSV_COLUMNS.join(",");
        fs.writeFileSync(this.csvPath, header + "\n");
        console.log(`[Simulator] CSV log initialized: ${this.csvPath}`);
    }
    /**
     * Log simulation result to CSV
     */
    logToCsv(result) {
        const row = [
            new Date().toISOString(),
            result.pathId,
            `"${result.pathDescription}"`,
            result.initialUSDC.toFixed(6),
            result.hop1.amountOut.toFixed(6),
            result.hop2.amountOut.toFixed(6),
            result.hop3.amountOut.toFixed(6),
            result.finalUSDC.toFixed(6),
            result.grossProfitUSDC.toFixed(6),
            (result.grossProfitPct.mul(100)).toFixed(4),
            (result.totalFeesPct.mul(100)).toFixed(4),
            result.netProfitUSDC.toFixed(6),
            (result.netProfitPct.mul(100)).toFixed(4),
            result.hop1.liquidityUSD.toFixed(0),
            result.hop2.liquidityUSD.toFixed(0),
            result.hop3.liquidityUSD.toFixed(0),
            (result.hop1.priceImpact.mul(100)).toFixed(4),
            (result.hop2.priceImpact.mul(100)).toFixed(4),
            (result.hop3.priceImpact.mul(100)).toFixed(4),
            (result.totalPriceImpact.mul(100)).toFixed(4),
            result.isExecutable ? "TRUE" : "FALSE",
            `"${result.failureReason || ""}"`,
            result.simulationTimeMs.toFixed(0),
        ];
        fs.appendFileSync(this.csvPath, row.join(",") + "\n");
    }
    /**
     * Run continuous simulation
     */
    async start(tradeAmountUSDC = 100) {
        if (this.isRunning) {
            console.log("[Simulator] Already running");
            return;
        }
        console.log("\n" + "=".repeat(80));
        console.log(" 4-HOP ARBITRAGE SIMULATOR");
        console.log("=".repeat(80));
        console.log("Mode: PURE CALCULATION (No Transactions)");
        console.log("Path: USDC → SOL → BONK → USDC");
        console.log(`Trade Amount: ${tradeAmountUSDC} USDC`);
        console.log(`Log File: ${this.csvPath}`);
        console.log("=".repeat(80));
        console.log("\nFundamental Rules:");
        console.log(" USDC is ONLY accounting base");
        console.log(" All profit/loss calculated in USDC");
        console.log(" Never evaluate in SOL or BONK");
        console.log(" Final output MUST end in USDC");
        console.log(" Any path not ending in USDC = REJECT");
        console.log("\nBONK Risk Rules:");
        console.log(` Max trade size: $${FourHopConstants_1.BONK_RISK_PARAMS.MAX_TRADE_SIZE_USD}`);
        console.log(` Min pool liquidity: $${FourHopConstants_1.BONK_RISK_PARAMS.MIN_POOL_LIQUIDITY_USD}`);
        console.log(` Max slippage per hop: ${FourHopConstants_1.BONK_RISK_PARAMS.MAX_SLIPPAGE_PER_HOP * 100}%`);
        console.log(` Min profit after fees: ${FourHopConstants_1.BONK_RISK_PARAMS.MIN_PROFIT_AFTER_FEES * 100}%`);
        console.log("=".repeat(80));
        // Validate trade amount
        if (tradeAmountUSDC > FourHopConstants_1.BONK_RISK_PARAMS.MAX_TRADE_SIZE_USD) {
            console.warn(`⚠️  Trade amount $${tradeAmountUSDC} exceeds max $${FourHopConstants_1.BONK_RISK_PARAMS.MAX_TRADE_SIZE_USD}`);
            console.warn(`⚠️  Capping at $${FourHopConstants_1.BONK_RISK_PARAMS.MAX_TRADE_SIZE_USD} for safety\n`);
            tradeAmountUSDC = FourHopConstants_1.BONK_RISK_PARAMS.MAX_TRADE_SIZE_USD;
        }
        this.isRunning = true;
        // Start data fetcher
        console.log("\n[Simulator] Starting data fetcher...");
        this.dataFetcher.start();
        // Wait for initial data
        console.log("[Simulator] Waiting 6 seconds for initial data fetch...");
        await new Promise((resolve) => setTimeout(resolve, 6000));
        // Generate all possible paths
        const allPaths = (0, FourHopConstants_1.generateFourHopPaths)();
        console.log(`\n[Simulator] Generated ${allPaths.length} possible 4-hop paths`);
        if (allPaths.length === 0) {
            console.error("[Simulator] ERROR: No paths generated!");
            console.error("[Simulator] Check pool configuration in FourHopConstants.ts");
            this.stop();
            return;
        }
        // Display path summary
        console.log("\n" + "-".repeat(80));
        console.log("PATH CONFIGURATION:");
        console.log("-".repeat(80));
        allPaths.slice(0, 5).forEach((path, i) => {
            console.log(`Path ${i + 1}: ${path.description}`);
            console.log(`  Total Fees: ${(path.totalFeeRate * 100).toFixed(2)}%`);
        });
        if (allPaths.length > 5) {
            console.log(`... and ${allPaths.length - 5} more paths`);
        }
        console.log("-".repeat(80));
        // Simulation loop
        console.log("\n[Simulator] Starting simulation loop...");
        console.log("[Simulator] Press Ctrl+C to stop\n");
        const tradeAmount = new decimal_js_1.default(tradeAmountUSDC);
        while (this.isRunning) {
            await this.runSimulationCycle(allPaths, tradeAmount);
            await new Promise((resolve) => setTimeout(resolve, 10000)); // Simulate every 10 seconds
        }
    }
    /**
     * Run one simulation cycle
     */
    async runSimulationCycle(paths, tradeAmount) {
        this.simulationCount++;
        const cycleStartTime = Date.now();
        console.log("\n" + "═".repeat(80));
        console.log(` SIMULATION CYCLE #${this.simulationCount}`);
        console.log("═".repeat(80));
        // Get path statistics
        const stats = this.calculator.getPathStatistics(paths, tradeAmount);
        console.log(`\n Path Statistics:`);
        console.log(`  Total paths: ${stats.totalPaths}`);
        console.log(`  Executable paths: ${stats.executablePaths}`);
        console.log(`  Best profit: ${(stats.bestProfit.mul(100)).toFixed(4)}%`);
        console.log(`  Avg profit: ${(stats.avgProfit.mul(100)).toFixed(4)}%`);
        // Display failure reasons
        if (stats.failureReasons.size > 0) {
            console.log(`\n Failure Reasons:`);
            stats.failureReasons.forEach((count, reason) => {
                console.log(`  - ${reason}: ${count} paths`);
            });
        }
        // Display best path if found
        if (stats.bestPath) {
            console.log("\n" + "─".repeat(80));
            console.log(" BEST PROFITABLE PATH FOUND");
            console.log("─".repeat(80));
            this.displayPathDetails(stats.bestPath);
            console.log("─".repeat(80));
            // Log best path
            this.logToCsv(stats.bestPath);
            // Classify profit level
            const profitPct = stats.bestPath.netProfitPct.toNumber();
            if (profitPct >= FourHopConstants_1.FOUR_HOP_PROFIT_THRESHOLDS.EXCELLENT_PROFIT_THRESHOLD) {
                console.log("\n EXCELLENT PROFIT - EXECUTE IMMEDIATELY!");
            }
            else if (profitPct >= FourHopConstants_1.FOUR_HOP_PROFIT_THRESHOLDS.OPTIMAL_PROFIT_THRESHOLD) {
                console.log("\n OPTIMAL PROFIT - GOOD OPPORTUNITY");
            }
            else if (profitPct >= FourHopConstants_1.FOUR_HOP_PROFIT_THRESHOLDS.MIN_PROFIT_THRESHOLD) {
                console.log("\n  MINIMUM PROFIT - MARGINAL OPPORTUNITY");
            }
        }
        else {
            console.log("\n NO PROFITABLE PATHS FOUND");
            console.log(`   Minimum profit required: ${(FourHopConstants_1.FOUR_HOP_PROFIT_THRESHOLDS.MIN_PROFIT_THRESHOLD * 100).toFixed(2)}%`);
        }
        // Log all results to CSV
        const allResults = this.calculator.simulateAllPaths(paths, tradeAmount);
        allResults.forEach((result) => this.logToCsv(result));
        const cycleTime = Date.now() - cycleStartTime;
        console.log(`\n  Cycle completed in ${cycleTime}ms`);
        console.log("═".repeat(80));
    }
    /**
     * Display detailed path information
     */
    displayPathDetails(result) {
        console.log(`Path ID: ${result.pathId}`);
        console.log(`Description: ${result.pathDescription}`);
        console.log();
        console.log(` Initial USDC: ${result.initialUSDC.toFixed(6)}`);
        console.log();
        console.log(`Hop 1 (USDC → SOL):`);
        console.log(`  Pool: ${result.hop1.poolName} (${result.hop1.dex})`);
        console.log(`  Input: ${result.hop1.amountIn.toFixed(6)} USDC`);
        console.log(`  Output: ${result.hop1.amountOut.toFixed(6)} SOL`);
        console.log(`  Fee: ${(result.hop1.effectiveFeeRate.mul(100)).toFixed(3)}%`);
        console.log(`  Impact: ${(result.hop1.priceImpact.mul(100)).toFixed(4)}%`);
        console.log(`  Liquidity: $${result.hop1.liquidityUSD.toFixed(0)}`);
        console.log();
        console.log(`Hop 2 (SOL → BONK):`);
        console.log(`  Pool: ${result.hop2.poolName} (${result.hop2.dex})`);
        console.log(`  Input: ${result.hop2.amountIn.toFixed(6)} SOL`);
        console.log(`  Output: ${result.hop2.amountOut.toFixed(2)} BONK`);
        console.log(`  Fee: ${(result.hop2.effectiveFeeRate.mul(100)).toFixed(3)}%`);
        console.log(`  Impact: ${(result.hop2.priceImpact.mul(100)).toFixed(4)}%`);
        console.log(`  Liquidity: $${result.hop2.liquidityUSD.toFixed(0)}`);
        console.log();
        console.log(`Hop 3 (BONK → USDC):`);
        console.log(`  Pool: ${result.hop3.poolName} (${result.hop3.dex})`);
        console.log(`  Input: ${result.hop3.amountIn.toFixed(2)} BONK`);
        console.log(`  Output: ${result.hop3.amountOut.toFixed(6)} USDC`);
        console.log(`  Fee: ${(result.hop3.effectiveFeeRate.mul(100)).toFixed(3)}%`);
        console.log(`  Impact: ${(result.hop3.priceImpact.mul(100)).toFixed(4)}%`);
        console.log(`  Liquidity: $${result.hop3.liquidityUSD.toFixed(0)}`);
        console.log();
        console.log(` Final USDC: ${result.finalUSDC.toFixed(6)}`);
        console.log();
        console.log(` Profit Analysis:`);
        console.log(`  Gross Profit: ${result.grossProfitUSDC.toFixed(6)} USDC (${(result.grossProfitPct.mul(100)).toFixed(4)}%)`);
        console.log(`  Total Fees: ${(result.totalFeesPct.mul(100)).toFixed(4)}%`);
        console.log(`  Net Profit: ${result.netProfitUSDC.toFixed(6)} USDC (${(result.netProfitPct.mul(100)).toFixed(4)}%)`);
        console.log();
        console.log(` Risk Metrics:`);
        console.log(`  Total Price Impact: ${(result.totalPriceImpact.mul(100)).toFixed(4)}%`);
        console.log(`  Total Liquidity: $${result.totalLiquidityUSD.toFixed(0)}`);
        console.log(`  Min Hop Liquidity: $${result.minHopLiquidityUSD.toFixed(0)}`);
        console.log(`  Simulation Time: ${result.simulationTimeMs}ms`);
    }
    /**
     * Stop simulator
     */
    stop() {
        if (!this.isRunning) {
            return;
        }
        console.log("\n[Simulator] Stopping...");
        this.isRunning = false;
        this.dataFetcher.stop();
        console.log(`[Simulator] Total simulations: ${this.simulationCount}`);
        console.log(`[Simulator] Log saved to: ${this.csvPath}`);
        console.log("[Simulator] Stopped.");
    }
    /**
     * Run single simulation (for testing)
     */
    async runOnce(tradeAmountUSDC = 100) {
        console.log("\n[Simulator] Running single simulation...");
        // Start data fetcher
        this.dataFetcher.start();
        // Wait for initial data
        await new Promise((resolve) => setTimeout(resolve, 6000));
        // Generate paths
        const allPaths = (0, FourHopConstants_1.generateFourHopPaths)();
        if (allPaths.length === 0) {
            console.error("[Simulator] No paths generated!");
            this.dataFetcher.stop();
            return;
        }
        // Run one cycle
        const tradeAmount = new decimal_js_1.default(tradeAmountUSDC);
        await this.runSimulationCycle(allPaths, tradeAmount);
        // Stop
        this.dataFetcher.stop();
        console.log("\n[Simulator] Single simulation complete.");
    }
}
exports.FourHopArbitrageSimulator = FourHopArbitrageSimulator;
/* =========================
   MAIN (for testing)
========================= */
async function main() {
    const RPC_URL = process.env.RPC_URL || "";
    if (!RPC_URL) {
        console.error("ERROR: RPC_URL not set in .env");
        process.exit(1);
    }
    const connection = new web3_js_1.Connection(RPC_URL, "confirmed");
    const simulator = new FourHopArbitrageSimulator(connection);
    // Handle graceful shutdown
    process.on("SIGINT", () => {
        console.log("\n\n[Main] Received SIGINT, shutting down...");
        simulator.stop();
        process.exit(0);
    });
    // Run simulator
    await simulator.start(100); // Test with $100 USDC
}
// Run if executed directly
if (require.main === module) {
    main().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
//export { FourHopArbitrageSimulator };
