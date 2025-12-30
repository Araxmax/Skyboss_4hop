import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram, sendAndConfirmTransaction } from "@solana/web3.js";
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
   ULTRA-FAST EXECUTOR
========================= */

interface FastBotConfig {
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
  usePriorityFees: boolean;
}

class FastArbitrageExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private config: FastBotConfig;
  private swapExecutor: SwapExecutor;
  private signalManager: SignalManager;
  private safetyChecker: SafetyChecker;
  private csvLogger: CsvLogger;
  private isRunning: boolean = false;
  private lastExecutionTime: number = 0;
  private executionCount: number = 0;

  // Performance tracking
  private avgExecutionTimeMs: number = 0;

  constructor(config: FastBotConfig) {
    this.config = config;

    // Use 'confirmed' commitment for balance, but 'processed' for speed
    this.connection = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    });

    this.wallet = this.loadWallet(config.walletPath);

    this.swapExecutor = new SwapExecutor(
      this.connection,
      this.wallet,
      config.maxSlippage,
      config.maxPriorityFee,
      {
        heliusApiKey: process.env.HELIUS_API_KEY,
        usePrivateTx: true, // Enable MEV protection
        maxRetries: 3,
        retryDelay: 1000,
        transactionDeadline: 30,
      }
    );

    this.signalManager = new SignalManager(
      "./signal.json",
      config.minProfitPercent,
      config.maxTradeAmount,
      2 // Shorter signal max age for speed
    );

    this.safetyChecker = new SafetyChecker(this.connection, this.wallet, {
      minSolBalance: config.minSolBalance,
      minUsdcBalance: config.minUsdcBalance,
      maxSlippage: config.maxSlippage,
      maxPriceImpact: config.maxPriceImpact,
    });

    this.csvLogger = new CsvLogger("./logs");

    console.log("\n" + "=".repeat(70));
    console.log("ULTRA-FAST ARBITRAGE EXECUTOR");
    console.log("=".repeat(70));
    console.log(`Wallet: ${this.wallet.publicKey.toBase58()}`);
    console.log(`Mode: ${config.dryRun ? "DRY RUN" : "🔥 LIVE TRADING 🔥"}`);
    console.log(`Priority Fees: ${config.usePriorityFees ? "ENABLED (faster)" : "disabled"}`);
    console.log("=".repeat(70));
  }

  private loadWallet(walletPath: string): Keypair {
    try {
      const secret = JSON.parse(fs.readFileSync(walletPath, "utf8"));
      return Keypair.fromSecretKey(new Uint8Array(secret));
    } catch (error: any) {
      throw new Error(`Failed to load wallet: ${error.message}`);
    }
  }

  /**
   * Process signal with maximum speed
   */
  private async processSignalFast(signal: ParsedSignal): Promise<boolean> {
    const startTime = Date.now();

    console.log(`\n[⚡${this.executionCount}] Processing signal...`);

    // Fetch pool prices in parallel with safety checks
    const poolPricesPromise = this.fetchPoolPricesForEntry(signal);
    const safetyCheckPromise = this.safetyChecker.performSafetyCheck(
      signal.tradeAmount,
      new Decimal(this.config.maxSlippage)
    );

    // Wait for both in parallel
    const [poolPrices, safetyCheck] = await Promise.all([
      poolPricesPromise,
      safetyCheckPromise
    ]);

    const spread = poolPrices.price_001.minus(poolPrices.price_005).abs();
    const spreadPct = spread.div(Decimal.min(poolPrices.price_001, poolPrices.price_005)).mul(100);

    // Initialize log entry
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
      safety_passed: safetyCheck.passed,
      safety_errors: safetyCheck.errors.join("; "),
      safety_warnings: safetyCheck.warnings.join("; "),
      sol_balance: safetyCheck.balances?.sol.toNumber() || 0,
      usdc_balance: safetyCheck.balances?.usdc.toNumber() || 0,
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
      logEntry.failure_reason = signal.error || "Invalid signal";
      logEntry.failure_stage = "validation";
      this.csvLogger.logTrade(logEntry);
      console.log(`[⚡] ✗ Signal invalid`);
      return false;
    }

    // Safety check
    if (!safetyCheck.passed) {
      logEntry.failure_reason = safetyCheck.errors.join("; ");
      logEntry.failure_stage = "safety";
      this.csvLogger.logTrade(logEntry);
      console.log(`[⚡] ✗ Safety failed: ${safetyCheck.errors[0]}`);
      return false;
    }

    // DRY RUN - simulate fast
    if (this.config.dryRun) {
      logEntry.executed = true;
      logEntry.swap1_success = true;
      logEntry.swap1_signature = "DRY_RUN_SIM";
      logEntry.swap2_success = true;
      logEntry.swap2_signature = "DRY_RUN_SIM";
      logEntry.actual_profit_pct = signal.profitPercent.mul(100).toNumber();

      this.csvLogger.logTrade(logEntry);

      const execTime = Date.now() - startTime;
      console.log(`[⚡] ✓ DRY RUN completed in ${execTime}ms`);

      this.updateStats(execTime);
      return true;
    }

    // LIVE EXECUTION
    console.log(`[⚡] 🔥 Executing LIVE trade...`);

    try {
      const result = await this.swapExecutor.executeArbitrage(
        signal.pool1Address,
        signal.pool2Address,
        SOL_MINT,
        USDC_MINT,
        signal.tradeAmount,
        signal.direction,
        this.config.maxSlippage
      );

      if (result.success && result.swap1 && result.swap2) {
        logEntry.executed = true;
        logEntry.swap1_success = result.swap1.success;
        logEntry.swap1_signature = result.swap1.signature || "";
        logEntry.swap2_success = result.swap2.success;
        logEntry.swap2_signature = result.swap2.signature || "";

        const profit = new Decimal(result.swap2.amountOut || "0").minus(signal.tradeAmount);
        logEntry.actual_profit_usdc = profit.toNumber();
        logEntry.actual_profit_pct = profit.div(signal.tradeAmount).mul(100).toNumber();

        this.csvLogger.logTrade(logEntry);

        const execTime = Date.now() - startTime;
        console.log(`[⚡] ✓✓✓ Trade SUCCESS in ${execTime}ms!`);
        console.log(`[⚡]     Profit: $${profit.toFixed(6)}`);

        this.updateStats(execTime);
        return true;
      } else {
        logEntry.failure_reason = result.error || "Execution failed";
        logEntry.failure_stage = "execution";
        this.csvLogger.logTrade(logEntry);

        console.log(`[⚡] ✗ Trade failed: ${result.error}`);
        return false;
      }
    } catch (error: any) {
      logEntry.failure_reason = error.message;
      logEntry.failure_stage = "exception";
      this.csvLogger.logTrade(logEntry);

      console.log(`[⚡] ✗ Exception: ${error.message}`);
      return false;
    }
  }

  /**
   * Decode Whirlpool sqrt price from account data
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
   * Fetch pool prices for log entry (FIXED - was returning 0,0)
   */
  private async fetchPoolPricesForEntry(signal: ParsedSignal): Promise<{ price_001: Decimal; price_005: Decimal }> {
    try {
      const pool001Address = new PublicKey(PREDEFINED_POOLS[1].address); // 0.01% pool
      const pool005Address = new PublicKey(PREDEFINED_POOLS[0].address); // 0.05% pool

      const accountInfos = await this.connection.getMultipleAccountsInfo(
        [pool001Address, pool005Address],
        { commitment: 'confirmed' }
      );

      if (!accountInfos[0] || !accountInfos[1]) {
        console.warn('[FAST] Failed to fetch pool account data, using zero prices');
        return {
          price_001: new Decimal(0),
          price_005: new Decimal(0),
        };
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
      console.error(`[FAST] Error fetching prices: ${error.message}`);
      return {
        price_001: new Decimal(0),
        price_005: new Decimal(0),
      };
    }
  }

  /**
   * Update performance statistics
   */
  private updateStats(execTimeMs: number): void {
    this.executionCount++;
    this.avgExecutionTimeMs = (this.avgExecutionTimeMs * (this.executionCount - 1) + execTimeMs) / this.executionCount;
  }

  /**
   * Watch for signals (fast polling)
   */
  async start(): Promise<void> {
    console.log("\n[⚡] EXECUTOR READY - Watching for signals...");
    console.log("[⚡] Press Ctrl+C to stop\n");

    this.isRunning = true;

    // Fast polling loop (50ms)
    while (this.isRunning) {
      try {
        if (this.signalManager.signalExists()) {
          const signal = this.signalManager.validateAndParseSignal();

          if (signal && signal.isValid) {
            // Rate limit: min 100ms between executions
            const now = Date.now();
            if (now - this.lastExecutionTime >= 100) {
              await this.processSignalFast(signal);
              this.lastExecutionTime = now;

              // Archive signal after processing
              this.signalManager.archiveSignal(true);
            }
          }
        }

        // Fast poll every 50ms
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error: any) {
        console.error(`[⚡] Error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Stop executor
   */
  stop(): void {
    this.isRunning = false;
    console.log(`\n[⚡] Executor stopped`);
    console.log(`[⚡] Total executions: ${this.executionCount}`);
    console.log(`[⚡] Avg execution time: ${this.avgExecutionTimeMs.toFixed(0)}ms`);
  }
}

/* =========================
   MAIN
========================= */

async function main() {
  const config: FastBotConfig = {
    rpcUrl: process.env.RPC_URL || "",
    walletPath: process.env.WALLET_PATH || "",
    dryRun: process.env.DRY_RUN === "True",
    maxSlippage: parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.03"),
    maxPriceImpact: parseFloat(process.env.MAX_PRICE_IMPACT_PCT || "0.02"),
    minProfitPercent: parseFloat(process.env.MIN_SPREAD_PCT || "0.006") / 100,
    maxTradeAmount: parseFloat(process.env.TRADE_USD || "480"),
    minSolBalance: parseFloat(process.env.MIN_SOL_BALANCE_CRITICAL || "0.01"),
    minUsdcBalance: 10,
    maxPriorityFee: parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || "50000"),
    usePriorityFees: true,
  };

  const executor = new FastArbitrageExecutor(config);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[⚡] Shutting down...');
    executor.stop();
    process.exit(0);
  });

  await executor.start();
}

if (require.main === module) {
  main();
}

export { FastArbitrageExecutor };
