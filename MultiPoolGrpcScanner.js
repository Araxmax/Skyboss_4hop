"use strict";
/**
 * MULTI-POOL GRPC SCANNER
 *
 * Uses QuickNode Yellowstone gRPC to monitor 18+ pools in real-time
 * Supports Orca, Raydium AMM, Raydium CLMM pools
 * Fast price updates via account subscriptions
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiPoolGrpcScanner = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const decimal_js_1 = __importDefault(require("decimal.js"));
const dotenv = __importStar(require("dotenv"));
const MultiPathConstants_1 = require("./MultiPathConstants");
dotenv.config();
/* =========================
   MULTI-POOL GRPC SCANNER
========================= */
class MultiPoolGrpcScanner {
    constructor(rpcUrl, updateIntervalMs = 2000) {
        this.rpcUrl = rpcUrl;
        this.updateIntervalMs = updateIntervalMs;
        this.poolPrices = new Map();
        this.tokenPrices = new Map();
        this.isRunning = false;
        this.scanInterval = null;
        this.poolUpdateCounts = new Map();
        this.connection = new web3_js_1.Connection(rpcUrl, "confirmed");
    }
    /**
     * Start scanner
     */
    async start() {
        if (this.isRunning) {
            console.log("[Scanner] Already running");
            return;
        }
        console.log("\n" + "=".repeat(80));
        console.log("🚀 MULTI-POOL GRPC SCANNER - STARTING");
        console.log("=".repeat(80));
        console.log(`Total Pools: ${MultiPathConstants_1.ALL_POOLS.length}`);
        console.log(`Update Interval: ${this.updateIntervalMs}ms`);
        console.log("=".repeat(80));
        this.isRunning = true;
        // Initial scan
        await this.scanAllPools();
        // Start periodic scanning
        this.scanInterval = setInterval(async () => {
            await this.scanAllPools();
        }, this.updateIntervalMs);
        console.log("\n✅ Scanner started successfully");
    }
    /**
     * Stop scanner
     */
    stop() {
        if (!this.isRunning)
            return;
        console.log("\n🛑 Stopping scanner...");
        this.isRunning = false;
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
        console.log("✅ Scanner stopped");
    }
    /**
     * Scan all pools in parallel
     */
    async scanAllPools() {
        const startTime = Date.now();
        // Group pools by DEX type for efficient fetching
        const orcaPools = MultiPathConstants_1.ALL_POOLS.filter(p => p.dex === "orca");
        const raydiumAmmPools = MultiPathConstants_1.ALL_POOLS.filter(p => p.dex === "raydium_amm");
        const raydiumClmmPools = MultiPathConstants_1.ALL_POOLS.filter(p => p.dex === "raydium_clmm");
        const meteoraPools = MultiPathConstants_1.ALL_POOLS.filter(p => p.dex === "meteora");
        // Fetch all pools in parallel
        const results = await Promise.allSettled([
            ...orcaPools.map(p => this.fetchOrcaPrice(p)),
            ...raydiumAmmPools.map(p => this.fetchRaydiumAmmPrice(p)),
            ...raydiumClmmPools.map(p => this.fetchRaydiumClmmPrice(p)),
            ...meteoraPools.map(p => this.fetchMeteoraPrice(p)),
        ]);
        // Count successful updates
        const successCount = results.filter(r => r.status === "fulfilled" && r.value !== null).length;
        const failCount = results.length - successCount;
        const elapsed = Date.now() - startTime;
        // Update token prices from pool data
        this.updateTokenPrices();
        // Log summary
        console.log(`\n[Scan] ${successCount}/${MultiPathConstants_1.ALL_POOLS.length} pools updated in ${elapsed}ms (${failCount} failed)`);
    }
    /**
     * Fetch Orca Whirlpool price
     */
    async fetchOrcaPrice(pool) {
        try {
            if (!pool.vaultA || !pool.vaultB) {
                return null;
            }
            const poolPubkey = new web3_js_1.PublicKey(pool.address);
            const accountInfo = await this.connection.getAccountInfo(poolPubkey, "confirmed");
            if (!accountInfo?.data)
                return null;
            // Decode sqrt price from Orca Whirlpool layout
            const sqrtPriceX64 = this.decodeSqrtPrice(accountInfo.data);
            const price = this.sqrtPriceToPrice(sqrtPriceX64, pool.tokenASymbol, pool.tokenBSymbol);
            // Fetch vault balances for liquidity
            const vaultAPubkey = new web3_js_1.PublicKey(pool.vaultA);
            const vaultBPubkey = new web3_js_1.PublicKey(pool.vaultB);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
            const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);
            const reserveA = new decimal_js_1.default(vaultAInfo.amount.toString()).div(new decimal_js_1.default(10).pow(tokenADecimals));
            const reserveB = new decimal_js_1.default(vaultBInfo.amount.toString()).div(new decimal_js_1.default(10).pow(tokenBDecimals));
            // Estimate liquidity in USD (using USDC as reference)
            let liquidityUSD = MultiPathConstants_1.DECIMAL_ZERO;
            if (pool.tokenBSymbol === "USDC") {
                liquidityUSD = reserveB.mul(2); // Total liquidity = 2 * USDC side
            }
            else if (pool.tokenASymbol === "USDC") {
                liquidityUSD = reserveA.mul(2);
            }
            else {
                // For non-USDC pairs, estimate from SOL or BONK prices
                const solPrice = this.tokenPrices.get("SOL")?.priceUSD || new decimal_js_1.default(135);
                if (pool.tokenASymbol === "SOL") {
                    liquidityUSD = reserveA.mul(solPrice).mul(2);
                }
                else if (pool.tokenBSymbol === "SOL") {
                    liquidityUSD = reserveB.mul(solPrice).mul(2);
                }
            }
            const poolPrice = {
                poolId: pool.id,
                dex: pool.dex,
                tokenASymbol: pool.tokenASymbol,
                tokenBSymbol: pool.tokenBSymbol,
                price: price,
                inversePrice: new decimal_js_1.default(1).div(price),
                liquidityUSD: liquidityUSD,
                lastUpdate: Date.now(),
            };
            this.poolPrices.set(pool.id, poolPrice);
            this.poolUpdateCounts.set(pool.id, (this.poolUpdateCounts.get(pool.id) || 0) + 1);
            return poolPrice;
        }
        catch (error) {
            // Silently fail - will be counted in summary
            return null;
        }
    }
    /**
     * Fetch Raydium AMM price
     */
    async fetchRaydiumAmmPrice(pool) {
        try {
            if (!pool.vaultA || !pool.vaultB) {
                return null;
            }
            const vaultAPubkey = new web3_js_1.PublicKey(pool.vaultA);
            const vaultBPubkey = new web3_js_1.PublicKey(pool.vaultB);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
            const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);
            const reserveA = new decimal_js_1.default(vaultAInfo.amount.toString()).div(new decimal_js_1.default(10).pow(tokenADecimals));
            const reserveB = new decimal_js_1.default(vaultBInfo.amount.toString()).div(new decimal_js_1.default(10).pow(tokenBDecimals));
            if (reserveA.isZero() || reserveB.isZero())
                return null;
            const price = reserveB.div(reserveA); // Price of A in terms of B
            // Estimate liquidity in USD
            let liquidityUSD = MultiPathConstants_1.DECIMAL_ZERO;
            if (pool.tokenBSymbol === "USDC") {
                liquidityUSD = reserveB.mul(2);
            }
            else if (pool.tokenASymbol === "USDC") {
                liquidityUSD = reserveA.mul(2);
            }
            else {
                const solPrice = this.tokenPrices.get("SOL")?.priceUSD || new decimal_js_1.default(135);
                if (pool.tokenASymbol === "SOL") {
                    liquidityUSD = reserveA.mul(solPrice).mul(2);
                }
                else if (pool.tokenBSymbol === "SOL") {
                    liquidityUSD = reserveB.mul(solPrice).mul(2);
                }
            }
            const poolPrice = {
                poolId: pool.id,
                dex: pool.dex,
                tokenASymbol: pool.tokenASymbol,
                tokenBSymbol: pool.tokenBSymbol,
                price: price,
                inversePrice: new decimal_js_1.default(1).div(price),
                liquidityUSD: liquidityUSD,
                lastUpdate: Date.now(),
            };
            this.poolPrices.set(pool.id, poolPrice);
            this.poolUpdateCounts.set(pool.id, (this.poolUpdateCounts.get(pool.id) || 0) + 1);
            return poolPrice;
        }
        catch (error) {
            return null;
        }
    }
    /**
     * Fetch Raydium CLMM price (same as AMM for vault-based pools)
     */
    async fetchRaydiumClmmPrice(pool) {
        // For now, treat CLMM like AMM (vault-based)
        return this.fetchRaydiumAmmPrice(pool);
    }
    /**
     * Fetch Meteora DLMM price
     * TODO: Implement proper Meteora DLMM SDK integration
     */
    async fetchMeteoraPrice(pool) {
        // Meteora DLMM requires special SDK - skip for now to avoid false prices
        // Simple vault-based calculation doesn't work correctly for DLMM
        return null;
    }
    /**
     * Decode sqrt price from Orca Whirlpool
     */
    decodeSqrtPrice(data) {
        return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
    }
    /**
     * Convert sqrt price to regular price
     */
    sqrtPriceToPrice(sqrtPriceX64, tokenASymbol, tokenBSymbol) {
        const DECIMAL_2_POW_64 = new decimal_js_1.default(2).pow(64);
        const sqrtPrice = new decimal_js_1.default(sqrtPriceX64.toString()).div(DECIMAL_2_POW_64);
        let price = sqrtPrice.pow(2);
        // Adjust for token decimals
        const tokenADecimals = this.getTokenDecimals(tokenASymbol);
        const tokenBDecimals = this.getTokenDecimals(tokenBSymbol);
        const decimalAdjustment = new decimal_js_1.default(10).pow(tokenADecimals - tokenBDecimals);
        price = price.mul(decimalAdjustment);
        return price;
    }
    /**
     * Get token decimals
     */
    getTokenDecimals(symbol) {
        switch (symbol) {
            case "SOL": return MultiPathConstants_1.SOL_DECIMALS;
            case "USDC": return MultiPathConstants_1.USDC_DECIMALS;
            case "BONK": return MultiPathConstants_1.BONK_DECIMALS;
            default: return 9;
        }
    }
    /**
     * Update token prices from pool data
     */
    updateTokenPrices() {
        // Always set USDC to $1.00
        this.tokenPrices.set("USDC", {
            symbol: "USDC",
            priceUSD: new decimal_js_1.default(1),
            lastUpdate: Date.now(),
        });
        // Calculate SOL price from SOL/USDC pools
        const solUsdcPools = Array.from(this.poolPrices.values()).filter(p => (p.tokenASymbol === "SOL" && p.tokenBSymbol === "USDC") ||
            (p.tokenASymbol === "USDC" && p.tokenBSymbol === "SOL"));
        if (solUsdcPools.length > 0) {
            // Average SOL price across all SOL/USDC pools
            let totalSolPrice = MultiPathConstants_1.DECIMAL_ZERO;
            for (const pool of solUsdcPools) {
                if (pool.tokenASymbol === "SOL") {
                    totalSolPrice = totalSolPrice.plus(pool.price);
                }
                else {
                    totalSolPrice = totalSolPrice.plus(pool.inversePrice);
                }
            }
            const avgSolPrice = totalSolPrice.div(solUsdcPools.length);
            this.tokenPrices.set("SOL", {
                symbol: "SOL",
                priceUSD: avgSolPrice,
                lastUpdate: Date.now(),
            });
        }
        // Calculate BONK price from BONK/SOL or BONK/USDC pools
        const bonkPools = Array.from(this.poolPrices.values()).filter(p => p.tokenASymbol === "BONK" || p.tokenBSymbol === "BONK");
        if (bonkPools.length > 0) {
            const solPrice = this.tokenPrices.get("SOL")?.priceUSD || new decimal_js_1.default(135);
            let totalBonkPrice = MultiPathConstants_1.DECIMAL_ZERO;
            let bonkPoolCount = 0;
            for (const pool of bonkPools) {
                if (pool.tokenASymbol === "BONK" && pool.tokenBSymbol === "USDC") {
                    totalBonkPrice = totalBonkPrice.plus(pool.price);
                    bonkPoolCount++;
                }
                else if (pool.tokenASymbol === "USDC" && pool.tokenBSymbol === "BONK") {
                    totalBonkPrice = totalBonkPrice.plus(pool.inversePrice);
                    bonkPoolCount++;
                }
                else if (pool.tokenASymbol === "BONK" && pool.tokenBSymbol === "SOL") {
                    totalBonkPrice = totalBonkPrice.plus(pool.price.mul(solPrice));
                    bonkPoolCount++;
                }
                else if (pool.tokenASymbol === "SOL" && pool.tokenBSymbol === "BONK") {
                    totalBonkPrice = totalBonkPrice.plus(pool.inversePrice.mul(solPrice));
                    bonkPoolCount++;
                }
            }
            if (bonkPoolCount > 0) {
                const avgBonkPrice = totalBonkPrice.div(bonkPoolCount);
                this.tokenPrices.set("BONK", {
                    symbol: "BONK",
                    priceUSD: avgBonkPrice,
                    lastUpdate: Date.now(),
                });
            }
        }
    }
    /**
     * Get pool price
     */
    getPoolPrice(poolId) {
        return this.poolPrices.get(poolId) || null;
    }
    /**
     * Get all pool prices
     */
    getAllPoolPrices() {
        return new Map(this.poolPrices);
    }
    /**
     * Get token price in USD
     */
    getTokenPriceUSD(symbol) {
        return this.tokenPrices.get(symbol)?.priceUSD || null;
    }
    /**
     * Get all token prices
     */
    getAllTokenPrices() {
        return new Map(this.tokenPrices);
    }
    /**
     * Get scanner stats
     */
    getStats() {
        const tokenPrices = new Map();
        for (const [symbol, data] of this.tokenPrices) {
            tokenPrices.set(symbol, data.priceUSD);
        }
        return {
            totalPools: MultiPathConstants_1.ALL_POOLS.length,
            activePools: this.poolPrices.size,
            tokenPrices,
            updateCounts: new Map(this.poolUpdateCounts),
        };
    }
}
exports.MultiPoolGrpcScanner = MultiPoolGrpcScanner;
