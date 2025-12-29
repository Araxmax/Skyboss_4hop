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
    // Use confirmed commitment for reliability, processed is too unstable
    this.connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      wsEndpoint: RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://'),
    });

    this.poolPrices = new Map();
    this.lastPriceUpdate = new Map();
    this.csvLogger = new CsvLogger('./logs/scanner');

    console.log('[gRPC] Ultra-fast gRPC-style scanner initialized');
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
   * Process price update (hot path - optimized)
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

      // Show update notification with delta
      if (oldPrice) {
        const delta = price.minus(oldPrice);
        const deltaPercent = delta.div(oldPrice).mul(100);
        console.log(`[⚡${this.updateCount}] ${poolName}: $${price.toFixed(6)} (${deltaPercent.gte(0) ? '+' : ''}${deltaPercent.toFixed(4)}%)`);
      } else {
        console.log(`[⚡${this.updateCount}] ${poolName}: $${price.toFixed(6)} [INITIAL]`);
      }

      // Check arbitrage immediately
      this.checkArbitrageOptimized();
    } catch (error: any) {
      console.error(`[gRPC] Price decode error: ${error.message}`);
    }
  }

  /**
   * Subscribe to account changes via Helius WebSocket (gRPC-style streaming)
   */
  private async subscribeToAccounts(): Promise<void> {
    console.log('\n[gRPC] Setting up streaming subscriptions...');

    for (const pool of POOLS) {
      try {
        const poolPubkey = new PublicKey(pool.address);

        // Use onAccountChange with 'confirmed' for balance between speed and reliability
        const subId = this.connection.onAccountChange(
          poolPubkey,
          (accountInfo) => {
            if (accountInfo && accountInfo.data) {
              this.processPriceUpdate(pool.address, pool.name, accountInfo.data);
            }
          },
          'confirmed' // confirmed = ~400-800ms, processed = ~200-400ms but less reliable
        );

        this.subscriptionIds.push(subId);
        console.log(`[gRPC] ✓ Subscribed to ${pool.name}`);
      } catch (error: any) {
        console.error(`[gRPC] Subscription error for ${pool.name}: ${error.message}`);
      }
    }

    console.log(`[gRPC] Active streaming connections: ${this.subscriptionIds.length}`);
  }

  /**
   * Initial price fetch
   */
  private async fetchInitialPrices(): Promise<void> {
    console.log('[gRPC] Fetching initial prices...');

    const poolPubkeys = POOLS.map(p => new PublicKey(p.address));

    try {
      const accountInfos = await this.connection.getMultipleAccountsInfo(
        poolPubkeys,
        { commitment: 'confirmed' }
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
   * Optimized arbitrage check
   */
  private checkArbitrageOptimized(): void {
    if (this.poolPrices.size < 2) return;

    const pool1 = POOLS[0];
    const pool2 = POOLS[1];

    const price1 = this.poolPrices.get(pool1.address);
    const price2 = this.poolPrices.get(pool2.address);

    if (!price1 || !price2) return;

    this.priceCheckCount++;

    // Fast calculations
    const priceDiff = price1.minus(price2).abs();
    const minPrice = price1.lt(price2) ? price1 : price2;
    const spreadPct = priceDiff.div(minPrice);

    // Determine direction
    const buyLower = price1.lt(price2);
    const direction = buyLower
      ? `${pool1.name} -> ${pool2.name}`
      : `${pool2.name} -> ${pool1.name}`;

    const buyPrice = buyLower ? price1 : price2;
    const sellPrice = buyLower ? price2 : price1;
    const buyFee = buyLower ? pool1.fee_rate : pool2.fee_rate;
    const sellFee = buyLower ? pool2.fee_rate : pool1.fee_rate;

    // Profit calculation
    const cost = buyPrice.mul(new Decimal(1 + buyFee));
    const revenue = sellPrice.mul(new Decimal(1 - sellFee));
    const profitPct = revenue.minus(cost).div(cost);

    const isProfitable = profitPct.gte(MIN_PROFIT_THRESHOLD_DECIMAL);

    // Log every 5th check or if profitable
    if (isProfitable || this.priceCheckCount % 5 === 0) {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      const updatesPerSec = (this.updateCount / parseFloat(elapsed)).toFixed(1);

      console.log(`\n[CHECK ${this.priceCheckCount}] [${elapsed}s] [${updatesPerSec} updates/s]`);
      console.log(`  ${pool1.name}: $${price1.toFixed(6)}`);
      console.log(`  ${pool2.name}: $${price2.toFixed(6)}`);
      console.log(`  Spread: ${spreadPct.mul(100).toFixed(4)}%`);
      console.log(`  Profit: ${profitPct.mul(100).toFixed(4)}%`);

      // CSV logging
      const logEntry: TradeLogEntry = {
        timestamp: Date.now().toString(),
        datetime: new Date().toISOString(),
        signal_direction: direction,
        price_001_pool: price2.toNumber(),
        price_005_pool: price1.toNumber(),
        spread: priceDiff.toNumber(),
        spread_pct: spreadPct.mul(100).toNumber(),
        expected_profit_pct: profitPct.mul(100).toNumber(),
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
        console.log(`Direction: ${direction}`);
        console.log(`Profit: ${profitPct.mul(100).toFixed(4)}%`);
        console.log(`Time: ${new Date().toLocaleTimeString()}`);
        console.log(`${'='.repeat(70)}\n`);

        const signal = {
          base: "USDC",
          direction: direction,
          profit_pct: profitPct.mul(100).toNumber(),
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
    console.log('HELIUS gRPC-STYLE STREAMING SCANNER');
    console.log('='.repeat(70));
    console.log('Technology: WebSocket with Confirmed Commitment');
    console.log('Speed: 400-800ms latency (gRPC-equivalent)');
    console.log('Features:');
    console.log('  ⚡ Real-time streaming updates');
    console.log('  ⚡ Sub-second reaction time');
    console.log('  ⚡ Confirmed commitment (reliable)');
    console.log('  ⚡ Parallel subscriptions');
    console.log('  ⚡ Hot path optimization');
    console.log('='.repeat(70));

    this.isRunning = true;
    this.startTime = Date.now();

    // Step 1: Fetch initial prices
    await this.fetchInitialPrices();

    // Step 2: Subscribe to streaming updates
    await this.subscribeToAccounts();

    console.log('\n[gRPC] 🚀 Scanner LIVE! Waiting for price updates...');
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
