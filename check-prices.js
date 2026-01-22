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
async function checkPools() {
    const connection = new web3_js_1.Connection(process.env.RPC_URL || "", "confirmed");
    // Orca USDC/SOL
    const orcaVaultA = new web3_js_1.PublicKey("2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP");
    const orcaVaultB = new web3_js_1.PublicKey("EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9");
    // Raydium USDC/SOL
    const raydiumVaultA = new web3_js_1.PublicKey("HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz");
    const raydiumVaultB = new web3_js_1.PublicKey("DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz");
    console.log("Fetching pool data...\n");
    const [orcaA, orcaB, raydiumA, raydiumB] = await Promise.all([
        (0, spl_token_1.getAccount)(connection, orcaVaultA),
        (0, spl_token_1.getAccount)(connection, orcaVaultB),
        (0, spl_token_1.getAccount)(connection, raydiumVaultA),
        (0, spl_token_1.getAccount)(connection, raydiumVaultB),
    ]);
    const orcaUSDC = Number(orcaA.amount) / 1e6;
    const orcaSOL = Number(orcaB.amount) / 1e9;
    const orcaPrice = orcaUSDC / orcaSOL;
    const raydiumUSDC = Number(raydiumA.amount) / 1e6;
    const raydiumSOL = Number(raydiumB.amount) / 1e9;
    const raydiumPrice = raydiumUSDC / raydiumSOL;
    console.log("Orca USDC/SOL:");
    console.log("  USDC Reserve:", orcaUSDC.toFixed(2));
    console.log("  SOL Reserve:", orcaSOL.toFixed(2));
    console.log("  Price: $" + orcaPrice.toFixed(4) + " per SOL");
    console.log("\nRaydium USDC/SOL:");
    console.log("  USDC Reserve:", raydiumUSDC.toFixed(2));
    console.log("  SOL Reserve:", raydiumSOL.toFixed(2));
    console.log("  Price: $" + raydiumPrice.toFixed(4) + " per SOL");
    console.log("\nPrice Difference:");
    const diff = Math.abs(orcaPrice - raydiumPrice);
    const diffPct = (diff / Math.min(orcaPrice, raydiumPrice)) * 100;
    console.log("  Absolute: $" + diff.toFixed(4));
    console.log("  Percentage: " + diffPct.toFixed(4) + "%");
    // Simulate 100 USDC swap
    console.log("\n\nSimulating 100 USDC arbitrage:");
    console.log("Step 1: Buy SOL on Orca with 100 USDC");
    const orcaFee = 0.0004;
    const usdcAfterFee = 100 * (1 - orcaFee);
    const solOut = (orcaSOL * usdcAfterFee) / (orcaUSDC + usdcAfterFee);
    console.log("  Input: 100 USDC (fee: " + (orcaFee * 100) + "%)");
    console.log("  Output: " + solOut.toFixed(6) + " SOL");
    console.log("\nStep 2: Sell SOL on Raydium");
    const raydiumFee = 0.0025;
    const solAfterFee = solOut * (1 - raydiumFee);
    const usdcOut = (raydiumUSDC * solAfterFee) / (raydiumSOL + solAfterFee);
    console.log("  Input: " + solOut.toFixed(6) + " SOL (fee: " + (raydiumFee * 100) + "%)");
    console.log("  Output: " + usdcOut.toFixed(6) + " USDC");
    console.log("\nResult:");
    const profit = usdcOut - 100;
    const profitPct = (profit / 100) * 100;
    console.log("  Net Profit: " + profit.toFixed(6) + " USDC (" + profitPct.toFixed(4) + "%)");
    if (profitPct > 50) {
        console.log("\n⚠️  WARNING: Profit is unrealistically high!");
        console.log("This suggests a bug in the calculation or data.");
    }
}
checkPools().catch(console.error);
