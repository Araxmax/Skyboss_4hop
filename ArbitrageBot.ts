import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import Decimal from "decimal.js";
import * as dotenv from "dotenv";
import { SwapExecutor } from "./SwapExecutor";
import { SignalManager, ParsedSignal } from "./SignalManager";
import { SafetyChecker } from "./SafetyChecker";
import { CsvLogger, TradeLogEntry } from "./CsvLogger";
import { SOL_MINT, USDC_MINT, PREDEFINED_POOLS, DECIMAL_2_POW_64, DECIMAL_10_POW_9, DECIMAL_10_POW_6 } from "./constants";

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
  private csvLogger: CsvLogger;
  private consecutiveFailures: number = 0;
  private isRunning: boolean = false;
  private totalTrades: number = 0;
  private successfulTrades: number = 0;
  private totalProfit: Decimal = new Decimal(0);
  private safetyPassedCount: number = 0;
  private safetyFailedCount: number = 0;

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

    this.csvLogger = new CsvLogger("./logs");

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
   * Decode Whirlpool account data to get sqrt price
   */
  private decodeSqrtPrice(data: Buffer): bigint {
    if (data.length < 81) {
      throw new Error('Invalid whirlpool data length');
    }
    // sqrt_price is at offset 65-81 (16 bytes, u128)
    return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
  }

  /**
   * Convert sqrt price X64 to regular price
   */
  private sqrtPriceToPrice(sqrtPriceX64: bigint): Decimal {
    const sqrtPrice = new Decimal(sqrtPriceX64.toString()).div(DECIMAL_2_POW_64);
    const price = sqrtPrice.pow(2);
    return price.mul(DECIMAL_10_POW_9).div(DECIMAL_10_POW_6);
  }

  /**
   * Fetch current pool prices
   * Returns: [price_001_pool, price_005_pool]
   */
  private async fetchPoolPrices(): Promise<{ price_001: Decimal; price_005: Decimal }> {
    try {
      const pool001Address = new PublicKey(PREDEFINED_POOLS[1].address); // 0.01% pool
      const pool005Address = new PublicKey(PREDEFINED_POOLS[0].address); // 0.05% pool

      const accountInfos = await this.connection.getMultipleAccountsInfo([pool001Address, pool005Address]);

      if (!accountInfos[0] || !accountInfos[1]) {
        throw new Error('Failed to fetch pool account data');
      }

      const sqrtPrice001 = this.decodeSqrtPrice(accountInfos[0].data);
      const sqrtPrice005 = this.decodeSqrtPrice(accountInfos[1].data);

      const price001 = this.sqrtPriceToPrice(sqrtPrice001);
      const price005 = this.sqrtPriceToPrice(sqrtPrice005);

      return {
        price_001: price001,
        price_005: price005,
      };
    } catch (error: any) {
      console.error(`[Price Fetch] Error: ${error.message}`);
      // Return zeros on error
      return {
        price_001: new Decimal(0),
        price_005: new Decimal(0),
      };
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

    // Fetch current pool prices
    const poolPrices = await this.fetchPoolPrices();
    const spread = poolPrices.price_001.minus(poolPrices.price_005).abs();
    const spreadPct = poolPrices.price_005.gt(0)
      ? spread.div(Decimal.min(poolPrices.price_001, poolPrices.price_005)).mul(100)
      : new Decimal(0);

    console.log(`\nCurrent Pool Prices:`);
    console.log(`  0.01% Pool: $${poolPrices.price_001.toFixed(6)}`);
    console.log(`  0.05% Pool: $${poolPrices.price_005.toFixed(6)}`);
    console.log(`  Spread: $${spread.toFixed(6)} (${spreadPct.toFixed(4)}%)`);

    // Initialize CSV log entry
    const logEntry: TradeLogEntry = {
      timestamp: Date.now().toString(),
      datetime: new Date().toISOString(),
      signal_direction: signal.direction,
      price_001_pool: poolPrices.price_001.toNumber(),
      price_005_pool: poolPrices.price_005.toNumber(),
      spread: spread.toNumber(),
      spread_pct: spreadPct.toNumber(),
      expected_profit_pct: signal.profitPercent.mul(100).toNumber(),
      trade_amount_usdc: signal.tradeAmount.toNumber(),
      safety_passed: false,
      safety_errors: "",
      safety_warnings: "",
      sol_balance: 0,
      usdc_balance: 0,
      executed: false,
      dry_run: this.config.dryRun,
      swap1_pool: signal.pool1Address,
      swap1_success: false,
      swap1_amount_in: 0,
      swap1_amount_out: 0,
      swap1_signature: "",
      swap1_error: "",
      swap2_pool: signal.pool2Address,
      swap2_success: false,
      swap2_amount_in: 0,
      swap2_amount_out: 0,
      swap2_signature: "",
      swap2_error: "",
      actual_profit_usdc: 0,
      actual_profit_pct: 0,
      failure_reason: "",
      failure_stage: "",
    };

    // Validate signal
    if (!signal.isValid) {
      console.error(`\n[✗] Signal validation failed: ${signal.error}`);
      logEntry.failure_reason = signal.error || "Signal validation failed";
      logEntry.failure_stage = "validation";
      this.csvLogger.logTrade(logEntry);
      return false;
    }

    try {
      // Step 1: Safety checks
      const safetyCheck = await this.safetyChecker.performSafetyCheck(
        signal.tradeAmount,
        new Decimal(this.config.maxSlippage)
      );

      logEntry.safety_passed = safetyCheck.passed;
      logEntry.safety_errors = safetyCheck.errors.join("; ");
      logEntry.safety_warnings = safetyCheck.warnings.join("; ");
      logEntry.sol_balance = safetyCheck.balances?.sol.toNumber() || 0;
      logEntry.usdc_balance = safetyCheck.balances?.usdc.toNumber() || 0;

      this.safetyChecker.printSafetyReport(safetyCheck);

      if (!safetyCheck.passed) {
        console.error("\n[✗] Safety check failed - aborting trade");
        this.safetyFailedCount++;
        logEntry.failure_reason = safetyCheck.errors.join("; ");
        logEntry.failure_stage = "safety_check";
        this.csvLogger.logTrade(logEntry);
        return false;
      }

      this.safetyPassedCount++;

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

        logEntry.executed = true;
        logEntry.swap1_success = true;
        logEntry.swap1_amount_in = signal.tradeAmount.toNumber();
        logEntry.swap1_amount_out = signal.tradeAmount.toNumber();
        logEntry.swap1_signature = "DRY_RUN_SIMULATED";
        logEntry.swap2_success = true;
        logEntry.swap2_amount_in = signal.tradeAmount.toNumber();
        logEntry.swap2_amount_out = signal.tradeAmount.toNumber();
        logEntry.swap2_signature = "DRY_RUN_SIMULATED";
        logEntry.actual_profit_usdc = 0;
        logEntry.actual_profit_pct = signal.profitPercent.mul(100).toNumber();

        this.csvLogger.logTrade(logEntry);
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

      logEntry.executed = true;

      // Step 4: Process results
      if (result.success) {
        console.log("\n[✓] ARBITRAGE SUCCESSFUL!");

        if (result.swap1 && result.swap2) {
          logEntry.swap1_success = result.swap1.success;
          logEntry.swap1_amount_in = parseFloat(result.swap1.amountIn || "0");
          logEntry.swap1_amount_out = parseFloat(result.swap1.amountOut || "0");
          logEntry.swap1_signature = result.swap1.signature || "";
          logEntry.swap1_error = result.swap1.error || "";

          logEntry.swap2_success = result.swap2.success;
          logEntry.swap2_amount_in = parseFloat(result.swap2.amountIn || "0");
          logEntry.swap2_amount_out = parseFloat(result.swap2.amountOut || "0");
          logEntry.swap2_signature = result.swap2.signature || "";
          logEntry.swap2_error = result.swap2.error || "";

          const profit = new Decimal(result.swap2.amountOut || "0").minus(
            signal.tradeAmount
          );
          const profitPct = profit.div(signal.tradeAmount).mul(100);

          logEntry.actual_profit_usdc = profit.toNumber();
          logEntry.actual_profit_pct = profitPct.toNumber();

          console.log(`Profit: ${profit.toFixed(6)} USDC (${profitPct.toFixed(4)}%)`);
          console.log(`Swap 1: ${result.swap1.signature}`);
          console.log(`Swap 2: ${result.swap2.signature}`);

          this.totalProfit = this.totalProfit.plus(profit);
          this.successfulTrades++;

          // Archive successful trade
          this.signalManager.archiveSignal(true, profit);
        }

        this.csvLogger.logTrade(logEntry);
        this.consecutiveFailures = 0;
        return true;
      } else {
        console.error(`\n[✗] ARBITRAGE FAILED: ${result.error}`);

        logEntry.failure_reason = result.error || "Unknown error";
        logEntry.failure_stage = result.swap1?.success ? "swap2" : "swap1";

        if (result.swap1) {
          logEntry.swap1_success = result.swap1.success;
          logEntry.swap1_error = result.swap1.error || "";
          logEntry.swap1_signature = result.swap1.signature || "";
        }

        if (result.swap2) {
          logEntry.swap2_success = result.swap2.success;
          logEntry.swap2_error = result.swap2.error || "";
          logEntry.swap2_signature = result.swap2.signature || "";
        }

        this.csvLogger.logTrade(logEntry);

        // Archive failed trade
        this.signalManager.archiveSignal(false);

        this.consecutiveFailures++;
        return false;
      }
    } catch (error: any) {
      console.error(`\n[✗] Error processing signal: ${error.message}`);
      console.error(error.stack);

      logEntry.failure_reason = error.message;
      logEntry.failure_stage = "exception";
      this.csvLogger.logTrade(logEntry);

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

    // Write CSV summary
    this.csvLogger.writeSummary({
      totalSignals: this.totalTrades,
      safetyPassed: this.safetyPassedCount,
      safetyFailed: this.safetyFailedCount,
      executed: this.successfulTrades,
      successful: this.successfulTrades,
      failed: this.totalTrades - this.successfulTrades,
      totalProfit: this.totalProfit,
      avgProfit: this.totalTrades > 0 ? this.totalProfit.div(this.totalTrades) : new Decimal(0),
    });

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
