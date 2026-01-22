import { Connection } from "@solana/web3.js";
import Decimal from "decimal.js";
import * as dotenv from "dotenv";
import { MultiPathCalculator } from "./MultiPathCalculator";
import { MultiPathDataFetcher } from "./MultiPathDataFetcher";
import { ALL_POOLS } from "./MultiPathConstants";

dotenv.config();

async function testAllDexes() {
  const RPC_URL = process.env.RPC_URL || "";
  if (!RPC_URL) {
    console.error("ERROR: RPC_URL not set in .env");
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const calculator = new MultiPathCalculator();
  const dataFetcher = new MultiPathDataFetcher(connection, calculator, 5000);

  console.log("\n" + "=".repeat(80));
  console.log(" TESTING ALL DEX IMPLEMENTATIONS");
  console.log("=".repeat(80));

  // Start data fetcher
  console.log("\n[Test] Starting data fetcher...");
  dataFetcher.start();

  // Wait for initial fetch
  console.log("[Test] Waiting 8 seconds for pool data...");
  await new Promise(resolve => setTimeout(resolve, 8000));

  // Check by DEX
  console.log("\n" + "=".repeat(80));
  console.log(" RESULTS BY DEX");
  console.log("=".repeat(80));

  const dexes = ["orca", "raydium_amm", "raydium_clmm", "meteora", "phoenix"];
  const dexNames = {
    orca: "Orca (AMM + Whirlpool)",
    raydium_amm: "Raydium AMM",
    raydium_clmm: "Raydium CLMM",
    meteora: "Meteora DLMM",
    phoenix: "Phoenix",
  };

  for (const dex of dexes) {
    console.log(`\n${dexNames[dex as keyof typeof dexNames]}:`);
    console.log("─".repeat(80));

    const dexPools = ALL_POOLS.filter(p => p.dex === dex);
    let workingCount = 0;
    let failedCount = 0;

    for (const pool of dexPools) {
      const liquidity = calculator.getPoolLiquidity(pool.id);
      const status = liquidity ? "✅" : "❌";

      console.log(`  ${status} ${pool.name}`);

      if (liquidity) {
        workingCount++;
        console.log(`     Reserves: ${liquidity.tokenAReserve.toFixed(2)} / ${liquidity.tokenBReserve.toFixed(2)}`);
        console.log(`     Liquidity: $${liquidity.liquidityUSD.toFixed(0)}`);
      } else {
        failedCount++;
        if (!pool.vaultA || !pool.vaultB || pool.vaultA === "" || pool.vaultB === "") {
          console.log(`     Reason: Missing vault addresses`);
        }
      }
    }

    console.log(`\n  Summary: ${workingCount}/${dexPools.length} pools working`);
  }

  // Overall summary
  console.log("\n" + "=".repeat(80));
  console.log(" OVERALL SUMMARY");
  console.log("=".repeat(80));

  const workingPools = ALL_POOLS.filter(p => calculator.getPoolLiquidity(p.id) !== null);
  const totalPools = ALL_POOLS.length;

  console.log(`\n  Total pools configured: ${totalPools}`);
  console.log(`  Working pools: ${workingPools.length}`);
  console.log(`  Failed pools: ${totalPools - workingPools.length}`);
  console.log(`\n  Success rate: ${((workingPools.length / totalPools) * 100).toFixed(1)}%`);

  if (workingPools.length > 0) {
    console.log(`\n  ✅ Working pools:`);
    workingPools.forEach(p => {
      console.log(`     - ${p.name} (${p.dex})`);
    });
  }

  const failedPools = ALL_POOLS.filter(p => calculator.getPoolLiquidity(p.id) === null);
  if (failedPools.length > 0) {
    console.log(`\n  ❌ Failed pools:`);
    failedPools.forEach(p => {
      console.log(`     - ${p.name} (${p.dex})`);
    });
  }

  console.log("\n" + "=".repeat(80));

  // Stop data fetcher
  dataFetcher.stop();
  process.exit(0);
}

testAllDexes().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
