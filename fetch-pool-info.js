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
dotenv.config();
/* =========================
   FETCH POOL INFO SCRIPT
   Helps find vault addresses for pools
========================= */
async function fetchPoolInfo() {
    const RPC_URL = process.env.RPC_URL || "";
    if (!RPC_URL) {
        console.error("ERROR: RPC_URL not set in .env");
        process.exit(1);
    }
    const connection = new web3_js_1.Connection(RPC_URL, "confirmed");
    // Known pool addresses from web search
    const pools = [
        {
            name: "Raydium SOL/BONK",
            address: "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv",
        },
        {
            name: "Raydium USDC/BONK",
            address: "G7mw1d83ismcQJKkzt62Ug4noXCjVhu3eV7U5EMgge6Z",
        },
        {
            name: "Orca SOL/BONK",
            address: "EgJa7vKP6lYJWY67M8GQCXuJbGP1OZ3Gc2E5JStSeKzQ", // From your constants
        },
    ];
    console.log("\n" + "=".repeat(80));
    console.log(" FETCHING POOL INFO FROM SOLANA");
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
            // For Raydium AMM pools, the layout is:
            // - Bytes 0-7: Status
            // - Bytes 8-39: Nonce (32 bytes)
            // - Bytes 40-71: Order num (32 bytes)
            // - Bytes 72-79: Depth (8 bytes)
            // - Bytes 80-87: Base lot size (8 bytes)
            // - Bytes 88-95: Quote lot size (8 bytes)
            // - Bytes 96-103: Fee numerator (8 bytes)
            // - Bytes 104-111: Fee denominator (8 bytes)
            // - Bytes 112-119: Base mint decimals (8 bytes)
            // - Bytes 120-127: Quote mint decimals (8 bytes)
            // - Bytes 128-159: Base vault (32 bytes)
            // - Bytes 160-191: Quote vault (32 bytes)
            // - Bytes 192-223: Base mint (32 bytes)
            // - Bytes 224-255: Quote mint (32 bytes)
            if (poolAccountInfo.data.length >= 256) {
                try {
                    // Try to parse as Raydium AMM
                    const baseVault = new web3_js_1.PublicKey(poolAccountInfo.data.slice(128, 160));
                    const quoteVault = new web3_js_1.PublicKey(poolAccountInfo.data.slice(160, 192));
                    const baseMint = new web3_js_1.PublicKey(poolAccountInfo.data.slice(192, 224));
                    const quoteMint = new web3_js_1.PublicKey(poolAccountInfo.data.slice(224, 256));
                    console.log(`  Base Mint: ${baseMint.toString()}`);
                    console.log(`  Quote Mint: ${quoteMint.toString()}`);
                    console.log(`  Base Vault: ${baseVault.toString()}`);
                    console.log(`  Quote Vault: ${quoteVault.toString()}`);
                }
                catch (parseError) {
                    console.log(`    Could not parse pool layout: ${parseError.message}`);
                }
            }
            else {
                console.log(`    Data too short for Raydium AMM layout (${poolAccountInfo.data.length} bytes)`);
            }
        }
        catch (error) {
            console.error(`   Error: ${error.message}`);
        }
    }
    console.log("\n" + "=".repeat(80));
}
fetchPoolInfo().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
});
