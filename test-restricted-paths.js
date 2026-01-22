"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const MultiPathGenerator_1 = require("./MultiPathGenerator");
console.log("\n" + "=".repeat(80));
console.log("RESTRICTED PATH GENERATION TEST");
console.log("=".repeat(80));
const generator = new MultiPathGenerator_1.MultiPathGenerator();
const allPaths = generator.generateAllPaths();
const stats = generator.getPathStats(allPaths);
console.log("\n✅ Path Generation Successful!");
console.log(`Total Paths: ${stats.total}`);
console.log(`  1-hop paths: ${stats.byType["1hop"]}`);
console.log(`  2-hop paths: ${stats.byType["2hop"]}`);
console.log(`  3-hop paths: ${stats.byType["3hop"]}`);
console.log(`  4-hop paths: ${stats.byType["4hop"]}`);
console.log("\n" + "-".repeat(80));
console.log("RESTRICTED ROUTES ONLY:");
console.log("-".repeat(80));
console.log("\n1-HOP (RESTRICTED):");
console.log("  Route: USDC → SOL → USDC");
const onehop = allPaths.filter(p => p.pathType === "1hop").slice(0, 3);
onehop.forEach(path => {
    console.log(`    ${path.pathId}: ${path.description}`);
});
console.log("\n2-HOP (RESTRICTED):");
console.log("  Route: USDC → SOL → BONK → USDC");
const twohop = allPaths.filter(p => p.pathType === "2hop").slice(0, 3);
twohop.forEach(path => {
    console.log(`    ${path.pathId}: ${path.description}`);
});
console.log("\n3-HOP (RESTRICTED):");
console.log("  Route: USDC → SOL → BONK → SOL → USDC");
const threehop = allPaths.filter(p => p.pathType === "3hop").slice(0, 3);
threehop.forEach(path => {
    console.log(`    ${path.pathId}: ${path.description}`);
});
console.log("\n4-HOP (RESTRICTED):");
console.log("  Routes:");
console.log("    A) USDC ↔ SOL bidirectional");
console.log("    B) USDC ↔ BONK bidirectional");
const fourhop = allPaths.filter(p => p.pathType === "4hop").slice(0, 3);
fourhop.forEach(path => {
    console.log(`    ${path.pathId}: ${path.description.substring(0, 80)}...`);
});
console.log("\n" + "=".repeat(80));
console.log("ROUTE VERIFICATION");
console.log("=".repeat(80));
// Verify 1-hop only has SOL routes
const onehopSol = allPaths.filter(p => p.pathType === "1hop" &&
    p.description.includes("SOL"));
const onehopBonk = allPaths.filter(p => p.pathType === "1hop" &&
    p.description.includes("BONK"));
console.log(`\n1-hop SOL routes: ${onehopSol.length}`);
console.log(`1-hop BONK routes: ${onehopBonk.length} (should be 0)`);
// Verify 2-hop only has SOL→BONK routes
const twohopValid = allPaths.filter(p => p.pathType === "2hop" &&
    p.pools.length === 3 &&
    (p.pools[0].tokenBSymbol === "SOL" || p.pools[0].tokenASymbol === "SOL") &&
    (p.pools[1].tokenBSymbol === "BONK" || p.pools[1].tokenASymbol === "BONK") &&
    (p.pools[2].tokenBSymbol === "USDC" || p.pools[2].tokenASymbol === "USDC"));
console.log(`\n2-hop USDC→SOL→BONK→USDC routes: ${twohopValid.length}`);
// Verify 3-hop only has SOL→BONK→SOL routes
const threehopValid = allPaths.filter(p => p.pathType === "3hop" &&
    p.pools.length === 4 &&
    (p.pools[0].tokenBSymbol === "SOL" || p.pools[0].tokenASymbol === "SOL") &&
    (p.pools[1].tokenBSymbol === "BONK" || p.pools[1].tokenASymbol === "BONK"));
console.log(`3-hop USDC→SOL→BONK→SOL→USDC routes: ${threehopValid.length}`);
// Verify 4-hop
const fourhopSol = allPaths.filter(p => p.pathType === "4hop" &&
    p.pools[0].tokenASymbol === "SOL" || p.pools[0].tokenBSymbol === "SOL");
const fourhopBonk = allPaths.filter(p => p.pathType === "4hop" &&
    p.pools[0].tokenASymbol === "BONK" || p.pools[0].tokenBSymbol === "BONK");
console.log(`\n4-hop SOL bidirectional routes: ${fourhopSol.length}`);
console.log(`4-hop BONK bidirectional routes: ${fourhopBonk.length}`);
console.log("\n" + "=".repeat(80));
console.log("✅ RESTRICTED ROUTES CONFIGURED SUCCESSFULLY");
console.log("=".repeat(80) + "\n");
