"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FourHopDataFetcher = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const decimal_js_1 = __importDefault(require("decimal.js"));
const FourHopConstants_1 = require("./FourHopConstants");
const FourHopCalculator_1 = require("./FourHopCalculator");
/* =========================
   REAL-TIME DATA FETCHER
   Fetches liquidity + prices from all DEXes
========================= */
class FourHopDataFetcher {
    constructor(connection, calculator, fetchIntervalMs = 5000 // 5 seconds default
    ) {
        this.isRunning = false;
        this.intervalHandle = null;
        this.connection = connection;
        this.calculator = calculator;
        this.priceOracle = new FourHopCalculator_1.SimplePriceOracle();
        this.fetchIntervalMs = fetchIntervalMs;
    }
    /**
     * Start continuous data fetching
     */
    start() {
        if (this.isRunning) {
            console.log("[DataFetcher] Already running");
            return;
        }
        console.log(`[DataFetcher] Starting continuous fetch (interval: ${this.fetchIntervalMs}ms)`);
        this.isRunning = true;
        // Immediate first fetch
        this.fetchAllPoolData().catch((err) => console.error("[DataFetcher] Initial fetch error:", err.message));
        // Set up interval
        this.intervalHandle = setInterval(() => {
            this.fetchAllPoolData().catch((err) => console.error("[DataFetcher] Fetch error:", err.message));
        }, this.fetchIntervalMs);
    }
    /**
     * Stop data fetching
     */
    stop() {
        if (!this.isRunning) {
            return;
        }
        console.log("[DataFetcher] Stopping...");
        this.isRunning = false;
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
    /**
     * Fetch all pool data (called periodically)
     */
    async fetchAllPoolData() {
        const startTime = Date.now();
        const results = [];
        // Fetch prices first (needed for liquidity USD calculations)
        await this.fetchTokenPrices();
        // Fetch liquidity for all pools in parallel
        const fetchPromises = FourHopConstants_1.FOUR_HOP_POOLS.map(async (pool) => {
            try {
                const liquidity = await this.fetchPoolLiquidity(pool);
                if (liquidity) {
                    this.calculator.updatePoolLiquidity(liquidity);
                    results.push({ poolId: pool.id, success: true });
                }
                else {
                    results.push({
                        poolId: pool.id,
                        success: false,
                        error: "Failed to fetch liquidity",
                    });
                }
            }
            catch (error) {
                results.push({
                    poolId: pool.id,
                    success: false,
                    error: error.message,
                });
            }
        });
        await Promise.all(fetchPromises);
        const elapsed = Date.now() - startTime;
        const successCount = results.filter((r) => r.success).length;
        console.log(`[DataFetcher] Fetched ${successCount}/${FourHopConstants_1.FOUR_HOP_POOLS.length} pools in ${elapsed}ms`);
        // Log failures
        const failures = results.filter((r) => !r.success);
        if (failures.length > 0) {
            console.warn(`[DataFetcher] ${failures.length} pools failed:`, failures.map((f) => `${f.poolId}: ${f.error}`).join(", "));
        }
    }
    /**
     * Fetch token prices (from existing pools or external oracle)
     * For demo, we derive prices from pool reserves
     */
    async fetchTokenPrices() {
        try {
            // Fetch SOL/USDC price from a reliable pool (e.g., Orca or Raydium)
            const orcaPool = FourHopConstants_1.FOUR_HOP_POOLS.find((p) => p.id === "pool_1_orca_usdc_sol");
            if (orcaPool && orcaPool.vaultA && orcaPool.vaultB) {
                const solPrice = await this.fetchSOLPrice(orcaPool.vaultA, orcaPool.vaultB);
                if (solPrice) {
                    this.priceOracle.updatePrice("SOL", solPrice);
                    this.priceOracle.updatePrice("USDC", new decimal_js_1.default(1)); // USDC = $1
                }
            }
            // Fetch BONK price from SOL/BONK pool
            const bonkPool = FourHopConstants_1.FOUR_HOP_POOLS.find((p) => p.id === "pool_4_raydium_sol_bonk");
            if (bonkPool && bonkPool.vaultA && bonkPool.vaultB) {
                const bonkPriceInSOL = await this.fetchBONKPriceInSOL(bonkPool.vaultA, bonkPool.vaultB);
                const solPrice = this.priceOracle.getPrice("SOL");
                if (bonkPriceInSOL && solPrice) {
                    const bonkPriceUSD = bonkPriceInSOL.mul(solPrice);
                    this.priceOracle.updatePrice("BONK", bonkPriceUSD);
                }
            }
        }
        catch (error) {
            console.error(`[DataFetcher] Price fetch error: ${error.message}`);
        }
    }
    /**
     * Fetch SOL price in USDC
     */
    async fetchSOLPrice(usdcVault, solVault) {
        try {
            const vaultAPubkey = new web3_js_1.PublicKey(usdcVault);
            const vaultBPubkey = new web3_js_1.PublicKey(solVault);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            const usdcBalance = new decimal_js_1.default(vaultAInfo.amount.toString()).div(10 ** FourHopConstants_1.USDC_DECIMALS);
            const solBalance = new decimal_js_1.default(vaultBInfo.amount.toString()).div(10 ** FourHopConstants_1.SOL_DECIMALS);
            if (solBalance.isZero())
                return null;
            return usdcBalance.div(solBalance);
        }
        catch (error) {
            console.error(`[DataFetcher] SOL price fetch error: ${error.message}`);
            return null;
        }
    }
    /**
     * Fetch BONK price in SOL
     */
    async fetchBONKPriceInSOL(solVault, bonkVault) {
        try {
            if (!solVault || !bonkVault) {
                // TODO: Replace with actual vault addresses
                console.warn("[DataFetcher] BONK vault addresses not configured");
                return new decimal_js_1.default(0.000001); // Placeholder price
            }
            const vaultAPubkey = new web3_js_1.PublicKey(solVault);
            const vaultBPubkey = new web3_js_1.PublicKey(bonkVault);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            const solBalance = new decimal_js_1.default(vaultAInfo.amount.toString()).div(10 ** FourHopConstants_1.SOL_DECIMALS);
            const bonkBalance = new decimal_js_1.default(vaultBInfo.amount.toString()).div(10 ** FourHopConstants_1.BONK_DECIMALS);
            if (bonkBalance.isZero())
                return null;
            return solBalance.div(bonkBalance);
        }
        catch (error) {
            console.error(`[DataFetcher] BONK price fetch error: ${error.message}`);
            return new decimal_js_1.default(0.000001); // Fallback price
        }
    }
    /**
     * Fetch liquidity for a single pool
     */
    async fetchPoolLiquidity(pool) {
        try {
            // Route based on DEX type
            switch (pool.dex) {
                case "orca":
                    return await this.fetchOrcaLiquidity(pool);
                case "raydium_amm":
                    return await this.fetchRaydiumAMMLiquidity(pool);
                case "raydium_clmm":
                    return await this.fetchRaydiumCLMMLiquidity(pool);
                case "meteora":
                    return await this.fetchMeteoraLiquidity(pool);
                case "phoenix":
                    return await this.fetchPhoenixLiquidity(pool);
                default:
                    console.warn(`[DataFetcher] Unknown DEX type: ${pool.dex}`);
                    return null;
            }
        }
        catch (error) {
            console.error(`[DataFetcher] Error fetching ${pool.id}: ${error.message}`);
            return null;
        }
    }
    /**
     * Fetch Orca Whirlpool liquidity
     */
    async fetchOrcaLiquidity(pool) {
        if (!pool.vaultA || !pool.vaultB) {
            return null;
        }
        try {
            const vaultAPubkey = new web3_js_1.PublicKey(pool.vaultA);
            const vaultBPubkey = new web3_js_1.PublicKey(pool.vaultB);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            const tokenADecimals = this.getTokenDecimals(pool.tokenA);
            const tokenBDecimals = this.getTokenDecimals(pool.tokenB);
            const tokenAReserve = new decimal_js_1.default(vaultAInfo.amount.toString()).div(10 ** tokenADecimals);
            const tokenBReserve = new decimal_js_1.default(vaultBInfo.amount.toString()).div(10 ** tokenBDecimals);
            // Calculate liquidity USD
            const liquidityUSD = this.priceOracle.calculatePoolLiquidityUSD(pool.tokenASymbol, pool.tokenBSymbol, tokenAReserve, tokenBReserve);
            if (!liquidityUSD) {
                return null;
            }
            return {
                poolId: pool.id,
                tokenAReserve,
                tokenBReserve,
                liquidityUSD,
                lastUpdate: Date.now(),
            };
        }
        catch (error) {
            console.error(`[DataFetcher] Orca fetch error for ${pool.id}: ${error.message}`);
            return null;
        }
    }
    /**
     * Fetch Raydium AMM liquidity
     */
    async fetchRaydiumAMMLiquidity(pool) {
        if (!pool.vaultA || !pool.vaultB) {
            return null;
        }
        try {
            const vaultAPubkey = new web3_js_1.PublicKey(pool.vaultA);
            const vaultBPubkey = new web3_js_1.PublicKey(pool.vaultB);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            const tokenADecimals = this.getTokenDecimals(pool.tokenA);
            const tokenBDecimals = this.getTokenDecimals(pool.tokenB);
            const tokenAReserve = new decimal_js_1.default(vaultAInfo.amount.toString()).div(10 ** tokenADecimals);
            const tokenBReserve = new decimal_js_1.default(vaultBInfo.amount.toString()).div(10 ** tokenBDecimals);
            const liquidityUSD = this.priceOracle.calculatePoolLiquidityUSD(pool.tokenASymbol, pool.tokenBSymbol, tokenAReserve, tokenBReserve);
            if (!liquidityUSD) {
                return null;
            }
            return {
                poolId: pool.id,
                tokenAReserve,
                tokenBReserve,
                liquidityUSD,
                lastUpdate: Date.now(),
            };
        }
        catch (error) {
            console.error(`[DataFetcher] Raydium AMM fetch error for ${pool.id}: ${error.message}`);
            return null;
        }
    }
    /**
     * Fetch Raydium CLMM liquidity
     * TODO: Implement actual CLMM liquidity fetching using Raydium SDK
     */
    async fetchRaydiumCLMMLiquidity(pool) {
        console.warn(`[DataFetcher] Raydium CLMM fetching not yet implemented for ${pool.id}`);
        // Placeholder: Return mock data
        return {
            poolId: pool.id,
            tokenAReserve: new decimal_js_1.default(1000000), // Mock
            tokenBReserve: new decimal_js_1.default(5000), // Mock
            liquidityUSD: new decimal_js_1.default(100000), // Mock $100k
            lastUpdate: Date.now(),
        };
    }
    /**
     * Fetch Meteora DLMM liquidity
     * TODO: Implement actual Meteora liquidity fetching using Meteora SDK
     */
    async fetchMeteoraLiquidity(pool) {
        console.warn(`[DataFetcher] Meteora DLMM fetching not yet implemented for ${pool.id}`);
        // Placeholder: Return mock data
        return {
            poolId: pool.id,
            tokenAReserve: new decimal_js_1.default(800000), // Mock
            tokenBReserve: new decimal_js_1.default(4000), // Mock
            liquidityUSD: new decimal_js_1.default(80000), // Mock $80k
            lastUpdate: Date.now(),
        };
    }
    /**
     * Fetch Phoenix liquidity
     * TODO: Implement Phoenix liquidity fetching using Phoenix SDK
     */
    async fetchPhoenixLiquidity(pool) {
        console.warn(`[DataFetcher] Phoenix fetching not yet implemented for ${pool.id}`);
        // Placeholder: Return mock data
        return {
            poolId: pool.id,
            tokenAReserve: new decimal_js_1.default(600000), // Mock
            tokenBReserve: new decimal_js_1.default(3000), // Mock
            liquidityUSD: new decimal_js_1.default(60000), // Mock $60k
            lastUpdate: Date.now(),
        };
    }
    /**
     * Get token decimals
     */
    getTokenDecimals(mint) {
        if (mint === FourHopConstants_1.USDC_MINT_PUBKEY.toBase58())
            return FourHopConstants_1.USDC_DECIMALS;
        if (mint === FourHopConstants_1.SOL_MINT_PUBKEY.toBase58())
            return FourHopConstants_1.SOL_DECIMALS;
        if (mint === FourHopConstants_1.BONK_MINT_PUBKEY.toBase58())
            return FourHopConstants_1.BONK_DECIMALS;
        return 6; // Default
    }
    /**
     * Get current price oracle (for external use)
     */
    getPriceOracle() {
        return this.priceOracle;
    }
}
exports.FourHopDataFetcher = FourHopDataFetcher;
