import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { Connection, PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';
import fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

/* =========================
   CONFIGURATION
========================= */

const HELIUS_GRPC_ENDPOINT = process.env.HELIUS_GRPC_ENDPOINT || 'laserstream-mainnet-ewr.helius-rpc.com:443';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_URL = process.env.RPC_URL || '';

// Pool addresses
const POOLS = [
  {
    name: "SOL/USDC 0.05% [VERIFIED]",
    address: "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm",
    fee_rate: 0.0005,
  },
  {
    name: "SOL/USDC 0.01% [VERIFIED]",
    address: "83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d",
    fee_rate: 0.0001,
  },
];

const MIN_PROFIT_THRESHOLD = new Decimal("0.00001"); // 0.001%

/* =========================
   HELIUS GRPC CLIENT
========================= */

class HeliusGrpcScanner {
  private connection: Connection;
  private poolPrices: Map<string, Decimal>;

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
   * Convert sqrt price X64 to regular price
   */
  private sqrtPriceToPrice(sqrtPriceX64: bigint): Decimal {
    const sqrtPrice = new Decimal(sqrtPriceX64.toString()).div(new Decimal(2).pow(64));
    const price = sqrtPrice.pow(2);
    return price.mul(new Decimal(10).pow(9)).div(new Decimal(10).pow(6));
  }

  /**
   * Fetch current pool prices via HTTP RPC
   */
  async fetchPoolPrices(): Promise<void> {
    console.log('\n[gRPC] Fetching initial pool prices...');

    for (const pool of POOLS) {
      try {
        const accountInfo = await this.connection.getAccountInfo(
          new PublicKey(pool.address)
        );

        if (!accountInfo || !accountInfo.data) {
          console.error(`[gRPC] Failed to fetch pool: ${pool.name}`);
          continue;
        }

        const sqrtPriceX64 = this.decodeSqrtPrice(accountInfo.data);
        const price = this.sqrtPriceToPrice(sqrtPriceX64);

        this.poolPrices.set(pool.address, price);
        console.log(`[gRPC] ${pool.name}: $${price.toFixed(6)}`);
      } catch (error: any) {
        console.error(`[gRPC] Error fetching ${pool.name}:`, error.message);
      }
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
    if (profitPct.gte(MIN_PROFIT_THRESHOLD)) {
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
      console.log(`  [×] Not profitable (threshold: ${MIN_PROFIT_THRESHOLD.mul(100).toFixed(4)}%)`);
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

    // Initial fetch
    await this.fetchPoolPrices();
    this.checkArbitrage();

    // For now, use enhanced HTTP polling as fallback
    // Real gRPC implementation would use Helius-specific proto files
    console.log('\n[gRPC] Using enhanced HTTP polling mode');
    console.log('[gRPC] Checking every 2 seconds for updates...');
    console.log('[gRPC] Press Ctrl+C to stop\n');

    setInterval(async () => {
      try {
        await this.fetchPoolPrices();
        this.checkArbitrage();
      } catch (error: any) {
        console.error('[gRPC] Error:', error.message);
      }
    }, 2000); // Check every 2 seconds
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
    const scanner = new HeliusGrpcScanner();
    await scanner.start();

    // Keep running
    await new Promise(() => {});
  } catch (error: any) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n[gRPC] Shutting down...');
  process.exit(0);
});

if (require.main === module) {
  main();
}

export { HeliusGrpcScanner };
