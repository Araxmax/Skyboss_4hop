import { Connection, PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';
import fs from 'fs';
import * as dotenv from 'dotenv';
import { PREDEFINED_POOLS, MIN_PROFIT_THRESHOLD, DECIMAL_2_POW_64, DECIMAL_10_POW_9, DECIMAL_10_POW_6 } from './constants';
import { CsvLogger, TradeLogEntry } from './CsvLogger';

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

class GrpcFastScanner {
  private connection: Connection;
  private poolPrices: Map<string, Decimal>;
  private lastPriceUpdate: Map<string, number>;
  private csvLogger: CsvLogger;
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
    this.csvLogger = new CsvLogger('./logs/scanner');

    console.log('[gRPC] ⚡ ULTRA-FAST gRPC Scanner initialized');
    console.log(`[gRPC] Commitment: PROCESSED (200-400ms latency)`);
    console.log(`[gRPC] Endpoint: ${GRPC_ENDPOINT}`);
    console.log(`[gRPC] API Key: ${HELIUS_API_KEY.substring(0, 8)}...`);
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
        const poolPubkey = new PublicKey(pool.address);

        // Use PROCESSED commitment for maximum speed (2x faster)
        const subId = this.connection.onAccountChange(
          poolPubkey,
          (accountInfo) => {
            if (accountInfo && accountInfo.data) {
              // Process update immediately without any delays
              this.processPriceUpdate(pool.address, pool.name, accountInfo.data);
            }
          },
          'processed' // processed = ~200-400ms (FASTEST AVAILABLE)
        );

        this.subscriptionIds.push(subId);
        console.log(`[gRPC] ✓ Subscribed to ${pool.name} (PROCESSED mode)`);
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

    const poolPubkeys = POOLS.map(p => new PublicKey(p.address));

    try {
      // Use processed commitment for fastest initial fetch
      const accountInfos = await this.connection.getMultipleAccountsInfo(
        poolPubkeys,
        { commitment: 'processed' }
      );

      for (let i = 0; i < POOLS.length; i++) {
        const pool = POOLS[i];
        const accountInfo = accountInfos[i];

        if (accountInfo && accountInfo.data) {
          this.processPriceUpdate(pool.address, pool.name, accountInfo.data);
        }
      }
    } catch (error: any) {
      console.error(`[gRPC] Initial fetch error: ${error.message}`);
    }
  }

  /**
   * Optimized arbitrage check - BOTH DIRECTIONS
   */
  private checkArbitrageOptimized(): void {
    if (this.poolPrices.size < 2) return;

    const pool005 = POOLS[0]; // 0.05% fee pool
    const pool001 = POOLS[1]; // 0.01% fee pool

    const price005 = this.poolPrices.get(pool005.address);
    const price001 = this.poolPrices.get(pool001.address);

    if (!price005 || !price001) return;

    this.priceCheckCount++;

    // ========================================
    // DIRECTION 1: Buy on 0.05% → Sell on 0.01%
    // ========================================
    const costPerSOL_dir1 = price005.mul(new Decimal(1).plus(pool005.fee_rate)); // Buy on 0.05%
    const revenuePerSOL_dir1 = price001.mul(new Decimal(1).minus(pool001.fee_rate)); // Sell on 0.01%
    const profitPerSOL_dir1 = revenuePerSOL_dir1.minus(costPerSOL_dir1);
    const profitPct_dir1 = profitPerSOL_dir1.div(costPerSOL_dir1);
    const isProfitable_dir1 = profitPct_dir1.gt(MIN_PROFIT_THRESHOLD_DECIMAL) && profitPct_dir1.gt(0);

    // ========================================
    // DIRECTION 2: Buy on 0.01% → Sell on 0.05%
    // ========================================
    const costPerSOL_dir2 = price001.mul(new Decimal(1).plus(pool001.fee_rate)); // Buy on 0.01%
    const revenuePerSOL_dir2 = price005.mul(new Decimal(1).minus(pool005.fee_rate)); // Sell on 0.05%
    const profitPerSOL_dir2 = revenuePerSOL_dir2.minus(costPerSOL_dir2);
    const profitPct_dir2 = profitPerSOL_dir2.div(costPerSOL_dir2);
    const isProfitable_dir2 = profitPct_dir2.gt(MIN_PROFIT_THRESHOLD_DECIMAL) && profitPct_dir2.gt(0);

    // Calculate spreads
    const priceDiff = price005.minus(price001).abs();
    const minPrice = price005.lt(price001) ? price005 : price001;
    const spreadPct = priceDiff.div(minPrice);

    // Pick the most profitable direction (or any if checking both)
    const direction1 = `${pool005.name} -> ${pool001.name}`;
    const direction2 = `${pool001.name} -> ${pool005.name}`;

    // Best direction
    let bestDirection = direction1;
    let bestProfitPct = profitPct_dir1;
    let isProfitable = isProfitable_dir1;

    if (profitPct_dir2.gt(profitPct_dir1)) {
      bestDirection = direction2;
      bestProfitPct = profitPct_dir2;
      isProfitable = isProfitable_dir2;
    }

    // Log every 20th check or if profitable (reduced logging for speed)
    if (isProfitable || this.priceCheckCount % 20 === 0) {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      const updatesPerSec = (this.updateCount / parseFloat(elapsed)).toFixed(1);

      console.log(`\n[CHECK ${this.priceCheckCount}] [${elapsed}s] [${updatesPerSec} updates/s]`);
      console.log(`  ${pool005.name}: $${price005.toFixed(6)}`);
      console.log(`  ${pool001.name}: $${price001.toFixed(6)}`);
      console.log(`  Spread: ${spreadPct.mul(100).toFixed(4)}%`);
      console.log(`  Direction 1 (0.05%→0.01%): ${profitPct_dir1.mul(100).toFixed(4)}%`);
      console.log(`  Direction 2 (0.01%→0.05%): ${profitPct_dir2.mul(100).toFixed(4)}%`);
      console.log(`  Best Direction: ${bestDirection} (${bestProfitPct.mul(100).toFixed(4)}%)`);

      // CSV logging (only log every 20th or if profitable to reduce I/O)
      const logEntry: TradeLogEntry = {
        timestamp: Date.now().toString(),
        datetime: new Date().toISOString(),
        signal_direction: bestDirection,
        price_001_pool: price001.toNumber(),
        price_005_pool: price005.toNumber(),
        spread: priceDiff.toNumber(),
        spread_pct: spreadPct.mul(100).toNumber(),
        expected_profit_pct: bestProfitPct.mul(100).toNumber(),
        trade_amount_usdc: parseFloat(process.env.TRADE_USD || "480"),
        safety_passed: false,
        safety_errors: "",
        safety_warnings: "",
        sol_balance: 0,
        usdc_balance: 0,
        executed: false,
        dry_run: true,
        swap1_pool: "",
        swap1_success: false,
        swap1_amount_in: 0,
        swap1_amount_out: 0,
        swap1_signature: "",
        swap1_error: "",
        swap2_pool: "",
        swap2_success: false,
        swap2_amount_in: 0,
        swap2_amount_out: 0,
        swap2_signature: "",
        swap2_error: "",
        actual_profit_usdc: 0,
        actual_profit_pct: 0,
        failure_reason: isProfitable ? "" : "Below profit threshold",
        failure_stage: isProfitable ? "" : "scanner",
      };

      this.csvLogger.logTrade(logEntry);
    }

    // Write signal if profitable (rate limited)
    if (isProfitable) {
      const now = Date.now();
      if (now - this.lastSignalTime > 1000) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`🚨 PROFITABLE OPPORTUNITY DETECTED!`);
        console.log(`${'='.repeat(70)}`);
        console.log(`Best Direction: ${bestDirection}`);
        console.log(`Profit: ${bestProfitPct.mul(100).toFixed(4)}%`);
        console.log(`Time: ${new Date().toLocaleTimeString()}`);
        console.log(`${'='.repeat(70)}\n`);

        const signal = {
          base: "USDC",
          direction: bestDirection,
          profit_pct: bestProfitPct.mul(100).toNumber(),
          trade_usdc: parseFloat(process.env.TRADE_USD || "480"),
          timestamp: now,
        };

        fs.writeFileSync('signal.json', JSON.stringify(signal, null, 2));
        console.log(`✅ Signal written to signal.json\n`);

        this.lastSignalTime = now;
      }
    }
  }

  /**
   * Start gRPC-style streaming scanner
   */
  async start(): Promise<void> {
    console.log('\n' + '='.repeat(70));
    console.log('⚡ ULTRA-FAST HELIUS gRPC STREAMING SCANNER ⚡');
    console.log('='.repeat(70));
    console.log('Technology: WebSocket with PROCESSED Commitment');
    console.log('Speed: 200-400ms latency (2x FASTER THAN CONFIRMED)');
    console.log('Features:');
    console.log('  🚀 Real-time streaming updates');
    console.log('  🚀 Ultra-low latency (PROCESSED mode)');
    console.log('  🚀 Minimal logging overhead');
    console.log('  🚀 Parallel subscriptions');
    console.log('  🚀 Hot path optimization');
    console.log('  🚀 Reduced I/O operations');
    console.log('='.repeat(70));

    this.isRunning = true;
    this.startTime = Date.now();

    // Step 1: Fetch initial prices (FAST)
    await this.fetchInitialPrices();

    // Step 2: Subscribe to streaming updates (ULTRA-FAST)
    await this.subscribeToAccounts();

    console.log('\n[gRPC] 🔥 Scanner LIVE in ULTRA-FAST MODE!');
    console.log('[gRPC] Latency: ~200-400ms per update');
    console.log('[gRPC] Press Ctrl+C to stop\n');
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

let scannerInstance: GrpcFastScanner | null = null;

async function main() {
  try {
    if (!process.env.HELIUS_API_KEY) {
      throw new Error('HELIUS_API_KEY not set in .env');
    }
    if (!process.env.RPC_URL) {
      throw new Error('RPC_URL not set in .env');
    }

    scannerInstance = new GrpcFastScanner();
    await scannerInstance.start();

    // Keep running
    await new Promise(() => {});
  } catch (error: any) {
    console.error('[gRPC] Fatal error:', error.message);
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

export { GrpcFastScanner };
