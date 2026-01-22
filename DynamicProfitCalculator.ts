import { Connection } from "@solana/web3.js";
import Decimal from "decimal.js";
import * as dotenv from "dotenv";

dotenv.config();

/* =========================
   DYNAMIC PROFIT CALCULATOR

   Calculates EXACT profitability after ALL fees:
   - Pool swap fees (from quotes)
   - Network gas fees (real-time estimation)
   - Priority fees (configurable)
   - Slippage (from quotes)
========================= */

export interface FeeBreakdown {
  // Pool fees
  pool1SwapFee: Decimal;        // Fee for first swap (in USDC)
  pool2SwapFee: Decimal;        // Fee for second swap (in USDC)
  totalPoolFees: Decimal;       // Total pool fees (in USDC)

  // Network fees
  baseFee: Decimal;             // Base transaction fee (in SOL)
  priorityFee: Decimal;         // Priority fee (in SOL)
  computeFee: Decimal;          // Compute units fee (in SOL)
  totalNetworkFeesSOL: Decimal; // Total network fees (in SOL)
  totalNetworkFeesUSDC: Decimal; // Total network fees (in USDC)

  // Slippage
  estimatedSlippage: Decimal;   // Expected slippage loss (in USDC)

  // Totals
  totalCostsUSDC: Decimal;      // All costs combined (in USDC)
  totalCostsPct: Decimal;       // All costs as % of trade amount
}

export interface ProfitAnalysis {
  tradeAmountUSDC: Decimal;

  // Swap estimates (from Orca SDK quotes)
  swap1Input: Decimal;          // USDC in
  swap1Output: Decimal;         // SOL out
  swap2Input: Decimal;          // SOL in
  swap2Output: Decimal;         // USDC out

  // Profit calculations
  grossProfitUSDC: Decimal;     // swap2Output - swap1Input
  grossProfitPct: Decimal;      // gross profit %

  fees: FeeBreakdown;

  netProfitUSDC: Decimal;       // Profit after ALL fees
  netProfitPct: Decimal;        // Net profit %

  isProfitable: boolean;        // True if net profit > 0
  meetsMinimum: boolean;        // True if meets user's minimum profit threshold

  // Debugging
  breakEvenSpreadPct: Decimal;  // Spread needed to break even
}

export class DynamicProfitCalculator {
  private connection: Connection;
  private solPriceUSD: Decimal;

  // Configurable parameters
  private priorityFeeLamports: number;
  private computeUnits: number;
  private minimumProfitUSDC: Decimal;

  constructor(
    connection: Connection,
    config: {
      priorityFeeLamports?: number;
      computeUnits?: number;
      minimumProfitUSDC?: number;
      solPriceUSD?: number;
    } = {}
  ) {
    this.connection = connection;
    this.priorityFeeLamports = config.priorityFeeLamports || 50000;
    this.computeUnits = config.computeUnits || 400000; // For atomic 2-swap transaction
    this.minimumProfitUSDC = new Decimal(config.minimumProfitUSDC || 0.001); // $0.001 default
    this.solPriceUSD = new Decimal(config.solPriceUSD || 125); // Default fallback
  }

  /**
   * Update SOL price from pool data
   */
  updateSOLPrice(poolPrice: Decimal): void {
    this.solPriceUSD = poolPrice;
  }

  /**
   * Calculate all fees for a trade
   *
   * IMPORTANT: Orca SDK quotes already include pool fees and slippage in estimatedAmountOut!
   * We only need to calculate and subtract NETWORK fees (gas, priority, compute).
   * Pool fees and slippage are calculated here for REPORTING only, not subtracted again.
   */
  private calculateFees(
    tradeAmountUSDC: Decimal,
    swap1Quote: any,
    swap2Quote: any,
    pool1FeeRate: number,
    pool2FeeRate: number
  ): FeeBreakdown {
    // 1. POOL FEES (for reporting only - already included in Orca quote)
    // Pool fees are already deducted in the quote's estimatedAmountOut
    // We calculate them explicitly for transparency in reports

    // Pool 1 fee (e.g., 0.05% = 0.0005)
    const pool1Fee = tradeAmountUSDC.mul(pool1FeeRate);

    // Pool 2 fee (e.g., 0.01% = 0.0001)
    // Fee is on the SOL amount, convert to USDC
    const swap2AmountIn = new Decimal(swap2Quote.estimatedAmountIn.toString()).div(1e9);
    const pool2Fee = swap2AmountIn.mul(this.solPriceUSD).mul(pool2FeeRate);

    const totalPoolFees = pool1Fee.plus(pool2Fee);

    // 2. NETWORK FEES (NOT in Orca quote - must subtract these!)

    // Base transaction fee (5000 lamports per signature)
    const baseFeeLamports = 5000;
    const baseFeeSOL = new Decimal(baseFeeLamports).div(1e9);

    // Priority fee calculation: microLamports/CU * computeUnits / 1,000,000 = lamports
    // Example: 200,000 microL/CU * 400,000 CU / 1,000,000 = 80,000 lamports = 0.00008 SOL
    const priorityFeeMicroLamports = new Decimal(this.priorityFeeLamports).mul(this.computeUnits);
    const priorityFeeLamports = priorityFeeMicroLamports.div(1_000_000);
    const priorityFeeSOL = priorityFeeLamports.div(1e9);

    // Compute units fee: Already included in priority fee calculation above
    const computeFeeSOL = new Decimal(0);

    const totalNetworkFeesSOL = baseFeeSOL.plus(priorityFeeSOL).plus(computeFeeSOL);
    const totalNetworkFeesUSDC = totalNetworkFeesSOL.mul(this.solPriceUSD);

    // 3. SLIPPAGE (for reporting only - already in Orca quote via estimatedAmountOut)
    // We show worst-case slippage for transparency, but it's already accounted for

    const swap1EstimatedOut = new Decimal(swap1Quote.estimatedAmountOut.toString()).div(1e9);
    const swap1MinOut = new Decimal(swap1Quote.otherAmountThreshold.toString()).div(1e9);
    const swap1SlippageLoss = swap1EstimatedOut.minus(swap1MinOut).mul(this.solPriceUSD);

    const swap2EstimatedOut = new Decimal(swap2Quote.estimatedAmountOut.toString()).div(1e6);
    const swap2MinOut = new Decimal(swap2Quote.otherAmountThreshold.toString()).div(1e6);
    const swap2SlippageLoss = swap2EstimatedOut.minus(swap2MinOut);

    const estimatedSlippage = swap1SlippageLoss.plus(swap2SlippageLoss);

    // 4. TOTAL COSTS TO SUBTRACT
    // Only subtract network fees (pool fees and slippage already in quote)
    const totalCostsUSDC = totalNetworkFeesUSDC;

    const totalCostsPct = totalCostsUSDC.div(tradeAmountUSDC).mul(100);

    return {
      pool1SwapFee: pool1Fee,
      pool2SwapFee: pool2Fee,
      totalPoolFees,
      baseFee: baseFeeSOL,
      priorityFee: priorityFeeSOL,
      computeFee: computeFeeSOL,
      totalNetworkFeesSOL,
      totalNetworkFeesUSDC,
      estimatedSlippage,
      totalCostsUSDC,
      totalCostsPct,
    };
  }

  /**
   * MAIN METHOD: Analyze profitability of a trade
   *
   * @param tradeAmountUSDC - Amount to trade in USDC
   * @param swap1Quote - Orca SDK quote for first swap (USDC -> SOL)
   * @param swap2Quote - Orca SDK quote for second swap (SOL -> USDC)
   * @param currentSOLPrice - Current SOL/USDC price
   * @param pool1FeeRate - First pool fee rate (e.g., 0.0005 for 0.05%)
   * @param pool2FeeRate - Second pool fee rate (e.g., 0.0001 for 0.01%)
   * @param logDetails - Whether to show detailed console output (default false)
   * @returns Complete profit analysis
   */
  analyzeProfitability(
    tradeAmountUSDC: Decimal,
    swap1Quote: any,
    swap2Quote: any,
    currentSOLPrice: Decimal,
    pool1FeeRate: number = 0.0005, // 0.05% default
    pool2FeeRate: number = 0.0001, // 0.01% default
    logDetails: boolean = false
  ): ProfitAnalysis {
    // Update SOL price
    this.updateSOLPrice(currentSOLPrice);

    // Extract swap amounts from quotes
    const swap1Input = new Decimal(swap1Quote.estimatedAmountIn.toString()).div(1e6);
    const swap1Output = new Decimal(swap1Quote.estimatedAmountOut.toString()).div(1e9);
    const swap2Input = new Decimal(swap2Quote.estimatedAmountIn.toString()).div(1e9);
    const swap2Output = new Decimal(swap2Quote.estimatedAmountOut.toString()).div(1e6);

    // DEBUG: Detailed logging (only if requested)
    if (logDetails) {
      console.log(`[PROFIT CALC DEBUG]:`);
      console.log(`  Swap 1: ${swap1Input.toFixed(6)} USDC -> ${swap1Output.toFixed(9)} SOL`);
      console.log(`  Swap 2: ${swap2Input.toFixed(9)} SOL -> ${swap2Output.toFixed(6)} USDC`);
      console.log(`  Pool fees (reporting): Pool1=${(pool1FeeRate * 100).toFixed(2)}%, Pool2=${(pool2FeeRate * 100).toFixed(2)}%`);
    }

    // Calculate gross profit (before network fees, but pool fees already deducted by Orca)
    // NOTE: Orca quotes already include pool fees in estimatedAmountOut
    const grossProfitUSDC = swap2Output.minus(swap1Input);
    const grossProfitPct = grossProfitUSDC.div(swap1Input).mul(100);

    if (logDetails) {
      console.log(`  Gross profit (pool fees already deducted): ${grossProfitUSDC.toFixed(6)} USDC (${grossProfitPct.toFixed(4)}%)`);
    }

    // Calculate all fees
    const fees = this.calculateFees(tradeAmountUSDC, swap1Quote, swap2Quote, pool1FeeRate, pool2FeeRate);

    if (logDetails) {
      console.log(`  Network fees to subtract: ${fees.totalCostsUSDC.toFixed(6)} USDC (${fees.totalCostsPct.toFixed(4)}%)`);
      console.log(`  Pool fees (for reporting): ${fees.totalPoolFees.toFixed(6)} USDC`);
    }

    // Calculate net profit (after ALL fees)
    const netProfitUSDC = grossProfitUSDC.minus(fees.totalCostsUSDC);
    const netProfitPct = netProfitUSDC.div(tradeAmountUSDC).mul(100);

    if (logDetails) {
      console.log(`  NET PROFIT: ${netProfitUSDC.toFixed(6)} USDC (${netProfitPct.toFixed(4)}%)`);
      console.log(`  Break-even spread needed: ${fees.totalCostsPct.toFixed(4)}%`);
    }

    // Determine profitability
    const isProfitable = netProfitUSDC.gt(0);
    const meetsMinimum = netProfitUSDC.gte(this.minimumProfitUSDC);

    if (logDetails) {
      console.log(`  Profitable: ${isProfitable}, Meets minimum ($${this.minimumProfitUSDC}): ${meetsMinimum}`);
    }

    // Calculate break-even spread needed
    const breakEvenSpreadPct = fees.totalCostsPct;

    return {
      tradeAmountUSDC,
      swap1Input,
      swap1Output,
      swap2Input,
      swap2Output,
      grossProfitUSDC,
      grossProfitPct,
      fees,
      netProfitUSDC,
      netProfitPct,
      isProfitable,
      meetsMinimum,
      breakEvenSpreadPct,
    };
  }

  /**
   * Quick check: is this trade profitable and meets minimum?
   */
  isProfitableQuick(
    tradeAmountUSDC: Decimal,
    swap1Quote: any,
    swap2Quote: any,
    currentSOLPrice: Decimal,
    pool1FeeRate: number = 0.0005,
    pool2FeeRate: number = 0.0001
  ): boolean {
    const analysis = this.analyzeProfitability(
      tradeAmountUSDC,
      swap1Quote,
      swap2Quote,
      currentSOLPrice,
      pool1FeeRate,
      pool2FeeRate
    );
    return analysis.isProfitable && analysis.meetsMinimum;
  }

  /**
   * Update minimum profit threshold
   */
  setMinimumProfit(minimumProfitUSDC: number): void {
    this.minimumProfitUSDC = new Decimal(minimumProfitUSDC);
    console.log(`[PROFIT CALC] Updated minimum profit to $${minimumProfitUSDC}`);
  }

  /**
   * Get current minimum profit
   */
  getMinimumProfit(): Decimal {
    return this.minimumProfitUSDC;
  }
}
