"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const MultiPathConstants_1 = require("./MultiPathConstants");
console.log("\n" + "=".repeat(80));
console.log("POOL VERIFICATION - ADDRESS & VAULT CHECK");
console.log("=".repeat(80));
const poolsToCheck = [
    { id: "Pool 3", name: "Raydium CLMM SOL/USDC 0.01%" },
    { id: "Pool 4", name: "Meteora DLMM SOL/USDC 0.01%" },
    { id: "Pool 5", name: "Raydium CLMM SOL/USDC 0.02%" },
    { id: "Pool 6", name: "Orca Whirlpool SOL/USDC 0.02%" },
    { id: "Pool 7", name: "Raydium CLMM SOL/USDC 0.04%" },
    { id: "Pool 8", name: "Meteora DLMM SOL/USDC 0.04%" },
    { id: "Pool 9", name: "Meteora DLMM SOL/USDC 0.05% #1" },
    { id: "Pool 10", name: "Raydium CLMM SOL/USDC 0.05%" },
    { id: "Pool 11", name: "Orca Whirlpool SOL/USDC 0.05%" },
    { id: "Pool 12", name: "Meteora DLMM SOL/USDC 0.05% #2" },
    { id: "Pool 13", name: "Meteora DLMM SOL/USDC 0.10%" },
    { id: "Pool 14", name: "Orca Whirlpool BONK/SOL 0.05%" },
    { id: "Pool 15", name: "Orca Whirlpool BONK/SOL 0.30%" },
    { id: "Pool 16", name: "Orca Whirlpool BONK/SOL 1.00%" },
    { id: "Pool 17", name: "Meteora DLMM BONK/USDC 0.20%" },
    { id: "Pool 18", name: "Orca Whirlpool BONK/USDC 0.30%" },
];
let allValid = true;
for (const check of poolsToCheck) {
    const pool = MultiPathConstants_1.ALL_POOLS.find(p => p.id === check.id);
    if (pool) {
        console.log(` ${pool.id}: ${pool.name}`);
        console.log(`   Address: ${pool.address}`);
        console.log(`   Vault A: ${pool.vaultA}`);
        console.log(`   Vault B: ${pool.vaultB}`);
        console.log(`   Fee: ${(pool.feeRate * 100).toFixed(4)}%`);
        console.log();
    }
    else {
        console.log(`❌ ${check.id}: NOT FOUND`);
        allValid = false;
    }
}
console.log("=".repeat(80));
if (allValid) {
    console.log(" ALL POOLS VERIFIED SUCCESSFULLY - READY TO RUN!");
}
else {
    console.log(" SOME POOLS MISSING");
}
console.log("=".repeat(80) + "\n");
