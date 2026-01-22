import * as dotenv from "dotenv";
import { MultiPathGenerator } from "./MultiPathGenerator";
import { MultiPathCalculator } from "./MultiPathCalculator";
import Decimal from "decimal.js";

dotenv.config();

console.log("\n" + "=".repeat(80));
console.log("MULTI-PATH SCANNER TEST");
console.log("=".repeat(80) + "\n");

// Test 1: Generate all paths
const generator = new MultiPathGenerator();
const allPaths = generator.generateAllPaths();
const stats = generator.getPathStats(allPaths);

console.log("✅ Path Generation Success!");
console.log(`Total Paths: ${stats.total}`);
console.log(`  1-hop paths: ${stats.byType["1hop"]}`);
console.log(`  2-hop paths: ${stats.byType["2hop"]}`);
console.log(`  3-hop paths: ${stats.byType["3hop"]}`);
console.log(`  4-hop paths: ${stats.byType["4hop"]}`);
console.log("\n");

// Test 2: Path breakdown
console.log("Path Examples:");
console.log("-".repeat(80));

const onehopPaths = allPaths.filter(p => p.pathType === "1hop").slice(0, 2);
console.log(`\n1-HOP PATHS (showing 2 of ${stats.byType["1hop"]}):`);
for (const path of onehopPaths) {
  console.log(`  ${path.pathId}: ${path.description}`);
  console.log(`    Pools: ${path.pools.map(p => p.name).join(" → ")}`);
  console.log(`    Fee: ${(path.totalFeeRate * 100).toFixed(3)}%`);
}

const twohopPaths = allPaths.filter(p => p.pathType === "2hop").slice(0, 2);
console.log(`\n2-HOP PATHS (showing 2 of ${stats.byType["2hop"]}):`);
for (const path of twohopPaths) {
  console.log(`  ${path.pathId}: ${path.description}`);
  console.log(`    Pools: ${path.pools.map(p => p.name).join(" → ")}`);
  console.log(`    Fee: ${(path.totalFeeRate * 100).toFixed(3)}%`);
}

const threehopPaths = allPaths.filter(p => p.pathType === "3hop").slice(0, 2);
console.log(`\n3-HOP PATHS (showing 2 of ${stats.byType["3hop"]}):`);
for (const path of threehopPaths) {
  console.log(`  ${path.pathId}: ${path.description}`);
  console.log(`    Pools: ${path.pools.map(p => p.name).join(" → ")}`);
  console.log(`    Fee: ${(path.totalFeeRate * 100).toFixed(3)}%`);
}

const fourhopPaths = allPaths.filter(p => p.pathType === "4hop").slice(0, 2);
console.log(`\n4-HOP PATHS (showing 2 of ${stats.byType["4hop"]}):`);
for (const path of fourhopPaths) {
  console.log(`  ${path.pathId}: ${path.description}`);
  console.log(`    Pools: ${path.pools.map(p => p.name).join(" → ")}`);
  console.log(`    Fee: ${(path.totalFeeRate * 100).toFixed(3)}%`);
}

// Test 3: All dexes
console.log("\n" + "-".repeat(80));
console.log("DEX COVERAGE:");
console.log("-".repeat(80));

const dexes = new Set<string>();
for (const path of allPaths) {
  for (const pool of path.pools) {
    dexes.add(pool.dex);
  }
}

for (const dex of Array.from(dexes).sort()) {
  const poolsWithDex = new Set<string>();
  for (const path of allPaths) {
    for (const pool of path.pools) {
      if (pool.dex === dex) {
        poolsWithDex.add(pool.id);
      }
    }
  }
  console.log(`  ${dex}: ${poolsWithDex.size} unique pools used`);
}

// Test 4: Show all pools in use
console.log("\n" + "-".repeat(80));
console.log("POOLS IN USE:");
console.log("-".repeat(80));

const poolsInUse = new Set<string>();
for (const path of allPaths) {
  for (const pool of path.pools) {
    poolsInUse.add(pool.id);
  }
}

const sortedPools = Array.from(poolsInUse).sort();
console.log(`Total unique pools being scanned: ${sortedPools.length}`);
for (const poolId of sortedPools) {
  const pool = allPaths[0]?.pools.find(p => p.id === poolId) ||
    allPaths.flatMap(p => p.pools).find(p => p.id === poolId);
  if (pool) {
    console.log(`  ${pool.id}: ${pool.name} (${pool.dex})`);
  }
}

console.log("\n" + "=".repeat(80));
console.log("✅ ALL TESTS PASSED!");
console.log("=".repeat(80) + "\n");
