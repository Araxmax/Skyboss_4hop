"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiPathDataFetcher = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const decimal_js_1 = __importDefault(require("decimal.js"));
const MultiPathConstants_1 = require("./MultiPathConstants");
/* =========================
   REAL-TIME PRICE & LIQUIDITY FETCHER
   Fetches from actual Solana pools
========================= */
class MultiPathDataFetcher {
    constructor(connection, calculator, fetchIntervalMs = 5000) {
        this.tokenPrices = new Map();
        this.isRunning = false;
        this.intervalHandle = null;
        this.connection = connection;
        this.calculator = calculator;
        this.fetchIntervalMs = fetchIntervalMs;
    }
    /**
     * Start continuous fetching
     */
    start() {
        if (this.isRunning)
            return;
        console.log(`[DataFetcher] Starting (interval: ${this.fetchIntervalMs}ms)`);
        this.isRunning = true;
        // Immediate first fetch
        this.fetchAllData().catch(err => console.error("[DataFetcher] Initial fetch error:", err.message));
        // Periodic fetch
        this.intervalHandle = setInterval(() => {
            this.fetchAllData().catch(err => console.error("[DataFetcher] Fetch error:", err.message));
        }, this.fetchIntervalMs);
    }
    /**
     * Stop fetching
     */
    stop() {
        if (!this.isRunning)
            return;
        console.log("[DataFetcher] Stopping...");
        this.isRunning = false;
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
    /**
     * Fetch all pool data
     */
    async fetchAllData() {
        const startTime = Date.now();
        // Fetch prices first
        await this.fetchTokenPrices();
        // Fetch all pool liquidity in parallel
        const promises = MultiPathConstants_1.ALL_POOLS.map(pool => this.fetchPoolLiquidity(pool));
        const results = await Promise.allSettled(promises);
        let successCount = 0;
        results.forEach((result, i) => {
            if (result.status === "fulfilled" && result.value) {
                this.calculator.updatePoolLiquidity(result.value);
                successCount++;
            }
            else if (result.status === "rejected") {
                console.warn(`[DataFetcher] Pool ${MultiPathConstants_1.ALL_POOLS[i].id}: ${result.reason.message}`);
            }
        });
        const elapsed = Date.now() - startTime;
        console.log(`[DataFetcher] Fetched ${successCount}/${MultiPathConstants_1.ALL_POOLS.length} pools in ${elapsed}ms`);
    }
    /**
     * Fetch token prices (SOL, BONK in USD)
     */
    async fetchTokenPrices() {
        try {
            // USDC is always $1
            this.tokenPrices.set("USDC", new decimal_js_1.default(1));
            // Fetch SOL price from a reliable USDC/SOL pool
            const solPrice = await this.fetchSOLPrice();
            if (solPrice) {
                this.tokenPrices.set("SOL", solPrice);
            }
            // Fetch BONK price (either direct USDC/BONK or via SOL)
            const bonkPrice = await this.fetchBONKPrice();
            if (bonkPrice) {
                this.tokenPrices.set("BONK", bonkPrice);
            }
        }
        catch (error) {
            console.error(`[DataFetcher] Price fetch error: ${error.message}`);
        }
    }
    /**
     * Fetch SOL price in USD
     */
    async fetchSOLPrice() {
        try {
            // Find the first USDC/SOL pool with vault data
            const pool = MultiPathConstants_1.ALL_POOLS.find(p => ((p.tokenASymbol === "USDC" && p.tokenBSymbol === "SOL") ||
                (p.tokenASymbol === "SOL" && p.tokenBSymbol === "USDC")) &&
                p.vaultA &&
                p.vaultB &&
                p.vaultA !== "" &&
                p.vaultB !== "");
            if (!pool) {
                console.warn("[DataFetcher] No USDC/SOL pool found, using fallback price");
                return new decimal_js_1.default(200); // Fallback price
            }
            const vaultAPubkey = new web3_js_1.PublicKey(pool.vaultA);
            const vaultBPubkey = new web3_js_1.PublicKey(pool.vaultB);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            // Determine which vault is USDC and which is SOL
            const isAtoB = pool.tokenASymbol === "USDC";
            const usdcBalance = new decimal_js_1.default((isAtoB ? vaultAInfo : vaultBInfo).amount.toString()).div(10 ** MultiPathConstants_1.USDC_DECIMALS);
            const solBalance = new decimal_js_1.default((isAtoB ? vaultBInfo : vaultAInfo).amount.toString()).div(10 ** MultiPathConstants_1.SOL_DECIMALS);
            if (solBalance.isZero()) {
                console.warn("[DataFetcher] SOL balance is zero, using fallback");
                return new decimal_js_1.default(200);
            }
            const price = usdcBalance.div(solBalance);
            return price;
        }
        catch (error) {
            console.warn(`[DataFetcher] SOL price fetch failed: ${error.message}`);
            return new decimal_js_1.default(200); // Fallback
        }
    }
    /**
     * Fetch BONK price in USD
     */
    async fetchBONKPrice() {
        try {
            // Try direct USDC/BONK pool first
            const usdcBonkPool = MultiPathConstants_1.ALL_POOLS.find(p => ((p.tokenASymbol === "USDC" && p.tokenBSymbol === "BONK") ||
                (p.tokenASymbol === "BONK" && p.tokenBSymbol === "USDC")) &&
                p.vaultA &&
                p.vaultB &&
                p.vaultA !== "" &&
                p.vaultB !== "");
            if (usdcBonkPool) {
                const vaultAPubkey = new web3_js_1.PublicKey(usdcBonkPool.vaultA);
                const vaultBPubkey = new web3_js_1.PublicKey(usdcBonkPool.vaultB);
                const [vaultAInfo, vaultBInfo] = await Promise.all([
                    (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                    (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
                ]);
                const isAtoB = usdcBonkPool.tokenASymbol === "USDC";
                const usdcBalance = new decimal_js_1.default((isAtoB ? vaultAInfo : vaultBInfo).amount.toString()).div(10 ** MultiPathConstants_1.USDC_DECIMALS);
                const bonkBalance = new decimal_js_1.default((isAtoB ? vaultBInfo : vaultAInfo).amount.toString()).div(10 ** MultiPathConstants_1.BONK_DECIMALS);
                if (!bonkBalance.isZero()) {
                    const price = usdcBalance.div(bonkBalance);
                    return price;
                }
            }
            // Fallback: Use SOL/BONK pool to derive price
            const solPrice = this.tokenPrices.get("SOL");
            if (!solPrice) {
                console.warn("[DataFetcher] SOL price not available, using BONK fallback");
                return new decimal_js_1.default(0.00002);
            }
            const solBonkPool = MultiPathConstants_1.ALL_POOLS.find(p => ((p.tokenASymbol === "SOL" && p.tokenBSymbol === "BONK") ||
                (p.tokenASymbol === "BONK" && p.tokenBSymbol === "SOL")) &&
                p.vaultA &&
                p.vaultB &&
                p.vaultA !== "" &&
                p.vaultB !== "");
            if (!solBonkPool) {
                console.warn("[DataFetcher] No SOL/BONK pool found, using BONK fallback");
                return new decimal_js_1.default(0.00002);
            }
            const vaultAPubkey = new web3_js_1.PublicKey(solBonkPool.vaultA);
            const vaultBPubkey = new web3_js_1.PublicKey(solBonkPool.vaultB);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            const isAtoB = solBonkPool.tokenASymbol === "SOL";
            const solBalance = new decimal_js_1.default((isAtoB ? vaultAInfo : vaultBInfo).amount.toString()).div(10 ** MultiPathConstants_1.SOL_DECIMALS);
            const bonkBalance = new decimal_js_1.default((isAtoB ? vaultBInfo : vaultAInfo).amount.toString()).div(10 ** MultiPathConstants_1.BONK_DECIMALS);
            if (!bonkBalance.isZero() && !solBalance.isZero()) {
                const bonkPerSol = solBalance.div(bonkBalance);
                const bonkPriceUSD = solPrice.div(bonkPerSol);
                return bonkPriceUSD;
            }
            return new decimal_js_1.default(0.00002); // Fallback
        }
        catch (error) {
            console.warn(`[DataFetcher] BONK price fetch failed: ${error.message}`);
            return new decimal_js_1.default(0.00002); // Fallback
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
                    // Check if this is a Whirlpool (has no vault addresses) or standard AMM pool
                    if (!pool.vaultA || !pool.vaultB || pool.vaultA === "" || pool.vaultB === "") {
                        return await this.fetchOrcaWhirlpoolLiquidity(pool);
                    }
                    else {
                        return await this.fetchAMMPoolLiquidity(pool);
                    }
                case "raydium_amm":
                    return await this.fetchAMMPoolLiquidity(pool);
                case "raydium_clmm":
                    return await this.fetchCLMMPoolLiquidity(pool);
                case "meteora":
                    return await this.fetchMeteoraLiquidity(pool);
                case "phoenix":
                    return await this.fetchPhoenixLiquidity(pool);
                default:
                    return null;
            }
        }
        catch (error) {
            // Silently fail for individual pools
            return null;
        }
    }
    /**
     * Fetch AMM pool liquidity (Orca, Raydium AMM)
     */
    async fetchAMMPoolLiquidity(pool) {
        if (!pool.vaultA || !pool.vaultB || pool.vaultA === "" || pool.vaultB === "") {
            console.warn(`[DataFetcher] AMM pool ${pool.id} skipped (missing vault addresses)`);
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
        const tokenAReserve = new decimal_js_1.default(vaultAInfo.amount.toString()).div(10 ** tokenADecimals);
        const tokenBReserve = new decimal_js_1.default(vaultBInfo.amount.toString()).div(10 ** tokenBDecimals);
        // Calculate prices
        const priceAtoB = tokenAReserve.isZero()
            ? new decimal_js_1.default(0)
            : tokenBReserve.div(tokenAReserve);
        const priceBtoA = tokenBReserve.isZero()
            ? new decimal_js_1.default(0)
            : tokenAReserve.div(tokenBReserve);
        // Calculate liquidity USD
        const priceA = this.tokenPrices.get(pool.tokenASymbol) || new decimal_js_1.default(0);
        const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new decimal_js_1.default(0);
        const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));
        return {
            poolId: pool.id,
            tokenAReserve,
            tokenBReserve,
            liquidityUSD,
            priceAtoB,
            priceBtoA,
            lastUpdate: Date.now(),
        };
    }
    /**
     * Fetch CLMM pool liquidity (Raydium CLMM)
     */
    async fetchCLMMPoolLiquidity(pool) {
        try {
            // Use pre-configured vault addresses if available (faster!)
            if (pool.vaultA && pool.vaultB && pool.vaultA !== "" && pool.vaultB !== "") {
                const tokenVault0 = new web3_js_1.PublicKey(pool.vaultA);
                const tokenVault1 = new web3_js_1.PublicKey(pool.vaultB);
                // Get vault balances directly
                const [vault0, vault1] = await Promise.all([
                    (0, spl_token_1.getAccount)(this.connection, tokenVault0),
                    (0, spl_token_1.getAccount)(this.connection, tokenVault1),
                ]);
                // Get token decimals
                const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
                const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);
                // Convert to human-readable amounts
                const tokenAReserve = new decimal_js_1.default(vault0.amount.toString()).div(10 ** tokenADecimals);
                const tokenBReserve = new decimal_js_1.default(vault1.amount.toString()).div(10 ** tokenBDecimals);
                // Skip if reserves are zero
                if (tokenAReserve.isZero() || tokenBReserve.isZero()) {
                    console.warn(`[DataFetcher] Raydium CLMM pool ${pool.id}: Zero reserves`);
                    return null;
                }
                // Calculate prices
                const priceAtoB = tokenBReserve.div(tokenAReserve);
                const priceBtoA = tokenAReserve.div(tokenBReserve);
                // Calculate liquidity USD
                const priceA = this.tokenPrices.get(pool.tokenASymbol) || new decimal_js_1.default(0);
                const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new decimal_js_1.default(0);
                const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));
                return {
                    poolId: pool.id,
                    tokenAReserve,
                    tokenBReserve,
                    liquidityUSD,
                    priceAtoB,
                    priceBtoA,
                    lastUpdate: Date.now(),
                };
            }
            // Fallback: Parse pool account if vaults not provided
            const poolPubkey = new web3_js_1.PublicKey(pool.address);
            const poolAccountInfo = await this.connection.getAccountInfo(poolPubkey);
            if (!poolAccountInfo) {
                console.warn(`[DataFetcher] Raydium CLMM pool ${pool.id}: Pool account not found`);
                return null;
            }
            const tokenVault0 = new web3_js_1.PublicKey(poolAccountInfo.data.slice(73, 105));
            const tokenVault1 = new web3_js_1.PublicKey(poolAccountInfo.data.slice(105, 137));
            const [vault0, vault1] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, tokenVault0),
                (0, spl_token_1.getAccount)(this.connection, tokenVault1),
            ]);
            // Get token decimals
            const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
            const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);
            // Convert to human-readable amounts
            const tokenAReserve = new decimal_js_1.default(vault0.amount.toString()).div(10 ** tokenADecimals);
            const tokenBReserve = new decimal_js_1.default(vault1.amount.toString()).div(10 ** tokenBDecimals);
            // Skip if reserves are zero
            if (tokenAReserve.isZero() || tokenBReserve.isZero()) {
                console.warn(`[DataFetcher] Raydium CLMM pool ${pool.id}: Zero reserves`);
                return null;
            }
            // Calculate prices
            const priceAtoB = tokenBReserve.div(tokenAReserve);
            const priceBtoA = tokenAReserve.div(tokenBReserve);
            // Calculate liquidity USD
            const priceA = this.tokenPrices.get(pool.tokenASymbol) || new decimal_js_1.default(0);
            const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new decimal_js_1.default(0);
            const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));
            return {
                poolId: pool.id,
                tokenAReserve,
                tokenBReserve,
                liquidityUSD,
                priceAtoB,
                priceBtoA,
                lastUpdate: Date.now(),
            };
        }
        catch (error) {
            console.warn(`[DataFetcher] Raydium CLMM pool ${pool.id} fetch error: ${error.message}`);
            return null;
        }
    }
    /**
     * Fetch Meteora DLMM liquidity
     */
    async fetchMeteoraLiquidity(pool) {
        try {
            // Use pre-configured vault addresses if available (faster!)
            if (pool.vaultA && pool.vaultB && pool.vaultA !== "" && pool.vaultB !== "") {
                const tokenVaultA = new web3_js_1.PublicKey(pool.vaultA);
                const tokenVaultB = new web3_js_1.PublicKey(pool.vaultB);
                // Get vault balances directly
                const [vaultA, vaultB] = await Promise.all([
                    (0, spl_token_1.getAccount)(this.connection, tokenVaultA),
                    (0, spl_token_1.getAccount)(this.connection, tokenVaultB),
                ]);
                // Get token decimals
                const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
                const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);
                // Convert to human-readable amounts
                const tokenAReserve = new decimal_js_1.default(vaultA.amount.toString()).div(10 ** tokenADecimals);
                const tokenBReserve = new decimal_js_1.default(vaultB.amount.toString()).div(10 ** tokenBDecimals);
                // Skip if reserves are zero
                if (tokenAReserve.isZero() || tokenBReserve.isZero()) {
                    console.warn(`[DataFetcher] Meteora pool ${pool.id}: Zero reserves`);
                    return null;
                }
                // Calculate prices
                const priceAtoB = tokenBReserve.div(tokenAReserve);
                const priceBtoA = tokenAReserve.div(tokenBReserve);
                // Calculate liquidity USD
                const priceA = this.tokenPrices.get(pool.tokenASymbol) || new decimal_js_1.default(0);
                const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new decimal_js_1.default(0);
                const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));
                return {
                    poolId: pool.id,
                    tokenAReserve,
                    tokenBReserve,
                    liquidityUSD,
                    priceAtoB,
                    priceBtoA,
                    lastUpdate: Date.now(),
                };
            }
            // Fallback: Parse pool account
            const poolPubkey = new web3_js_1.PublicKey(pool.address);
            const poolAccountInfo = await this.connection.getAccountInfo(poolPubkey);
            if (!poolAccountInfo) {
                console.warn(`[DataFetcher] Meteora pool ${pool.id}: Pool account not found`);
                return null;
            }
            // Meteora DLMM pool layout: Read reserves as BigInt
            const reserveXBuf = poolAccountInfo.data.slice(73, 89);
            const reserveYBuf = poolAccountInfo.data.slice(105, 121);
            const reserveX = BigInt("0x" + Buffer.from(reserveXBuf).reverse().toString("hex"));
            const reserveY = BigInt("0x" + Buffer.from(reserveYBuf).reverse().toString("hex"));
            const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
            const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);
            const tokenAReserve = new decimal_js_1.default(reserveX.toString()).div(10 ** tokenADecimals);
            const tokenBReserve = new decimal_js_1.default(reserveY.toString()).div(10 ** tokenBDecimals);
            // Skip if reserves are zero
            if (tokenAReserve.isZero() || tokenBReserve.isZero()) {
                console.warn(`[DataFetcher] Meteora pool ${pool.id}: Zero reserves`);
                return null;
            }
            // Calculate prices
            const priceAtoB = tokenBReserve.div(tokenAReserve);
            const priceBtoA = tokenAReserve.div(tokenBReserve);
            // Calculate liquidity USD
            const priceA = this.tokenPrices.get(pool.tokenASymbol) || new decimal_js_1.default(0);
            const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new decimal_js_1.default(0);
            const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));
            return {
                poolId: pool.id,
                tokenAReserve,
                tokenBReserve,
                liquidityUSD,
                priceAtoB,
                priceBtoA,
                lastUpdate: Date.now(),
            };
        }
        catch (error) {
            console.warn(`[DataFetcher] Meteora pool ${pool.id} fetch error: ${error.message}`);
            return null;
        }
    }
    /**
     * Fetch Orca Whirlpool liquidity
     */
    async fetchOrcaWhirlpoolLiquidity(pool) {
        try {
            // Use pre-configured vault addresses if available (faster!)
            let tokenVaultA;
            let tokenVaultB;
            if (pool.vaultA && pool.vaultB && pool.vaultA !== "" && pool.vaultB !== "") {
                tokenVaultA = new web3_js_1.PublicKey(pool.vaultA);
                tokenVaultB = new web3_js_1.PublicKey(pool.vaultB);
            }
            else {
                // Fallback: Parse pool account
                const poolPubkey = new web3_js_1.PublicKey(pool.address);
                const poolAccountInfo = await this.connection.getAccountInfo(poolPubkey);
                if (!poolAccountInfo) {
                    console.warn(`[DataFetcher] Orca Whirlpool ${pool.id}: Pool account not found`);
                    return null;
                }
                // Orca Whirlpool layout: Offset 101-133: tokenVaultA, Offset 133-165: tokenVaultB
                tokenVaultA = new web3_js_1.PublicKey(poolAccountInfo.data.slice(101, 133));
                tokenVaultB = new web3_js_1.PublicKey(poolAccountInfo.data.slice(133, 165));
            }
            // Get vault balances
            const [vaultA, vaultB] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, tokenVaultA),
                (0, spl_token_1.getAccount)(this.connection, tokenVaultB),
            ]);
            // Get token decimals
            const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
            const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);
            // Convert to human-readable amounts
            const tokenAReserve = new decimal_js_1.default(vaultA.amount.toString()).div(10 ** tokenADecimals);
            const tokenBReserve = new decimal_js_1.default(vaultB.amount.toString()).div(10 ** tokenBDecimals);
            // Calculate prices
            const priceAtoB = tokenAReserve.isZero() ? new decimal_js_1.default(0) : tokenBReserve.div(tokenAReserve);
            const priceBtoA = tokenBReserve.isZero() ? new decimal_js_1.default(0) : tokenAReserve.div(tokenBReserve);
            // Calculate liquidity USD
            const priceA = this.tokenPrices.get(pool.tokenASymbol) || new decimal_js_1.default(0);
            const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new decimal_js_1.default(0);
            const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));
            return {
                poolId: pool.id,
                tokenAReserve,
                tokenBReserve,
                liquidityUSD,
                priceAtoB,
                priceBtoA,
                lastUpdate: Date.now(),
            };
        }
        catch (error) {
            console.warn(`[DataFetcher] Orca Whirlpool ${pool.id} fetch error: ${error.message}`);
            return null;
        }
    }
    /**
     * Fetch Phoenix liquidity
     * TODO: Implement with Phoenix SDK
     */
    async fetchPhoenixLiquidity(pool) {
        // For now, return null to skip Phoenix pools until SDK is implemented
        console.warn(`[DataFetcher] Phoenix pool ${pool.id} skipped (SDK not implemented)`);
        return null;
    }
    /**
     * Get token decimals
     */
    getTokenDecimals(symbol) {
        switch (symbol) {
            case "USDC": return MultiPathConstants_1.USDC_DECIMALS;
            case "SOL": return MultiPathConstants_1.SOL_DECIMALS;
            case "BONK": return MultiPathConstants_1.BONK_DECIMALS;
            default: return 6;
        }
    }
    /**
     * Get current token prices
     */
    getTokenPrices() {
        return new Map(this.tokenPrices);
    }
}
exports.MultiPathDataFetcher = MultiPathDataFetcher;
