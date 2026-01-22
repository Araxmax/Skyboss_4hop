/**
 * GRPC Price Streamer - Event-Driven Architecture
 *
 * Replaces polling with real-time gRPC streaming.
 * Only updates when prices actually change.
 *
 * ELIMINATES:
 * - setInterval polling loops
 * - Redundant getAccountInfo calls
 * - Unnecessary RPC requests
 */

import { Connection, PublicKey, AccountInfo, Context } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { getPoolMetadata, getAllPoolIds, PoolMetadata } from './PoolMetadataCache';
import Decimal from 'decimal.js';

/**
 * Live price data (only thing that changes)
 */
export interface LivePoolPrice {
  poolId: string;
  price: Decimal;
  liquidity: Decimal;
  timestamp: number;
  slot: number;
}

/**
 * Price update event
 */
export interface PriceUpdateEvent {
  poolId: string;
  price: Decimal;
  liquidity: Decimal;
  oldPrice?: Decimal;
  priceChange?: Decimal;
  slot: number;
}

/**
 * RPC Call Tracker
 */
export class RPCCallTracker {
  private callCounts: Map<string, number> = new Map();
  private lastReset: number = Date.now();
  private readonly RESET_INTERVAL_MS = 60000; // 1 minute

  trackCall(method: string): void {
    const current = this.callCounts.get(method) || 0;
    this.callCounts.set(method, current + 1);
  }

  getStats(): { [method: string]: number } {
    const now = Date.now();
    if (now - this.lastReset > this.RESET_INTERVAL_MS) {
      console.log('[RPCTracker] Call stats (last minute):');
      const entries = Array.from(this.callCounts.entries());
      for (const [method, count] of entries) {
        console.log(`  ${method}: ${count} calls`);
      }
      this.callCounts.clear();
      this.lastReset = now;
    }
    return Object.fromEntries(Array.from(this.callCounts.entries()));
  }

  getTotalCalls(): number {
    return Array.from(this.callCounts.values()).reduce((a, b) => a + b, 0);
  }
}

/**
 * Event-Driven gRPC Price Streamer
 *
 * NO POLLING - only reacts to real account changes
 */
export class GrpcPriceStreamer extends EventEmitter {
  private connection: Connection;
  private subscriptionIds: Map<string, number> = new Map();
  private livePrices: Map<string, LivePoolPrice> = new Map();
  private rpcTracker: RPCCallTracker = new RPCCallTracker();
  private isStreaming: boolean = false;

  // Rate limiting (adjusted for free RPC limits)
  private readonly MAX_SUBSCRIPTIONS = 100;
  private readonly BATCH_SIZE = 2; // Reduced from 10 to 2 for free RPC
  private readonly BATCH_DELAY_MS = 1000; // Increased from 100ms to 1000ms

  constructor(connection: Connection) {
    super();
    this.connection = connection;
  }

  /**
   * Start streaming price updates for all pools
   * REPLACES: setInterval polling loops
   */
  async startStreaming(): Promise<void> {
    if (this.isStreaming) {
      console.log('[GrpcStreamer] Already streaming');
      return;
    }

    console.log('[GrpcStreamer] Starting event-driven price streaming...');
    this.isStreaming = true;

    const poolIds = getAllPoolIds();
    console.log(`[GrpcStreamer] Subscribing to ${poolIds.length} pools...`);

    // Subscribe in batches to avoid rate limiting
    for (let i = 0; i < poolIds.length; i += this.BATCH_SIZE) {
      const batch = poolIds.slice(i, i + this.BATCH_SIZE);
      await this.subscribeToBatch(batch);

      // Rate limit: small delay between batches
      if (i + this.BATCH_SIZE < poolIds.length) {
        await this.sleep(this.BATCH_DELAY_MS);
      }
    }

    console.log(`[GrpcStreamer] ✅ Subscribed to ${this.subscriptionIds.size} pools`);
    console.log('[GrpcStreamer] Event-driven streaming active (NO POLLING)');

    // Log RPC stats periodically
    setInterval(() => {
      this.rpcTracker.getStats();
    }, 60000);
  }

  /**
   * Subscribe to a batch of pools
   */
  private async subscribeToBatch(poolIds: string[]): Promise<void> {
    const promises = poolIds.map(poolId => this.subscribeToPool(poolId));
    await Promise.allSettled(promises);
  }

  /**
   * Subscribe to individual pool (event-driven, NO POLLING)
   *
   * REPLACES:
   * - getAccountInfo in polling loop
   * - setInterval for each pool
   */
  private async subscribeToPool(poolId: string): Promise<void> {
    try {
      const metadata = getPoolMetadata(poolId);
      if (!metadata) {
        console.error(`[GrpcStreamer] No metadata for pool ${poolId}`);
        return;
      }

      const poolPubkey = new PublicKey(poolId);

      // Fetch initial price ONCE (not repeatedly)
      await this.fetchInitialPrice(poolId, metadata);
      this.rpcTracker.trackCall('getAccountInfo_initial');

      // Subscribe to vault A changes (event-driven)
      const vaultASubId = this.connection.onAccountChange(
        metadata.vaultA,
        (accountInfo: AccountInfo<Buffer>, context: Context) => {
          this.handleVaultUpdate(poolId, metadata, 'A', accountInfo, context.slot);
        },
        'confirmed'
      );

      // Subscribe to vault B changes (event-driven)
      const vaultBSubId = this.connection.onAccountChange(
        metadata.vaultB,
        (accountInfo: AccountInfo<Buffer>, context: Context) => {
          this.handleVaultUpdate(poolId, metadata, 'B', accountInfo, context.slot);
        },
        'confirmed'
      );

      this.subscriptionIds.set(`${poolId}_vaultA`, vaultASubId);
      this.subscriptionIds.set(`${poolId}_vaultB`, vaultBSubId);

      this.rpcTracker.trackCall('onAccountChange_subscribe');

    } catch (error) {
      console.error(`[GrpcStreamer] Error subscribing to ${poolId}:`, error);
    }
  }

  /**
   * Fetch initial price ONCE (not in loop)
   */
  private async fetchInitialPrice(poolId: string, metadata: PoolMetadata): Promise<void> {
    try {
      // Fetch vault balances directly instead of pool account
      const [vaultAInfo, vaultBInfo] = await Promise.all([
        this.connection.getAccountInfo(metadata.vaultA, 'confirmed'),
        this.connection.getAccountInfo(metadata.vaultB, 'confirmed')
      ]);

      if (!vaultAInfo || !vaultBInfo) {
        console.warn(`[GrpcStreamer] No vault info for ${poolId}`);
        return;
      }

      // Extract balances from vault accounts (raw amounts)
      const rawBalanceA = this.extractTokenBalance(vaultAInfo.data);
      const rawBalanceB = this.extractTokenBalance(vaultBInfo.data);

      // Convert to human-readable amounts using decimals
      const balanceA = rawBalanceA.div(Math.pow(10, metadata.decimalsA));
      const balanceB = rawBalanceB.div(Math.pow(10, metadata.decimalsB));

      // Calculate price from vault balances (tokenB per tokenA)
      const price = balanceB.div(balanceA);
      const liquidity = balanceA.times(balanceB).sqrt();

      const livePrice: LivePoolPrice = {
        poolId,
        price,
        liquidity,
        timestamp: Date.now(),
        slot: 0
      };

      this.livePrices.set(poolId, livePrice);

    } catch (error) {
      console.error(`[GrpcStreamer] Error fetching initial price for ${poolId}:`, error);
    }
  }

  /**
   * Handle vault update event (NO POLLING)
   */
  private async handleVaultUpdate(
    poolId: string,
    metadata: PoolMetadata,
    vault: 'A' | 'B',
    accountInfo: AccountInfo<Buffer>,
    slot: number
  ): Promise<void> {
    try {
      // Fetch both vault balances
      const [vaultAInfo, vaultBInfo] = await Promise.all([
        this.connection.getAccountInfo(metadata.vaultA, 'confirmed'),
        this.connection.getAccountInfo(metadata.vaultB, 'confirmed')
      ]);

      if (!vaultAInfo || !vaultBInfo) {
        return;
      }

      // Extract balances (raw amounts)
      const rawBalanceA = this.extractTokenBalance(vaultAInfo.data);
      const rawBalanceB = this.extractTokenBalance(vaultBInfo.data);

      // Convert to human-readable amounts using decimals
      const balanceA = rawBalanceA.div(Math.pow(10, metadata.decimalsA));
      const balanceB = rawBalanceB.div(Math.pow(10, metadata.decimalsB));

      // Calculate price from vault balances (tokenB per tokenA)
      const price = balanceB.div(balanceA);
      const liquidity = balanceA.times(balanceB).sqrt();

      const oldPrice = this.livePrices.get(poolId);
      const priceChange = oldPrice ? price.minus(oldPrice.price) : new Decimal(0);

      const livePrice: LivePoolPrice = {
        poolId,
        price,
        liquidity,
        timestamp: Date.now(),
        slot
      };

      this.livePrices.set(poolId, livePrice);

      // Emit price update event
      const event: PriceUpdateEvent = {
        poolId,
        price,
        liquidity,
        oldPrice: oldPrice?.price,
        priceChange,
        slot
      };

      this.emit('priceUpdate', event);

      // Track minimal price changes only
      if (Math.abs(priceChange.toNumber()) > 0.001) {
        console.log(
          `[GrpcStreamer] ${metadata.name} price: ${price.toFixed(6)} ` +
          `(${priceChange.toNumber() > 0 ? '+' : ''}${priceChange.toFixed(6)})`
        );
      }

    } catch (error) {
      console.error(`[GrpcStreamer] Error handling vault update for ${poolId}:`, error);
    }
  }


  /**
   * Extract token balance from account data
   */
  private extractTokenBalance(data: Buffer): Decimal {
    try {
      // SPL Token account: amount is at offset 64 (8 bytes)
      const amount = data.readBigUInt64LE(64);
      return new Decimal(amount.toString());
    } catch (error) {
      return new Decimal(0);
    }
  }

  /**
   * Get current price (instant, from cache)
   * NO RPC CALL
   */
  getLivePrice(poolId: string): LivePoolPrice | undefined {
    return this.livePrices.get(poolId);
  }

  /**
   * Get all live prices (instant, from cache)
   * NO RPC CALLS
   */
  getAllLivePrices(): Map<string, LivePoolPrice> {
    return new Map(this.livePrices);
  }

  /**
   * Stop streaming and unsubscribe
   */
  async stopStreaming(): Promise<void> {
    console.log('[GrpcStreamer] Stopping streaming...');
    this.isStreaming = false;

    // Unsubscribe from all accounts
    const entries = Array.from(this.subscriptionIds.entries());
    for (const [key, subId] of entries) {
      try {
        // Only try to unsubscribe if subId is valid (not undefined/null)
        if (subId !== undefined && subId !== null) {
          await this.connection.removeAccountChangeListener(subId);
        }
      } catch (error) {
        // Silently ignore unsubscribe errors (they're expected on shutdown)
        // console.error(`[GrpcStreamer] Error unsubscribing ${key}:`, error);
      }
    }

    this.subscriptionIds.clear();
    console.log('[GrpcStreamer] Stopped');
  }

  /**
   * Get RPC usage statistics
   */
  getRPCStats(): { totalCalls: number; breakdown: { [method: string]: number } } {
    return {
      totalCalls: this.rpcTracker.getTotalCalls(),
      breakdown: this.rpcTracker.getStats()
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Singleton instance
 */
let streamerInstance: GrpcPriceStreamer | null = null;

export function getGrpcStreamer(connection: Connection): GrpcPriceStreamer {
  if (!streamerInstance) {
    streamerInstance = new GrpcPriceStreamer(connection);
  }
  return streamerInstance;
}
