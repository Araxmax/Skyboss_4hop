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
const spl_token_1 = require("@solana/spl-token");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
/* =========================
   FETCH ORCA POOL INFO
   Find vault addresses for Orca Whirlpools
========================= */
async function fetchOrcaPoolInfo() {
    const RPC_URL = process.env.RPC_URL || "";
    if (!RPC_URL) {
        console.error("ERROR: RPC_URL not set in .env");
        process.exit(1);
    }
    const connection = new web3_js_1.Connection(RPC_URL, "confirmed");
    // Known Orca pool addresses from your constants
    const pools = [
        {
            name: "Orca USDC/SOL",
            address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        },
        {
            name: "Orca SOL/BONK",
            address: "EgJa7vKP6lYJWY67M8GQCXuJbGP1OZ3Gc2E5JStSeKzQ",
        },
        {
            name: "Orca USDC/BONK",
            address: "CdmkZQavBxHyXj1bqFrxvgZlH3gEZBxckTZvVAGRTmGE",
        },
    ];
    console.log("\n" + "=".repeat(80));
    console.log(" FETCHING ORCA POOL INFO");
    console.log("=".repeat(80));
    for (const pool of pools) {
        try {
            console.log(`\n${pool.name}:`);
            console.log(`  Pool Address: ${pool.address}`);
            const poolPubkey = new web3_js_1.PublicKey(pool.address);
            const poolAccountInfo = await connection.getAccountInfo(poolPubkey);
            if (!poolAccountInfo) {
                console.log(`   Pool account not found`);
                continue;
            }
            console.log(`   Pool account found`);
            console.log(`  Owner: ${poolAccountInfo.owner.toString()}`);
            console.log(`  Data length: ${poolAccountInfo.data.length} bytes`);
            if (poolAccountInfo.data.length >= 200) {
                try {
                    const tokenMintA = new web3_js_1.PublicKey(poolAccountInfo.data.slice(8, 40));
                    const tokenMintB = new web3_js_1.PublicKey(poolAccountInfo.data.slice(40, 72));
                    const tokenVaultA = new web3_js_1.PublicKey(poolAccountInfo.data.slice(101, 133));
                    const tokenVaultB = new web3_js_1.PublicKey(poolAccountInfo.data.slice(133, 165));
                    console.log(`  Token Mint A: ${tokenMintA.toString()}`);
                    console.log(`  Token Mint B: ${tokenMintB.toString()}`);
                    console.log(`  Token Vault A: ${tokenVaultA.toString()}`);
                    console.log(`  Token Vault B: ${tokenVaultB.toString()}`);
                    // Try to fetch vault balances
                    try {
                        const [vaultAInfo, vaultBInfo] = await Promise.all([
                            (0, spl_token_1.getAccount)(connection, tokenVaultA),
                            (0, spl_token_1.getAccount)(connection, tokenVaultB),
                        ]);
                        console.log(`  Vault A Balance: ${vaultAInfo.amount.toString()}`);
                        console.log(`  Vault B Balance: ${vaultBInfo.amount.toString()}`);
                    }
                    catch (vaultError) {
                        console.log(`    Could not fetch vault balances: ${vaultError.message}`);
                    }
                }
                catch (parseError) {
                    console.log(`    Could not parse pool layout: ${parseError.message}`);
                }
            }
            else {
                console.log(`    Data too short (${poolAccountInfo.data.length} bytes)`);
            }
        }
        catch (error) {
            console.error(`   Error: ${error.message}`);
        }
    }
    console.log("\n" + "=".repeat(80));
}
fetchOrcaPoolInfo().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
});
