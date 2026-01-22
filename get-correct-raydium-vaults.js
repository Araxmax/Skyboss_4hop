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
async function getRaydiumVaults() {
    const connection = new web3_js_1.Connection(process.env.RPC_URL || "", "confirmed");
    const poolAddress = new web3_js_1.PublicKey("58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2");
    console.log("Fetching Raydium USDC/SOL pool data...\n");
    console.log("Pool:", poolAddress.toString());
    const poolAccountInfo = await connection.getAccountInfo(poolAddress);
    if (!poolAccountInfo) {
        console.log("Pool not found!");
        return;
    }
    console.log("Owner:", poolAccountInfo.owner.toString());
    console.log("Data length:", poolAccountInfo.data.length, "bytes\n");
    // Parse Raydium AMM layout
    const baseMint = new web3_js_1.PublicKey(poolAccountInfo.data.slice(192, 224));
    const quoteMint = new web3_js_1.PublicKey(poolAccountInfo.data.slice(224, 256));
    const baseVault = new web3_js_1.PublicKey(poolAccountInfo.data.slice(128, 160));
    const quoteVault = new web3_js_1.PublicKey(poolAccountInfo.data.slice(160, 192));
    console.log("Base Mint (should be SOL):", baseMint.toString());
    console.log("Quote Mint (should be USDC):", quoteMint.toString());
    console.log("\nBase Vault:", baseVault.toString());
    console.log("Quote Vault:", quoteVault.toString());
    // Expected values
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    console.log("\n✓ Check:");
    if (baseMint.toString() === SOL_MINT) {
        console.log("  Base is SOL ✅");
    }
    else {
        console.log("  Base is NOT SOL ❌ (Got:", baseMint.toString() + ")");
    }
    if (quoteMint.toString() === USDC_MINT) {
        console.log("  Quote is USDC ✅");
    }
    else {
        console.log("  Quote is NOT USDC ❌ (Got:", quoteMint.toString() + ")");
    }
}
getRaydiumVaults().catch(console.error);
