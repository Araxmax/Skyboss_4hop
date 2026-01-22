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
exports.AllHopsScanner = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const dotenv = __importStar(require("dotenv"));
const fs = __importStar(require("fs"));
const decimal_js_1 = __importDefault(require("decimal.js"));
const MultiPathConstants_1 = require("./MultiPathConstants");
const MultiPathCalculator_1 = require("./MultiPathCalculator");
const MultiPathGenerator_1 = require("./MultiPathGenerator");
const SwapExecutor_1 = require("./SwapExecutor");
const RpcConnectionManager_1 = require("./RpcConnectionManager");
const ComprehensiveLogger_1 = require("./ComprehensiveLogger");
dotenv.config();
class AllHopsScanner {
    constructor() {
        this.swapExecutor = null;
        this.wallet = null;
        this.rpcManager = null;
        // All generated paths
        this.allPaths = [];
        // Runtime state
        this.isRunning = false;
        this.scanCount = 0;
        this.startTime = Date.now();
        this.lastScanTime = 0;
        // Execution tracking
        this.executionCount = 0;
        this.totalProfit = new decimal_js_1.default(0);
        this.successCount = 0;
        this.failCount = 0;
        // Token prices cache
        this.tokenPrices = new Map();
        this.SIGNAL_FILE = "all_hops_signals.json";
        this.LOG_FILE = "all_hops_trades.csv";
        // Execution lock to prevent duplicate executions
        this.executingPaths = new Set();
        const rpcUrl = process.env.RPC_URL || "";
        const walletPath = process.env.WALLET_PATH || "";
        if (!rpcUrl) {
            throw new Error("RPC_URL must be set in .env");
        }
        // Configuration from env
        this.TRADE_USD = new decimal_js_1.default(process.env.TRADE_USD || "100");
        this.MIN_PROFIT_USDC = new decimal_js_1.default(process.env.MIN_PROFIT_USDC || "0.10");
        this.SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || "500");
        this.MAX_PARALLEL_EXECUTIONS = parseInt(process.env.MAX_PARALLEL_EXECUTIONS || "5");
        this.isDryRun = process.env.DRY_RUN !== "false";
        console.log(`\n${"=".repeat(80)}`);
        console.log(" ALL HOPS SCANNER - SIMULTANEOUS MULTI-PATH ARBITRAGE");
        console.log("=".repeat(80));
        console.log(`RPC: ${rpcUrl.substring(0, 50)}...`);
        // Initialize connection with optimized settings
        this.connection = new web3_js_1.Connection(rpcUrl, {
            commitment: "confirmed",
            confirmTransactionInitialTimeout: 60000,
        });
        // Initialize RPC Manager for retry logic (optional)
        try {
            this.rpcManager = new RpcConnectionManager_1.RpcConnectionManager({
                endpoints: [
                    { url: rpcUrl, weight: 100, type: "quicknode" },
                ],
                commitment: "confirmed",
                rateLimitRetryAttempts: 3,
                rateLimitBackoffMs: 500,
            });
            console.log("RPC Manager initialized with retry logic");
        }
        catch (e) {
            console.log("RPC Manager not available, using direct connection");
        }
        // Initialize calculator and path generator
        this.calculator = new MultiPathCalculator_1.MultiPathCalculator();
        this.pathGenerator = new MultiPathGenerator_1.MultiPathGenerator();
        // Generate ALL paths once during initialization
        this.allPaths = this.pathGenerator.generateAllPaths();
        // Initialize comprehensive logger for CSV output
        this.comprehensiveLogger = new ComprehensiveLogger_1.ComprehensiveLogger("./logs");
        // Initialize wallet if provided
        if (walletPath && fs.existsSync(walletPath)) {
            try {
                const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
                this.wallet = web3_js_1.Keypair.fromSecretKey(new Uint8Array(walletData));
                console.log(`Wallet: ${this.wallet.publicKey.toBase58()}`);
                // Initialize swap executor for real trading
                this.swapExecutor = new SwapExecutor_1.SwapExecutor(this.connection, this.wallet, parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.005"), parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || "50000"), {
                    rpcManager: this.rpcManager || undefined,
                    maxRetries: 2,
                    transactionDeadline: 30,
                });
                console.log("Swap Executor initialized for trading");
            }
            catch (e) {
                console.log("Wallet not loaded - running in scan-only mode");
            }
        }
        // Print configuration
        this.printConfiguration();
        // Initialize signal file
        this.initSignalFile();
    }
    printConfiguration() {
        const pathStats = this.pathGenerator.getPathStats(this.allPaths);
        console.log(`\nCONFIGURATION:`);
        console.log(`  Trade Amount: $${this.TRADE_USD} USDC`);
        console.log(`  Min Profit: $${this.MIN_PROFIT_USDC} USDC`);
        console.log(`  Scan Interval: ${this.SCAN_INTERVAL_MS}ms`);
        console.log(`  Max Parallel Executions: ${this.MAX_PARALLEL_EXECUTIONS}`);
        console.log(`  Mode: ${this.isDryRun ? "DRY RUN (Simulation)" : "LIVE TRADING"}`);
        console.log(`\nPATHS SCANNING:`);
        console.log(`  Total Paths: ${pathStats.total}`);
        console.log(`  1-hop paths: ${pathStats.byType["1hop"]}`);
        console.log(`  2-hop paths: ${pathStats.byType["2hop"]}`);
        console.log(`  3-hop paths: ${pathStats.byType["3hop"]}`);
        console.log(`  4-hop paths: ${pathStats.byType["4hop"]}`);
        console.log(`\nPOOLS:`);
        console.log(`  Total: ${MultiPathConstants_1.ALL_POOLS.length} pools across multiple DEXes`);
        // Show CSV log paths
        const logPaths = this.comprehensiveLogger.getLogPaths();
        console.log(`\nCSV LOGGING (All Opportunities):`);
        console.log(`  All Opps:     ${logPaths.allOpportunities}`);
        console.log(`  Tradable:     ${logPaths.tradableOpportunities}`);
        console.log(`  Executed:     ${logPaths.executedTrades}`);
        console.log("=".repeat(80) + "\n");
    }
    initSignalFile() {
        const emptySignal = {
            lastUpdate: Date.now(),
            signals: [],
            spreadAnalysis: {},
        };
        fs.writeFileSync(this.SIGNAL_FILE, JSON.stringify(emptySignal, null, 2));
        console.log(`Signal file initialized: ${this.SIGNAL_FILE}`);
    }
    /**
     * Start the scanner
     */
    async start() {
        console.log("\n[AllHopsScanner] Starting...\n");
        // Check wallet balance if available
        if (this.wallet) {
            await this.checkWalletBalance();
        }
        this.isRunning = true;
        this.startTime = Date.now();
        // Start the main scanning loop
        await this.scanLoop();
    }
    async checkWalletBalance() {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            const solBalance = balance / 1e9;
            console.log(`SOL Balance: ${solBalance.toFixed(4)} SOL`);
            if (solBalance < 0.01) {
                console.warn("WARNING: Low SOL balance - may not be able to execute trades");
            }
        }
        catch (error) {
            console.error("Failed to check wallet balance:", error);
        }
    }
    /**
     * Main scanning loop - runs continuously
     */
    async scanLoop() {
        console.log("[AllHopsScanner] Scanning ALL hops simultaneously...\n");
        while (this.isRunning) {
            const scanStart = Date.now();
            try {
                // STEP 1: Fetch ALL pool data in parallel
                await this.fetchAllPoolsParallel();
                // STEP 2: Simulate ALL paths simultaneously
                const results = this.simulateAllPathsSimultaneous();
                // STEP 2.5: LOG ALL OPPORTUNITIES TO CSV (tradable + non-tradable)
                const allOpportunities = results.map(result => (0, ComprehensiveLogger_1.convertPathSimulationToOpportunity)(this.scanCount, result));
                this.comprehensiveLogger.logAllOpportunities(this.scanCount, allOpportunities);
                this.comprehensiveLogger.logTradableOpportunities(this.scanCount, allOpportunities);
                // STEP 3: Find all profitable opportunities
                const profitableSignals = this.findProfitableOpportunities(results);
                // STEP 4: Analyze spreads for all hop types
                const spreadAnalysis = this.analyzeSpreadsByHopType(results);
                // STEP 5: Execute profitable trades immediately (if any)
                if (profitableSignals.length > 0) {
                    await this.executeOpportunities(profitableSignals, spreadAnalysis);
                }
                // Update stats
                this.scanCount++;
                this.lastScanTime = Date.now() - scanStart;
                // Log progress every 50 scans
                if (this.scanCount % 50 === 0) {
                    this.logProgress();
                }
            }
            catch (error) {
                console.error(`[Scan Error] ${error.message}`);
            }
            // Wait before next scan
            const elapsed = Date.now() - scanStart;
            const waitTime = Math.max(0, this.SCAN_INTERVAL_MS - elapsed);
            if (waitTime > 0) {
                await this.sleep(waitTime);
            }
        }
    }
    /**
     * Fetch all pool data in parallel
     */
    async fetchAllPoolsParallel() {
        // First fetch token prices
        await this.fetchTokenPrices();
        // Fetch all pools in parallel
        const fetchPromises = MultiPathConstants_1.ALL_POOLS.map(pool => this.fetchPoolLiquidity(pool));
        const results = await Promise.allSettled(fetchPromises);
        let successCount = 0;
        results.forEach((result, i) => {
            if (result.status === "fulfilled" && result.value) {
                this.calculator.updatePoolLiquidity(result.value);
                successCount++;
            }
        });
        // Silent success - only log errors
        if (successCount < MultiPathConstants_1.ALL_POOLS.length * 0.5) {
            console.warn(`[Warning] Only ${successCount}/${MultiPathConstants_1.ALL_POOLS.length} pools fetched`);
        }
    }
    /**
     * Fetch token prices (SOL, BONK in USD)
     */
    async fetchTokenPrices() {
        try {
            this.tokenPrices.set("USDC", new decimal_js_1.default(1));
            // Find a USDC/SOL pool for SOL price
            const solPool = MultiPathConstants_1.ALL_POOLS.find(p => p.tokenASymbol === "SOL" && p.tokenBSymbol === "USDC" ||
                p.tokenASymbol === "USDC" && p.tokenBSymbol === "SOL");
            if (solPool && solPool.vaultA && solPool.vaultB) {
                try {
                    const [vaultA, vaultB] = await Promise.all([
                        (0, spl_token_1.getAccount)(this.connection, new web3_js_1.PublicKey(solPool.vaultA)),
                        (0, spl_token_1.getAccount)(this.connection, new web3_js_1.PublicKey(solPool.vaultB)),
                    ]);
                    const isAUSDC = solPool.tokenASymbol === "USDC";
                    const usdcBalance = new decimal_js_1.default((isAUSDC ? vaultA : vaultB).amount.toString()).div(1e6);
                    const solBalance = new decimal_js_1.default((isAUSDC ? vaultB : vaultA).amount.toString()).div(1e9);
                    if (!solBalance.isZero()) {
                        this.tokenPrices.set("SOL", usdcBalance.div(solBalance));
                    }
                }
                catch {
                    this.tokenPrices.set("SOL", new decimal_js_1.default(200)); // Fallback
                }
            }
            else {
                this.tokenPrices.set("SOL", new decimal_js_1.default(200));
            }
            // BONK price (simplified)
            this.tokenPrices.set("BONK", new decimal_js_1.default(0.00002));
        }
        catch {
            this.tokenPrices.set("SOL", new decimal_js_1.default(200));
            this.tokenPrices.set("BONK", new decimal_js_1.default(0.00002));
        }
    }
    /**
     * Fetch liquidity for a single pool
     */
    async fetchPoolLiquidity(pool) {
        try {
            if (!pool.vaultA || !pool.vaultB)
                return null;
            const [vaultA, vaultB] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, new web3_js_1.PublicKey(pool.vaultA)),
                (0, spl_token_1.getAccount)(this.connection, new web3_js_1.PublicKey(pool.vaultB)),
            ]);
            const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
            const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);
            const tokenAReserve = new decimal_js_1.default(vaultA.amount.toString()).div(10 ** tokenADecimals);
            const tokenBReserve = new decimal_js_1.default(vaultB.amount.toString()).div(10 ** tokenBDecimals);
            const priceAtoB = tokenAReserve.isZero() ? new decimal_js_1.default(0) : tokenBReserve.div(tokenAReserve);
            const priceBtoA = tokenBReserve.isZero() ? new decimal_js_1.default(0) : tokenAReserve.div(tokenBReserve);
            const priceA = this.tokenPrices.get(pool.tokenASymbol) || new decimal_js_1.default(0);
            const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new decimal_js_1.default(0);
            const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));
            return {
                poolId: pool.id,
                tokenAReserve,
                tokenBReserve,
                liquidityUSD,
                priceAtoB,
                priceBtoA,
                lastUpdate: Date.now(),
            };
        }
        catch {
            return null;
        }
    }
    getTokenDecimals(symbol) {
        switch (symbol) {
            case "USDC": return MultiPathConstants_1.USDC_DECIMALS;
            case "SOL": return MultiPathConstants_1.SOL_DECIMALS;
            case "BONK": return MultiPathConstants_1.BONK_DECIMALS;
            default: return 6;
        }
    }
    /**
     * Simulate ALL paths simultaneously
     */
    simulateAllPathsSimultaneous() {
        return this.calculator.simulateAllPaths(this.allPaths, this.TRADE_USD);
    }
    /**
     * Find all profitable opportunities from simulation results
     */
    findProfitableOpportunities(results) {
        const signals = [];
        for (const result of results) {
            if (result.isExecutable && result.netProfitUSDC.gte(this.MIN_PROFIT_USDC)) {
                // Skip if already executing this path
                if (this.executingPaths.has(result.pathId))
                    continue;
                const path = this.allPaths.find(p => p.pathId === result.pathId);
                if (!path)
                    continue;
                const signal = {
                    timestamp: Date.now(),
                    pathId: result.pathId,
                    pathType: result.pathType,
                    description: result.description,
                    path: result.swaps.map(s => s.tokenIn).concat(result.swaps[result.swaps.length - 1]?.tokenOut || ""),
                    poolIds: result.swaps.map(s => s.poolId),
                    poolNames: result.swaps.map(s => s.poolName),
                    poolAddresses: path.pools.map((p) => p.address),
                    estimatedProfit: result.netProfitUSDC.toNumber(),
                    profitPercent: result.netProfitPct.mul(100).toNumber(),
                    tradeAmount: this.TRADE_USD.toNumber(),
                    swapDetails: result.swaps.map((s, i) => ({
                        pool: s.poolName,
                        poolAddress: path.pools[i].address,
                        tokenIn: s.tokenIn,
                        tokenOut: s.tokenOut,
                        amountIn: s.amountIn.toFixed(6),
                        amountOut: s.amountOut.toFixed(6),
                        priceImpact: s.priceImpact.mul(100).toFixed(4),
                    })),
                };
                signals.push(signal);
            }
        }
        // Sort by profit descending
        signals.sort((a, b) => b.profitPercent - a.profitPercent);
        return signals;
    }
    /**
     * Analyze spreads for all hop types
     */
    analyzeSpreadsByHopType(results) {
        const analysis = new Map();
        const hopTypes = ["1hop", "2hop", "3hop", "4hop"];
        for (const hopType of hopTypes) {
            const hopResults = results.filter(r => r.pathType === hopType && r.isExecutable);
            if (hopResults.length === 0) {
                analysis.set(hopType, {
                    hopType,
                    count: 0,
                    bestProfit: 0,
                    avgProfit: 0,
                    worstProfit: 0,
                    spreadRange: 0,
                    bestPath: "N/A",
                });
                continue;
            }
            const profits = hopResults.map(r => r.netProfitPct.mul(100).toNumber()).sort((a, b) => b - a);
            const bestResult = hopResults.find(r => r.netProfitPct.mul(100).toNumber() === profits[0]);
            analysis.set(hopType, {
                hopType,
                count: hopResults.length,
                bestProfit: profits[0],
                avgProfit: profits.reduce((a, b) => a + b, 0) / profits.length,
                worstProfit: profits[profits.length - 1],
                spreadRange: profits[0] - profits[profits.length - 1],
                bestPath: bestResult?.description || "N/A",
            });
        }
        return analysis;
    }
    /**
     * Execute profitable opportunities
     */
    async executeOpportunities(signals, spreadAnalysis) {
        // Print spread analysis
        console.log("\n" + "=".repeat(80));
        console.log("SPREAD ANALYSIS - ALL HOPS");
        console.log("=".repeat(80));
        for (const [hopType, analysis] of Array.from(spreadAnalysis)) {
            if (analysis.count > 0) {
                console.log(`\n${hopType.toUpperCase()} (${analysis.count} profitable paths):`);
                console.log(`  Best:  ${analysis.bestProfit.toFixed(4)}%`);
                console.log(`  Avg:   ${analysis.avgProfit.toFixed(4)}%`);
                console.log(`  Worst: ${analysis.worstProfit.toFixed(4)}%`);
                console.log(`  Range: ${analysis.spreadRange.toFixed(4)}%`);
                console.log(`  Best:  ${analysis.bestPath.substring(0, 60)}...`);
            }
        }
        console.log("\n" + "=".repeat(80));
        console.log(`EXECUTING ${Math.min(signals.length, this.MAX_PARALLEL_EXECUTIONS)} OPPORTUNITIES`);
        console.log("=".repeat(80));
        // Limit parallel executions
        const toExecute = signals.slice(0, this.MAX_PARALLEL_EXECUTIONS);
        // Execute in parallel
        const executionPromises = toExecute.map((signal, idx) => this.executeSignal(signal, idx + 1, toExecute.length));
        const results = await Promise.allSettled(executionPromises);
        // Process results
        for (const result of results) {
            if (result.status === "fulfilled" && result.value.success) {
                this.successCount++;
                this.totalProfit = this.totalProfit.plus(result.value.actualProfit || 0);
            }
            else if (result.status === "fulfilled") {
                this.failCount++;
            }
        }
        // Write signals to file
        this.writeSignalsToFile(signals, spreadAnalysis);
    }
    /**
     * Execute a single signal
     */
    async executeSignal(signal, index, total) {
        const startTime = Date.now();
        this.executionCount++;
        // Mark as executing
        this.executingPaths.add(signal.pathId);
        console.log(`\n[${index}/${total}] ${signal.pathType.toUpperCase()}: ${signal.profitPercent.toFixed(4)}%`);
        console.log(`  Path: ${signal.path.join(" -> ")}`);
        console.log(`  Pools: ${signal.poolIds.join(" -> ")}`);
        console.log(`  Profit: $${signal.estimatedProfit.toFixed(4)} USDC`);
        try {
            if (this.isDryRun || !this.swapExecutor) {
                // Simulation mode
                console.log(`  [DRY RUN] Would execute trade`);
                // Simulate execution delay
                await this.sleep(100);
                const result = {
                    success: true,
                    signal,
                    actualProfit: signal.estimatedProfit,
                    executionTimeMs: Date.now() - startTime,
                };
                this.logTrade(signal, result);
                return result;
            }
            // LIVE EXECUTION
            console.log(`  [LIVE] Executing trade...`);
            // For 1-hop paths: Use atomic arbitrage
            if (signal.pathType === "1hop" && signal.poolAddresses.length === 2) {
                const arbResult = await this.swapExecutor.executeArbitrage(signal.poolAddresses[0], signal.poolAddresses[1], "So11111111111111111111111111111111111111112", // SOL
                "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
                this.TRADE_USD, "pool1-to-pool2", parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.005"), false);
                const result = {
                    success: arbResult.success,
                    signal,
                    txSignature: arbResult.bundleSignature,
                    actualProfit: arbResult.profit?.toNumber(),
                    executionTimeMs: Date.now() - startTime,
                    error: arbResult.error,
                };
                this.logTrade(signal, result);
                return result;
            }
            // For multi-hop paths: Execute sequentially
            // TODO: Implement multi-hop atomic execution
            console.log(`  [WARN] Multi-hop execution not yet implemented for ${signal.pathType}`);
            const result = {
                success: false,
                signal,
                executionTimeMs: Date.now() - startTime,
                error: "Multi-hop execution not yet implemented",
            };
            return result;
        }
        catch (error) {
            console.error(`  [ERROR] ${error.message}`);
            return {
                success: false,
                signal,
                executionTimeMs: Date.now() - startTime,
                error: error.message,
            };
        }
        finally {
            // Remove from executing set
            this.executingPaths.delete(signal.pathId);
        }
    }
    /**
     * Log trade to CSV
     */
    logTrade(signal, result) {
        const timestamp = new Date().toISOString();
        const entry = [
            timestamp,
            signal.pathType,
            signal.poolIds.join("->"),
            signal.path.join("->"),
            signal.tradeAmount,
            signal.estimatedProfit.toFixed(6),
            (result.actualProfit || 0).toFixed(6),
            signal.profitPercent.toFixed(4),
            result.executionTimeMs,
            result.success ? "SUCCESS" : "FAILED",
            this.isDryRun ? "DRY_RUN" : "LIVE",
            result.txSignature || "",
            result.error || "",
        ].join(",");
        if (!fs.existsSync(this.LOG_FILE)) {
            const header = "Timestamp,PathType,Pools,Path,TradeAmount,EstProfit,ActualProfit,ProfitPct,ExecTimeMs,Status,Mode,TxSignature,Error\n";
            fs.writeFileSync(this.LOG_FILE, header);
        }
        fs.appendFileSync(this.LOG_FILE, entry + "\n");
    }
    /**
     * Write signals to file
     */
    writeSignalsToFile(signals, spreadAnalysis) {
        const data = {
            lastUpdate: Date.now(),
            signalCount: signals.length,
            signals: signals.slice(0, 20), // Top 20 signals
            spreadAnalysis: Object.fromEntries(spreadAnalysis),
        };
        fs.writeFileSync(this.SIGNAL_FILE, JSON.stringify(data, null, 2));
    }
    /**
     * Log progress
     */
    logProgress() {
        const uptime = ((Date.now() - this.startTime) / 1000).toFixed(0);
        const scanRate = (this.scanCount / ((Date.now() - this.startTime) / 1000)).toFixed(2);
        console.log("\n" + "-".repeat(60));
        console.log(`PROGRESS UPDATE`);
        console.log("-".repeat(60));
        console.log(`Uptime: ${uptime}s | Scans: ${this.scanCount} | Rate: ${scanRate}/s`);
        console.log(`Executions: ${this.executionCount} | Success: ${this.successCount} | Failed: ${this.failCount}`);
        console.log(`Total Profit: $${this.totalProfit.toFixed(4)} USDC`);
        console.log(`Last Scan: ${this.lastScanTime}ms`);
        console.log("-".repeat(60) + "\n");
    }
    /**
     * Stop the scanner
     */
    stop() {
        console.log("\n[AllHopsScanner] Stopping...");
        this.isRunning = false;
        // Print final stats
        const uptime = ((Date.now() - this.startTime) / 1000).toFixed(0);
        console.log("\n" + "=".repeat(80));
        console.log("FINAL STATISTICS");
        console.log("=".repeat(80));
        console.log(`Runtime: ${uptime}s`);
        console.log(`Total Scans: ${this.scanCount}`);
        console.log(`Total Executions: ${this.executionCount}`);
        console.log(`Successful: ${this.successCount}`);
        console.log(`Failed: ${this.failCount}`);
        console.log(`Total Profit: $${this.totalProfit.toFixed(4)} USDC`);
        console.log("=".repeat(80) + "\n");
        process.exit(0);
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.AllHopsScanner = AllHopsScanner;
// Main execution
if (require.main === module) {
    const scanner = new AllHopsScanner();
    process.on("SIGINT", () => scanner.stop());
    process.on("SIGTERM", () => scanner.stop());
    scanner.start().catch(error => {
        console.error("[AllHopsScanner] Fatal error:", error);
        process.exit(1);
    });
}
