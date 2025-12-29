import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { Connection, PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';
import fs from 'fs';
import * as dotenv from 'dotenv';
import { PREDEFINED_POOLS, MIN_PROFIT_THRESHOLD, DECIMAL_2_POW_64, DECIMAL_10_POW_9, DECIMAL_10_POW_6 } from './constants';

dotenv.config();

/* =========================
   CONFIGURATION
========================= */

const HELIUS_GRPC_ENDPOINT = process.env.HELIUS_GRPC_ENDPOINT || 'laserstream-mainnet-ewr.helius-rpc.com:443';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_URL = process.env.RPC_URL || '';

const POOLS = PREDEFINED_POOLS;
const MIN_PROFIT_THRESHOLD_DECIMAL = new Decimal(MIN_PROFIT_THRESHOLD);

/* =========================
   HELIUS GRPC CLIENT
========================= */

class HeliusGrpcScanner {
  private connection: Connection;
  private poolPrices: Map<string, Decimal>;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor() {
    this.connection = new Connection(RPC_URL, 'confirmed');
    this.poolPrices = new Map();
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
   * Convert sqrt price X64 to regular price (optimized)
   */
  private sqrtPriceToPrice(sqrtPriceX64: bigint): Decimal {
    const sqrtPrice = new Decimal(sqrtPriceX64.toString()).div(DECIMAL_2_POW_64);
    const price = sqrtPrice.pow(2);
    return price.mul(DECIMAL_10_POW_9).div(DECIMAL_10_POW_6);
  }

  /**
   * Fetch current pool prices via HTTP RPC (batched for performance)
   */
  async fetchPoolPrices(): Promise<void> {
    console.log('\n[gRPC] Fetching pool prices...');

    // Batch RPC calls for better performance
    const poolPublicKeys = POOLS.map(p => new PublicKey(p.address));
    
    try {
      const accountInfos = await this.connection.getMultipleAccountsInfo(poolPublicKeys);
      
      for (let i = 0; i < POOLS.length; i++) {
        const pool = POOLS[i];
        const accountInfo = accountInfos[i];
        
        if (!accountInfo || !accountInfo.data) {
          console.error(`[gRPC] Failed to fetch pool: ${pool.name}`);
          continue;
        }

        try {
          const sqrtPriceX64 = this.decodeSqrtPrice(accountInfo.data);
          const price = this.sqrtPriceToPrice(sqrtPriceX64);

          this.poolPrices.set(pool.address, price);
          console.log(`[gRPC] ${pool.name}: $${price.toFixed(6)}`);
        } catch (error: any) {
          console.error(`[gRPC] Error processing ${pool.name}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error(`[gRPC] Error fetching pool prices:`, error.message);
    }
  }

  /**
   * Calculate arbitrage opportunity
   */
  private checkArbitrage(): void {
    if (this.poolPrices.size < 2) {
      return;
    }

    const pool1 = POOLS[0];
    const pool2 = POOLS[1];

    const price1 = this.poolPrices.get(pool1.address);
    const price2 = this.poolPrices.get(pool2.address);

    if (!price1 || !price2) {
      return;
    }

    // Calculate arbitrage
    const priceDiff = price1.minus(price2).abs();
    const minPrice = Decimal.min(price1, price2);
    const spreadPct = priceDiff.div(minPrice);

    // Determine direction
    let direction: string;
    let buyPrice: Decimal;
    let sellPrice: Decimal;
    let buyFee: number;
    let sellFee: number;

    if (price1.lt(price2)) {
      direction = `${pool1.name} -> ${pool2.name}`;
      buyPrice = price1;
      sellPrice = price2;
      buyFee = pool1.fee_rate;
      sellFee = pool2.fee_rate;
    } else {
      direction = `${pool2.name} -> ${pool1.name}`;
      buyPrice = price2;
      sellPrice = price1;
      buyFee = pool2.fee_rate;
      sellFee = pool1.fee_rate;
    }

    // Calculate profit
    const cost = buyPrice.mul(new Decimal(1 + buyFee));
    const revenue = sellPrice.mul(new Decimal(1 - sellFee));
    const profitPct = revenue.minus(cost).div(cost);

    console.log(`\n[gRPC] Price Update:`);
    console.log(`  ${pool1.name}: $${price1.toFixed(6)}`);
    console.log(`  ${pool2.name}: $${price2.toFixed(6)}`);
    console.log(`  Spread: ${spreadPct.mul(100).toFixed(4)}%`);
    console.log(`  Net Profit: ${profitPct.mul(100).toFixed(4)}%`);

    // Check if profitable
    if (profitPct.gte(MIN_PROFIT_THRESHOLD_DECIMAL)) {
      console.log(`\n[✓] PROFITABLE OPPORTUNITY DETECTED!`);
      console.log(`  Direction: ${direction}`);
      console.log(`  Profit: ${profitPct.mul(100).toFixed(4)}%`);

      // Write signal
      const signal = {
        base: "USDC",
        direction: direction,
        profit_pct: profitPct.mul(100).toNumber(),
        trade_usdc: parseFloat(process.env.TRADE_USD || "50"),
        timestamp: Date.now(),
      };

      fs.writeFileSync('signal.json', JSON.stringify(signal, null, 2));
      console.log(`[✓] Signal written to signal.json`);
    } else {
      console.log(`  [×] Not profitable (threshold: ${MIN_PROFIT_THRESHOLD_DECIMAL.mul(100).toFixed(4)}%)`);
    }
  }

  /**
   * Subscribe to pool updates via gRPC
   * Note: Helius gRPC implementation details may vary
   * This is a simplified version that falls back to HTTP polling
   */
  async subscribeToUpdates(): Promise<void> {
    console.log('\n' + '='.repeat(70));
    console.log('HELIUS GRPC SCANNER (Real-time Mode)');
    console.log('='.repeat(70));
    console.log(`Endpoint: ${HELIUS_GRPC_ENDPOINT}`);
    console.log(`API Key: ${HELIUS_API_KEY.substring(0, 8)}...`);
    console.log(`Monitoring ${POOLS.length} pools`);
    console.log('='.repeat(70));

    this.isRunning = true;

    // Initial fetch
    await this.fetchPoolPrices();
    this.checkArbitrage();

    // For now, use enhanced HTTP polling as fallback
    // Real gRPC implementation would use Helius-specific proto files
    console.log('\n[gRPC] Using enhanced HTTP polling mode');
    console.log('[gRPC] Checking every 2 seconds for updates...');
    console.log('[gRPC] Press Ctrl+C to stop\n');

    // Use proper interval management with cleanup
    this.pollingInterval = setInterval(async () => {
      if (!this.isRunning) {
        return;
      }
      try {
        await this.fetchPoolPrices();
        this.checkArbitrage();
      } catch (error: any) {
        console.error('[gRPC] Error:', error.message);
      }
    }, 2000); // Check every 2 seconds
  }

  /**
   * Stop the scanner and cleanup resources
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    console.log('[gRPC] Scanner stopped and resources cleaned up');
  }

  /**
   * Start the scanner
   */
  async start(): Promise<void> {
    if (!HELIUS_API_KEY) {
      throw new Error('HELIUS_API_KEY not set in .env');
    }
    if (!RPC_URL) {
      throw new Error('RPC_URL not set in .env');
    }

    await this.subscribeToUpdates();
  }
}

/* =========================
   MAIN
========================= */

async function main() {
  try {
    scannerInstance = new HeliusGrpcScanner();
    await scannerInstance.start();

    // Keep running
    await new Promise(() => {});
  } catch (error: any) {
    console.error('Fatal error:', error.message);
    if (scannerInstance) {
      scannerInstance.stop();
    }
    process.exit(1);
  }
}

// Handle graceful shutdown
let scannerInstance: HeliusGrpcScanner | null = null;

process.on('SIGINT', () => {
  console.log('\n\n[gRPC] Shutting down...');
  if (scannerInstance) {
    scannerInstance.stop();
  }
  process.exit(0);
});

if (require.main === module) {
  main();
}

export { HeliusGrpcScanner };
