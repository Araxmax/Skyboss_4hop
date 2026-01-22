"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiPathCalculator = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const MultiPathConstants_1 = require("./MultiPathConstants");
class MultiPathCalculator {
    constructor() {
        this.liquidityCache = new Map();
    }
    /**
     * Update pool liquidity data
     */
    updatePoolLiquidity(data) {
        this.liquidityCache.set(data.poolId, data);
    }
    /**
     * Get cached liquidity data
     */
    getPoolLiquidity(poolId) {
        const data = this.liquidityCache.get(poolId);
        if (!data)
            return null;
        // Check freshness
        const age = Date.now() - data.lastUpdate;
        if (age > MultiPathConstants_1.RISK_PARAMS.MAX_QUOTE_AGE_MS) {
            return null; // Stale data
        }
        return data;
    }
    /**
     * Simulate a single pool swap
     */
    simulatePoolSwap(pool, amountIn, tokenIn, tokenOut) {
        const liquidity = this.getPoolLiquidity(pool.id);
        if (!liquidity) {
            return {
                poolId: pool.id,
                poolName: pool.name,
                amountIn,
                amountOut: MultiPathConstants_1.DECIMAL_ZERO,
                priceImpact: MultiPathConstants_1.DECIMAL_ZERO,
                feeRate: new decimal_js_1.default(pool.feeRate),
                tokenIn,
                tokenOut,
                liquidityUSD: MultiPathConstants_1.DECIMAL_ZERO,
                isValid: false,
                failureReason: "No liquidity data available",
            };
        }
        // Determine swap direction
        const isAtoB = pool.tokenASymbol === tokenIn && pool.tokenBSymbol === tokenOut;
        const isBtoA = pool.tokenBSymbol === tokenIn && pool.tokenASymbol === tokenOut;
        if (!isAtoB && !isBtoA) {
            return {
                poolId: pool.id,
                poolName: pool.name,
                amountIn,
                amountOut: MultiPathConstants_1.DECIMAL_ZERO,
                priceImpact: MultiPathConstants_1.DECIMAL_ZERO,
                feeRate: new decimal_js_1.default(pool.feeRate),
                tokenIn,
                tokenOut,
                liquidityUSD: liquidity.liquidityUSD,
                isValid: false,
                failureReason: `Token pair mismatch: ${tokenIn} -> ${tokenOut}`,
            };
        }
        // Get reserves
        const reserveIn = isAtoB ? liquidity.tokenAReserve : liquidity.tokenBReserve;
        const reserveOut = isAtoB ? liquidity.tokenBReserve : liquidity.tokenAReserve;
        if (reserveIn.lte(0) || reserveOut.lte(0)) {
            return {
                poolId: pool.id,
                poolName: pool.name,
                amountIn,
                amountOut: MultiPathConstants_1.DECIMAL_ZERO,
                priceImpact: MultiPathConstants_1.DECIMAL_ZERO,
                feeRate: new decimal_js_1.default(pool.feeRate),
                tokenIn,
                tokenOut,
                liquidityUSD: liquidity.liquidityUSD,
                isValid: false,
                failureReason: "Zero reserves in pool",
            };
        }
        // Apply fee
        const feeRate = new decimal_js_1.default(pool.feeRate);
        const amountInAfterFee = amountIn.mul(MultiPathConstants_1.DECIMAL_ONE.minus(feeRate));
        // Constant product formula
        const amountOut = reserveOut.mul(amountInAfterFee).div(reserveIn.add(amountInAfterFee));
        // Price impact
        const priceImpact = amountIn.div(reserveIn);
        // Validation
        let isValid = true;
        let failureReason;
        if (liquidity.liquidityUSD.lt(MultiPathConstants_1.RISK_PARAMS.MIN_POOL_LIQUIDITY_USD)) {
            isValid = false;
            failureReason = `Low liquidity: $${liquidity.liquidityUSD.toFixed(0)}`;
        }
        else if (priceImpact.gt(MultiPathConstants_1.RISK_PARAMS.MAX_PRICE_IMPACT_PER_POOL)) {
            isValid = false;
            failureReason = `High price impact: ${priceImpact.mul(100).toFixed(2)}%`;
        }
        else if (amountOut.lte(0)) {
            isValid = false;
            failureReason = "Output is zero or negative";
        }
        return {
            poolId: pool.id,
            poolName: pool.name,
            amountIn,
            amountOut,
            priceImpact,
            feeRate,
            tokenIn,
            tokenOut,
            liquidityUSD: liquidity.liquidityUSD,
            isValid,
            failureReason,
        };
    }
    /**
     * Simulate complete arbitrage path
     */
    simulatePath(path, initialUSDC) {
        const startTime = Date.now();
        const swaps = [];
        // Determine token flow based on path type
        let currentAmount = initialUSDC;
        let currentToken = "USDC";
        let isValid = true;
        let failureReason;
        // Execute each pool swap
        for (let i = 0; i < path.pools.length; i++) {
            const pool = path.pools[i];
            // Determine next token
            let nextToken;
            if (currentToken === "USDC") {
                nextToken = pool.tokenASymbol === "USDC" ? pool.tokenBSymbol : pool.tokenASymbol;
            }
            else if (currentToken === "SOL") {
                nextToken = pool.tokenASymbol === "SOL" ? pool.tokenBSymbol : pool.tokenASymbol;
            }
            else if (currentToken === "BONK") {
                nextToken = pool.tokenASymbol === "BONK" ? pool.tokenBSymbol : pool.tokenASymbol;
            }
            else {
                // Invalid token
                nextToken = "USDC";
            }
            // Simulate swap
            const swap = this.simulatePoolSwap(pool, currentAmount, currentToken, nextToken);
            swaps.push(swap);
            if (!swap.isValid) {
                isValid = false;
                failureReason = `Pool ${i + 1} (${pool.name}): ${swap.failureReason}`;
                break;
            }
            // Update for next iteration
            currentAmount = swap.amountOut;
            currentToken = nextToken;
        }
        // Final amount must be in USDC
        const finalUSDC = currentToken === "USDC" ? currentAmount : MultiPathConstants_1.DECIMAL_ZERO;
        if (currentToken !== "USDC") {
            isValid = false;
            failureReason = `Path does not end in USDC (ends in ${currentToken})`;
        }
        // Calculate profits
        const grossProfitUSDC = finalUSDC.minus(initialUSDC);
        const grossProfitPct = initialUSDC.gt(0) ? grossProfitUSDC.div(initialUSDC) : MultiPathConstants_1.DECIMAL_ZERO;
        const netProfitUSDC = grossProfitUSDC; // Fees already deducted in simulation
        const netProfitPct = initialUSDC.gt(0) ? netProfitUSDC.div(initialUSDC) : MultiPathConstants_1.DECIMAL_ZERO;
        // Calculate total metrics
        const totalFeesPct = new decimal_js_1.default(path.totalFeeRate);
        const totalPriceImpact = swaps.reduce((sum, s) => sum.plus(s.priceImpact), MultiPathConstants_1.DECIMAL_ZERO);
        const totalLiquidityUSD = swaps.reduce((sum, s) => sum.plus(s.liquidityUSD), MultiPathConstants_1.DECIMAL_ZERO);
        const minPoolLiquidityUSD = swaps.length > 0
            ? decimal_js_1.default.min(...swaps.map(s => s.liquidityUSD))
            : MultiPathConstants_1.DECIMAL_ZERO;
        // Final validation
        if (isValid) {
            const minProfit = (0, MultiPathConstants_1.getMinProfitThreshold)(path.pathType);
            if (netProfitPct.lt(minProfit)) {
                isValid = false;
                failureReason = `Profit ${netProfitPct.mul(100).toFixed(4)}% < ${(minProfit * 100).toFixed(2)}% minimum`;
            }
            else if (totalPriceImpact.gt(MultiPathConstants_1.RISK_PARAMS.MAX_TOTAL_SLIPPAGE)) {
                isValid = false;
                failureReason = `Total impact ${totalPriceImpact.mul(100).toFixed(2)}% > ${(MultiPathConstants_1.RISK_PARAMS.MAX_TOTAL_SLIPPAGE * 100)}% max`;
            }
            else if (totalLiquidityUSD.lt(MultiPathConstants_1.RISK_PARAMS.MIN_TOTAL_PATH_LIQUIDITY_USD)) {
                isValid = false;
                failureReason = `Total liquidity $${totalLiquidityUSD.toFixed(0)} < $${MultiPathConstants_1.RISK_PARAMS.MIN_TOTAL_PATH_LIQUIDITY_USD} min`;
            }
        }
        return {
            pathId: path.pathId,
            pathType: path.pathType,
            description: path.description,
            initialUSDC,
            finalUSDC,
            swaps,
            grossProfitUSDC,
            grossProfitPct,
            netProfitUSDC,
            netProfitPct,
            totalFeesPct,
            totalPriceImpact,
            totalLiquidityUSD,
            minPoolLiquidityUSD,
            isExecutable: isValid,
            failureReason,
            simulationTimeMs: Date.now() - startTime,
        };
    }
    /**
     * Simulate all paths and return results sorted by profit
     */
    simulateAllPaths(paths, initialUSDC) {
        const results = paths.map(path => this.simulatePath(path, initialUSDC));
        // Sort by net profit (descending)
        results.sort((a, b) => b.netProfitPct.minus(a.netProfitPct).toNumber());
        return results;
    }
    /**
     * Find best executable path
     */
    findBestPath(paths, initialUSDC) {
        const results = this.simulateAllPaths(paths, initialUSDC);
        return results.find(r => r.isExecutable) || null;
    }
    /**
     * Get statistics for all paths
     */
    getPathStatistics(paths, initialUSDC) {
        const results = this.simulateAllPaths(paths, initialUSDC);
        const executable = results.filter(r => r.isExecutable);
        const byType = {
            "1hop": { total: 0, executable: 0 },
            "2hop": { total: 0, executable: 0 },
            "3hop": { total: 0, executable: 0 },
            "4hop": { total: 0, executable: 0 },
        };
        const failureReasons = new Map();
        for (const result of results) {
            byType[result.pathType].total++;
            if (result.isExecutable) {
                byType[result.pathType].executable++;
            }
            else if (result.failureReason) {
                failureReasons.set(result.failureReason, (failureReasons.get(result.failureReason) || 0) + 1);
            }
        }
        const avgProfit = executable.length > 0
            ? executable.reduce((sum, r) => sum.plus(r.netProfitPct), MultiPathConstants_1.DECIMAL_ZERO).div(executable.length)
            : MultiPathConstants_1.DECIMAL_ZERO;
        return {
            totalPaths: results.length,
            executablePaths: executable.length,
            bestProfit: executable.length > 0 ? executable[0].netProfitPct : MultiPathConstants_1.DECIMAL_ZERO,
            avgProfit,
            bestPath: executable.length > 0 ? executable[0] : null,
            byType,
            failureReasons,
        };
    }
}
exports.MultiPathCalculator = MultiPathCalculator;
