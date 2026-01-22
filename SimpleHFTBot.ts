/**
 * SIMPLE HFT BOT - WORKS ON WINDOWS
 *
 * Uses RPC polling (no gRPC needed)
 * Real profitability calculation
 * Fast and reliable
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import Decimal from "decimal.js";
import fs from "fs";
import * as dotenv from "dotenv";
import { SwapExecutor } from "./SwapExecutor";
import { PREDEFINED_POOLS, DECIMAL_2_POW_64, DECIMAL_10_POW_9, DECIMAL_10_POW_6 } from "./constants";

dotenv.config();

/* =========================
   CONFIGURATION
========================= */

interface Config {
  rpcUrl: string;
  walletPath: string;
  dryRun: boolean;
  tradeAmountUSDC: number;
  minNetProfitUSDC: number;
  maxSlippagePercent: number;
  basePriorityFee: number;
  maxPriorityFee: number;
  scanIntervalMs: number;
}

/* =========================
   SIMPLE HFT BOT
========================= */

class SimpleHFTBot {
  private connection: Connection;
  private wallet: Keypair;
  private config: Config;
  private swapExecutor: SwapExecutor;

  private isRunning: boolean = false;
  private scanCount: number = 0;
  private tradeCount: number = 0;
  private successfulTrades: number = 0;
  private totalProfit: Decimal = new Decimal(0);

  constructor(config: Config) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.wallet = this.loadWallet(config.walletPath);
    this.swapExecutor = new SwapExecutor(
      this.connection,
      this.wallet,
      config.maxSlippagePercent / 100,
      config.maxPriorityFee
    );

    console.log("\n" + "=".repeat(80));
    console.log("⚡ SIMPLE HFT BOT - INITIALIZED");
    console.log("=".repeat(80));
    console.log(`Wallet: ${this.wallet.publicKey.toBase58()}`);
    console.log(`Mode: ${config.dryRun ? "🧪 DRY RUN" : "💰 LIVE TRADING"}`);
    console.log(`Trade Size: $${config.tradeAmountUSDC}`);
    console.log(`Min Net Profit: $${config.minNetProfitUSDC}`);
    console.log(`Scan Interval: ${config.scanIntervalMs}ms`);
    console.log("=".repeat(80));
  }

  private loadWallet(walletPath: string): Keypair {
    const secret = JSON.parse(fs.readFileSync(walletPath, "utf8"));
    return Keypair.fromSecretKey(new Uint8Array(secret));
  }

  /**
   * Decode sqrt price from Orca Whirlpool
   */
  private decodeSqrtPrice(data: Buffer): bigint {
    return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
  }

  /**
   * Convert sqrt price to regular price
   */
  private sqrtPriceToPrice(sqrtPriceX64: bigint): Decimal {
    const sqrtPrice = new Decimal(sqrtPriceX64.toString()).div(DECIMAL_2_POW_64);
    const price = sqrtPrice.pow(2);
    return price.mul(DECIMAL_10_POW_9).div(DECIMAL_10_POW_6);
  }

  /**
   * Fetch Orca pool price
   */
  private async fetchOrcaPrice(poolAddress: string): Promise<Decimal | null> {
    try {
      const poolPubkey = new PublicKey(poolAddress);
      const accountInfo = await this.connection.getAccountInfo(poolPubkey, "confirmed");

      if (!accountInfo?.data) return null;

      const sqrtPrice = this.decodeSqrtPrice(accountInfo.data);
      return this.sqrtPriceToPrice(sqrtPrice);
    } catch (error: any) {
      console.error(`[Orca] Error fetching ${poolAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch Raydium pool price from vaults
   */
  private async fetchRaydiumPrice(vaultA: string, vaultB: string): Promise<Decimal | null> {
    try {
      const vaultAPubkey = new PublicKey(vaultA);
      const vaultBPubkey = new PublicKey(vaultB);

      const [vaultAInfo, vaultBInfo] = await Promise.all([
        getAccount(this.connection, vaultAPubkey),
        getAccount(this.connection, vaultBPubkey),
      ]);

      const solBalance = new Decimal(vaultAInfo.amount.toString()).div(1e9);
      const usdcBalance = new Decimal(vaultBInfo.amount.toString()).div(1e6);

      if (solBalance.isZero()) return null;

      return usdcBalance.div(solBalance);
    } catch (error: any) {
      console.error(`[Raydium] Error fetching vaults: ${error.message}`);
      return null;
    }
  }

  /**
   * Calculate NET profitability with ALL costs
   */
  private calculateProfitability(
    pool1Price: Decimal,
    pool2Price: Decimal,
    pool1Fee: number,
    pool2Fee: number
  ): {
    isProfitable: boolean;
    grossProfit: Decimal;
    totalCosts: Decimal;
    netProfit: Decimal;
    netProfitPercent: Decimal;
    priorityFee: number;
  } {
    const tradeAmount = new Decimal(this.config.tradeAmountUSDC);
    const spread = pool1Price.minus(pool2Price).abs();
    const spreadPercent = spread.div(Decimal.min(pool1Price, pool2Price));

    // Gross profit
    const grossProfit = tradeAmount.mul(spreadPercent);

    // Swap fees
    const swap1Fee = tradeAmount.mul(pool1Fee);
    const swap2Fee = tradeAmount.mul(pool2Fee);
    const totalSwapFees = swap1Fee.plus(swap2Fee);

    // Slippage
    const slippageLoss = tradeAmount.mul(this.config.maxSlippagePercent / 100);

    // Gas costs
    const computeUnits = 400000;
    const baseFee = 5000;
    const priorityFeeMultiplier = 1 + (spreadPercent.toNumber() * 2);
    const dynamicPriorityFee = Math.min(
      this.config.basePriorityFee * priorityFeeMultiplier,
      this.config.maxPriorityFee
    );
    const priorityFeeLamports = (dynamicPriorityFee * computeUnits) / 1000000;
    const totalGasLamports = priorityFeeLamports + baseFee;
    const solPriceUSD = 135; // Update this dynamically if needed
    const gasCostUSD = new Decimal(totalGasLamports).div(1e9).mul(solPriceUSD);

    // Total costs
    const totalCosts = totalSwapFees.plus(slippageLoss).plus(gasCostUSD);

    // Net profit
    const netProfit = grossProfit.minus(totalCosts);
    const netProfitPercent = netProfit.div(tradeAmount).mul(100);

    return {
      isProfitable: netProfit.gte(this.config.minNetProfitUSDC),
      grossProfit,
      totalCosts,
      netProfit,
      netProfitPercent,
      priorityFee: Math.floor(dynamicPriorityFee),
    };
  }

  /**
   * Scan for arbitrage opportunities
   */
  private async scan(): Promise<void> {
    this.scanCount++;
    const startTime = Date.now();

    try {
      // Get pool configs
      const orcaPool = PREDEFINED_POOLS.find(p => p.type === "orca");
      const raydiumPool = PREDEFINED_POOLS.find(p => p.type === "raydium");

      if (!orcaPool || !raydiumPool) {
        console.error("[ERROR] Pool configs not found");
        return;
      }

      // Fetch prices in parallel
      const [orcaPrice, raydiumPrice] = await Promise.all([
        this.fetchOrcaPrice(orcaPool.address),
        raydiumPool.vault_a && raydiumPool.vault_b
          ? this.fetchRaydiumPrice(raydiumPool.vault_a, raydiumPool.vault_b)
          : Promise.resolve(null),
      ]);

      if (!orcaPrice || !raydiumPrice) {
        console.log(`[SCAN ${this.scanCount}] Failed to fetch prices`);
        return;
      }

      // Calculate spread
      const spread = orcaPrice.minus(raydiumPrice).abs();
      const spreadPercent = spread.div(Decimal.min(orcaPrice, raydiumPrice)).mul(100);

      // Log every 20 scans or if spread > 0.5%
      if (this.scanCount % 20 === 0 || spreadPercent.gte(0.5)) {
        console.log(`\n[SCAN ${this.scanCount}] ${new Date().toLocaleTimeString()}`);
        console.log(`  Orca:    $${orcaPrice.toFixed(4)}`);
        console.log(`  Raydium: $${raydiumPrice.toFixed(4)}`);
        console.log(`  Spread:  ${spreadPercent.toFixed(4)}%`);
      }

      // Calculate profitability
      const analysis = this.calculateProfitability(
        orcaPrice,
        raydiumPrice,
        orcaPool.fee_rate,
        raydiumPool.fee_rate
      );

      // If profitable, show analysis
      if (analysis.isProfitable || spreadPercent.gte(0.5)) {
        console.log("\n" + "─".repeat(80));
        console.log("📊 OPPORTUNITY ANALYSIS");
        console.log("─".repeat(80));
        console.log(`Orca Price:    $${orcaPrice.toFixed(4)}`);
        console.log(`Raydium Price: $${raydiumPrice.toFixed(4)}`);
        console.log(`Spread:        ${spreadPercent.toFixed(4)}%`);
        console.log();
        console.log(`Trade Amount:  $${this.config.tradeAmountUSDC.toFixed(2)}`);
        console.log(`Gross Profit:  $${analysis.grossProfit.toFixed(4)}`);
        console.log();
        console.log("Costs:");
        console.log(`  Swap Fees:   -$${analysis.totalCosts.toFixed(4)}`);
        console.log(`  Gas:         (included above)`);
        console.log();
        console.log(`Net Profit:    $${analysis.netProfit.toFixed(4)} (${analysis.netProfitPercent.toFixed(2)}%)`);
        console.log(`Profitable:    ${analysis.isProfitable ? "✅ YES" : "❌ NO"}`);

        if (!analysis.isProfitable) {
          const breakevenSpread = analysis.totalCosts.div(this.config.tradeAmountUSDC).mul(100);
          console.log();
          console.log(`Breakeven:     ${breakevenSpread.toFixed(4)}% spread needed`);
          console.log(`Gap:           ${breakevenSpread.minus(spreadPercent).toFixed(4)}%`);
        }
        console.log("─".repeat(80));

        // Execute if profitable
        if (analysis.isProfitable) {
          if (this.config.dryRun) {
            console.log("\n🧪 DRY RUN: Would execute trade");
            console.log(`   Expected profit: $${analysis.netProfit.toFixed(4)}`);
          } else {
            console.log("\n💰 EXECUTING TRADE...");
            await this.executeTrade(
              orcaPool.address,
              raydiumPool.address,
              orcaPrice,
              raydiumPrice,
              analysis
            );
          }
        }
      }

      const elapsed = Date.now() - startTime;
      if (this.scanCount % 20 === 0) {
        console.log(`  Scan time: ${elapsed}ms`);
      }

    } catch (error: any) {
      console.error(`[SCAN ${this.scanCount}] Error: ${error.message}`);
    }
  }

  /**
   * Execute trade
   */
  private async executeTrade(
    pool1: string,
    pool2: string,
    price1: Decimal,
    price2: Decimal,
    analysis: any
  ): Promise<void> {
    this.tradeCount++;

    try {
      const direction = price1.lt(price2) ? "pool1-to-pool2" : "pool2-to-pool1";
      const tokenAMint = "So11111111111111111111111111111111111111112"; // SOL
      const tokenBMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC

      const result = await this.swapExecutor.executeArbitrage(
        pool1,
        pool2,
        tokenAMint,
        tokenBMint,
        new Decimal(this.config.tradeAmountUSDC),
        direction,
        this.config.maxSlippagePercent / 100,
        false
      );

      if (result.success) {
        this.successfulTrades++;
        const actualProfit = result.profit || new Decimal(0);
        this.totalProfit = this.totalProfit.plus(actualProfit);

        console.log("\n✅ TRADE SUCCESSFUL");
        console.log(`   Expected: $${analysis.netProfit.toFixed(4)}`);
        console.log(`   Actual:   $${actualProfit.toFixed(4)}`);
        console.log(`   Signature: ${result.bundleSignature || result.swap1?.signature}`);
      } else {
        console.log("\n❌ TRADE FAILED");
        console.log(`   Error: ${result.error}`);
      }

      this.printStats();

    } catch (error: any) {
      console.error(`[TRADE] Error: ${error.message}`);
    }
  }

  /**
   * Print statistics
   */
  private printStats(): void {
    const successRate = this.tradeCount > 0
      ? ((this.successfulTrades / this.tradeCount) * 100).toFixed(2)
      : "0.00";

    console.log("\n" + "=".repeat(80));
    console.log("📈 STATISTICS");
    console.log("=".repeat(80));
    console.log(`Scans: ${this.scanCount}`);
    console.log(`Trades: ${this.tradeCount}`);
    console.log(`Successful: ${this.successfulTrades} (${successRate}%)`);
    console.log(`Total Profit: $${this.totalProfit.toFixed(4)}`);
    console.log("=".repeat(80));
  }

  /**
   * Start bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("[BOT] Already running");
      return;
    }

    this.isRunning = true;

    console.log("\n🚀 STARTING BOT");
    console.log("Press Ctrl+C to stop\n");

    // Main loop
    while (this.isRunning) {
      await this.scan();
      await new Promise(resolve => setTimeout(resolve, this.config.scanIntervalMs));
    }
  }

  /**
   * Stop bot
   */
  stop(): void {
    this.isRunning = false;
    console.log("\n🛑 STOPPING BOT");
    this.printStats();
  }
}

/* =========================
   MAIN
========================= */

async function main() {
  const config: Config = {
    rpcUrl: process.env.RPC_URL || "",
    walletPath: process.env.WALLET_PATH || "",
    dryRun: process.env.DRY_RUN?.toLowerCase() !== "false",
    tradeAmountUSDC: parseFloat(process.env.TRADE_USD || "100"),
    minNetProfitUSDC: parseFloat(process.env.MIN_NET_PROFIT_USDC || "0.10"),
    maxSlippagePercent: parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.5"),
    basePriorityFee: parseInt(process.env.BASE_PRIORITY_FEE_LAMPORTS || "50000"),
    maxPriorityFee: parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || "200000"),
    scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS || "2000"), // 2 seconds
  };

  if (!config.rpcUrl || !config.walletPath) {
    console.error("ERROR: RPC_URL and WALLET_PATH required in .env");
    process.exit(1);
  }

  // SAFETY CHECK
  if (!config.dryRun && config.tradeAmountUSDC < 10) {
    console.error("\n" + "=".repeat(80));
    console.error("⚠️  SAFETY WARNING");
    console.error("=".repeat(80));
    console.error(`Trade size $${config.tradeAmountUSDC} is too small for live trading`);
    console.error("Minimum recommended: $25 (better: $100+)");
    console.error();
    console.error("Small trades lose money to fees!");
    console.error();
    console.error("Either:");
    console.error("  1. Set DRY_RUN=true for testing");
    console.error("  2. Set TRADE_USD=25 or higher");
    console.error("=".repeat(80));
    process.exit(1);
  }

  // WARNING for small trades
  if (!config.dryRun && config.tradeAmountUSDC < 50) {
    console.log("\n" + "=".repeat(80));
    console.log("⚠️  WARNING: Small Trade Size");
    console.log("=".repeat(80));
    console.log(`You're trading with $${config.tradeAmountUSDC} (recommended: $100+)`);
    console.log();
    console.log("With $${config.tradeAmountUSDC} trades:");
    console.log("  • Need 0.78%+ spread to break even");
    console.log("  • Need 1.5%+ spread for meaningful profit ($0.15-0.20)");
    console.log("  • Most opportunities will be unprofitable");
    console.log("  • You may lose money during low volatility");
    console.log();
    console.log("This is allowed but HIGH RISK. Continuing in 5 seconds...");
    console.log("Press Ctrl+C to cancel.");
    console.log("=".repeat(80));

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const bot = new SimpleHFTBot(config);

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\n\nShutdown signal received");
    bot.stop();
    process.exit(0);
  });

  await bot.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { SimpleHFTBot };
