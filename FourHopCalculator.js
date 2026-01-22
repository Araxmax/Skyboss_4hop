"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimplePriceOracle = exports.FourHopCalculator = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const FourHopConstants_1 = require("./FourHopConstants");
/* =========================
   FOUR HOP CALCULATOR CLASS
========================= */
class FourHopCalculator {
    constructor() {
        this.liquidityCache = new Map();
    }
    /**
     * Update liquidity data for a pool (called by data fetcher)
     */
    updatePoolLiquidity(data) {
        this.liquidityCache.set(data.poolId, data);
    }
    /**
     * Get cached liquidity data
     */
    getPoolLiquidity(poolId) {
        const data = this.liquidityCache.get(poolId);
        if (!data) {
            return null;
        }
        // Check if data is stale (older than MAX_QUOTE_AGE_MS)
        const age = Date.now() - data.lastUpdate;
        if (age > FourHopConstants_1.BONK_RISK_PARAMS.MAX_QUOTE_AGE_MS) {
            return null; // Stale data, reject
        }
        return data;
    }
    /**
     * Simulate a single swap using constant product formula (x * y = k)
     * Accounts for fees and calculates price impact
     */
    simulateSwap(pool, amountIn, liquidity, isAtoB // true if swapping tokenA -> tokenB
    ) {
        const startTime = Date.now();
        try {
            // Get reserves
            const reserveIn = isAtoB ? liquidity.tokenAReserve : liquidity.tokenBReserve;
            const reserveOut = isAtoB ? liquidity.tokenBReserve : liquidity.tokenAReserve;
            // Validate reserves
            if (reserveIn.lte(0) || reserveOut.lte(0)) {
                return {
                    poolId: pool.id,
                    poolName: pool.name,
                    dex: pool.dex,
                    amountIn,
                    amountOut: FourHopConstants_1.DECIMAL_ZERO,
                    priceImpact: FourHopConstants_1.DECIMAL_ZERO,
                    effectiveFeeRate: new decimal_js_1.default(pool.feeRate),
                    tokenInSymbol: isAtoB ? pool.tokenASymbol : pool.tokenBSymbol,
                    tokenOutSymbol: isAtoB ? pool.tokenBSymbol : pool.tokenASymbol,
                    liquidityUSD: liquidity.liquidityUSD,
                    isValid: false,
                    failureReason: "Zero reserves in pool",
                };
            }
            // Apply fee to input amount
            const feeRate = new decimal_js_1.default(pool.feeRate);
            const amountInAfterFee = amountIn.mul(FourHopConstants_1.DECIMAL_ONE.minus(feeRate));
            // Constant product formula: amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee)
            const amountOut = reserveOut
                .mul(amountInAfterFee)
                .div(reserveIn.add(amountInAfterFee));
            // Calculate price impact
            // Price impact = (amountIn / reserveIn) * 100
            const priceImpact = amountIn.div(reserveIn);
            // Validate against risk parameters
            let isValid = true;
            let failureReason;
            // Check liquidity minimums
            if (liquidity.liquidityUSD.lt(FourHopConstants_1.BONK_RISK_PARAMS.MIN_POOL_LIQUIDITY_USD)) {
                isValid = false;
                failureReason = `Liquidity too low: $${liquidity.liquidityUSD.toFixed(0)} < $${FourHopConstants_1.BONK_RISK_PARAMS.MIN_POOL_LIQUIDITY_USD}`;
            }
            // Check price impact
            if (priceImpact.gt(FourHopConstants_1.BONK_RISK_PARAMS.MAX_PRICE_IMPACT_PER_HOP)) {
                isValid = false;
                failureReason = `Price impact too high: ${priceImpact
                    .mul(100)
                    .toFixed(2)}% > ${FourHopConstants_1.BONK_RISK_PARAMS.MAX_PRICE_IMPACT_PER_HOP * 100}%`;
            }
            // Check if output is reasonable
            if (amountOut.lte(0)) {
                isValid = false;
                failureReason = "Output amount is zero or negative";
            }
            return {
                poolId: pool.id,
                poolName: pool.name,
                dex: pool.dex,
                amountIn,
                amountOut,
                priceImpact,
                effectiveFeeRate: feeRate,
                tokenInSymbol: isAtoB ? pool.tokenASymbol : pool.tokenBSymbol,
                tokenOutSymbol: isAtoB ? pool.tokenBSymbol : pool.tokenASymbol,
                liquidityUSD: liquidity.liquidityUSD,
                isValid,
                failureReason,
            };
        }
        catch (error) {
            return {
                poolId: pool.id,
                poolName: pool.name,
                dex: pool.dex,
                amountIn,
                amountOut: FourHopConstants_1.DECIMAL_ZERO,
                priceImpact: FourHopConstants_1.DECIMAL_ZERO,
                effectiveFeeRate: new decimal_js_1.default(pool.feeRate),
                tokenInSymbol: isAtoB ? pool.tokenASymbol : pool.tokenBSymbol,
                tokenOutSymbol: isAtoB ? pool.tokenBSymbol : pool.tokenASymbol,
                liquidityUSD: liquidity.liquidityUSD,
                isValid: false,
                failureReason: `Simulation error: ${error.message}`,
            };
        }
    }
    /**
     * Simulate complete 4-hop arbitrage path
     * Path: USDC -> SOL -> BONK -> USDC
     */
    simulateFourHopPath(path, initialUSDC) {
        const startTime = Date.now();
        // Get liquidity data for all pools
        const hop1Liquidity = this.getPoolLiquidity(path.pools.hop1.id);
        const hop2Liquidity = this.getPoolLiquidity(path.pools.hop2.id);
        const hop3Liquidity = this.getPoolLiquidity(path.pools.hop3.id);
        // Validate liquidity data availability
        if (!hop1Liquidity || !hop2Liquidity || !hop3Liquidity) {
            return {
                pathId: path.pathId,
                pathDescription: path.description,
                initialUSDC,
                finalUSDC: FourHopConstants_1.DECIMAL_ZERO,
                hop1: this.createInvalidSwap(path.pools.hop1, initialUSDC, "USDC", "SOL"),
                hop2: this.createInvalidSwap(path.pools.hop2, FourHopConstants_1.DECIMAL_ZERO, "SOL", "BONK"),
                hop3: this.createInvalidSwap(path.pools.hop3, FourHopConstants_1.DECIMAL_ZERO, "BONK", "USDC"),
                grossProfitUSDC: FourHopConstants_1.DECIMAL_ZERO,
                grossProfitPct: FourHopConstants_1.DECIMAL_ZERO,
                totalFeesPct: new decimal_js_1.default(path.totalFeeRate),
                netProfitUSDC: FourHopConstants_1.DECIMAL_ZERO,
                netProfitPct: FourHopConstants_1.DECIMAL_ZERO,
                totalPriceImpact: FourHopConstants_1.DECIMAL_ZERO,
                totalLiquidityUSD: FourHopConstants_1.DECIMAL_ZERO,
                minHopLiquidityUSD: FourHopConstants_1.DECIMAL_ZERO,
                isExecutable: false,
                failureReason: "Missing liquidity data for one or more pools",
                simulationTimeMs: Date.now() - startTime,
            };
        }
        // Simulate Hop 1: USDC -> SOL
        const hop1 = this.simulateSwap(path.pools.hop1, initialUSDC, hop1Liquidity, true // USDC (tokenA) -> SOL (tokenB)
        );
        if (!hop1.isValid) {
            return this.createFailedSimulation(path, initialUSDC, hop1, null, null, `Hop 1 failed: ${hop1.failureReason}`, startTime);
        }
        // Simulate Hop 2: SOL -> BONK
        const hop2 = this.simulateSwap(path.pools.hop2, hop1.amountOut, hop2Liquidity, true // SOL (tokenA) -> BONK (tokenB)
        );
        if (!hop2.isValid) {
            return this.createFailedSimulation(path, initialUSDC, hop1, hop2, null, `Hop 2 failed: ${hop2.failureReason}`, startTime);
        }
        // Simulate Hop 3: BONK -> USDC
        const hop3 = this.simulateSwap(path.pools.hop3, hop2.amountOut, hop3Liquidity, true // BONK (tokenA) -> USDC (tokenB)
        );
        if (!hop3.isValid) {
            return this.createFailedSimulation(path, initialUSDC, hop1, hop2, hop3, `Hop 3 failed: ${hop3.failureReason}`, startTime);
        }
        // Calculate final amounts and profits
        const finalUSDC = hop3.amountOut;
        const grossProfitUSDC = finalUSDC.minus(initialUSDC);
        const grossProfitPct = grossProfitUSDC.div(initialUSDC);
        // Total fees
        const totalFeesPct = new decimal_js_1.default(path.totalFeeRate);
        // Net profit (already accounts for fees via simulation)
        const netProfitUSDC = grossProfitUSDC;
        const netProfitPct = netProfitUSDC.div(initialUSDC);
        // Risk metrics
        const totalPriceImpact = hop1.priceImpact
            .plus(hop2.priceImpact)
            .plus(hop3.priceImpact);
        const totalLiquidityUSD = hop1Liquidity.liquidityUSD
            .plus(hop2Liquidity.liquidityUSD)
            .plus(hop3Liquidity.liquidityUSD);
        const minHopLiquidityUSD = decimal_js_1.default.min(hop1Liquidity.liquidityUSD, hop2Liquidity.liquidityUSD, hop3Liquidity.liquidityUSD);
        // Execution decision
        let isExecutable = true;
        let failureReason;
        // Check profit threshold
        if (netProfitPct.lt(FourHopConstants_1.FOUR_HOP_PROFIT_THRESHOLDS.MIN_PROFIT_THRESHOLD)) {
            isExecutable = false;
            failureReason = `Net profit ${netProfitPct
                .mul(100)
                .toFixed(4)}% below minimum ${FourHopConstants_1.FOUR_HOP_PROFIT_THRESHOLDS.MIN_PROFIT_THRESHOLD * 100}%`;
        }
        // Check total price impact
        if (totalPriceImpact.gt(FourHopConstants_1.BONK_RISK_PARAMS.MAX_TOTAL_SLIPPAGE)) {
            isExecutable = false;
            failureReason = `Total price impact ${totalPriceImpact
                .mul(100)
                .toFixed(2)}% exceeds maximum ${FourHopConstants_1.BONK_RISK_PARAMS.MAX_TOTAL_SLIPPAGE * 100}%`;
        }
        // Check total liquidity
        if (totalLiquidityUSD.lt(FourHopConstants_1.BONK_RISK_PARAMS.MIN_TOTAL_PATH_LIQUIDITY_USD)) {
            isExecutable = false;
            failureReason = `Total liquidity $${totalLiquidityUSD.toFixed(0)} below minimum $${FourHopConstants_1.BONK_RISK_PARAMS.MIN_TOTAL_PATH_LIQUIDITY_USD}`;
        }
        return {
            pathId: path.pathId,
            pathDescription: path.description,
            initialUSDC,
            finalUSDC,
            hop1,
            hop2,
            hop3,
            grossProfitUSDC,
            grossProfitPct,
            totalFeesPct,
            netProfitUSDC,
            netProfitPct,
            totalPriceImpact,
            totalLiquidityUSD,
            minHopLiquidityUSD,
            isExecutable,
            failureReason,
            simulationTimeMs: Date.now() - startTime,
        };
    }
    /**
     * Helper: Create invalid swap result
     */
    createInvalidSwap(pool, amountIn, tokenIn, tokenOut) {
        return {
            poolId: pool.id,
            poolName: pool.name,
            dex: pool.dex,
            amountIn,
            amountOut: FourHopConstants_1.DECIMAL_ZERO,
            priceImpact: FourHopConstants_1.DECIMAL_ZERO,
            effectiveFeeRate: new decimal_js_1.default(pool.feeRate),
            tokenInSymbol: tokenIn,
            tokenOutSymbol: tokenOut,
            liquidityUSD: FourHopConstants_1.DECIMAL_ZERO,
            isValid: false,
            failureReason: "Pool data unavailable",
        };
    }
    /**
     * Helper: Create failed simulation result
     */
    createFailedSimulation(path, initialUSDC, hop1, hop2, hop3, failureReason, startTime) {
        return {
            pathId: path.pathId,
            pathDescription: path.description,
            initialUSDC,
            finalUSDC: FourHopConstants_1.DECIMAL_ZERO,
            hop1: hop1 ||
                this.createInvalidSwap(path.pools.hop1, initialUSDC, "USDC", "SOL"),
            hop2: hop2 ||
                this.createInvalidSwap(path.pools.hop2, FourHopConstants_1.DECIMAL_ZERO, "SOL", "BONK"),
            hop3: hop3 ||
                this.createInvalidSwap(path.pools.hop3, FourHopConstants_1.DECIMAL_ZERO, "BONK", "USDC"),
            grossProfitUSDC: FourHopConstants_1.DECIMAL_ZERO,
            grossProfitPct: FourHopConstants_1.DECIMAL_ZERO,
            totalFeesPct: new decimal_js_1.default(path.totalFeeRate),
            netProfitUSDC: FourHopConstants_1.DECIMAL_ZERO,
            netProfitPct: FourHopConstants_1.DECIMAL_ZERO,
            totalPriceImpact: FourHopConstants_1.DECIMAL_ZERO,
            totalLiquidityUSD: FourHopConstants_1.DECIMAL_ZERO,
            minHopLiquidityUSD: FourHopConstants_1.DECIMAL_ZERO,
            isExecutable: false,
            failureReason,
            simulationTimeMs: Date.now() - startTime,
        };
    }
    /**
     * Simulate ALL possible 4-hop paths and return sorted by profit
     */
    simulateAllPaths(paths, initialUSDC) {
        const results = [];
        for (const path of paths) {
            const result = this.simulateFourHopPath(path, initialUSDC);
            results.push(result);
        }
        // Sort by net profit percentage (descending)
        results.sort((a, b) => {
            return b.netProfitPct.minus(a.netProfitPct).toNumber();
        });
        return results;
    }
    /**
     * Find best executable path
     */
    findBestPath(paths, initialUSDC) {
        const results = this.simulateAllPaths(paths, initialUSDC);
        // Find first executable path (already sorted by profit)
        const bestPath = results.find((r) => r.isExecutable);
        return bestPath || null;
    }
    /**
     * Get execution statistics for a set of paths
     */
    getPathStatistics(paths, initialUSDC) {
        const results = this.simulateAllPaths(paths, initialUSDC);
        const executableResults = results.filter((r) => r.isExecutable);
        const failureReasons = new Map();
        results.forEach((r) => {
            if (!r.isExecutable && r.failureReason) {
                failureReasons.set(r.failureReason, (failureReasons.get(r.failureReason) || 0) + 1);
            }
        });
        const avgProfit = executableResults.length > 0
            ? executableResults
                .reduce((sum, r) => sum.plus(r.netProfitPct), FourHopConstants_1.DECIMAL_ZERO)
                .div(executableResults.length)
            : FourHopConstants_1.DECIMAL_ZERO;
        return {
            totalPaths: results.length,
            executablePaths: executableResults.length,
            bestProfit: executableResults.length > 0
                ? executableResults[0].netProfitPct
                : FourHopConstants_1.DECIMAL_ZERO,
            avgProfit,
            bestPath: executableResults.length > 0 ? executableResults[0] : null,
            failureReasons,
        };
    }
}
exports.FourHopCalculator = FourHopCalculator;
class SimplePriceOracle {
    constructor() {
        this.prices = new Map();
    }
    /**
     * Update price for a token
     */
    updatePrice(token, priceUSD) {
        this.prices.set(token, {
            token,
            priceUSD,
            lastUpdate: Date.now(),
        });
    }
    /**
     * Get price for a token
     */
    getPrice(token) {
        const price = this.prices.get(token);
        if (!price)
            return null;
        // Check staleness (2 seconds max)
        const age = Date.now() - price.lastUpdate;
        if (age > 2000)
            return null;
        return price.priceUSD;
    }
    /**
     * Calculate liquidity in USD for a pool
     */
    calculatePoolLiquidityUSD(tokenASymbol, tokenBSymbol, tokenAReserve, tokenBReserve) {
        const priceA = this.getPrice(tokenASymbol);
        const priceB = this.getPrice(tokenBSymbol);
        if (!priceA || !priceB)
            return null;
        const liquidityA = tokenAReserve.mul(priceA);
        const liquidityB = tokenBReserve.mul(priceB);
        return liquidityA.plus(liquidityB);
    }
}
exports.SimplePriceOracle = SimplePriceOracle;
