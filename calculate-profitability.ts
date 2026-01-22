/**
 * PROFIT CALCULATOR
 *
 * Calculate if an arbitrage opportunity is profitable BEFORE executing
 * Shows exact breakdown of all costs
 */

import Decimal from "decimal.js";
import * as dotenv from "dotenv";

dotenv.config();

/* =========================
   COST PARAMETERS
========================= */

// Swap fees (per DEX)
const ORCA_FEE = 0.0001;       // 0.01% for Orca Whirlpool
const RAYDIUM_FEE = 0.0025;    // 0.25% for Raydium AMM

// Gas costs
const COMPUTE_UNITS = 400000;
const BASE_TX_FEE_LAMPORTS = 5000;

// Jito
const JITO_TIP_LAMPORTS = parseInt(process.env.JITO_TIP_LAMPORTS || "10000");
const USE_JITO = process.env.USE_JITO?.toLowerCase() !== "false";

// Market prices
const SOL_PRICE_USD = 135; // Update this with current SOL price

/* =========================
   CALCULATOR
========================= */

function calculateProfitability(
  tradeAmountUSDC: number,
  spreadPercent: number,
  maxSlippagePercent: number = 0.5,
  priorityFeeMicroLamports: number = 50000
) {
  console.log("\n" + "=".repeat(80));
  console.log("💰 ARBITRAGE PROFITABILITY CALCULATOR");
  console.log("=".repeat(80));

  // Input
  const tradeAmount = new Decimal(tradeAmountUSDC);
  const spread = new Decimal(spreadPercent).div(100);

  console.log("\n📥 INPUT:");
  console.log(`  Trade Amount: $${tradeAmount.toFixed(2)} USDC`);
  console.log(`  Spread: ${spreadPercent.toFixed(4)}%`);
  console.log(`  Max Slippage: ${maxSlippagePercent.toFixed(2)}%`);
  console.log(`  Priority Fee: ${priorityFeeMicroLamports.toLocaleString()} microLamports/CU`);

  // Calculate gross profit
  const grossProfit = tradeAmount.mul(spread);

  console.log("\n💵 GROSS PROFIT:");
  console.log(`  ${grossProfit.toFixed(4)} USDC`);

  // Calculate swap fees
  // Two swaps: USDC -> SOL (Orca/Raydium), SOL -> USDC (Raydium/Orca)
  const swap1Fee = tradeAmount.mul(ORCA_FEE);     // Assume Orca for first swap (lower fee)
  const swap2Fee = tradeAmount.mul(RAYDIUM_FEE);  // Raydium for second
  const totalSwapFees = swap1Fee.plus(swap2Fee);

  console.log("\n💸 SWAP FEES:");
  console.log(`  Swap 1 (Orca 0.01%): -$${swap1Fee.toFixed(4)}`);
  console.log(`  Swap 2 (Raydium 0.25%): -$${swap2Fee.toFixed(4)}`);
  console.log(`  Total Swap Fees: -$${totalSwapFees.toFixed(4)}`);

  // Calculate slippage loss
  const slippageLoss = tradeAmount.mul(maxSlippagePercent / 100);

  console.log("\n📉 SLIPPAGE:");
  console.log(`  Max Slippage: -$${slippageLoss.toFixed(4)}`);

  // Calculate gas costs
  const priorityFeeLamports = (priorityFeeMicroLamports * COMPUTE_UNITS) / 1000000;
  const totalGasLamports = priorityFeeLamports + BASE_TX_FEE_LAMPORTS;
  const totalGasSOL = new Decimal(totalGasLamports).div(1e9);
  const totalGasUSD = totalGasSOL.mul(SOL_PRICE_USD);

  console.log("\n⛽ GAS COSTS:");
  console.log(`  Base Fee: ${BASE_TX_FEE_LAMPORTS.toLocaleString()} lamports`);
  console.log(`  Priority Fee: ${priorityFeeLamports.toFixed(0)} lamports`);
  console.log(`  Total Gas: ${totalGasLamports.toFixed(0)} lamports = ${totalGasSOL.toFixed(6)} SOL`);
  console.log(`  Total Gas USD: -$${totalGasUSD.toFixed(4)}`);

  // Jito tip
  let jitoTipUSD = new Decimal(0);
  if (USE_JITO) {
    const jitoTipSOL = new Decimal(JITO_TIP_LAMPORTS).div(1e9);
    jitoTipUSD = jitoTipSOL.mul(SOL_PRICE_USD);
    console.log("\n🔒 JITO MEV PROTECTION:");
    console.log(`  Jito Tip: ${JITO_TIP_LAMPORTS.toLocaleString()} lamports = ${jitoTipSOL.toFixed(6)} SOL`);
    console.log(`  Jito Tip USD: -$${jitoTipUSD.toFixed(4)}`);
  }

  // Calculate total costs
  const totalCosts = totalSwapFees.plus(slippageLoss).plus(totalGasUSD).plus(jitoTipUSD);

  console.log("\n📊 TOTAL COSTS:");
  console.log(`  Swap Fees: -$${totalSwapFees.toFixed(4)}`);
  console.log(`  Slippage: -$${slippageLoss.toFixed(4)}`);
  console.log(`  Gas: -$${totalGasUSD.toFixed(4)}`);
  if (USE_JITO) {
    console.log(`  Jito Tip: -$${jitoTipUSD.toFixed(4)}`);
  }
  console.log(`  ─────────────────────────`);
  console.log(`  TOTAL: -$${totalCosts.toFixed(4)}`);

  // Calculate net profit
  const netProfit = grossProfit.minus(totalCosts);
  const netProfitPercent = netProfit.div(tradeAmount).mul(100);
  const isProfitable = netProfit.gt(0);

  console.log("\n🎯 NET PROFIT:");
  console.log(`  ${netProfit.toFixed(4)} USDC (${netProfitPercent.toFixed(2)}%)`);

  console.log("\n" + "=".repeat(80));
  if (isProfitable) {
    console.log("✅ PROFITABLE OPPORTUNITY");
    console.log(`   Trade $${tradeAmount.toFixed(2)} → Profit $${netProfit.toFixed(4)}`);

    // ROI analysis
    const roi = netProfitPercent;
    console.log("\n📈 ROI ANALYSIS:");
    console.log(`   Per Trade: ${roi.toFixed(2)}%`);
    if (roi.gte(0.1)) {
      const tradesFor1Dollar = new Decimal(1).div(netProfit);
      console.log(`   Trades for $1 profit: ${tradesFor1Dollar.toFixed(1)} trades`);
    }
    if (roi.gte(0.01)) {
      const tradesFor10Dollars = new Decimal(10).div(netProfit);
      console.log(`   Trades for $10 profit: ${tradesFor10Dollars.toFixed(1)} trades`);
    }

  } else {
    console.log("❌ NOT PROFITABLE");
    console.log(`   Loss: -$${netProfit.abs().toFixed(4)}`);

    // Breakeven analysis
    const breakevenSpread = totalCosts.div(tradeAmount).mul(100);
    console.log("\n📈 BREAKEVEN ANALYSIS:");
    console.log(`   Need ${breakevenSpread.toFixed(2)}% spread to break even`);
    console.log(`   Current spread: ${spreadPercent.toFixed(2)}%`);
    console.log(`   Gap: ${breakevenSpread.minus(spreadPercent).toFixed(2)}%`);
  }
  console.log("=".repeat(80));

  return {
    isProfitable,
    grossProfit: grossProfit.toNumber(),
    totalCosts: totalCosts.toNumber(),
    netProfit: netProfit.toNumber(),
    netProfitPercent: netProfitPercent.toNumber(),
  };
}

/* =========================
   SCENARIOS
========================= */

console.log("\n" + "█".repeat(80));
console.log("COMPARING DIFFERENT SCENARIOS");
console.log("█".repeat(80));

// Scenario 1: Your current setup ($10 trade, 0.26% spread)
console.log("\n📍 SCENARIO 1: Current Setup");
calculateProfitability(10, 0.26, 0.5, 50000);

// Scenario 2: Recommended setup ($100 trade, 0.26% spread)
console.log("\n📍 SCENARIO 2: Recommended Setup");
calculateProfitability(100, 0.26, 0.5, 50000);

// Scenario 3: Good opportunity ($100 trade, 1.5% spread)
console.log("\n📍 SCENARIO 3: Good Opportunity");
calculateProfitability(100, 1.5, 0.5, 75000);

// Scenario 4: Excellent opportunity ($100 trade, 3% spread)
console.log("\n📍 SCENARIO 4: Excellent Opportunity");
calculateProfitability(100, 3.0, 0.5, 100000);

// Scenario 5: Large trade ($500, 1.5% spread)
console.log("\n📍 SCENARIO 5: Large Trade");
calculateProfitability(500, 1.5, 0.5, 100000);

/* =========================
   CUSTOM CALCULATION
========================= */

// Check command line args
const args = process.argv.slice(2);
if (args.length >= 2) {
  const tradeAmount = parseFloat(args[0]);
  const spread = parseFloat(args[1]);
  const slippage = args[2] ? parseFloat(args[2]) : 0.5;
  const priorityFee = args[3] ? parseInt(args[3]) : 50000;

  console.log("\n📍 CUSTOM CALCULATION");
  calculateProfitability(tradeAmount, spread, slippage, priorityFee);
}

console.log("\n💡 USAGE:");
console.log("  ts-node calculate-profitability.ts [tradeAmount] [spreadPercent] [slippagePercent] [priorityFee]");
console.log("\n  Example:");
console.log("  ts-node calculate-profitability.ts 100 2.5 0.5 75000");
console.log("  (Trade $100 with 2.5% spread, 0.5% slippage, 75k priority fee)\n");
