/**
 * HFT ARBITRAGE BOT - PRODUCTION READY
 *
 * Integrates:
 * - UltraFastGrpcScanner for real-time price feeds
 * - HFTArbitrageEngine for profitable execution
 * - Advanced logging and monitoring
 *
 * Usage:
 *   npm run bot:hft
 */

import { Connection, Keypair } from "@solana/web3.js";
import fs from "fs";
import Decimal from "decimal.js";
import * as dotenv from "dotenv";
import { HFTArbitrageEngine } from "./HFTArbitrageEngine";
import { PREDEFINED_POOLS, DECIMAL_2_POW_64, DECIMAL_10_POW_9, DECIMAL_10_POW_6 } from "./constants";
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";

dotenv.config();

/* =========================
   CONFIGURATION
========================= */

interface BotConfig {
  rpcUrl: string;
  walletPath: string;
  dryRun: boolean;

  // Trading params
  minNetProfitUSDC: number;
  tradeAmountUSDC: number;
  maxSlippagePercent: number;

  // Priority fees
  basePriorityFee: number;
  maxPriorityFee: number;

  // gRPC streaming
  grpcEndpoint: string;
  grpcToken: string;

  // Jito
  useJito: boolean;
  jitoTipLamports: number;

  // Safety
  maxConsecutiveFailures: number;
  minSOLBalance: number;
}

/* =========================
   HFT ARBITRAGE BOT
========================= */

class HFTArbitrageBot {
  private connection: Connection;
  private wallet: Keypair;
  private config: BotConfig;
  private engine: HFTArbitrageEngine;
  private grpcClient: Client | null = null;
  private grpcStream: any = null;

  private poolPrices: Map<string, Decimal> = new Map();
  private lastPriceUpdate: Map<string, number> = new Map();
  private updateCount: number = 0;
  private scanCount: number = 0;
  private isRunning: boolean = false;

  constructor(config: BotConfig) {
    this.config = config;

    // Setup connection with fast commitment
    this.connection = new Connection(config.rpcUrl, {
      commitment: "processed",
      disableRetryOnRateLimit: false,
    });

    // Load wallet
    this.wallet = this.loadWallet(config.walletPath);

    // Initialize HFT engine
    this.engine = new HFTArbitrageEngine(
      this.connection,
      this.wallet,
      {
        minNetProfitUSDC: config.minNetProfitUSDC,
        tradeAmountUSDC: config.tradeAmountUSDC,
        maxSlippagePercent: config.maxSlippagePercent,
        basePriorityFee: config.basePriorityFee,
        maxPriorityFee: config.maxPriorityFee,
        useJito: config.useJito,
        jitoTipLamports: config.jitoTipLamports,
        maxConsecutiveFailures: config.maxConsecutiveFailures,
        minSOLBalance: config.minSOLBalance,
      }
    );

    console.log("\n" + "=".repeat(80));
    console.log("⚡ HFT ARBITRAGE BOT - INITIALIZED");
    console.log("=".repeat(80));
    console.log(`Wallet: ${this.wallet.publicKey.toBase58()}`);
    console.log(`Mode: ${config.dryRun ? "🧪 DRY RUN" : "💰 LIVE TRADING"}`);
    console.log(`Min Net Profit: $${config.minNetProfitUSDC}`);
    console.log(`Trade Size: $${config.tradeAmountUSDC}`);
    console.log(`Jito MEV Protection: ${config.useJito ? "ENABLED" : "DISABLED"}`);
    console.log("=".repeat(80));
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
   * Decode sqrt price from Orca Whirlpool
   */
  private decodeSqrtPrice(data: Buffer): bigint {
    try {
      return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
    } catch {
      throw new Error("Invalid whirlpool data");
    }
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
   * Fetch Raydium price from vaults
   */
  private async fetchRaydiumPrice(vaultA: string, vaultB: string): Promise<Decimal | null> {
    try {
      const { getAccount } = await import("@solana/spl-token");
      const { PublicKey } = await import("@solana/web3.js");

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
      console.error(`[RAYDIUM] Price fetch error: ${error.message}`);
      return null;
    }
  }

  /**
   * Process price update and check for arbitrage
   */
  private async processPriceUpdate(poolAddress: string, poolName: string, price: Decimal): Promise<void> {
    this.poolPrices.set(poolAddress, price);
    this.lastPriceUpdate.set(poolAddress, Date.now());
    this.updateCount++;

    // Log every 10th update
    if (this.updateCount % 10 === 0) {
      console.log(`[⚡${this.updateCount}] ${poolName}: $${price.toFixed(6)}`);
    }

    // Check arbitrage
    await this.checkArbitrage();
  }

  /**
   * Check for arbitrage opportunities
   */
  private async checkArbitrage(): Promise<void> {
    if (this.poolPrices.size < 2) return;

    this.scanCount++;

    // Get pool prices
    const orcaPool = PREDEFINED_POOLS.find(p => p.type === "orca");
    const raydiumPool = PREDEFINED_POOLS.find(p => p.type === "raydium");

    if (!orcaPool || !raydiumPool) return;

    const orcaPrice = this.poolPrices.get(orcaPool.address);
    const raydiumPrice = this.poolPrices.get(raydiumPool.address);

    if (!orcaPrice || !raydiumPrice) return;

    // Calculate spread
    const spread = orcaPrice.minus(raydiumPrice).abs();
    const spreadPercent = spread.div(Decimal.min(orcaPrice, raydiumPrice)).mul(100);

    // Log every 20 scans or if spread > 0.2%
    if (this.scanCount % 20 === 0 || spreadPercent.gte(0.2)) {
      console.log(`\n[SCAN ${this.scanCount}]`);
      console.log(`  Orca: $${orcaPrice.toFixed(6)}`);
      console.log(`  Raydium: $${raydiumPrice.toFixed(6)}`);
      console.log(`  Spread: ${spreadPercent.toFixed(4)}%`);
    }

    // Determine direction
    if (orcaPrice.lt(raydiumPrice)) {
      // Buy on Orca (cheaper), sell on Raydium (expensive)
      await this.engine.processOpportunity(
        orcaPool.address,
        raydiumPool.address,
        orcaPrice,
        raydiumPrice,
        "pool1-to-pool2"
      );
    } else if (raydiumPrice.lt(orcaPrice)) {
      // Buy on Raydium (cheaper), sell on Orca (expensive)
      await this.engine.processOpportunity(
        raydiumPool.address,
        orcaPool.address,
        raydiumPrice,
        orcaPrice,
        "pool1-to-pool2"
      );
    }
  }

  /**
   * Subscribe to gRPC streaming
   */
  private async subscribeToStreams(): Promise<void> {
    console.log("\n[gRPC] Connecting to real-time price feeds...");

    if (!this.config.grpcToken) {
      throw new Error("GRPC token not configured");
    }

    // Initialize gRPC client
    this.grpcClient = new Client(
      this.config.grpcEndpoint,
      this.config.grpcToken,
      {
        grpcMaxDecodingMessageSize: 64 * 1024 * 1024,
        grpcMaxEncodingMessageSize: 64 * 1024 * 1024,
      }
    );

    await this.grpcClient.connect();
    console.log("[gRPC] ✅ Connected");

    // Build account list
    const accountsToWatch: string[] = [];
    const raydiumVaultStates = new Map<string, {
      vaultA: bigint | null,
      vaultB: bigint | null,
      poolName: string,
      poolAddress: string
    }>();

    for (const pool of PREDEFINED_POOLS) {
      if (pool.type === "orca") {
        accountsToWatch.push(pool.address);
      } else if (pool.type === "raydium" && pool.vault_a && pool.vault_b) {
        accountsToWatch.push(pool.vault_a);
        accountsToWatch.push(pool.vault_b);
        raydiumVaultStates.set(pool.address, {
          vaultA: null,
          vaultB: null,
          poolName: pool.name,
          poolAddress: pool.address
        });
      }
    }

    // Subscribe
    const request = {
      accounts: {
        client: {
          account: accountsToWatch,
          owner: [],
          filters: [],
        },
      },
      commitment: CommitmentLevel.PROCESSED,
    };

    this.grpcStream = await this.grpcClient.subscribe();

    // Handle updates
    this.grpcStream.on("data", async (data: any) => {
      try {
        if (!data?.account?.account) return;

        const update = data.account;
        const { PublicKey } = await import("@solana/web3.js");
        const accountPubkey = new PublicKey(update.account.pubkey);
        const accountKey = accountPubkey.toBase58();
        const accountData = Buffer.from(update.account.data);

        // Check if Orca pool
        const orcaPool = PREDEFINED_POOLS.find(p => p.type === "orca" && p.address === accountKey);
        if (orcaPool) {
          const sqrtPrice = this.decodeSqrtPrice(accountData);
          const price = this.sqrtPriceToPrice(sqrtPrice);
          await this.processPriceUpdate(orcaPool.address, orcaPool.name, price);
          return;
        }

        // Check if Raydium vault
        for (const pool of PREDEFINED_POOLS) {
          if (pool.type === "raydium" && pool.vault_a && pool.vault_b) {
            const state = raydiumVaultStates.get(pool.address)!;

            if (accountKey === pool.vault_a) {
              state.vaultA = accountData.readBigUInt64LE(64);
              if (state.vaultB !== null) {
                const solBalance = new Decimal(state.vaultA.toString()).div(1e9);
                const usdcBalance = new Decimal(state.vaultB.toString()).div(1e6);
                if (!solBalance.isZero()) {
                  const price = usdcBalance.div(solBalance);
                  await this.processPriceUpdate(pool.address, pool.name, price);
                }
              }
            } else if (accountKey === pool.vault_b) {
              state.vaultB = accountData.readBigUInt64LE(64);
              if (state.vaultA !== null) {
                const solBalance = new Decimal(state.vaultA.toString()).div(1e9);
                const usdcBalance = new Decimal(state.vaultB.toString()).div(1e6);
                if (!solBalance.isZero()) {
                  const price = usdcBalance.div(solBalance);
                  await this.processPriceUpdate(pool.address, pool.name, price);
                }
              }
            }
          }
        }
      } catch (error: any) {
        // Suppress errors
      }
    });

    this.grpcStream.on("error", (error: any) => {
      console.error(`[gRPC] Error: ${error.message}`);
    });

    await this.grpcStream.write(request);

    console.log(`[gRPC] ✅ Subscribed to ${accountsToWatch.length} accounts`);

    // Fetch initial prices
    await this.fetchInitialPrices();
  }

  /**
   * Fetch initial prices
   */
  private async fetchInitialPrices(): Promise<void> {
    console.log("\n[INIT] Fetching initial pool prices...");

    for (const pool of PREDEFINED_POOLS) {
      if (pool.type === "orca") {
        try {
          const { PublicKey } = await import("@solana/web3.js");
          const poolPubkey = new PublicKey(pool.address);
          const accountInfo = await this.connection.getAccountInfo(poolPubkey, "processed");

          if (accountInfo?.data) {
            const sqrtPrice = this.decodeSqrtPrice(accountInfo.data);
            const price = this.sqrtPriceToPrice(sqrtPrice);
            this.poolPrices.set(pool.address, price);
            console.log(`[INIT] ${pool.name}: $${price.toFixed(6)}`);
          }
        } catch (error: any) {
          console.error(`[INIT] ${pool.name} error: ${error.message}`);
        }
      } else if (pool.type === "raydium" && pool.vault_a && pool.vault_b) {
        const price = await this.fetchRaydiumPrice(pool.vault_a, pool.vault_b);
        if (price) {
          this.poolPrices.set(pool.address, price);
          console.log(`[INIT] ${pool.name}: $${price.toFixed(6)}`);
        }
      }
    }
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

    console.log("\n" + "=".repeat(80));
    console.log("🚀 STARTING HFT ARBITRAGE BOT");
    console.log("=".repeat(80));

    // Subscribe to streams
    await this.subscribeToStreams();

    console.log("\n[BOT] 🔥 LIVE - Monitoring for profitable opportunities");
    console.log("[BOT] Press Ctrl+C to stop\n");

    // Keep running
    return new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        console.log("\n\n[BOT] Shutdown signal received");
        this.stop();
        resolve();
      });
    });
  }

  /**
   * Stop bot
   */
  stop(): void {
    this.isRunning = false;

    if (this.grpcStream) {
      try {
        this.grpcStream.end();
      } catch {}
    }

    console.log("\n" + "=".repeat(80));
    console.log("🛑 BOT STOPPED");
    console.log("=".repeat(80));

    const stats = this.engine.getStats();
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`Successful: ${stats.successfulTrades} (${stats.successRate.toFixed(2)}%)`);
    console.log(`Failed: ${stats.failedTrades}`);
    console.log(`Total Profit: $${stats.totalProfitUSDC.toFixed(4)} USDC`);
    console.log("=".repeat(80));
  }
}

/* =========================
   MAIN ENTRY POINT
========================= */

async function main() {
  const config: BotConfig = {
    rpcUrl: process.env.RPC_URL || "",
    walletPath: process.env.WALLET_PATH || "",
    dryRun: process.env.DRY_RUN?.toLowerCase() === "true",

    minNetProfitUSDC: parseFloat(process.env.MIN_NET_PROFIT_USDC || "0.10"),
    tradeAmountUSDC: parseFloat(process.env.TRADE_USD || "100"),
    maxSlippagePercent: parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.5"),

    basePriorityFee: parseInt(process.env.BASE_PRIORITY_FEE_LAMPORTS || "50000"),
    maxPriorityFee: parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || "200000"),

    grpcEndpoint: process.env.QUICKNODE_GRPC_ENDPOINT || "",
    grpcToken: process.env.QUICKNODE_GRPC_TOKEN || "",

    useJito: process.env.USE_JITO?.toLowerCase() !== "false", // Default true
    jitoTipLamports: parseInt(process.env.JITO_TIP_LAMPORTS || "10000"),

    maxConsecutiveFailures: parseInt(process.env.MAX_CONSECUTIVE_FAILURES || "5"),
    minSOLBalance: parseFloat(process.env.MIN_SOL_BALANCE_CRITICAL || "0.05"),
  };

  // Validate config
  if (!config.rpcUrl) throw new Error("RPC_URL not set");
  if (!config.walletPath) throw new Error("WALLET_PATH not set");
  if (!config.grpcEndpoint) throw new Error("QUICKNODE_GRPC_ENDPOINT not set");
  if (!config.grpcToken) throw new Error("QUICKNODE_GRPC_TOKEN not set");

  // Create and start bot
  const bot = new HFTArbitrageBot(config);
  await bot.start();
}

// Run
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
}

export { HFTArbitrageBot };
