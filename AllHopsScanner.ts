import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import * as dotenv from "dotenv";
import * as fs from "fs";
import Decimal from "decimal.js";
import {
  ALL_POOLS,
  PathType,
  PoolConfig,
  USDC_DECIMALS,
  SOL_DECIMALS,
  BONK_DECIMALS,
  RISK_PARAMS,
  getMinProfitThreshold,
} from "./MultiPathConstants";
import { MultiPathCalculator, PoolLiquidityData, PathSimulationResult } from "./MultiPathCalculator";
import { MultiPathGenerator } from "./MultiPathGenerator";
import { SwapExecutor } from "./SwapExecutor";
import { RpcConnectionManager } from "./RpcConnectionManager";
import { ComprehensiveLogger, OpportunityData, convertPathSimulationToOpportunity } from "./ComprehensiveLogger";

dotenv.config();

/**
 * ============================================================================
 * ALL HOPS SCANNER - SIMULTANEOUS MULTI-PATH ARBITRAGE
 * ============================================================================
 *
 * Features:
 * - Scans ALL pools SIMULTANEOUSLY
 * - Checks ALL hop combinations (1-hop, 2-hop, 3-hop, 4-hop) in PARALLEL
 * - Executes profitable trades IMMEDIATELY when found
 * - Shows SPREAD ANALYSIS for every hop type
 * - Real-time execution with minimal latency
 *
 * Architecture:
 * 1. Parallel pool data fetching (all 18 pools at once)
 * 2. Simultaneous path simulation (all paths computed in parallel)
 * 3. Immediate execution on profitable opportunities
 * 4. Comprehensive logging and spread analysis
 * ============================================================================
 */

interface ArbitrageSignal {
  timestamp: number;
  pathId: string;
  pathType: PathType;
  description: string;
  path: string[];
  poolIds: string[];
  poolNames: string[];
  poolAddresses: string[];
  estimatedProfit: number;
  profitPercent: number;
  tradeAmount: number;
  swapDetails: {
    pool: string;
    poolAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    priceImpact: string;
  }[];
}

interface SpreadAnalysis {
  hopType: PathType;
  count: number;
  bestProfit: number;
  avgProfit: number;
  worstProfit: number;
  spreadRange: number;
  bestPath: string;
}

interface ExecutionResult {
  success: boolean;
  signal: ArbitrageSignal;
  txSignature?: string;
  actualProfit?: number;
  executionTimeMs: number;
  error?: string;
}

export class AllHopsScanner {
  private connection: Connection;
  private calculator: MultiPathCalculator;
  private pathGenerator: MultiPathGenerator;
  private swapExecutor: SwapExecutor | null = null;
  private wallet: Keypair | null = null;
  private rpcManager: RpcConnectionManager | null = null;
  private comprehensiveLogger: ComprehensiveLogger;

  // All generated paths
  private allPaths: any[] = [];

  // Runtime state
  private isRunning: boolean = false;
  private scanCount: number = 0;
  private startTime: number = Date.now();
  private lastScanTime: number = 0;

  // Execution tracking
  private executionCount: number = 0;
  private totalProfit: Decimal = new Decimal(0);
  private successCount: number = 0;
  private failCount: number = 0;

  // Token prices cache
  private tokenPrices: Map<string, Decimal> = new Map();

  // Configuration
  private readonly TRADE_USD: Decimal;
  private readonly MIN_PROFIT_USDC: Decimal;
  private readonly SCAN_INTERVAL_MS: number;
  private readonly MAX_PARALLEL_EXECUTIONS: number;
  private readonly isDryRun: boolean;
  private readonly SIGNAL_FILE = "all_hops_signals.json";
  private readonly LOG_FILE = "all_hops_trades.csv";

  // Execution lock to prevent duplicate executions
  private executingPaths: Set<string> = new Set();

  constructor() {
    const rpcUrl = process.env.RPC_URL || "";
    const walletPath = process.env.WALLET_PATH || "";

    if (!rpcUrl) {
      throw new Error("RPC_URL must be set in .env");
    }

    // Configuration from env
    this.TRADE_USD = new Decimal(process.env.TRADE_USD || "100");
    this.MIN_PROFIT_USDC = new Decimal(process.env.MIN_PROFIT_USDC || "0.10");
    this.SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || "500");
    this.MAX_PARALLEL_EXECUTIONS = parseInt(process.env.MAX_PARALLEL_EXECUTIONS || "5");
    this.isDryRun = process.env.DRY_RUN !== "false";

    console.log(`\n${"=".repeat(80)}`);
    console.log(" ALL HOPS SCANNER - SIMULTANEOUS MULTI-PATH ARBITRAGE");
    console.log("=".repeat(80));
    console.log(`RPC: ${rpcUrl.substring(0, 50)}...`);

    // Initialize connection with optimized settings
    this.connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60000,
    });

    // Initialize RPC Manager for retry logic (optional)
    try {
      this.rpcManager = new RpcConnectionManager({
        endpoints: [
          { url: rpcUrl, weight: 100, type: "quicknode" },
        ],
        commitment: "confirmed",
        rateLimitRetryAttempts: 3,
        rateLimitBackoffMs: 500,
      });
      console.log("RPC Manager initialized with retry logic");
    } catch (e) {
      console.log("RPC Manager not available, using direct connection");
    }

    // Initialize calculator and path generator
    this.calculator = new MultiPathCalculator();
    this.pathGenerator = new MultiPathGenerator();

    // Generate ALL paths once during initialization
    this.allPaths = this.pathGenerator.generateAllPaths();

    // Initialize comprehensive logger for CSV output
    this.comprehensiveLogger = new ComprehensiveLogger("./logs");

    // Initialize wallet if provided
    if (walletPath && fs.existsSync(walletPath)) {
      try {
        const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
        this.wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
        console.log(`Wallet: ${this.wallet.publicKey.toBase58()}`);

        // Initialize swap executor for real trading
        this.swapExecutor = new SwapExecutor(
          this.connection,
          this.wallet,
          parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.005"),
          parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || "50000"),
          {
            rpcManager: this.rpcManager || undefined,
            maxRetries: 2,
            transactionDeadline: 30,
          }
        );
        console.log("Swap Executor initialized for trading");
      } catch (e) {
        console.log("Wallet not loaded - running in scan-only mode");
      }
    }

    // Print configuration
    this.printConfiguration();

    // Initialize signal file
    this.initSignalFile();
  }

  private printConfiguration(): void {
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
    console.log(`  Total: ${ALL_POOLS.length} pools across multiple DEXes`);

    // Show CSV log paths
    const logPaths = this.comprehensiveLogger.getLogPaths();
    console.log(`\nCSV LOGGING (All Opportunities):`);
    console.log(`  All Opps:     ${logPaths.allOpportunities}`);
    console.log(`  Tradable:     ${logPaths.tradableOpportunities}`);
    console.log(`  Executed:     ${logPaths.executedTrades}`);
    console.log("=".repeat(80) + "\n");
  }

  private initSignalFile(): void {
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
  async start(): Promise<void> {
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

  private async checkWalletBalance(): Promise<void> {
    try {
      const balance = await this.connection.getBalance(this.wallet!.publicKey);
      const solBalance = balance / 1e9;
      console.log(`SOL Balance: ${solBalance.toFixed(4)} SOL`);

      if (solBalance < 0.01) {
        console.warn("WARNING: Low SOL balance - may not be able to execute trades");
      }
    } catch (error) {
      console.error("Failed to check wallet balance:", error);
    }
  }

  /**
   * Main scanning loop - runs continuously
   */
  private async scanLoop(): Promise<void> {
    console.log("[AllHopsScanner] Scanning ALL hops simultaneously...\n");

    while (this.isRunning) {
      const scanStart = Date.now();

      try {
        // STEP 1: Fetch ALL pool data in parallel
        await this.fetchAllPoolsParallel();

        // STEP 2: Simulate ALL paths simultaneously
        const results = this.simulateAllPathsSimultaneous();

        // STEP 2.5: LOG ALL OPPORTUNITIES TO CSV (tradable + non-tradable)
        const allOpportunities: OpportunityData[] = results.map(result =>
          convertPathSimulationToOpportunity(this.scanCount, result)
        );
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

      } catch (error: any) {
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
  private async fetchAllPoolsParallel(): Promise<void> {
    // First fetch token prices
    await this.fetchTokenPrices();

    // Fetch all pools in parallel
    const fetchPromises = ALL_POOLS.map(pool => this.fetchPoolLiquidity(pool));
    const results = await Promise.allSettled(fetchPromises);

    let successCount = 0;
    results.forEach((result, i) => {
      if (result.status === "fulfilled" && result.value) {
        this.calculator.updatePoolLiquidity(result.value);
        successCount++;
      }
    });

    // Silent success - only log errors
    if (successCount < ALL_POOLS.length * 0.5) {
      console.warn(`[Warning] Only ${successCount}/${ALL_POOLS.length} pools fetched`);
    }
  }

  /**
   * Fetch token prices (SOL, BONK in USD)
   */
  private async fetchTokenPrices(): Promise<void> {
    try {
      this.tokenPrices.set("USDC", new Decimal(1));

      // Find a USDC/SOL pool for SOL price
      const solPool = ALL_POOLS.find(p =>
        p.tokenASymbol === "SOL" && p.tokenBSymbol === "USDC" ||
        p.tokenASymbol === "USDC" && p.tokenBSymbol === "SOL"
      );

      if (solPool && solPool.vaultA && solPool.vaultB) {
        try {
          const [vaultA, vaultB] = await Promise.all([
            getAccount(this.connection, new PublicKey(solPool.vaultA)),
            getAccount(this.connection, new PublicKey(solPool.vaultB)),
          ]);

          const isAUSDC = solPool.tokenASymbol === "USDC";
          const usdcBalance = new Decimal((isAUSDC ? vaultA : vaultB).amount.toString()).div(1e6);
          const solBalance = new Decimal((isAUSDC ? vaultB : vaultA).amount.toString()).div(1e9);

          if (!solBalance.isZero()) {
            this.tokenPrices.set("SOL", usdcBalance.div(solBalance));
          }
        } catch {
          this.tokenPrices.set("SOL", new Decimal(200)); // Fallback
        }
      } else {
        this.tokenPrices.set("SOL", new Decimal(200));
      }

      // BONK price (simplified)
      this.tokenPrices.set("BONK", new Decimal(0.00002));
    } catch {
      this.tokenPrices.set("SOL", new Decimal(200));
      this.tokenPrices.set("BONK", new Decimal(0.00002));
    }
  }

  /**
   * Fetch liquidity for a single pool
   */
  private async fetchPoolLiquidity(pool: PoolConfig): Promise<PoolLiquidityData | null> {
    try {
      if (!pool.vaultA || !pool.vaultB) return null;

      const [vaultA, vaultB] = await Promise.all([
        getAccount(this.connection, new PublicKey(pool.vaultA)),
        getAccount(this.connection, new PublicKey(pool.vaultB)),
      ]);

      const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
      const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);

      const tokenAReserve = new Decimal(vaultA.amount.toString()).div(10 ** tokenADecimals);
      const tokenBReserve = new Decimal(vaultB.amount.toString()).div(10 ** tokenBDecimals);

      const priceAtoB = tokenAReserve.isZero() ? new Decimal(0) : tokenBReserve.div(tokenAReserve);
      const priceBtoA = tokenBReserve.isZero() ? new Decimal(0) : tokenAReserve.div(tokenBReserve);

      const priceA = this.tokenPrices.get(pool.tokenASymbol) || new Decimal(0);
      const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new Decimal(0);
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
    } catch {
      return null;
    }
  }

  private getTokenDecimals(symbol: string): number {
    switch (symbol) {
      case "USDC": return USDC_DECIMALS;
      case "SOL": return SOL_DECIMALS;
      case "BONK": return BONK_DECIMALS;
      default: return 6;
    }
  }

  /**
   * Simulate ALL paths simultaneously
   */
  private simulateAllPathsSimultaneous(): PathSimulationResult[] {
    return this.calculator.simulateAllPaths(this.allPaths, this.TRADE_USD);
  }

  /**
   * Find all profitable opportunities from simulation results
   */
  private findProfitableOpportunities(results: PathSimulationResult[]): ArbitrageSignal[] {
    const signals: ArbitrageSignal[] = [];

    for (const result of results) {
      if (result.isExecutable && result.netProfitUSDC.gte(this.MIN_PROFIT_USDC)) {
        // Skip if already executing this path
        if (this.executingPaths.has(result.pathId)) continue;

        const path = this.allPaths.find(p => p.pathId === result.pathId);
        if (!path) continue;

        const signal: ArbitrageSignal = {
          timestamp: Date.now(),
          pathId: result.pathId,
          pathType: result.pathType,
          description: result.description,
          path: result.swaps.map(s => s.tokenIn).concat(result.swaps[result.swaps.length - 1]?.tokenOut || ""),
          poolIds: result.swaps.map(s => s.poolId),
          poolNames: result.swaps.map(s => s.poolName),
          poolAddresses: path.pools.map((p: PoolConfig) => p.address),
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
  private analyzeSpreadsByHopType(results: PathSimulationResult[]): Map<PathType, SpreadAnalysis> {
    const analysis = new Map<PathType, SpreadAnalysis>();
    const hopTypes: PathType[] = ["1hop", "2hop", "3hop", "4hop"];

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
  private async executeOpportunities(
    signals: ArbitrageSignal[],
    spreadAnalysis: Map<PathType, SpreadAnalysis>
  ): Promise<void> {
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
    const executionPromises = toExecute.map((signal, idx) =>
      this.executeSignal(signal, idx + 1, toExecute.length)
    );

    const results = await Promise.allSettled(executionPromises);

    // Process results
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.success) {
        this.successCount++;
        this.totalProfit = this.totalProfit.plus(result.value.actualProfit || 0);
      } else if (result.status === "fulfilled") {
        this.failCount++;
      }
    }

    // Write signals to file
    this.writeSignalsToFile(signals, spreadAnalysis);
  }

  /**
   * Execute a single signal
   */
  private async executeSignal(
    signal: ArbitrageSignal,
    index: number,
    total: number
  ): Promise<ExecutionResult> {
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

        const result: ExecutionResult = {
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
        const arbResult = await this.swapExecutor.executeArbitrage(
          signal.poolAddresses[0],
          signal.poolAddresses[1],
          "So11111111111111111111111111111111111111112", // SOL
          "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
          this.TRADE_USD,
          "pool1-to-pool2",
          parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.005"),
          false
        );

        const result: ExecutionResult = {
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

      const result: ExecutionResult = {
        success: false,
        signal,
        executionTimeMs: Date.now() - startTime,
        error: "Multi-hop execution not yet implemented",
      };

      return result;

    } catch (error: any) {
      console.error(`  [ERROR] ${error.message}`);

      return {
        success: false,
        signal,
        executionTimeMs: Date.now() - startTime,
        error: error.message,
      };
    } finally {
      // Remove from executing set
      this.executingPaths.delete(signal.pathId);
    }
  }

  /**
   * Log trade to CSV
   */
  private logTrade(signal: ArbitrageSignal, result: ExecutionResult): void {
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
  private writeSignalsToFile(
    signals: ArbitrageSignal[],
    spreadAnalysis: Map<PathType, SpreadAnalysis>
  ): void {
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
  private logProgress(): void {
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
  stop(): void {
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

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
