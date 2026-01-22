"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const decimal_js_1 = __importDefault(require("decimal.js"));
const dotenv = __importStar(require("dotenv"));
const FourHopConstants_1 = require("./FourHopConstants");
const FourHopCalculator_1 = require("./FourHopCalculator");
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
    const calculator = new FourHopCalculator_1.FourHopCalculator();
    const priceOracle = new FourHopCalculator_1.SimplePriceOracle();
    // Set mock prices
    console.log("\n[Test] Setting mock token prices...");
    priceOracle.updatePrice("USDC", new decimal_js_1.default(1)); // $1
    priceOracle.updatePrice("SOL", new decimal_js_1.default(200)); // $200
    priceOracle.updatePrice("BONK", new decimal_js_1.default(0.00002)); // $0.00002
    // Set mock liquidity for pools
    console.log("[Test] Setting mock liquidity data...");
    // Hop 1 pools (USDC -> SOL)
    calculator.updatePoolLiquidity({
        poolId: "pool_1_orca_usdc_sol",
        tokenAReserve: new decimal_js_1.default(1000000), // 1M USDC
        tokenBReserve: new decimal_js_1.default(5000), // 5k SOL
        liquidityUSD: new decimal_js_1.default(2000000), // $2M
        lastUpdate: Date.now(),
    });
    calculator.updatePoolLiquidity({
        poolId: "pool_2_raydium_usdc_sol",
        tokenAReserve: new decimal_js_1.default(2000000), // 2M USDC
        tokenBReserve: new decimal_js_1.default(10000), // 10k SOL
        liquidityUSD: new decimal_js_1.default(4000000), // $4M
        lastUpdate: Date.now(),
    });
    calculator.updatePoolLiquidity({
        poolId: "pool_3_raydium_clmm_usdc_sol",
        tokenAReserve: new decimal_js_1.default(500000), // 500k USDC
        tokenBReserve: new decimal_js_1.default(2500), // 2.5k SOL
        liquidityUSD: new decimal_js_1.default(1000000), // $1M
        lastUpdate: Date.now(),
    });
    // Hop 2 pools (SOL -> BONK)
    calculator.updatePoolLiquidity({
        poolId: "pool_4_raydium_sol_bonk",
        tokenAReserve: new decimal_js_1.default(1000), // 1k SOL
        tokenBReserve: new decimal_js_1.default(100000000000), // 100B BONK
        liquidityUSD: new decimal_js_1.default(400000), // $400k
        lastUpdate: Date.now(),
    });
    calculator.updatePoolLiquidity({
        poolId: "pool_5_orca_sol_bonk",
        tokenAReserve: new decimal_js_1.default(500), // 500 SOL
        tokenBReserve: new decimal_js_1.default(50000000000), // 50B BONK
        liquidityUSD: new decimal_js_1.default(200000), // $200k
        lastUpdate: Date.now(),
    });
    calculator.updatePoolLiquidity({
        poolId: "pool_6_meteora_sol_bonk",
        tokenAReserve: new decimal_js_1.default(800), // 800 SOL
        tokenBReserve: new decimal_js_1.default(80000000000), // 80B BONK
        liquidityUSD: new decimal_js_1.default(320000), // $320k
        lastUpdate: Date.now(),
    });
    // Hop 3 pools (BONK -> USDC)
    calculator.updatePoolLiquidity({
        poolId: "pool_7_raydium_bonk_usdc",
        tokenAReserve: new decimal_js_1.default(100000000000), // 100B BONK
        tokenBReserve: new decimal_js_1.default(2000000), // 2M USDC
        liquidityUSD: new decimal_js_1.default(4000000), // $4M
        lastUpdate: Date.now(),
    });
    calculator.updatePoolLiquidity({
        poolId: "pool_8_orca_bonk_usdc",
        tokenAReserve: new decimal_js_1.default(50000000000), // 50B BONK
        tokenBReserve: new decimal_js_1.default(1000000), // 1M USDC
        liquidityUSD: new decimal_js_1.default(2000000), // $2M
        lastUpdate: Date.now(),
    });
    calculator.updatePoolLiquidity({
        poolId: "pool_9_raydium_clmm_bonk_usdc",
        tokenAReserve: new decimal_js_1.default(80000000000), // 80B BONK
        tokenBReserve: new decimal_js_1.default(1600000), // 1.6M USDC
        liquidityUSD: new decimal_js_1.default(3200000), // $3.2M
        lastUpdate: Date.now(),
    });
    calculator.updatePoolLiquidity({
        poolId: "pool_10_meteora_bonk_usdc",
        tokenAReserve: new decimal_js_1.default(60000000000), // 60B BONK
        tokenBReserve: new decimal_js_1.default(1200000), // 1.2M USDC
        liquidityUSD: new decimal_js_1.default(2400000), // $2.4M
        lastUpdate: Date.now(),
    });
    // Generate all paths
    console.log("\n[Test] Generating 4-hop paths...");
    const paths = (0, FourHopConstants_1.generateFourHopPaths)();
    console.log(`✓ Generated ${paths.length} paths`);
    // Simulate all paths
    console.log("\n[Test] Simulating all paths with 100 USDC...");
    const tradeAmount = new decimal_js_1.default(100);
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
    }
    else {
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
