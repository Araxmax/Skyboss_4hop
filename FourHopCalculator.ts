import Decimal from "decimal.js";
import {
  FourHopPoolConfig,
  FourHopPath,
  BONK_RISK_PARAMS,
  FOUR_HOP_PROFIT_THRESHOLDS,
  DECIMAL_ZERO,
  DECIMAL_ONE,
  DECIMAL_100,
} from "./FourHopConstants";

/* =========================
   PURE CALCULATION ENGINE
   NO RPC CALLS, NO TRANSACTIONS
   ONLY MATH + SIMULATION
========================= */

export interface PoolLiquidityData {
  poolId: string;
  tokenAReserve: Decimal; // in human-readable units
  tokenBReserve: Decimal; // in human-readable units
  liquidityUSD: Decimal;
  lastUpdate: number; // timestamp
}

export interface SwapSimulation {
  poolId: string;
  poolName: string;
  dex: string;
  amountIn: Decimal;
  amountOut: Decimal;
  priceImpact: Decimal; // as percentage (e.g., 0.02 = 2%)
  effectiveFeeRate: Decimal;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  liquidityUSD: Decimal;
  isValid: boolean;
  failureReason?: string;
}

export interface FourHopSimulationResult {
  pathId: string;
  pathDescription: string;

  // Initial and final amounts
  initialUSDC: Decimal;
  finalUSDC: Decimal;

  // Each hop simulation
  hop1: SwapSimulation; // USDC -> SOL
  hop2: SwapSimulation; // SOL -> BONK
  hop3: SwapSimulation; // BONK -> USDC

  // Profit calculations (ALL IN USDC)
  grossProfitUSDC: Decimal;
  grossProfitPct: Decimal;
  totalFeesPct: Decimal;
  netProfitUSDC: Decimal;
  netProfitPct: Decimal;

  // Risk metrics
  totalPriceImpact: Decimal;
  totalLiquidityUSD: Decimal;
  minHopLiquidityUSD: Decimal;

  // Execution decision
  isExecutable: boolean;
  failureReason?: string;

  // Performance
  simulationTimeMs: number;
}

/* =========================
   FOUR HOP CALCULATOR CLASS
========================= */

export class FourHopCalculator {
  private liquidityCache: Map<string, PoolLiquidityData>;

  constructor() {
    this.liquidityCache = new Map();
  }

  /**
   * Update liquidity data for a pool (called by data fetcher)
   */
  updatePoolLiquidity(data: PoolLiquidityData): void {
    this.liquidityCache.set(data.poolId, data);
  }

  /**
   * Get cached liquidity data
   */
  getPoolLiquidity(poolId: string): PoolLiquidityData | null {
    const data = this.liquidityCache.get(poolId);

    if (!data) {
      return null;
    }

    // Check if data is stale (older than MAX_QUOTE_AGE_MS)
    const age = Date.now() - data.lastUpdate;
    if (age > BONK_RISK_PARAMS.MAX_QUOTE_AGE_MS) {
      return null; // Stale data, reject
    }

    return data;
  }

  /**
   * Simulate a single swap using constant product formula (x * y = k)
   * Accounts for fees and calculates price impact
   */
  private simulateSwap(
    pool: FourHopPoolConfig,
    amountIn: Decimal,
    liquidity: PoolLiquidityData,
    isAtoB: boolean // true if swapping tokenA -> tokenB
  ): SwapSimulation {
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
          amountOut: DECIMAL_ZERO,
          priceImpact: DECIMAL_ZERO,
          effectiveFeeRate: new Decimal(pool.feeRate),
          tokenInSymbol: isAtoB ? pool.tokenASymbol : pool.tokenBSymbol,
          tokenOutSymbol: isAtoB ? pool.tokenBSymbol : pool.tokenASymbol,
          liquidityUSD: liquidity.liquidityUSD,
          isValid: false,
          failureReason: "Zero reserves in pool",
        };
      }

      // Apply fee to input amount
      const feeRate = new Decimal(pool.feeRate);
      const amountInAfterFee = amountIn.mul(DECIMAL_ONE.minus(feeRate));

      // Constant product formula: amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee)
      const amountOut = reserveOut
        .mul(amountInAfterFee)
        .div(reserveIn.add(amountInAfterFee));

      // Calculate price impact
      // Price impact = (amountIn / reserveIn) * 100
      const priceImpact = amountIn.div(reserveIn);

      // Validate against risk parameters
      let isValid = true;
      let failureReason: string | undefined;

      // Check liquidity minimums
      if (liquidity.liquidityUSD.lt(BONK_RISK_PARAMS.MIN_POOL_LIQUIDITY_USD)) {
        isValid = false;
        failureReason = `Liquidity too low: $${liquidity.liquidityUSD.toFixed(
          0
        )} < $${BONK_RISK_PARAMS.MIN_POOL_LIQUIDITY_USD}`;
      }

      // Check price impact
      if (priceImpact.gt(BONK_RISK_PARAMS.MAX_PRICE_IMPACT_PER_HOP)) {
        isValid = false;
        failureReason = `Price impact too high: ${priceImpact
          .mul(100)
          .toFixed(2)}% > ${BONK_RISK_PARAMS.MAX_PRICE_IMPACT_PER_HOP * 100}%`;
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
    } catch (error: any) {
      return {
        poolId: pool.id,
        poolName: pool.name,
        dex: pool.dex,
        amountIn,
        amountOut: DECIMAL_ZERO,
        priceImpact: DECIMAL_ZERO,
        effectiveFeeRate: new Decimal(pool.feeRate),
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
  simulateFourHopPath(
    path: FourHopPath,
    initialUSDC: Decimal
  ): FourHopSimulationResult {
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
        finalUSDC: DECIMAL_ZERO,
        hop1: this.createInvalidSwap(path.pools.hop1, initialUSDC, "USDC", "SOL"),
        hop2: this.createInvalidSwap(path.pools.hop2, DECIMAL_ZERO, "SOL", "BONK"),
        hop3: this.createInvalidSwap(path.pools.hop3, DECIMAL_ZERO, "BONK", "USDC"),
        grossProfitUSDC: DECIMAL_ZERO,
        grossProfitPct: DECIMAL_ZERO,
        totalFeesPct: new Decimal(path.totalFeeRate),
        netProfitUSDC: DECIMAL_ZERO,
        netProfitPct: DECIMAL_ZERO,
        totalPriceImpact: DECIMAL_ZERO,
        totalLiquidityUSD: DECIMAL_ZERO,
        minHopLiquidityUSD: DECIMAL_ZERO,
        isExecutable: false,
        failureReason: "Missing liquidity data for one or more pools",
        simulationTimeMs: Date.now() - startTime,
      };
    }

    // Simulate Hop 1: USDC -> SOL
    const hop1 = this.simulateSwap(
      path.pools.hop1,
      initialUSDC,
      hop1Liquidity,
      true // USDC (tokenA) -> SOL (tokenB)
    );

    if (!hop1.isValid) {
      return this.createFailedSimulation(
        path,
        initialUSDC,
        hop1,
        null,
        null,
        `Hop 1 failed: ${hop1.failureReason}`,
        startTime
      );
    }

    // Simulate Hop 2: SOL -> BONK
    const hop2 = this.simulateSwap(
      path.pools.hop2,
      hop1.amountOut,
      hop2Liquidity,
      true // SOL (tokenA) -> BONK (tokenB)
    );

    if (!hop2.isValid) {
      return this.createFailedSimulation(
        path,
        initialUSDC,
        hop1,
        hop2,
        null,
        `Hop 2 failed: ${hop2.failureReason}`,
        startTime
      );
    }

    // Simulate Hop 3: BONK -> USDC
    const hop3 = this.simulateSwap(
      path.pools.hop3,
      hop2.amountOut,
      hop3Liquidity,
      true // BONK (tokenA) -> USDC (tokenB)
    );

    if (!hop3.isValid) {
      return this.createFailedSimulation(
        path,
        initialUSDC,
        hop1,
        hop2,
        hop3,
        `Hop 3 failed: ${hop3.failureReason}`,
        startTime
      );
    }

    // Calculate final amounts and profits
    const finalUSDC = hop3.amountOut;
    const grossProfitUSDC = finalUSDC.minus(initialUSDC);
    const grossProfitPct = grossProfitUSDC.div(initialUSDC);

    // Total fees
    const totalFeesPct = new Decimal(path.totalFeeRate);

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

    const minHopLiquidityUSD = Decimal.min(
      hop1Liquidity.liquidityUSD,
      hop2Liquidity.liquidityUSD,
      hop3Liquidity.liquidityUSD
    );

    // Execution decision
    let isExecutable = true;
    let failureReason: string | undefined;

    // Check profit threshold
    if (netProfitPct.lt(FOUR_HOP_PROFIT_THRESHOLDS.MIN_PROFIT_THRESHOLD)) {
      isExecutable = false;
      failureReason = `Net profit ${netProfitPct
        .mul(100)
        .toFixed(4)}% below minimum ${
        FOUR_HOP_PROFIT_THRESHOLDS.MIN_PROFIT_THRESHOLD * 100
      }%`;
    }

    // Check total price impact
    if (totalPriceImpact.gt(BONK_RISK_PARAMS.MAX_TOTAL_SLIPPAGE)) {
      isExecutable = false;
      failureReason = `Total price impact ${totalPriceImpact
        .mul(100)
        .toFixed(2)}% exceeds maximum ${
        BONK_RISK_PARAMS.MAX_TOTAL_SLIPPAGE * 100
      }%`;
    }

    // Check total liquidity
    if (totalLiquidityUSD.lt(BONK_RISK_PARAMS.MIN_TOTAL_PATH_LIQUIDITY_USD)) {
      isExecutable = false;
      failureReason = `Total liquidity $${totalLiquidityUSD.toFixed(
        0
      )} below minimum $${BONK_RISK_PARAMS.MIN_TOTAL_PATH_LIQUIDITY_USD}`;
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
  private createInvalidSwap(
    pool: FourHopPoolConfig,
    amountIn: Decimal,
    tokenIn: string,
    tokenOut: string
  ): SwapSimulation {
    return {
      poolId: pool.id,
      poolName: pool.name,
      dex: pool.dex,
      amountIn,
      amountOut: DECIMAL_ZERO,
      priceImpact: DECIMAL_ZERO,
      effectiveFeeRate: new Decimal(pool.feeRate),
      tokenInSymbol: tokenIn,
      tokenOutSymbol: tokenOut,
      liquidityUSD: DECIMAL_ZERO,
      isValid: false,
      failureReason: "Pool data unavailable",
    };
  }

  /**
   * Helper: Create failed simulation result
   */
  private createFailedSimulation(
    path: FourHopPath,
    initialUSDC: Decimal,
    hop1: SwapSimulation | null,
    hop2: SwapSimulation | null,
    hop3: SwapSimulation | null,
    failureReason: string,
    startTime: number
  ): FourHopSimulationResult {
    return {
      pathId: path.pathId,
      pathDescription: path.description,
      initialUSDC,
      finalUSDC: DECIMAL_ZERO,
      hop1:
        hop1 ||
        this.createInvalidSwap(path.pools.hop1, initialUSDC, "USDC", "SOL"),
      hop2:
        hop2 ||
        this.createInvalidSwap(path.pools.hop2, DECIMAL_ZERO, "SOL", "BONK"),
      hop3:
        hop3 ||
        this.createInvalidSwap(path.pools.hop3, DECIMAL_ZERO, "BONK", "USDC"),
      grossProfitUSDC: DECIMAL_ZERO,
      grossProfitPct: DECIMAL_ZERO,
      totalFeesPct: new Decimal(path.totalFeeRate),
      netProfitUSDC: DECIMAL_ZERO,
      netProfitPct: DECIMAL_ZERO,
      totalPriceImpact: DECIMAL_ZERO,
      totalLiquidityUSD: DECIMAL_ZERO,
      minHopLiquidityUSD: DECIMAL_ZERO,
      isExecutable: false,
      failureReason,
      simulationTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Simulate ALL possible 4-hop paths and return sorted by profit
   */
  simulateAllPaths(
    paths: FourHopPath[],
    initialUSDC: Decimal
  ): FourHopSimulationResult[] {
    const results: FourHopSimulationResult[] = [];

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
  findBestPath(
    paths: FourHopPath[],
    initialUSDC: Decimal
  ): FourHopSimulationResult | null {
    const results = this.simulateAllPaths(paths, initialUSDC);

    // Find first executable path (already sorted by profit)
    const bestPath = results.find((r) => r.isExecutable);

    return bestPath || null;
  }

  /**
   * Get execution statistics for a set of paths
   */
  getPathStatistics(
    paths: FourHopPath[],
    initialUSDC: Decimal
  ): {
    totalPaths: number;
    executablePaths: number;
    bestProfit: Decimal;
    avgProfit: Decimal;
    bestPath: FourHopSimulationResult | null;
    failureReasons: Map<string, number>;
  } {
    const results = this.simulateAllPaths(paths, initialUSDC);

    const executableResults = results.filter((r) => r.isExecutable);

    const failureReasons = new Map<string, number>();
    results.forEach((r) => {
      if (!r.isExecutable && r.failureReason) {
        failureReasons.set(
          r.failureReason,
          (failureReasons.get(r.failureReason) || 0) + 1
        );
      }
    });

    const avgProfit =
      executableResults.length > 0
        ? executableResults
            .reduce((sum, r) => sum.plus(r.netProfitPct), DECIMAL_ZERO)
            .div(executableResults.length)
        : DECIMAL_ZERO;

    return {
      totalPaths: results.length,
      executablePaths: executableResults.length,
      bestProfit:
        executableResults.length > 0
          ? executableResults[0].netProfitPct
          : DECIMAL_ZERO,
      avgProfit,
      bestPath: executableResults.length > 0 ? executableResults[0] : null,
      failureReasons,
    };
  }
}

/* =========================
   PRICE ORACLE (for calculating liquidity USD values)
========================= */

export interface TokenPrice {
  token: string;
  priceUSD: Decimal;
  lastUpdate: number;
}

export class SimplePriceOracle {
  private prices: Map<string, TokenPrice>;

  constructor() {
    this.prices = new Map();
  }

  /**
   * Update price for a token
   */
  updatePrice(token: string, priceUSD: Decimal): void {
    this.prices.set(token, {
      token,
      priceUSD,
      lastUpdate: Date.now(),
    });
  }

  /**
   * Get price for a token
   */
  getPrice(token: string): Decimal | null {
    const price = this.prices.get(token);
    if (!price) return null;

    // Check staleness (2 seconds max)
    const age = Date.now() - price.lastUpdate;
    if (age > 2000) return null;

    return price.priceUSD;
  }

  /**
   * Calculate liquidity in USD for a pool
   */
  calculatePoolLiquidityUSD(
    tokenASymbol: string,
    tokenBSymbol: string,
    tokenAReserve: Decimal,
    tokenBReserve: Decimal
  ): Decimal | null {
    const priceA = this.getPrice(tokenASymbol);
    const priceB = this.getPrice(tokenBSymbol);

    if (!priceA || !priceB) return null;

    const liquidityA = tokenAReserve.mul(priceA);
    const liquidityB = tokenBReserve.mul(priceB);

    return liquidityA.plus(liquidityB);
  }
}
