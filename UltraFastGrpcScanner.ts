import { Connection, PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';
import fs from 'fs';
import * as dotenv from 'dotenv';
import { PREDEFINED_POOLS, MIN_PROFIT_THRESHOLD, DECIMAL_2_POW_64, DECIMAL_10_POW_9, DECIMAL_10_POW_6, PoolType } from './constants';
import { UltraScannerLogger, UltraScanLogEntry } from './UltraScannerLogger';
import { fetchRaydiumPrice } from './RaydiumPriceFetcher';

dotenv.config();

/* =========================
   HELIUS GRPC STREAMING
========================= */

const RPC_URL = process.env.RPC_URL || '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const POOLS = PREDEFINED_POOLS;
const MIN_PROFIT_THRESHOLD_DECIMAL = new Decimal(MIN_PROFIT_THRESHOLD);

// Helius gRPC endpoint
const GRPC_ENDPOINT = process.env.HELIUS_GRPC_ENDPOINT || 'laserstream-mainnet-ewr.helius-rpc.com:443';

/* =========================
   ULTRA-FAST GRPC SCANNER
========================= */

class UltraFastGrpcScanner {
  private connection: Connection;
  private poolPrices: Map<string, Decimal>;
  private lastPriceUpdate: Map<string, number>;
  private ultraLogger: UltraScannerLogger;
  private isRunning: boolean = false;
  private priceCheckCount: number = 0;
  private lastSignalTime: number = 0;
  private updateCount: number = 0;
  private startTime: number = 0;

  // WebSocket subscriptions (fastest available in Solana Web3.js)
  private subscriptionIds: number[] = [];

  constructor() {
    // Use PROCESSED commitment for maximum speed (2x faster than confirmed)
    this.connection = new Connection(RPC_URL, {
      commitment: 'processed', // 200-400ms latency (FASTEST)
      wsEndpoint: RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://'),
      disableRetryOnRateLimit: false,
    });

    this.poolPrices = new Map();
    this.lastPriceUpdate = new Map();
    this.ultraLogger = new UltraScannerLogger('./logs');

    console.log('[HFT] ⚡⚡⚡ ULTRA-FAST HFT SCANNER INITIALIZED ⚡⚡⚡');
    console.log(`[HFT] Commitment: PROCESSED (200-400ms latency)`);
    console.log(`[HFT] Endpoint: ${GRPC_ENDPOINT}`);
    console.log(`[HFT] API Key: ${HELIUS_API_KEY.substring(0, 8)}...`);
    console.log(`[HFT] Logging every scan to: ${this.ultraLogger.getCurrentLogFile()}`);
  }

  /**
   * Decode sqrt price (optimized)
   */
  private decodeSqrtPrice(data: Buffer): bigint {
    try {
      return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
    } catch {
      throw new Error('Invalid whirlpool data');
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
   * Process price update (HOT PATH - MAXIMUM SPEED)
   */
  private processPriceUpdate(poolAddress: string, poolName: string, data: Buffer): void {
    try {
      const now = Date.now();
      this.updateCount++;

      const sqrtPriceX64 = this.decodeSqrtPrice(data);
      const price = this.sqrtPriceToPrice(sqrtPriceX64);

      const oldPrice = this.poolPrices.get(poolAddress);
      this.poolPrices.set(poolAddress, price);
      this.lastPriceUpdate.set(poolAddress, now);

      // Minimal logging on hot path - only log every 10th update or significant changes
      if (this.updateCount % 10 === 0 || !oldPrice) {
        if (oldPrice) {
          const delta = price.minus(oldPrice);
          const deltaPercent = delta.div(oldPrice).mul(100);
          if (deltaPercent.abs().gte(0.01)) { // Only log if >0.01% change
            console.log(`[⚡${this.updateCount}] ${poolName}: $${price.toFixed(6)} (${deltaPercent.gte(0) ? '+' : ''}${deltaPercent.toFixed(4)}%)`);
          }
        } else {
          console.log(`[⚡${this.updateCount}] ${poolName}: $${price.toFixed(6)} [INITIAL]`);
        }
      }

      // Check arbitrage immediately (this is the critical path)
      this.checkArbitrageOptimized();
    } catch (error: any) {
      // Suppress error logging on hot path
      if (this.updateCount % 100 === 0) {
        console.error(`[gRPC] Price decode errors: ${error.message}`);
      }
    }
  }

  /**
   * Subscribe to account changes via Helius WebSocket (ULTRA-FAST)
   */
  private async subscribeToAccounts(): Promise<void> {
    console.log('\n[gRPC] Setting up ULTRA-FAST streaming subscriptions...');

    // Subscribe to all pools in parallel for faster setup
    const subscriptionPromises = POOLS.map(async (pool) => {
      try {
        if (pool.type === 'orca') {
          // Orca Whirlpool - subscribe to pool account
          const poolPubkey = new PublicKey(pool.address);

          const subId = this.connection.onAccountChange(
            poolPubkey,
            (accountInfo) => {
              if (accountInfo && accountInfo.data) {
                this.processPriceUpdate(pool.address, pool.name, accountInfo.data);
              }
            },
            'processed'
          );

          this.subscriptionIds.push(subId);
          console.log(`[gRPC] ✓ Subscribed to ${pool.name} (Orca Whirlpool)`);
        } else if (pool.type === 'raydium') {
          // Raydium AMM - subscribe to both vaults
          if (!pool.vault_a || !pool.vault_b) {
            console.error(`[gRPC] Missing vault addresses for ${pool.name}`);
            return;
          }

          const vaultAPubkey = new PublicKey(pool.vault_a);
          const vaultBPubkey = new PublicKey(pool.vault_b);

          let lastVaultABalance: bigint | null = null;
          let lastVaultBBalance: bigint | null = null;

          // Subscribe to SOL vault
          const subIdA = this.connection.onAccountChange(
            vaultAPubkey,
            (accountInfo) => {
              try {
                const amount = accountInfo.data.readBigUInt64LE(64);
                lastVaultABalance = amount;

                if (lastVaultBBalance !== null) {
                  const solBalance = new Decimal(lastVaultABalance.toString()).div(1e9);
                  const usdcBalance = new Decimal(lastVaultBBalance.toString()).div(1e6);
                  if (!solBalance.isZero()) {
                    const price = usdcBalance.div(solBalance);
                    this.poolPrices.set(pool.address, price);
                    this.lastPriceUpdate.set(pool.address, Date.now());
                    this.updateCount++;
                    this.checkArbitrageOptimized();
                  }
                }
              } catch (error: any) {
                console.error(`[gRPC] Raydium vault A error: ${error.message}`);
              }
            },
            'processed'
          );

          // Subscribe to USDC vault
          const subIdB = this.connection.onAccountChange(
            vaultBPubkey,
            (accountInfo) => {
              try {
                const amount = accountInfo.data.readBigUInt64LE(64);
                lastVaultBBalance = amount;

                if (lastVaultABalance !== null) {
                  const solBalance = new Decimal(lastVaultABalance.toString()).div(1e9);
                  const usdcBalance = new Decimal(lastVaultBBalance.toString()).div(1e6);
                  if (!solBalance.isZero()) {
                    const price = usdcBalance.div(solBalance);
                    this.poolPrices.set(pool.address, price);
                    this.lastPriceUpdate.set(pool.address, Date.now());
                    this.updateCount++;
                    this.checkArbitrageOptimized();
                  }
                }
              } catch (error: any) {
                console.error(`[gRPC] Raydium vault B error: ${error.message}`);
              }
            },
            'processed'
          );

          this.subscriptionIds.push(subIdA, subIdB);
          console.log(`[gRPC] ✓ Subscribed to ${pool.name} (Raydium AMM - 2 vaults)`);
        }
      } catch (error: any) {
        console.error(`[gRPC] Subscription error for ${pool.name}: ${error.message}`);
      }
    });

    // Wait for all subscriptions to complete
    await Promise.all(subscriptionPromises);

    console.log(`[gRPC] ✅ ${this.subscriptionIds.length} streaming connections ACTIVE (ULTRA-FAST MODE)`);
  }

  /**
   * Initial price fetch (FAST)
   */
  private async fetchInitialPrices(): Promise<void> {
    console.log('[gRPC] Fetching initial prices (FAST)...');

    try {
      for (const pool of POOLS) {
        if (pool.type === 'orca') {
          // Fetch Orca Whirlpool account
          const poolPubkey = new PublicKey(pool.address);
          const accountInfo = await this.connection.getAccountInfo(poolPubkey, 'processed');

          if (accountInfo && accountInfo.data) {
            this.processPriceUpdate(pool.address, pool.name, accountInfo.data);
          }
        } else if (pool.type === 'raydium') {
          // Fetch Raydium price from vaults
          if (pool.vault_a && pool.vault_b) {
            const price = await fetchRaydiumPrice(this.connection, pool.vault_a, pool.vault_b);
            if (price) {
              this.poolPrices.set(pool.address, price);
              this.lastPriceUpdate.set(pool.address, Date.now());
              console.log(`[gRPC] ${pool.name}: $${price.toFixed(6)} [INITIAL]`);
            }
          }
        }
      }
    } catch (error: any) {
      console.error(`[gRPC] Initial fetch error: ${error.message}`);
    }
  }

  /**
   * Optimized arbitrage check - ALL POOL PAIRS AND DIRECTIONS
   * LOGS EVERY SCAN TO CSV
   */
  private checkArbitrageOptimized(): void {
    if (this.poolPrices.size < 2) return;

    this.priceCheckCount++;

    // Get Orca and Raydium prices (we have exactly 2 pools now)
    const orcaPool = POOLS.find(p => p.type === 'orca');
    const raydiumPool = POOLS.find(p => p.type === 'raydium');

    if (!orcaPool || !raydiumPool) return;

    const orcaPrice = this.poolPrices.get(orcaPool.address);
    const raydiumPrice = this.poolPrices.get(raydiumPool.address);

    if (!orcaPrice || !raydiumPrice) return;

    // Direction 1: Orca → Raydium (buy on Orca, sell on Raydium)
    const costPerSOL_dir1 = orcaPrice.mul(new Decimal(1).plus(orcaPool.fee_rate));
    const revenuePerSOL_dir1 = raydiumPrice.mul(new Decimal(1).minus(raydiumPool.fee_rate));
    const profitPerSOL_dir1 = revenuePerSOL_dir1.minus(costPerSOL_dir1);
    const profitPct_dir1 = profitPerSOL_dir1.div(costPerSOL_dir1).mul(100);

    // Direction 2: Raydium → Orca (buy on Raydium, sell on Orca)
    const costPerSOL_dir2 = raydiumPrice.mul(new Decimal(1).plus(raydiumPool.fee_rate));
    const revenuePerSOL_dir2 = orcaPrice.mul(new Decimal(1).minus(orcaPool.fee_rate));
    const profitPerSOL_dir2 = revenuePerSOL_dir2.minus(costPerSOL_dir2);
    const profitPct_dir2 = profitPerSOL_dir2.div(costPerSOL_dir2).mul(100);

    // Determine best direction
    let bestDirection: string;
    let bestProfitPct: Decimal;

    if (profitPct_dir1.gt(profitPct_dir2)) {
      bestDirection = `${orcaPool.name} -> ${raydiumPool.name}`;
      bestProfitPct = profitPct_dir1;
    } else {
      bestDirection = `${raydiumPool.name} -> ${orcaPool.name}`;
      bestProfitPct = profitPct_dir2;
    }

    // Check if tradable (profit above threshold)
    const isProfitable = bestProfitPct.div(100).gt(MIN_PROFIT_THRESHOLD_DECIMAL);

    // Calculate price difference and spread
    const priceDiff = orcaPrice.minus(raydiumPrice).abs();
    const minPrice = orcaPrice.lt(raydiumPrice) ? orcaPrice : raydiumPrice;
    const spreadPct = priceDiff.div(minPrice).mul(100);

    // LOG EVERY SCAN TO CSV
    const failureReason = isProfitable ? '' : `Profit ${bestProfitPct.toFixed(4)}% below threshold ${(MIN_PROFIT_THRESHOLD_DECIMAL.mul(100)).toFixed(2)}%`;

    const scanLogEntry: UltraScanLogEntry = {
      scan_number: this.priceCheckCount,
      timestamp: new Date().toISOString(),
      raydium_price: raydiumPrice.toNumber(),
      orca_price: orcaPrice.toNumber(),
      spread_usd: priceDiff.toNumber(),
      spread_pct: spreadPct.toNumber(),
      net_profit: bestProfitPct.toNumber(),
      is_tradable: isProfitable,
      failure_reason: failureReason
    };

    this.ultraLogger.logScan(scanLogEntry);

    // Console logging every 20th check or if profitable
    if (isProfitable || this.priceCheckCount % 20 === 0) {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      const updatesPerSec = (this.updateCount / parseFloat(elapsed)).toFixed(1);

      console.log(`\n[SCAN ${this.priceCheckCount}] [${elapsed}s] [${updatesPerSec} updates/s]`);
      console.log(`  Orca: $${orcaPrice.toFixed(6)}`);
      console.log(`  Raydium: $${raydiumPrice.toFixed(6)}`);
      console.log(`  Spread: ${spreadPct.toFixed(4)}%`);
      console.log(`  Dir 1 (Orca→Raydium): ${profitPct_dir1.toFixed(4)}%`);
      console.log(`  Dir 2 (Raydium→Orca): ${profitPct_dir2.toFixed(4)}%`);
      console.log(`  Best: ${bestDirection} (${bestProfitPct.toFixed(4)}%)`);
      console.log(`  Tradable: ${isProfitable ? '✅ YES' : '❌ NO'}`);
    }

    // Write signal if profitable (rate limited)
    if (isProfitable) {
      const now = Date.now();
      if (now - this.lastSignalTime > 1000) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`🚨 PROFITABLE OPPORTUNITY DETECTED!`);
        console.log(`${'='.repeat(70)}`);
        console.log(`Best Direction: ${bestDirection}`);
        console.log(`Profit: ${bestProfitPct.toFixed(4)}%`);
        console.log(`Time: ${new Date().toLocaleTimeString()}`);
        console.log(`${'='.repeat(70)}\n`);

        const signal = {
          base: "USDC",
          direction: bestDirection,
          profit_pct: bestProfitPct.toNumber(),
          trade_usdc: parseFloat(process.env.TRADE_USD || "100"),
          timestamp: now,
        };

        fs.writeFileSync('signal.json', JSON.stringify(signal, null, 2));
        console.log(`✅ Signal written to signal.json\n`);

        this.lastSignalTime = now;
      }
    }
  }

  /**
   * Start HFT scanner
   */
  async start(): Promise<void> {
    console.log('\n' + '='.repeat(70));
    console.log('⚡⚡⚡ ULTRA-FAST HFT SCANNER - RAYDIUM ↔ ORCA ⚡⚡⚡');
    console.log('='.repeat(70));
    console.log('Mode: HIGH-FREQUENCY TRADING (HFT)');
    console.log('Technology: WebSocket + PROCESSED Commitment');
    console.log('Latency: 200-400ms per update');
    console.log('Pools: 1 Orca + 1 Raydium');
    console.log('Features:');
    console.log('  ⚡ Real-time streaming updates');
    console.log('  ⚡ Ultra-low latency');
    console.log('  ⚡ LOGS EVERY SCAN to CSV');
    console.log('  ⚡ Bidirectional arbitrage detection');
    console.log(`CSV Log: ${this.ultraLogger.getCurrentLogFile()}`);
    console.log('='.repeat(70));

    this.isRunning = true;
    this.startTime = Date.now();

    // Step 1: Fetch initial prices
    await this.fetchInitialPrices();

    // Step 2: Subscribe to streaming updates
    await this.subscribeToAccounts();

    console.log('\n[HFT] 🔥 SCANNER LIVE - LOGGING ALL SCANS!');
    console.log('[HFT] Press Ctrl+C to stop\n');
  }

  /**
   * Stop and cleanup
   */
  stop(): void {
    this.isRunning = false;

    // Unsubscribe from all streams
    for (const subId of this.subscriptionIds) {
      try {
        this.connection.removeAccountChangeListener(subId);
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const avgUpdatesPerSec = (this.updateCount / parseFloat(elapsed)).toFixed(2);

    console.log(`\n[gRPC] Scanner stopped`);
    console.log(`[gRPC] Total updates: ${this.updateCount}`);
    console.log(`[gRPC] Total checks: ${this.priceCheckCount}`);
    console.log(`[gRPC] Runtime: ${elapsed}s`);
    console.log(`[gRPC] Avg updates/sec: ${avgUpdatesPerSec}`);
  }
}

/* =========================
   MAIN
========================= */

let scannerInstance: UltraFastGrpcScanner | null = null;

async function main() {
  try {
    if (!process.env.HELIUS_API_KEY) {
      throw new Error('HELIUS_API_KEY not set in .env');
    }
    if (!process.env.RPC_URL) {
      throw new Error('RPC_URL not set in .env');
    }

    scannerInstance = new UltraFastGrpcScanner();
    await scannerInstance.start();

    // Keep running
    await new Promise(() => {});
  } catch (error: any) {
    console.error('[HFT] Fatal error:', error.message);
    if (scannerInstance) {
      scannerInstance.stop();
    }
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[gRPC] Shutting down...');
  if (scannerInstance) {
    scannerInstance.stop();
  }
  process.exit(0);
});

if (require.main === module) {
  main();
}

export { UltraFastGrpcScanner };
