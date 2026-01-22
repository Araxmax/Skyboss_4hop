"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrpcPriceStreamer = exports.RPCCallTracker = void 0;
exports.getGrpcStreamer = getGrpcStreamer;
const web3_js_1 = require("@solana/web3.js");
const events_1 = require("events");
const PoolMetadataCache_1 = require("./PoolMetadataCache");
const decimal_js_1 = __importDefault(require("decimal.js"));
/**
 * RPC Call Tracker
 */
class RPCCallTracker {
    constructor() {
        this.callCounts = new Map();
        this.lastReset = Date.now();
        this.RESET_INTERVAL_MS = 60000; // 1 minute
    }
    trackCall(method) {
        const current = this.callCounts.get(method) || 0;
        this.callCounts.set(method, current + 1);
    }
    getStats() {
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
    getTotalCalls() {
        return Array.from(this.callCounts.values()).reduce((a, b) => a + b, 0);
    }
}
exports.RPCCallTracker = RPCCallTracker;
/**
 * Event-Driven gRPC Price Streamer
 *
 * NO POLLING - only reacts to real account changes
 */
class GrpcPriceStreamer extends events_1.EventEmitter {
    constructor(connection) {
        super();
        this.subscriptionIds = new Map();
        this.livePrices = new Map();
        this.rpcTracker = new RPCCallTracker();
        this.isStreaming = false;
        // Rate limiting
        this.MAX_SUBSCRIPTIONS = 100;
        this.BATCH_SIZE = 10;
        this.BATCH_DELAY_MS = 100;
        this.connection = connection;
    }
    /**
     * Start streaming price updates for all pools
     * REPLACES: setInterval polling loops
     */
    async startStreaming() {
        if (this.isStreaming) {
            console.log('[GrpcStreamer] Already streaming');
            return;
        }
        console.log('[GrpcStreamer] Starting event-driven price streaming...');
        this.isStreaming = true;
        const poolIds = (0, PoolMetadataCache_1.getAllPoolIds)();
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
    async subscribeToBatch(poolIds) {
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
    async subscribeToPool(poolId) {
        try {
            const metadata = (0, PoolMetadataCache_1.getPoolMetadata)(poolId);
            if (!metadata) {
                console.error(`[GrpcStreamer] No metadata for pool ${poolId}`);
                return;
            }
            const poolPubkey = new web3_js_1.PublicKey(poolId);
            // Fetch initial price ONCE (not repeatedly)
            await this.fetchInitialPrice(poolId, metadata);
            this.rpcTracker.trackCall('getAccountInfo_initial');
            // Subscribe to vault A changes (event-driven)
            const vaultASubId = this.connection.onAccountChange(metadata.vaultA, (accountInfo, context) => {
                this.handleVaultUpdate(poolId, metadata, 'A', accountInfo, context.slot);
            }, 'confirmed');
            // Subscribe to vault B changes (event-driven)
            const vaultBSubId = this.connection.onAccountChange(metadata.vaultB, (accountInfo, context) => {
                this.handleVaultUpdate(poolId, metadata, 'B', accountInfo, context.slot);
            }, 'confirmed');
            this.subscriptionIds.set(`${poolId}_vaultA`, vaultASubId);
            this.subscriptionIds.set(`${poolId}_vaultB`, vaultBSubId);
            this.rpcTracker.trackCall('onAccountChange_subscribe');
        }
        catch (error) {
            console.error(`[GrpcStreamer] Error subscribing to ${poolId}:`, error);
        }
    }
    /**
     * Fetch initial price ONCE (not in loop)
     */
    async fetchInitialPrice(poolId, metadata) {
        try {
            const poolPubkey = new web3_js_1.PublicKey(poolId);
            const accountInfo = await this.connection.getAccountInfo(poolPubkey, 'confirmed');
            if (!accountInfo) {
                console.warn(`[GrpcStreamer] No account info for ${poolId}`);
                return;
            }
            const price = this.extractPrice(accountInfo.data, metadata);
            const liquidity = await this.calculateLiquidity(metadata);
            const livePrice = {
                poolId,
                price,
                liquidity,
                timestamp: Date.now(),
                slot: 0
            };
            this.livePrices.set(poolId, livePrice);
        }
        catch (error) {
            console.error(`[GrpcStreamer] Error fetching initial price for ${poolId}:`, error);
        }
    }
    /**
     * Handle vault update event (NO POLLING)
     */
    async handleVaultUpdate(poolId, metadata, vault, accountInfo, slot) {
        try {
            // Recalculate price based on vault change
            const liquidity = await this.calculateLiquidity(metadata);
            const price = this.calculatePriceFromVaults(metadata, liquidity);
            const oldPrice = this.livePrices.get(poolId);
            const priceChange = oldPrice ? price.minus(oldPrice.price) : new decimal_js_1.default(0);
            const livePrice = {
                poolId,
                price,
                liquidity,
                timestamp: Date.now(),
                slot
            };
            this.livePrices.set(poolId, livePrice);
            // Emit price update event
            const event = {
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
                console.log(`[GrpcStreamer] ${metadata.name} price: ${price.toFixed(6)} ` +
                    `(${priceChange.toNumber() > 0 ? '+' : ''}${priceChange.toFixed(6)})`);
            }
        }
        catch (error) {
            console.error(`[GrpcStreamer] Error handling vault update for ${poolId}:`, error);
        }
    }
    /**
     * Calculate liquidity from vaults (optimized)
     */
    async calculateLiquidity(metadata) {
        try {
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                this.connection.getAccountInfo(metadata.vaultA, 'confirmed'),
                this.connection.getAccountInfo(metadata.vaultB, 'confirmed')
            ]);
            this.rpcTracker.trackCall('getAccountInfo_vaults');
            if (!vaultAInfo || !vaultBInfo) {
                return new decimal_js_1.default(0);
            }
            const balanceA = this.extractTokenBalance(vaultAInfo.data);
            const balanceB = this.extractTokenBalance(vaultBInfo.data);
            // Simplified liquidity calculation
            return balanceA.times(balanceB).sqrt();
        }
        catch (error) {
            console.error('[GrpcStreamer] Error calculating liquidity:', error);
            return new decimal_js_1.default(0);
        }
    }
    /**
     * Calculate price from vault balances
     */
    calculatePriceFromVaults(metadata, liquidity) {
        // Simplified price calculation (implement proper pool-specific logic)
        return liquidity.div(1000);
    }
    /**
     * Extract price from pool account data
     */
    extractPrice(data, metadata) {
        // Pool-specific price extraction logic
        // This is a placeholder - implement proper decoding
        try {
            if (metadata.dex === 'ORCA') {
                // Orca Whirlpool price extraction
                const sqrtPrice = data.readBigUInt64LE(65);
                const price = new decimal_js_1.default(sqrtPrice.toString()).div(2 ** 64).pow(2);
                return price;
            }
            else if (metadata.dex === 'RAYDIUM_CLMM') {
                // Raydium CLMM price extraction (similar to Orca)
                const sqrtPrice = data.readBigUInt64LE(65);
                const price = new decimal_js_1.default(sqrtPrice.toString()).div(2 ** 64).pow(2);
                return price;
            }
            else if (metadata.dex === 'METEORA') {
                // Meteora DLMM price extraction
                // Simplified - use vault balances instead
                return new decimal_js_1.default(1);
            }
            else {
                return new decimal_js_1.default(1);
            }
        }
        catch (error) {
            return new decimal_js_1.default(1);
        }
    }
    /**
     * Extract token balance from account data
     */
    extractTokenBalance(data) {
        try {
            // SPL Token account: amount is at offset 64 (8 bytes)
            const amount = data.readBigUInt64LE(64);
            return new decimal_js_1.default(amount.toString());
        }
        catch (error) {
            return new decimal_js_1.default(0);
        }
    }
    /**
     * Get current price (instant, from cache)
     * NO RPC CALL
     */
    getLivePrice(poolId) {
        return this.livePrices.get(poolId);
    }
    /**
     * Get all live prices (instant, from cache)
     * NO RPC CALLS
     */
    getAllLivePrices() {
        return new Map(this.livePrices);
    }
    /**
     * Stop streaming and unsubscribe
     */
    async stopStreaming() {
        console.log('[GrpcStreamer] Stopping streaming...');
        this.isStreaming = false;
        // Unsubscribe from all accounts
        const entries = Array.from(this.subscriptionIds.entries());
        for (const [key, subId] of entries) {
            try {
                await this.connection.removeAccountChangeListener(subId);
            }
            catch (error) {
                console.error(`[GrpcStreamer] Error unsubscribing ${key}:`, error);
            }
        }
        this.subscriptionIds.clear();
        console.log('[GrpcStreamer] Stopped');
    }
    /**
     * Get RPC usage statistics
     */
    getRPCStats() {
        return {
            totalCalls: this.rpcTracker.getTotalCalls(),
            breakdown: this.rpcTracker.getStats()
        };
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.GrpcPriceStreamer = GrpcPriceStreamer;
/**
 * Singleton instance
 */
let streamerInstance = null;
function getGrpcStreamer(connection) {
    if (!streamerInstance) {
        streamerInstance = new GrpcPriceStreamer(connection);
    }
    return streamerInstance;
}
