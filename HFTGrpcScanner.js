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
exports.HFTGrpcScanner = void 0;
const web3_js_1 = require("@solana/web3.js");
const dotenv = __importStar(require("dotenv"));
const fs = __importStar(require("fs"));
const MultiPathConstants_1 = require("./MultiPathConstants");
const MultiPathCalculator_1 = require("./MultiPathCalculator");
const MultiPathDataFetcher_1 = require("./MultiPathDataFetcher");
const MultiPathGenerator_1 = require("./MultiPathGenerator");
const decimal_js_1 = __importDefault(require("decimal.js"));
const ComprehensiveLogger_1 = require("./ComprehensiveLogger");
dotenv.config();
class HFTGrpcScanner {
    constructor() {
        this.allPaths = [];
        this.isRunning = false;
        this.SIGNAL_FILE = "signals.json";
        this.POLL_INTERVAL_MS = 2000; // Poll every 2 seconds (to avoid rate limits)
        this.updateCount = 0;
        this.startTime = Date.now();
        this.TRADE_USD = process.env.TRADE_USD ? new decimal_js_1.default(process.env.TRADE_USD) : new decimal_js_1.default(100);
        this.MIN_PROFIT_USDC = process.env.MIN_PROFIT_USDC ? new decimal_js_1.default(process.env.MIN_PROFIT_USDC) : new decimal_js_1.default(0.10);
        const rpcUrl = process.env.RPC_URL || "";
        if (!rpcUrl) {
            throw new Error("RPC_URL must be set in .env");
        }
        console.log(`[HFT Scanner] Connecting to QuickNode RPC: ${rpcUrl}`);
        // Initialize connection
        this.connection = new web3_js_1.Connection(rpcUrl, {
            commitment: "confirmed",
            wsEndpoint: undefined,
        });
        this.calculator = new MultiPathCalculator_1.MultiPathCalculator();
        this.pathGenerator = new MultiPathGenerator_1.MultiPathGenerator();
        this.dataFetcher = new MultiPathDataFetcher_1.MultiPathDataFetcher(this.connection, this.calculator, 3000 // Fetch pool data every 3 seconds (slower to avoid rate limits)
        );
        // Generate all paths once during initialization
        this.allPaths = this.pathGenerator.generateAllPaths();
        // Initialize comprehensive logger for CSV output
        this.comprehensiveLogger = new ComprehensiveLogger_1.ComprehensiveLogger("./logs");
        // Initialize signal file
        this.initSignalFile();
    }
    initSignalFile() {
        const emptySignal = {
            lastUpdate: Date.now(),
            signal: null,
        };
        fs.writeFileSync(this.SIGNAL_FILE, JSON.stringify(emptySignal, null, 2));
        console.log(`[HFT Scanner] Initialized ${this.SIGNAL_FILE}`);
    }
    async start() {
        console.log("\n" + "=".repeat(80));
        console.log(" HFT SCANNER - QuickNode Optimized (Multi-Path)");
        console.log("=".repeat(80));
        console.log(`Pools: ${MultiPathConstants_1.ALL_POOLS.length}`);
        // Show path statistics
        const pathStats = this.pathGenerator.getPathStats(this.allPaths);
        console.log(`Total Paths Scanning: ${pathStats.total}`);
        console.log(`  1-hop paths: ${pathStats.byType["1hop"]}`);
        console.log(`  2-hop paths: ${pathStats.byType["2hop"]}`);
        console.log(`  3-hop paths: ${pathStats.byType["3hop"]}`);
        console.log(`  4-hop paths: ${pathStats.byType["4hop"]}`);
        console.log(`Scan Interval: ${this.POLL_INTERVAL_MS}ms`);
        console.log(`Signal File: ${this.SIGNAL_FILE}`);
        console.log(`Trade Amount: $${this.TRADE_USD} USDC`);
        console.log(`Min Profit: $${this.MIN_PROFIT_USDC} USDC`);
        // Show CSV log paths
        const logPaths = this.comprehensiveLogger.getLogPaths();
        console.log(`\nCSV LOGGING (All Opportunities):`);
        console.log(`  All Opps:     ${logPaths.allOpportunities}`);
        console.log(`  Tradable:     ${logPaths.tradableOpportunities}`);
        console.log(`  Executed:     ${logPaths.executedTrades}`);
        console.log("=".repeat(80) + "\n");
        // Start data fetcher
        this.dataFetcher.start();
        // Wait for initial data
        console.log("[HFT Scanner] Waiting for initial pool data...");
        await this.sleep(2000);
        // Start scanning loop
        this.isRunning = true;
        this.scanLoop();
    }
    async scanLoop() {
        console.log("[HFT Scanner] 👀 Scanning for opportunities...\n");
        while (this.isRunning) {
            try {
                await this.scanForOpportunities();
                this.updateCount++;
                // Log stats every 100 scans
                if (this.updateCount % 100 === 0) {
                    const uptime = ((Date.now() - this.startTime) / 1000).toFixed(0);
                    const rate = (this.updateCount / (Date.now() - this.startTime) * 1000).toFixed(1);
                    console.log(`[HFT Scanner] Scans: ${this.updateCount} | Rate: ${rate}/s | Uptime: ${uptime}s`);
                }
            }
            catch (error) {
                // Continue on errors
            }
            await this.sleep(this.POLL_INTERVAL_MS);
        }
    }
    async scanForOpportunities() {
        // Simulate all paths in parallel to find ALL profitable opportunities
        const results = this.calculator.simulateAllPaths(this.allPaths, this.TRADE_USD);
        // LOG ALL OPPORTUNITIES TO CSV (tradable + non-tradable)
        const allOpportunities = results.map(result => (0, ComprehensiveLogger_1.convertPathSimulationToOpportunity)(this.updateCount, result));
        this.comprehensiveLogger.logAllOpportunities(this.updateCount, allOpportunities);
        this.comprehensiveLogger.logTradableOpportunities(this.updateCount, allOpportunities);
        // Separate results by path type for spread analysis
        const resultsByType = {
            "1hop": [],
            "2hop": [],
            "3hop": [],
            "4hop": [],
        };
        // Filter and organize all profitable paths
        const profitableSignals = [];
        for (const result of results) {
            if (result.isExecutable && result.netProfitUSDC.gte(this.MIN_PROFIT_USDC)) {
                resultsByType[result.pathType].push(result);
                const signal = {
                    timestamp: Date.now(),
                    pathId: result.pathId,
                    pathType: result.pathType,
                    description: result.description,
                    path: result.swaps.map(s => s.tokenIn).concat(result.swaps[result.swaps.length - 1]?.tokenOut || ""),
                    poolIds: result.swaps.map(s => s.poolId),
                    poolNames: result.swaps.map(s => s.poolName),
                    estimatedProfit: result.netProfitUSDC.toNumber(),
                    profitPercent: result.netProfitPct.mul(100).toNumber(),
                    tradeAmount: this.TRADE_USD.toNumber(),
                    swapDetails: result.swaps.map(s => ({
                        pool: s.poolName,
                        tokenIn: s.tokenIn,
                        tokenOut: s.tokenOut,
                        amountIn: s.amountIn.toFixed(6),
                        amountOut: s.amountOut.toFixed(6),
                        priceImpact: s.priceImpact.mul(100).toFixed(3),
                    })),
                };
                profitableSignals.push(signal);
            }
        }
        // Write ALL profitable signals for simultaneous execution
        if (profitableSignals.length > 0) {
            // Sort by profit percentage descending
            profitableSignals.sort((a, b) => b.profitPercent - a.profitPercent);
            // Log spread analysis by path type
            console.log("\n" + "=".repeat(80));
            console.log("SPREAD ANALYSIS - ALL PATHS");
            console.log("=".repeat(80));
            for (const [pathType, pathResults] of Object.entries(resultsByType)) {
                if (pathResults.length > 0) {
                    const profits = pathResults.map(r => r.netProfitPct.mul(100).toNumber()).sort((a, b) => b - a);
                    const bestProfit = profits[0];
                    const worstProfit = profits[profits.length - 1];
                    const avgProfit = profits.reduce((a, b) => a + b) / profits.length;
                    const spread = bestProfit - worstProfit;
                    console.log(`\n${pathType.toUpperCase()} PATHS:`);
                    console.log(`  Best Spread: ${bestProfit.toFixed(3)}%`);
                    console.log(`  Avg Spread: ${avgProfit.toFixed(3)}%`);
                    console.log(`  Worst Spread: ${worstProfit.toFixed(3)}%`);
                    console.log(`  Spread Range: ${spread.toFixed(3)}%`);
                    console.log(`  Count: ${pathResults.length} paths`);
                }
            }
            console.log("\n" + "=".repeat(80));
            console.log(`EXECUTING ${profitableSignals.length} OPPORTUNITIES IN PARALLEL`);
            console.log("=".repeat(80));
            // Write all signals for parallel execution
            const signalData = {
                lastUpdate: Date.now(),
                signals: profitableSignals,
            };
            fs.writeFileSync(this.SIGNAL_FILE, JSON.stringify(signalData, null, 2));
            // Log each opportunity
            profitableSignals.forEach((signal, idx) => {
                console.log(`[${idx + 1}]  ${signal.pathType.toUpperCase()}: ${signal.profitPercent.toFixed(3)}% profit (${signal.poolIds.join(" → ")})`);
                console.log(`     Path: ${signal.path.join(" → ")}`);
            });
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    stop() {
        console.log("\n[HFT Scanner] Stopping...");
        this.isRunning = false;
        this.dataFetcher.stop();
        process.exit(0);
    }
}
exports.HFTGrpcScanner = HFTGrpcScanner;
// Main execution
if (require.main === module) {
    const scanner = new HFTGrpcScanner();
    process.on("SIGINT", () => scanner.stop());
    process.on("SIGTERM", () => scanner.stop());
    scanner.start().catch(error => {
        console.error("[HFT Scanner] Fatal error:", error);
        process.exit(1);
    });
}
