import { Connection } from "@solana/web3.js";
import Decimal from "decimal.js";
import * as dotenv from "dotenv";
import { generateFourHopPaths, FOUR_HOP_POOLS } from "./FourHopConstants";
import { FourHopCalculator, SimplePriceOracle } from "./FourHopCalculator";

dotenv.config();

/* =========================
   QUICK TEST SCRIPT
   Tests the 4-hop calculation logic without RPC
========================= */

async function testCalculations() {
  console.log("\n" + "=".repeat(80));
  console.log(" TESTING 4-HOP CALCULATION LOGIC");
  console.log("=".repeat(80));

  // Initialize calculator and price oracle
  const calculator = new FourHopCalculator();
  const priceOracle = new SimplePriceOracle();

  // Set mock prices
  console.log("\n[Test] Setting mock token prices...");
  priceOracle.updatePrice("USDC", new Decimal(1)); // $1
  priceOracle.updatePrice("SOL", new Decimal(200)); // $200
  priceOracle.updatePrice("BONK", new Decimal(0.00002)); // $0.00002

  // Set mock liquidity for pools
  console.log("[Test] Setting mock liquidity data...");

  // Hop 1 pools (USDC -> SOL)
  calculator.updatePoolLiquidity({
    poolId: "pool_1_orca_usdc_sol",
    tokenAReserve: new Decimal(1000000), // 1M USDC
    tokenBReserve: new Decimal(5000), // 5k SOL
    liquidityUSD: new Decimal(2000000), // $2M
    lastUpdate: Date.now(),
  });

  calculator.updatePoolLiquidity({
    poolId: "pool_2_raydium_usdc_sol",
    tokenAReserve: new Decimal(2000000), // 2M USDC
    tokenBReserve: new Decimal(10000), // 10k SOL
    liquidityUSD: new Decimal(4000000), // $4M
    lastUpdate: Date.now(),
  });

  calculator.updatePoolLiquidity({
    poolId: "pool_3_raydium_clmm_usdc_sol",
    tokenAReserve: new Decimal(500000), // 500k USDC
    tokenBReserve: new Decimal(2500), // 2.5k SOL
    liquidityUSD: new Decimal(1000000), // $1M
    lastUpdate: Date.now(),
  });

  // Hop 2 pools (SOL -> BONK)
  calculator.updatePoolLiquidity({
    poolId: "pool_4_raydium_sol_bonk",
    tokenAReserve: new Decimal(1000), // 1k SOL
    tokenBReserve: new Decimal(100000000000), // 100B BONK
    liquidityUSD: new Decimal(400000), // $400k
    lastUpdate: Date.now(),
  });

  calculator.updatePoolLiquidity({
    poolId: "pool_5_orca_sol_bonk",
    tokenAReserve: new Decimal(500), // 500 SOL
    tokenBReserve: new Decimal(50000000000), // 50B BONK
    liquidityUSD: new Decimal(200000), // $200k
    lastUpdate: Date.now(),
  });

  calculator.updatePoolLiquidity({
    poolId: "pool_6_meteora_sol_bonk",
    tokenAReserve: new Decimal(800), // 800 SOL
    tokenBReserve: new Decimal(80000000000), // 80B BONK
    liquidityUSD: new Decimal(320000), // $320k
    lastUpdate: Date.now(),
  });

  // Hop 3 pools (BONK -> USDC)
  calculator.updatePoolLiquidity({
    poolId: "pool_7_raydium_bonk_usdc",
    tokenAReserve: new Decimal(100000000000), // 100B BONK
    tokenBReserve: new Decimal(2000000), // 2M USDC
    liquidityUSD: new Decimal(4000000), // $4M
    lastUpdate: Date.now(),
  });

  calculator.updatePoolLiquidity({
    poolId: "pool_8_orca_bonk_usdc",
    tokenAReserve: new Decimal(50000000000), // 50B BONK
    tokenBReserve: new Decimal(1000000), // 1M USDC
    liquidityUSD: new Decimal(2000000), // $2M
    lastUpdate: Date.now(),
  });

  calculator.updatePoolLiquidity({
    poolId: "pool_9_raydium_clmm_bonk_usdc",
    tokenAReserve: new Decimal(80000000000), // 80B BONK
    tokenBReserve: new Decimal(1600000), // 1.6M USDC
    liquidityUSD: new Decimal(3200000), // $3.2M
    lastUpdate: Date.now(),
  });

  calculator.updatePoolLiquidity({
    poolId: "pool_10_meteora_bonk_usdc",
    tokenAReserve: new Decimal(60000000000), // 60B BONK
    tokenBReserve: new Decimal(1200000), // 1.2M USDC
    liquidityUSD: new Decimal(2400000), // $2.4M
    lastUpdate: Date.now(),
  });

  // Generate all paths
  console.log("\n[Test] Generating 4-hop paths...");
  const paths = generateFourHopPaths();
  console.log(`✓ Generated ${paths.length} paths`);

  // Simulate all paths
  console.log("\n[Test] Simulating all paths with 100 USDC...");
  const tradeAmount = new Decimal(100);
  const stats = calculator.getPathStatistics(paths, tradeAmount);

  console.log("\n" + "─".repeat(80));
  console.log("📊 SIMULATION RESULTS");
  console.log("─".repeat(80));
  console.log(`Total paths tested: ${stats.totalPaths}`);
  console.log(`Executable paths: ${stats.executablePaths}`);
  console.log(`Best profit: ${(stats.bestProfit.mul(100)).toFixed(4)}%`);
  console.log(`Average profit: ${(stats.avgProfit.mul(100)).toFixed(4)}%`);

  if (stats.failureReasons.size > 0) {
    console.log("\n❌ Failure Reasons:");
    stats.failureReasons.forEach((count, reason) => {
      console.log(`  - ${reason}: ${count} paths`);
    });
  }

  if (stats.bestPath) {
    console.log("\n" + "─".repeat(80));
    console.log("💰 BEST PATH FOUND");
    console.log("─".repeat(80));
    console.log(`Path: ${stats.bestPath.pathDescription}`);
    console.log(`Initial: ${stats.bestPath.initialUSDC.toFixed(6)} USDC`);
    console.log(`Final: ${stats.bestPath.finalUSDC.toFixed(6)} USDC`);
    console.log(`Net Profit: ${stats.bestPath.netProfitUSDC.toFixed(6)} USDC (${(stats.bestPath.netProfitPct.mul(100)).toFixed(4)}%)`);
    console.log(`Total Fees: ${(stats.bestPath.totalFeesPct.mul(100)).toFixed(4)}%`);
    console.log(`Total Impact: ${(stats.bestPath.totalPriceImpact.mul(100)).toFixed(4)}%`);
    console.log(`Executable: ${stats.bestPath.isExecutable ? "✅ YES" : "❌ NO"}`);
    if (stats.bestPath.failureReason) {
      console.log(`Reason: ${stats.bestPath.failureReason}`);
    }
  } else {
    console.log("\n❌ NO PROFITABLE PATHS FOUND");
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ TEST COMPLETE");
  console.log("=".repeat(80));
  console.log("\nNOTE: This test uses MOCK data for demonstration.");
  console.log("To test with REAL data, run: npm run simulator:4hop");
  console.log("=".repeat(80) + "\n");
}

// Run test
testCalculations().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
