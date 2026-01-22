import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import * as dotenv from "dotenv";
import * as fs from "fs";
import { ALL_POOLS, PathType } from "./MultiPathConstants";
import { MultiPathCalculator } from "./MultiPathCalculator";
import { MultiPathDataFetcher } from "./MultiPathDataFetcher";
import { MultiPathGenerator } from "./MultiPathGenerator";
import Decimal from "decimal.js";
import { ComprehensiveLogger, OpportunityData, convertPathSimulationToOpportunity } from "./ComprehensiveLogger";

dotenv.config();

/**
 * HFT-Optimized Scanner using QuickNode
 *
 * Features:
 * - Fast polling with QuickNode RPC
 * - Tracks all 18 pools continuously
 * - Writes opportunities to signals.json for executor
 */

interface ArbitrageSignal {
  timestamp: number;
  pathId: string;
  pathType: PathType;
  description: string;
  path: string[];
  poolIds: string[];
  poolNames: string[];
  estimatedProfit: number;
  profitPercent: number;
  tradeAmount: number;
  swapDetails: {
    pool: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    priceImpact: string;
  }[];
}

export class HFTGrpcScanner {
  private connection: Connection;
  private calculator: MultiPathCalculator;
  private dataFetcher: MultiPathDataFetcher;
  private pathGenerator: MultiPathGenerator;
  private comprehensiveLogger: ComprehensiveLogger;
  private allPaths: any[] = [];
  private isRunning: boolean = false;
  private readonly SIGNAL_FILE = "signals.json";
  private readonly POLL_INTERVAL_MS = 2000; // Poll every 2 seconds (to avoid rate limits)
  private updateCount: number = 0;
  private startTime: number = Date.now();
  private readonly TRADE_USD = process.env.TRADE_USD ? new Decimal(process.env.TRADE_USD) : new Decimal(100);
  private readonly MIN_PROFIT_USDC = process.env.MIN_PROFIT_USDC ? new Decimal(process.env.MIN_PROFIT_USDC) : new Decimal(0.10);

  constructor() {
    const rpcUrl = process.env.RPC_URL || "";

    if (!rpcUrl) {
      throw new Error("RPC_URL must be set in .env");
    }

    console.log(`[HFT Scanner] Connecting to QuickNode RPC: ${rpcUrl}`);

    // Initialize connection
    this.connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      wsEndpoint: undefined,
    });

    this.calculator = new MultiPathCalculator();
    this.pathGenerator = new MultiPathGenerator();
    this.dataFetcher = new MultiPathDataFetcher(
      this.connection,
      this.calculator,
      3000 // Fetch pool data every 3 seconds (slower to avoid rate limits)
    );

    // Generate all paths once during initialization
    this.allPaths = this.pathGenerator.generateAllPaths();

    // Initialize comprehensive logger for CSV output
    this.comprehensiveLogger = new ComprehensiveLogger("./logs");

    // Initialize signal file
    this.initSignalFile();
  }

  private initSignalFile(): void {
    const emptySignal = {
      lastUpdate: Date.now(),
      signal: null,
    };
    fs.writeFileSync(this.SIGNAL_FILE, JSON.stringify(emptySignal, null, 2));
    console.log(`[HFT Scanner] Initialized ${this.SIGNAL_FILE}`);
  }

  async start(): Promise<void> {
    console.log("\n" + "=".repeat(80));
    console.log(" HFT SCANNER - QuickNode Optimized (Multi-Path)");
    console.log("=".repeat(80));
    console.log(`Pools: ${ALL_POOLS.length}`);
    
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

  private async scanLoop(): Promise<void> {
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
      } catch (error) {
        // Continue on errors
      }

      await this.sleep(this.POLL_INTERVAL_MS);
    }
  }

  private async scanForOpportunities(): Promise<void> {
    // Simulate all paths in parallel to find ALL profitable opportunities
    const results = this.calculator.simulateAllPaths(this.allPaths, this.TRADE_USD);

    // LOG ALL OPPORTUNITIES TO CSV (tradable + non-tradable)
    const allOpportunities: OpportunityData[] = results.map(result =>
      convertPathSimulationToOpportunity(this.updateCount, result)
    );
    this.comprehensiveLogger.logAllOpportunities(this.updateCount, allOpportunities);
    this.comprehensiveLogger.logTradableOpportunities(this.updateCount, allOpportunities);

    // Separate results by path type for spread analysis
    const resultsByType: Record<PathType, any[]> = {
      "1hop": [],
      "2hop": [],
      "3hop": [],
      "4hop": [],
    };

    // Filter and organize all profitable paths
    const profitableSignals: ArbitrageSignal[] = [];

    for (const result of results) {
      if (result.isExecutable && result.netProfitUSDC.gte(this.MIN_PROFIT_USDC)) {
        resultsByType[result.pathType].push(result);

        const signal: ArbitrageSignal = {
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
        console.log(
          `[${idx + 1}]  ${signal.pathType.toUpperCase()}: ${signal.profitPercent.toFixed(3)}% profit (${signal.poolIds.join(" → ")})`
        );
        console.log(`     Path: ${signal.path.join(" → ")}`);
      });
    }
  }


  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop(): void {
    console.log("\n[HFT Scanner] Stopping...");
    this.isRunning = false;
    this.dataFetcher.stop();
    process.exit(0);
  }
}

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
