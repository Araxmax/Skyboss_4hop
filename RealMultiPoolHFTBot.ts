/**
 * REAL MULTI-POOL HFT BOT
 *
 * Scans 18+ pools across Orca, Raydium, Meteora
 * Uses QuickNode RPC for real-time price monitoring
 * Executes profitable arbitrage trades automatically
 * Proper fee calculation and risk management
 */

import { Connection, Keypair } from "@solana/web3.js";
import Decimal from "decimal.js";
import fs from "fs";
import * as dotenv from "dotenv";
import { MultiPoolGrpcScanner } from "./MultiPoolGrpcScanner";
import { MultiPoolArbitrageFinder, ArbitrageOpportunity } from "./MultiPoolArbitrageFinder";
import { SwapExecutor } from "./SwapExecutor";
import { ALL_POOLS } from "./MultiPathConstants";

dotenv.config();

/* =========================
   CONFIGURATION
========================= */

interface BotConfig {
  rpcUrl: string;
  walletPath: string;
  dryRun: boolean;
  tradeAmountUSD: number;
  minNetProfitUSD: number;
  maxSlippagePercent: number;
  basePriorityFee: number;
  maxPriorityFee: number;
  scanIntervalMs: number;
  solPriceUSD: number;
}

/* =========================
   REAL MULTI-POOL HFT BOT
========================= */

class RealMultiPoolHFTBot {
  private connection: Connection;
  private wallet: Keypair;
  private config: BotConfig;
  private scanner: MultiPoolGrpcScanner;
  private arbitrageFinder: MultiPoolArbitrageFinder;
  private swapExecutor: SwapExecutor;

  private isRunning: boolean = false;
  private scanCount: number = 0;
  private tradeCount: number = 0;
  private successfulTrades: number = 0;
  private failedTrades: number = 0;
  private totalProfitUSD: Decimal = new Decimal(0);

  private lastOpportunityTime: number = 0;
  private opportunitiesFound: number = 0;

  constructor(config: BotConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.wallet = this.loadWallet(config.walletPath);

    // Initialize scanner
    this.scanner = new MultiPoolGrpcScanner(
      config.rpcUrl,
      config.scanIntervalMs
    );

    // Initialize arbitrage finder
    this.arbitrageFinder = new MultiPoolArbitrageFinder(
      this.scanner,
      config.tradeAmountUSD,
      config.minNetProfitUSD,
      config.maxSlippagePercent,
      config.basePriorityFee,
      config.solPriceUSD
    );

    // Initialize swap executor
    this.swapExecutor = new SwapExecutor(
      this.connection,
      this.wallet,
      config.maxSlippagePercent / 100,
      config.maxPriorityFee
    );

    this.printHeader();
  }

  /**
   * Load wallet from file
   */
  private loadWallet(walletPath: string): Keypair {
    const secret = JSON.parse(fs.readFileSync(walletPath, "utf8"));
    return Keypair.fromSecretKey(new Uint8Array(secret));
  }

  /**
   * Print bot header
   */
  private printHeader(): void {
    console.log("\n" + "=".repeat(80));
    console.log("⚡ REAL MULTI-POOL HFT BOT");
    console.log("=".repeat(80));
    console.log(`Wallet:           ${this.wallet.publicKey.toBase58()}`);
    console.log(`Mode:             ${this.config.dryRun ? "🧪 DRY RUN" : "💰 LIVE TRADING"}`);
    console.log(`Total Pools:      ${ALL_POOLS.length}`);
    console.log(`Trade Size:       $${this.config.tradeAmountUSD}`);
    console.log(`Min Net Profit:   $${this.config.minNetProfitUSD}`);
    console.log(`Max Slippage:     ${this.config.maxSlippagePercent}%`);
    console.log(`Scan Interval:    ${this.config.scanIntervalMs}ms`);
    console.log(`Priority Fee:     ${this.config.basePriorityFee}-${this.config.maxPriorityFee} µLamports/CU`);
    console.log("=".repeat(80));

    // Print pool breakdown
    const orcaPools = ALL_POOLS.filter(p => p.dex === "orca").length;
    const raydiumAmmPools = ALL_POOLS.filter(p => p.dex === "raydium_amm").length;
    const raydiumClmmPools = ALL_POOLS.filter(p => p.dex === "raydium_clmm").length;
    const meteoraPools = ALL_POOLS.filter(p => p.dex === "meteora").length;

    console.log("\n📊 POOL BREAKDOWN:");
    console.log(`   Orca Whirlpool:    ${orcaPools} pools`);
    console.log(`   Raydium AMM:       ${raydiumAmmPools} pools`);
    console.log(`   Raydium CLMM:      ${raydiumClmmPools} pools`);
    console.log(`   Meteora DLMM:      ${meteoraPools} pools`);

    const solUsdcPools = ALL_POOLS.filter(p =>
      (p.tokenASymbol === "SOL" && p.tokenBSymbol === "USDC") ||
      (p.tokenASymbol === "USDC" && p.tokenBSymbol === "SOL")
    ).length;
    const bonkSolPools = ALL_POOLS.filter(p =>
      (p.tokenASymbol === "BONK" && p.tokenBSymbol === "SOL") ||
      (p.tokenASymbol === "SOL" && p.tokenBSymbol === "BONK")
    ).length;
    const bonkUsdcPools = ALL_POOLS.filter(p =>
      (p.tokenASymbol === "BONK" && p.tokenBSymbol === "USDC") ||
      (p.tokenASymbol === "USDC" && p.tokenBSymbol === "BONK")
    ).length;

    console.log("\n🪙 TOKEN PAIRS:");
    console.log(`   SOL/USDC:          ${solUsdcPools} pools`);
    console.log(`   BONK/SOL:          ${bonkSolPools} pools`);
    console.log(`   BONK/USDC:         ${bonkUsdcPools} pools`);
    console.log("=".repeat(80));
  }

  /**
   * Start bot
   */
  async start(): Promise<void> {
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
  private async scanForOpportunities(): Promise<void> {
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
          } else {
            console.log("\n💰 EXECUTING TRADE...");
            await this.executeTrade(best);
          }
        } else {
          console.log(`\n⚠️  Profit too low: $${best.netProfitUSD.toFixed(4)} < $${this.config.minNetProfitUSD}`);
        }
      } else {
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
    } catch (error: any) {
      console.error(`\n[ERROR] Scan ${this.scanCount}: ${error.message}`);
    }
  }

  /**
   * Execute arbitrage trade
   */
  private async executeTrade(opportunity: ArbitrageOpportunity): Promise<void> {
    this.tradeCount++;

    try {
      const startTime = Date.now();

      // Execute via SwapExecutor
      // Map direction from arbitrage nomenclature to pool nomenclature
      const mappedDirection = opportunity.direction === "buy-then-sell" 
        ? "pool1-to-pool2" 
        : "pool2-to-pool1";

      const result = await this.swapExecutor.executeArbitrage(
        opportunity.buyPool.address,
        opportunity.sellPool.address,
        opportunity.buyPool.tokenA,
        opportunity.buyPool.tokenB,
        opportunity.tradeAmountUSD,
        mappedDirection,
        this.config.maxSlippagePercent / 100,
        false // Not atomic - use separate transactions
      );

      const elapsed = Date.now() - startTime;

      if (result.success) {
        this.successfulTrades++;
        const actualProfit = result.profit || new Decimal(0);

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
      } else {
        this.failedTrades++;

        console.log("\n" + "".repeat(40));
        console.log("❌ TRADE FAILED");
        console.log("❌".repeat(40));
        console.log(`Error: ${result.error || "Unknown error"}`);
        console.log(`Execution Time: ${elapsed}ms`);
        console.log("=".repeat(80));

        this.printStats();
      }
    } catch (error: any) {
      this.failedTrades++;
      console.error(`\n❌ TRADE ERROR: ${error.message}`);
      this.printStats();
    }
  }

  /**
   * Print statistics
   */
  private printStats(): void {
    const successRate = this.tradeCount > 0
      ? ((this.successfulTrades / this.tradeCount) * 100).toFixed(2)
      : "0.00";

    const avgProfitPerTrade = this.successfulTrades > 0
      ? this.totalProfitUSD.div(this.successfulTrades)
      : new Decimal(0);

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
  stop(): void {
    if (!this.isRunning) return;

    console.log("\n🛑 STOPPING BOT...");
    this.isRunning = false;

    this.scanner.stop();

    console.log("\n✅ Bot stopped");
    this.printStats();
  }
}

/* =========================
   MAIN
========================= */

async function main() {
  const config: BotConfig = {
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

export { RealMultiPoolHFTBot };
