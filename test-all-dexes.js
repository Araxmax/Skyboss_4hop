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
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const dotenv = __importStar(require("dotenv"));
const MultiPathCalculator_1 = require("./MultiPathCalculator");
const MultiPathDataFetcher_1 = require("./MultiPathDataFetcher");
const MultiPathConstants_1 = require("./MultiPathConstants");
dotenv.config();
async function testAllDexes() {
    const RPC_URL = process.env.RPC_URL || "";
    if (!RPC_URL) {
        console.error("ERROR: RPC_URL not set in .env");
        process.exit(1);
    }
    const connection = new web3_js_1.Connection(RPC_URL, "confirmed");
    const calculator = new MultiPathCalculator_1.MultiPathCalculator();
    const dataFetcher = new MultiPathDataFetcher_1.MultiPathDataFetcher(connection, calculator, 5000);
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
        console.log(`\n${dexNames[dex]}:`);
        console.log("─".repeat(80));
        const dexPools = MultiPathConstants_1.ALL_POOLS.filter(p => p.dex === dex);
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
            }
            else {
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
    const workingPools = MultiPathConstants_1.ALL_POOLS.filter(p => calculator.getPoolLiquidity(p.id) !== null);
    const totalPools = MultiPathConstants_1.ALL_POOLS.length;
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
    const failedPools = MultiPathConstants_1.ALL_POOLS.filter(p => calculator.getPoolLiquidity(p.id) === null);
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
