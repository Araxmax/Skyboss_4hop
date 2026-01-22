/**
 * MULTI-POOL ARBITRAGE FINDER
 *
 * Finds arbitrage opportunities across 18+ pools
 * Supports 1-hop (simple) arbitrage between any two pools
 * Real profitability calculation including all fees
 */

import Decimal from "decimal.js";
import {
  ALL_POOLS,
  PoolConfig,
  DECIMAL_ZERO,
  DECIMAL_ONE,
} from "./MultiPathConstants";
import { MultiPoolGrpcScanner, PoolPrice } from "./MultiPoolGrpcScanner";

/* =========================
   ARBITRAGE OPPORTUNITY
========================= */

export interface ArbitrageOpportunity {
  // Pools involved
  buyPool: PoolConfig;
  sellPool: PoolConfig;

  // Prices
  buyPrice: Decimal; // Price to buy at (lower)
  sellPrice: Decimal; // Price to sell at (higher)

  // Token pair
  tokenASymbol: string;
  tokenBSymbol: string;

  // Profitability
  spreadPercent: Decimal;
  grossProfitUSD: Decimal;
  totalFeesUSD: Decimal;
  netProfitUSD: Decimal;
  netProfitPercent: Decimal;
  roi: Decimal;

  // Trade details
  tradeAmountUSD: Decimal;
  direction: "buy-then-sell" | "sell-then-buy";

  // Metadata
  timestamp: number;
  score: number; // Higher is better
}

/* =========================
   ARBITRAGE FINDER
========================= */

export class MultiPoolArbitrageFinder {
  constructor(
    private scanner: MultiPoolGrpcScanner,
    private tradeAmountUSD: number = 25,
    private minNetProfitUSD: number = 0.10,
    private maxSlippagePercent: number = 0.5,
    private priorityFeePerCU: number = 100000, // microlamports
    private solPriceUSD: number = 135
  ) {}

  /**
   * Find all arbitrage opportunities across all pool pairs
   */
  findOpportunities(): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    const poolPrices = this.scanner.getAllPoolPrices();

    // Group pools by token pair
    const poolsByPair = this.groupPoolsByPair();

    // Check each token pair
    for (const [pairKey, pools] of poolsByPair) {
      if (pools.length < 2) continue; // Need at least 2 pools to arbitrage

      // Compare all pairs of pools for this token pair
      for (let i = 0; i < pools.length; i++) {
        for (let j = i + 1; j < pools.length; j++) {
          const pool1 = pools[i];
          const pool2 = pools[j];

          const price1 = poolPrices.get(pool1.id);
          const price2 = poolPrices.get(pool2.id);

          if (!price1 || !price2) continue;

          // Check both directions
          const opp1 = this.calculateArbitrage(pool1, pool2, price1, price2);
          const opp2 = this.calculateArbitrage(pool2, pool1, price2, price1);

          if (opp1 && opp1.netProfitUSD.gte(this.minNetProfitUSD)) {
            opportunities.push(opp1);
          }
          if (opp2 && opp2.netProfitUSD.gte(this.minNetProfitUSD)) {
            opportunities.push(opp2);
          }
        }
      }
    }

    // Sort by score (highest first)
    opportunities.sort((a, b) => b.score - a.score);

    return opportunities;
  }

  /**
   * Calculate arbitrage between two pools
   */
  private calculateArbitrage(
    buyPool: PoolConfig,
    sellPool: PoolConfig,
    buyPrice: PoolPrice,
    sellPrice: PoolPrice
  ): ArbitrageOpportunity | null {
    // Ensure we're comparing same token pair (may be inverted)
    const sameDirection =
      buyPool.tokenASymbol === sellPool.tokenASymbol &&
      buyPool.tokenBSymbol === sellPool.tokenBSymbol;

    const invertedDirection =
      buyPool.tokenASymbol === sellPool.tokenBSymbol &&
      buyPool.tokenBSymbol === sellPool.tokenASymbol;

    if (!sameDirection && !invertedDirection) return null;

    // Get comparable prices
    let buyPriceValue: Decimal;
    let sellPriceValue: Decimal;

    if (sameDirection) {
      buyPriceValue = buyPrice.price; // Price of A in terms of B
      sellPriceValue = sellPrice.price;
    } else {
      // Inverted - need to flip one price
      buyPriceValue = buyPrice.price;
      sellPriceValue = sellPrice.inversePrice;
    }

    // Check if there's a profitable spread
    if (sellPriceValue.lte(buyPriceValue)) return null;

    const spread = sellPriceValue.minus(buyPriceValue);
    const spreadPercent = spread.div(buyPriceValue).mul(100);

    // Sanity check: spreads over 10% are likely data errors
    if (spreadPercent.gt(10)) {
      return null; // Skip obviously wrong prices
    }

    // Calculate profitability
    const tradeAmount = new Decimal(this.tradeAmountUSD);

    // Gross profit (before fees)
    const grossProfitPercent = spreadPercent.div(100);
    const grossProfitUSD = tradeAmount.mul(grossProfitPercent);

    // Calculate all fees
    const buyFee = tradeAmount.mul(buyPool.feeRate); // Swap fee for buying
    const sellFee = tradeAmount.mul(sellPool.feeRate); // Swap fee for selling

    // Slippage cost
    const slippageCost = tradeAmount.mul(this.maxSlippagePercent / 100);

    // Gas cost (2 transactions)
    const computeUnits = 400000; // Per transaction
    const baseFee = 5000; // 5000 lamports base fee per transaction
    const priorityFeeLamports = (this.priorityFeePerCU * computeUnits) / 1000000;
    const totalGasLamports = (priorityFeeLamports + baseFee) * 2; // 2 transactions
    const gasCostUSD = new Decimal(totalGasLamports).div(1e9).mul(this.solPriceUSD);

    // Total fees
    const totalFeesUSD = buyFee.plus(sellFee).plus(slippageCost).plus(gasCostUSD);

    // Net profit
    const netProfitUSD = grossProfitUSD.minus(totalFeesUSD);
    const netProfitPercent = netProfitUSD.div(tradeAmount).mul(100);
    const roi = netProfitPercent;

    // Skip if not profitable
    if (netProfitUSD.lt(this.minNetProfitUSD)) return null;

    // Calculate opportunity score (for ranking)
    // Factors: net profit, spread, liquidity, fee efficiency
    const profitScore = netProfitUSD.toNumber() * 100; // Higher profit = better
    const spreadScore = spreadPercent.toNumber() * 10; // Higher spread = better
    const liquidityScore = Math.min(
      buyPrice.liquidityUSD.toNumber(),
      sellPrice.liquidityUSD.toNumber()
    ) / 10000; // Higher min liquidity = better
    const feeScore = 100 - (buyPool.feeRate + sellPool.feeRate) * 10000; // Lower fees = better

    const score = profitScore + spreadScore + liquidityScore + feeScore;

    return {
      buyPool,
      sellPool,
      buyPrice: buyPriceValue,
      sellPrice: sellPriceValue,
      tokenASymbol: buyPool.tokenASymbol,
      tokenBSymbol: buyPool.tokenBSymbol,
      spreadPercent,
      grossProfitUSD,
      totalFeesUSD,
      netProfitUSD,
      netProfitPercent,
      roi,
      tradeAmountUSD: tradeAmount,
      direction: "buy-then-sell",
      timestamp: Date.now(),
      score,
    };
  }

  /**
   * Group pools by token pair (normalized)
   */
  private groupPoolsByPair(): Map<string, PoolConfig[]> {
    const groups = new Map<string, PoolConfig[]>();

    for (const pool of ALL_POOLS) {
      // Create normalized pair key (alphabetical order)
      const tokens = [pool.tokenASymbol, pool.tokenBSymbol].sort();
      const pairKey = `${tokens[0]}-${tokens[1]}`;

      if (!groups.has(pairKey)) {
        groups.set(pairKey, []);
      }
      groups.get(pairKey)!.push(pool);
    }

    return groups;
  }

  /**
   * Find best opportunity for a specific token pair
   */
  findBestForPair(tokenA: string, tokenB: string): ArbitrageOpportunity | null {
    const opportunities = this.findOpportunities();

    const filtered = opportunities.filter(
      opp =>
        (opp.tokenASymbol === tokenA && opp.tokenBSymbol === tokenB) ||
        (opp.tokenASymbol === tokenB && opp.tokenBSymbol === tokenA)
    );

    return filtered.length > 0 ? filtered[0] : null;
  }

  /**
   * Print opportunity details
   */
  printOpportunity(opp: ArbitrageOpportunity): void {
    console.log("\n" + "═".repeat(80));
    console.log("💰 ARBITRAGE OPPORTUNITY");
    console.log("═".repeat(80));
    console.log(`\n🔄 ${opp.tokenASymbol}/${opp.tokenBSymbol} Arbitrage`);
    console.log(`   Buy:  ${opp.buyPool.name}`);
    console.log(`   Sell: ${opp.sellPool.name}`);
    console.log(`\n📊 Prices:`);
    console.log(`   Buy:  ${opp.buyPrice.toFixed(6)} ${opp.tokenBSymbol}/${opp.tokenASymbol}`);
    console.log(`   Sell: ${opp.sellPrice.toFixed(6)} ${opp.tokenBSymbol}/${opp.tokenASymbol}`);
    console.log(`   Spread: ${opp.spreadPercent.toFixed(4)}%`);
    console.log(`\n💵 Profitability (Trade: $${opp.tradeAmountUSD.toFixed(2)}):`);
    console.log(`   Gross Profit:  +$${opp.grossProfitUSD.toFixed(4)}`);
    console.log(`   Total Fees:    -$${opp.totalFeesUSD.toFixed(4)}`);
    console.log(`   Net Profit:    $${opp.netProfitUSD.toFixed(4)} (${opp.netProfitPercent.toFixed(2)}%)`);
    console.log(`   ROI:           ${opp.roi.toFixed(2)}%`);
    console.log(`\n⭐ Score: ${opp.score.toFixed(2)}`);
    console.log("═".repeat(80));
  }

  /**
   * Print summary of all opportunities
   */
  printSummary(opportunities: ArbitrageOpportunity[]): void {
    if (opportunities.length === 0) {
      console.log("\n❌ No profitable opportunities found");
      return;
    }

    console.log("\n" + "═".repeat(80));
    console.log(`📋 FOUND ${opportunities.length} PROFITABLE OPPORTUNITIES`);
    console.log("═".repeat(80));

    for (let i = 0; i < Math.min(opportunities.length, 5); i++) {
      const opp = opportunities[i];
      console.log(`\n${i + 1}. ${opp.tokenASymbol}/${opp.tokenBSymbol}: ${opp.buyPool.dex} → ${opp.sellPool.dex}`);
      console.log(`   Profit: $${opp.netProfitUSD.toFixed(4)} (${opp.netProfitPercent.toFixed(2)}%) | Spread: ${opp.spreadPercent.toFixed(4)}%`);
    }

    if (opportunities.length > 5) {
      console.log(`\n... and ${opportunities.length - 5} more opportunities`);
    }

    console.log("═".repeat(80));
  }
}
