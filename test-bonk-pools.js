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
/* =========================
   TEST BONK POOLS
   Quick test to verify BONK pools are fetching correctly
========================= */
async function testBonkPools() {
    const RPC_URL = process.env.RPC_URL || "";
    if (!RPC_URL) {
        console.error("ERROR: RPC_URL not set in .env");
        process.exit(1);
    }
    const connection = new web3_js_1.Connection(RPC_URL, "confirmed");
    const calculator = new MultiPathCalculator_1.MultiPathCalculator();
    const dataFetcher = new MultiPathDataFetcher_1.MultiPathDataFetcher(connection, calculator, 5000);
    console.log("\n" + "=".repeat(80));
    console.log(" TESTING BONK POOL DATA FETCHING");
    console.log("=".repeat(80));
    // Start data fetcher
    console.log("\n[Test] Starting data fetcher...");
    dataFetcher.start();
    // Wait for initial fetch
    console.log("[Test] Waiting 8 seconds for pool data...");
    await new Promise(resolve => setTimeout(resolve, 8000));
    // Check token prices
    console.log("\n TOKEN PRICES:");
    console.log("─".repeat(80));
    const tokenPrices = dataFetcher.getTokenPrices();
    console.log(`  USDC: $${tokenPrices.get("USDC")?.toFixed(4) || "N/A"}`);
    console.log(`  SOL: $${tokenPrices.get("SOL")?.toFixed(4) || "N/A"}`);
    console.log(`  BONK: $${tokenPrices.get("BONK")?.toFixed(8) || "N/A"}`);
    // Check pool data
    console.log("\n POOL DATA:");
    console.log("─".repeat(80));
    const bonkPools = MultiPathConstants_1.ALL_POOLS.filter(p => p.tokenASymbol === "BONK" || p.tokenBSymbol === "BONK");
    for (const pool of bonkPools) {
        const liquidity = calculator.getPoolLiquidity(pool.id);
        console.log(`\n  ${pool.name}:`);
        console.log(`    ID: ${pool.id}`);
        console.log(`    DEX: ${pool.dex}`);
        console.log(`    Address: ${pool.address}`);
        if (liquidity) {
            console.log(`    ✅ Data fetched successfully`);
            console.log(`    Token A Reserve: ${liquidity.tokenAReserve.toFixed(2)}`);
            console.log(`    Token B Reserve: ${liquidity.tokenBReserve.toFixed(2)}`);
            console.log(`    Liquidity USD: $${liquidity.liquidityUSD.toFixed(0)}`);
            console.log(`    Price A->B: ${liquidity.priceAtoB.toFixed(9)}`);
            console.log(`    Price B->A: ${liquidity.priceBtoA.toFixed(9)}`);
        }
        else {
            console.log(`    ❌ No data available`);
            if (!pool.vaultA || !pool.vaultB || pool.vaultA === "" || pool.vaultB === "") {
                console.log(`    Reason: Missing vault addresses`);
            }
            else if (pool.dex === "meteora" || pool.dex === "phoenix") {
                console.log(`    Reason: SDK not implemented`);
            }
        }
    }
    console.log("\n" + "=".repeat(80));
    console.log(" SUMMARY");
    console.log("=".repeat(80));
    const workingPools = bonkPools.filter(p => calculator.getPoolLiquidity(p.id) !== null);
    const totalBonkPools = bonkPools.length;
    console.log(`\n  Total BONK pools: ${totalBonkPools}`);
    console.log(`  Working pools: ${workingPools.length}`);
    console.log(`  Failed pools: ${totalBonkPools - workingPools.length}`);
    if (workingPools.length > 0) {
        console.log(`\n  ✅ SUCCESS: ${workingPools.length} BONK pool(s) fetching data`);
        workingPools.forEach(p => {
            console.log(`     - ${p.name}`);
        });
    }
    const failedPools = bonkPools.filter(p => calculator.getPoolLiquidity(p.id) === null);
    if (failedPools.length > 0) {
        console.log(`\n  ⚠️  PENDING: ${failedPools.length} pool(s) need implementation`);
        failedPools.forEach(p => {
            console.log(`     - ${p.name} (${p.dex})`);
        });
    }
    console.log("\n" + "=".repeat(80));
    // Stop data fetcher
    dataFetcher.stop();
    process.exit(0);
}
testBonkPools().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
});
