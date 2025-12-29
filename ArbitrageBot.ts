import { Connection, Keypair } from "@solana/web3.js";
import fs from "fs";
import Decimal from "decimal.js";
import * as dotenv from "dotenv";
import { SwapExecutor } from "./SwapExecutor";
import { SignalManager, ParsedSignal } from "./SignalManager";
import { SafetyChecker } from "./SafetyChecker";
import { SOL_MINT, USDC_MINT } from "./constants";

dotenv.config();

/* =========================
   CONFIGURATION
========================= */

interface BotConfig {
  rpcUrl: string;
  walletPath: string;
  dryRun: boolean;
  maxSlippage: number;
  maxPriceImpact: number;
  minProfitPercent: number;
  maxTradeAmount: number;
  minSolBalance: number;
  minUsdcBalance: number;
  maxPriorityFee: number;
  maxConsecutiveFailures: number;
  retryAttempts: number;
  retryDelay: number;
}

/* =========================
   ARBITRAGE BOT CLASS
========================= */

class ArbitrageBot {
  private connection: Connection;
  private wallet: Keypair;
  private config: BotConfig;
  private swapExecutor: SwapExecutor;
  private signalManager: SignalManager;
  private safetyChecker: SafetyChecker;
  private consecutiveFailures: number = 0;
  private isRunning: boolean = false;
  private totalTrades: number = 0;
  private successfulTrades: number = 0;
  private totalProfit: Decimal = new Decimal(0);

  constructor(config: BotConfig) {
    this.config = config;

    // Setup connection
    this.connection = new Connection(config.rpcUrl, "confirmed");

    // Load wallet
    this.wallet = this.loadWallet(config.walletPath);

    // Initialize components
    this.swapExecutor = new SwapExecutor(
      this.connection,
      this.wallet,
      config.maxSlippage,
      config.maxPriorityFee
    );

    this.signalManager = new SignalManager(
      "./signal.json",
      config.minProfitPercent,
      config.maxTradeAmount,
      10
    );

    this.safetyChecker = new SafetyChecker(this.connection, this.wallet, {
      minSolBalance: config.minSolBalance,
      minUsdcBalance: config.minUsdcBalance,
      maxSlippage: config.maxSlippage,
      maxPriceImpact: config.maxPriceImpact,
    });

    console.log("\n" + "=".repeat(70));
    console.log("ARBITRAGE BOT INITIALIZED");
    console.log("=".repeat(70));
    console.log(`Wallet: ${this.wallet.publicKey.toBase58()}`);
    console.log(`RPC: ${config.rpcUrl}`);
    console.log(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE TRADING"}`);
    console.log(`Max Slippage: ${config.maxSlippage * 100}%`);
    console.log(`Min Profit: ${config.minProfitPercent * 100}%`);
    console.log("=".repeat(70));
  }

  /**
   * Load wallet from file
   */
  private loadWallet(walletPath: string): Keypair {
    try {
      const secret = JSON.parse(fs.readFileSync(walletPath, "utf8"));
      return Keypair.fromSecretKey(new Uint8Array(secret));
    } catch (error: any) {
      throw new Error(`Failed to load wallet: ${error.message}`);
    }
  }

  /**
   * Process a single arbitrage signal
   */
  private async processSignal(signal: ParsedSignal): Promise<boolean> {
    console.log("\n" + "=".repeat(70));
    console.log("PROCESSING ARBITRAGE SIGNAL");
    console.log("=".repeat(70));
    console.log(`Direction: ${signal.direction}`);
    console.log(`Pool 1: ${signal.pool1Address}`);
    console.log(`Pool 2: ${signal.pool2Address}`);
    console.log(`Expected Profit: ${signal.profitPercent.mul(100).toFixed(4)}%`);
    console.log(`Trade Amount: ${signal.tradeAmount.toString()} USDC`);
    console.log("=".repeat(70));

    // Validate signal
    if (!signal.isValid) {
      console.error(`\n[✗] Signal validation failed: ${signal.error}`);
      return false;
    }

    try {
      // Step 1: Safety checks
      const safetyCheck = await this.safetyChecker.performSafetyCheck(
        signal.tradeAmount,
        new Decimal(this.config.maxSlippage)
      );

      this.safetyChecker.printSafetyReport(safetyCheck);

      if (!safetyCheck.passed) {
        console.error("\n[✗] Safety check failed - aborting trade");
        return false;
      }

      if (safetyCheck.warnings.length > 0 && !this.config.dryRun) {
        console.log(
          "\n[!] Warnings present - proceeding with caution in live mode"
        );
      }

      // Step 2: DRY RUN mode check
      if (this.config.dryRun) {
        console.log("\n" + "=".repeat(70));
        console.log("[DRY RUN] Simulating arbitrage execution");
        console.log("=".repeat(70));
        console.log(`[DRY RUN] Would buy on: ${signal.pool1Address}`);
        console.log(`[DRY RUN] Would sell on: ${signal.pool2Address}`);
        console.log(
          `[DRY RUN] Expected profit: ${signal.profitPercent.mul(100).toFixed(4)}%`
        );
        console.log(`[DRY RUN] Trade amount: ${signal.tradeAmount.toString()}`);
        console.log("=".repeat(70));
        console.log("[DRY RUN] Simulation complete - NO REAL TRADE EXECUTED");
        console.log("=".repeat(70));

        this.successfulTrades++;
        return true;
      }

      // Step 3: Execute arbitrage (LIVE MODE)
      console.log("\n[LIVE] Executing real arbitrage trade...");

      const result = await this.swapExecutor.executeArbitrage(
        signal.pool1Address,
        signal.pool2Address,
        SOL_MINT,
        USDC_MINT,
        signal.tradeAmount,
        signal.direction,
        this.config.maxSlippage
      );

      // Step 4: Process results
      if (result.success) {
        console.log("\n[✓] ARBITRAGE SUCCESSFUL!");

        if (result.swap1 && result.swap2) {
          const profit = new Decimal(result.swap2.amountOut || "0").minus(
            signal.tradeAmount
          );
          const profitPct = profit.div(signal.tradeAmount).mul(100);

          console.log(`Profit: ${profit.toFixed(6)} USDC (${profitPct.toFixed(4)}%)`);
          console.log(`Swap 1: ${result.swap1.signature}`);
          console.log(`Swap 2: ${result.swap2.signature}`);

          this.totalProfit = this.totalProfit.plus(profit);
          this.successfulTrades++;

          // Archive successful trade
          this.signalManager.archiveSignal(true, profit);
        }

        this.consecutiveFailures = 0;
        return true;
      } else {
        console.error(`\n[✗] ARBITRAGE FAILED: ${result.error}`);

        // Archive failed trade
        this.signalManager.archiveSignal(false);

        this.consecutiveFailures++;
        return false;
      }
    } catch (error: any) {
      console.error(`\n[✗] Error processing signal: ${error.message}`);
      console.error(error.stack);

      this.consecutiveFailures++;
      this.signalManager.archiveSignal(false);

      return false;
    } finally {
      this.totalTrades++;

      // Delete signal after processing
      this.signalManager.deleteSignal();

      // Print statistics
      this.printStats();

      // Check emergency stop
      if (
        this.safetyChecker.shouldEmergencyStop(
          this.consecutiveFailures,
          this.config.maxConsecutiveFailures
        )
      ) {
        console.error("\n[EMERGENCY STOP] Too many failures - shutting down");
        this.stop();
      }
    }
  }

  /**
   * Start the bot in watch mode
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("[!] Bot is already running");
      return;
    }

    this.isRunning = true;

    console.log("\n" + "=".repeat(70));
    console.log("STARTING ARBITRAGE BOT");
    console.log("=".repeat(70));
    console.log(`Mode: ${this.config.dryRun ? "DRY RUN" : "LIVE TRADING"}`);
    console.log("Waiting for signals from scanner...");
    console.log("Press Ctrl+C to stop");
    console.log("=".repeat(70));

    // Check for existing signal
    if (this.signalManager.signalExists()) {
      console.log("\n[!] Existing signal found - processing...");
      const signal = this.signalManager.validateAndParseSignal();
      await this.processSignal(signal);
    }

    // Watch for new signals
    const watcher = this.signalManager.watchSignal(async (signal) => {
      if (this.isRunning) {
        await this.processSignal(signal);
      }
    });

    // Keep running until stopped
    return new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        console.log("\n\n[!] Shutdown signal received");
        watcher.close();
        this.stop();
        resolve();
      });
    });
  }

  /**
   * Stop the bot
   */
  stop(): void {
    this.isRunning = false;
    console.log("\n" + "=".repeat(70));
    console.log("BOT STOPPED");
    this.printStats();
    console.log("=".repeat(70));
  }

  /**
   * Print trading statistics
   */
  private printStats(): void {
    const successRate =
      this.totalTrades > 0
        ? ((this.successfulTrades / this.totalTrades) * 100).toFixed(2)
        : "0.00";

    console.log("\n" + "=".repeat(70));
    console.log("TRADING STATISTICS");
    console.log("=".repeat(70));
    console.log(`Total Trades: ${this.totalTrades}`);
    console.log(`Successful: ${this.successfulTrades}`);
    console.log(`Failed: ${this.totalTrades - this.successfulTrades}`);
    console.log(`Success Rate: ${successRate}%`);
    console.log(`Total Profit: ${this.totalProfit.toFixed(6)} USDC`);
    console.log(`Consecutive Failures: ${this.consecutiveFailures}`);
    console.log("=".repeat(70));
  }

  /**
   * Execute a single trade immediately (manual mode)
   */
  async executeSingleTrade(): Promise<void> {
    console.log("\n[MANUAL] Checking for signal...");

    if (!this.signalManager.signalExists()) {
      console.log("[!] No signal found");
      return;
    }

    const signal = this.signalManager.validateAndParseSignal();
    await this.processSignal(signal);
  }
}

/* =========================
   MAIN ENTRY POINT
========================= */

async function main() {
  // Load configuration from environment
  const config: BotConfig = {
    rpcUrl: process.env.RPC_URL || "",
    walletPath: process.env.WALLET_PATH || "",
    dryRun: process.env.DRY_RUN?.toLowerCase() === "true",
    maxSlippage: parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.03"),
    maxPriceImpact: parseFloat(process.env.MAX_PRICE_IMPACT_PCT || "0.02"),
    minProfitPercent: parseFloat(process.env.MIN_PROFIT_USD || "0.01") / 100,
    maxTradeAmount: parseFloat(process.env.TRADE_USD || "100"),
    minSolBalance: parseFloat(process.env.MIN_SOL_BALANCE_CRITICAL || "0.02"),
    minUsdcBalance: 5,
    maxPriorityFee: parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || "50000"),
    maxConsecutiveFailures: 3,
    retryAttempts: 3,
    retryDelay: 1000,
  };

  // Validate configuration
  if (!config.rpcUrl) {
    throw new Error("RPC_URL not set in .env");
  }
  if (!config.walletPath) {
    throw new Error("WALLET_PATH not set in .env");
  }

  // Create and start bot
  const bot = new ArbitrageBot(config);

  // Check command line arguments
  const args = process.argv.slice(2);
  if (args.includes("--once")) {
    // Execute once and exit
    await bot.executeSingleTrade();
  } else {
    // Start in watch mode
    await bot.start();
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { ArbitrageBot, BotConfig };
