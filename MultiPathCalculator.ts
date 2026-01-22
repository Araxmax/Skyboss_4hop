import Decimal from "decimal.js";
import {
  PoolConfig,
  ArbitragePath,
  PathType,
  RISK_PARAMS,
  getMinProfitThreshold,
  DECIMAL_ZERO,
  DECIMAL_ONE,
  USDC_MINT,
  SOL_MINT,
  BONK_MINT,
} from "./MultiPathConstants";

/* =========================
   OPTIMIZED MULTI-PATH CALCULATOR
   Calculates profit for 1-hop, 2-hop, 3-hop, 4-hop
========================= */

export interface PoolSwapResult {
  poolId: string;
  poolName: string;
  amountIn: Decimal;
  amountOut: Decimal;
  priceImpact: Decimal;
  feeRate: Decimal;
  tokenIn: string;
  tokenOut: string;
  liquidityUSD: Decimal;
  isValid: boolean;
  failureReason?: string;
}

export interface PathSimulationResult {
  pathId: string;
  pathType: PathType;
  description: string;

  // Input/Output (ALL IN USDC)
  initialUSDC: Decimal;
  finalUSDC: Decimal;

  // All pool swaps
  swaps: PoolSwapResult[];

  // Profit (USDC ONLY)
  grossProfitUSDC: Decimal;
  grossProfitPct: Decimal;
  netProfitUSDC: Decimal;
  netProfitPct: Decimal;
  totalFeesPct: Decimal;

  // Risk metrics
  totalPriceImpact: Decimal;
  totalLiquidityUSD: Decimal;
  minPoolLiquidityUSD: Decimal;

  // Execution decision
  isExecutable: boolean;
  failureReason?: string;
  simulationTimeMs: number;
}

export interface PoolLiquidityData {
  poolId: string;
  tokenAReserve: Decimal;
  tokenBReserve: Decimal;
  liquidityUSD: Decimal;
  priceAtoB: Decimal; // Price of tokenA in terms of tokenB
  priceBtoA: Decimal; // Price of tokenB in terms of tokenA
  lastUpdate: number;
}

export class MultiPathCalculator {
  private liquidityCache: Map<string, PoolLiquidityData> = new Map();

  /**
   * Update pool liquidity data
   */
  updatePoolLiquidity(data: PoolLiquidityData): void {
    this.liquidityCache.set(data.poolId, data);
  }

  /**
   * Get cached liquidity data
   */
  getPoolLiquidity(poolId: string): PoolLiquidityData | null {
    const data = this.liquidityCache.get(poolId);
    if (!data) return null;

    // Check freshness
    const age = Date.now() - data.lastUpdate;
    if (age > RISK_PARAMS.MAX_QUOTE_AGE_MS) {
      return null; // Stale data
    }

    return data;
  }

  /**
   * Simulate a single pool swap
   */
  private simulatePoolSwap(
    pool: PoolConfig,
    amountIn: Decimal,
    tokenIn: string,
    tokenOut: string
  ): PoolSwapResult {
    const liquidity = this.getPoolLiquidity(pool.id);

    if (!liquidity) {
      return {
        poolId: pool.id,
        poolName: pool.name,
        amountIn,
        amountOut: DECIMAL_ZERO,
        priceImpact: DECIMAL_ZERO,
        feeRate: new Decimal(pool.feeRate),
        tokenIn,
        tokenOut,
        liquidityUSD: DECIMAL_ZERO,
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
        amountOut: DECIMAL_ZERO,
        priceImpact: DECIMAL_ZERO,
        feeRate: new Decimal(pool.feeRate),
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
        amountOut: DECIMAL_ZERO,
        priceImpact: DECIMAL_ZERO,
        feeRate: new Decimal(pool.feeRate),
        tokenIn,
        tokenOut,
        liquidityUSD: liquidity.liquidityUSD,
        isValid: false,
        failureReason: "Zero reserves in pool",
      };
    }

    // Apply fee
    const feeRate = new Decimal(pool.feeRate);
    const amountInAfterFee = amountIn.mul(DECIMAL_ONE.minus(feeRate));

    // Constant product formula
    const amountOut = reserveOut.mul(amountInAfterFee).div(reserveIn.add(amountInAfterFee));

    // Price impact
    const priceImpact = amountIn.div(reserveIn);

    // Validation
    let isValid = true;
    let failureReason: string | undefined;

    if (liquidity.liquidityUSD.lt(RISK_PARAMS.MIN_POOL_LIQUIDITY_USD)) {
      isValid = false;
      failureReason = `Low liquidity: $${liquidity.liquidityUSD.toFixed(0)}`;
    } else if (priceImpact.gt(RISK_PARAMS.MAX_PRICE_IMPACT_PER_POOL)) {
      isValid = false;
      failureReason = `High price impact: ${priceImpact.mul(100).toFixed(2)}%`;
    } else if (amountOut.lte(0)) {
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
  simulatePath(path: ArbitragePath, initialUSDC: Decimal): PathSimulationResult {
    const startTime = Date.now();
    const swaps: PoolSwapResult[] = [];

    // Determine token flow based on path type
    let currentAmount = initialUSDC;
    let currentToken = "USDC";
    let isValid = true;
    let failureReason: string | undefined;

    // Execute each pool swap
    for (let i = 0; i < path.pools.length; i++) {
      const pool = path.pools[i];

      // Determine next token
      let nextToken: string;
      if (currentToken === "USDC") {
        nextToken = pool.tokenASymbol === "USDC" ? pool.tokenBSymbol : pool.tokenASymbol;
      } else if (currentToken === "SOL") {
        nextToken = pool.tokenASymbol === "SOL" ? pool.tokenBSymbol : pool.tokenASymbol;
      } else if (currentToken === "BONK") {
        nextToken = pool.tokenASymbol === "BONK" ? pool.tokenBSymbol : pool.tokenASymbol;
      } else {
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
    const finalUSDC = currentToken === "USDC" ? currentAmount : DECIMAL_ZERO;

    if (currentToken !== "USDC") {
      isValid = false;
      failureReason = `Path does not end in USDC (ends in ${currentToken})`;
    }

    // Calculate profits
    const grossProfitUSDC = finalUSDC.minus(initialUSDC);
    const grossProfitPct = initialUSDC.gt(0) ? grossProfitUSDC.div(initialUSDC) : DECIMAL_ZERO;
    const netProfitUSDC = grossProfitUSDC; // Fees already deducted in simulation
    const netProfitPct = initialUSDC.gt(0) ? netProfitUSDC.div(initialUSDC) : DECIMAL_ZERO;

    // Calculate total metrics
    const totalFeesPct = new Decimal(path.totalFeeRate);
    const totalPriceImpact = swaps.reduce((sum, s) => sum.plus(s.priceImpact), DECIMAL_ZERO);
    const totalLiquidityUSD = swaps.reduce((sum, s) => sum.plus(s.liquidityUSD), DECIMAL_ZERO);
    const minPoolLiquidityUSD = swaps.length > 0
      ? Decimal.min(...swaps.map(s => s.liquidityUSD))
      : DECIMAL_ZERO;

    // Final validation
    if (isValid) {
      const minProfit = getMinProfitThreshold(path.pathType);
      if (netProfitPct.lt(minProfit)) {
        isValid = false;
        failureReason = `Profit ${netProfitPct.mul(100).toFixed(4)}% < ${(minProfit * 100).toFixed(2)}% minimum`;
      } else if (totalPriceImpact.gt(RISK_PARAMS.MAX_TOTAL_SLIPPAGE)) {
        isValid = false;
        failureReason = `Total impact ${totalPriceImpact.mul(100).toFixed(2)}% > ${(RISK_PARAMS.MAX_TOTAL_SLIPPAGE * 100)}% max`;
      } else if (totalLiquidityUSD.lt(RISK_PARAMS.MIN_TOTAL_PATH_LIQUIDITY_USD)) {
        isValid = false;
        failureReason = `Total liquidity $${totalLiquidityUSD.toFixed(0)} < $${RISK_PARAMS.MIN_TOTAL_PATH_LIQUIDITY_USD} min`;
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
  simulateAllPaths(paths: ArbitragePath[], initialUSDC: Decimal): PathSimulationResult[] {
    const results = paths.map(path => this.simulatePath(path, initialUSDC));

    // Sort by net profit (descending)
    results.sort((a, b) => b.netProfitPct.minus(a.netProfitPct).toNumber());

    return results;
  }

  /**
   * Find best executable path
   */
  findBestPath(paths: ArbitragePath[], initialUSDC: Decimal): PathSimulationResult | null {
    const results = this.simulateAllPaths(paths, initialUSDC);
    return results.find(r => r.isExecutable) || null;
  }

  /**
   * Get statistics for all paths
   */
  getPathStatistics(paths: ArbitragePath[], initialUSDC: Decimal): {
    totalPaths: number;
    executablePaths: number;
    bestProfit: Decimal;
    avgProfit: Decimal;
    bestPath: PathSimulationResult | null;
    byType: Record<PathType, { total: number; executable: number }>;
    failureReasons: Map<string, number>;
  } {
    const results = this.simulateAllPaths(paths, initialUSDC);
    const executable = results.filter(r => r.isExecutable);

    const byType: Record<PathType, { total: number; executable: number }> = {
      "1hop": { total: 0, executable: 0 },
      "2hop": { total: 0, executable: 0 },
      "3hop": { total: 0, executable: 0 },
      "4hop": { total: 0, executable: 0 },
    };

    const failureReasons = new Map<string, number>();

    for (const result of results) {
      byType[result.pathType].total++;
      if (result.isExecutable) {
        byType[result.pathType].executable++;
      } else if (result.failureReason) {
        failureReasons.set(
          result.failureReason,
          (failureReasons.get(result.failureReason) || 0) + 1
        );
      }
    }

    const avgProfit = executable.length > 0
      ? executable.reduce((sum, r) => sum.plus(r.netProfitPct), DECIMAL_ZERO).div(executable.length)
      : DECIMAL_ZERO;

    return {
      totalPaths: results.length,
      executablePaths: executable.length,
      bestProfit: executable.length > 0 ? executable[0].netProfitPct : DECIMAL_ZERO,
      avgProfit,
      bestPath: executable.length > 0 ? executable[0] : null,
      byType,
      failureReasons,
    };
  }
}
