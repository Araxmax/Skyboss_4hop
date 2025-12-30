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
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const fs_1 = __importDefault(require("fs"));
const dotenv = __importStar(require("dotenv"));
const decimal_js_1 = __importDefault(require("decimal.js"));
const constants_1 = require("./constants");
dotenv.config();
/* =========================
   ENV VALIDATION
========================= */
const RPC_URL = process.env.RPC_URL;
const WALLET_PATH = process.env.WALLET_PATH;
if (!RPC_URL)
    throw new Error("RPC_URL missing in .env");
if (!WALLET_PATH)
    throw new Error("WALLET_PATH missing in .env");
/* =========================
   CONSTANTS
========================= */
const MIN_SOL_REQUIRED = new decimal_js_1.default(0.02);
const MIN_USDC_REQUIRED = new decimal_js_1.default(5);
/* =========================
   WALLET LOADING
========================= */
function loadWallet() {
    const secret = JSON.parse(fs_1.default.readFileSync(WALLET_PATH, "utf8"));
    return web3_js_1.Keypair.fromSecretKey(new Uint8Array(secret));
}
/* =========================
   MAIN
========================= */
async function main() {
    console.log("=== EXECUTOR PHASE 1: WALLET & SAFETY CHECK ===");
    const connection = new web3_js_1.Connection(RPC_URL, "confirmed");
    const wallet = loadWallet();
    console.log("Wallet Address:", wallet.publicKey.toBase58());
    /* ---------- BALANCE CHECKS (parallelized) ---------- */
    const [solLamports, usdcAta] = await Promise.all([
        connection.getBalance(wallet.publicKey),
        (0, spl_token_1.getAssociatedTokenAddress)(constants_1.USDC_MINT_PUBKEY, wallet.publicKey),
    ]);
    const solBalance = new decimal_js_1.default(solLamports).div(constants_1.DECIMAL_1E9);
    console.log("SOL Balance:", solBalance.toFixed(6));
    if (solBalance.lt(MIN_SOL_REQUIRED)) {
        throw new Error(`INSUFFICIENT SOL: Need at least ${MIN_SOL_REQUIRED.toString()} SOL`);
    }
    const usdcAccountInfo = await connection.getTokenAccountBalance(usdcAta);
    const usdcBalance = new decimal_js_1.default(usdcAccountInfo.value.uiAmount || 0);
    console.log("USDC Balance:", usdcBalance.toFixed(6));
    if (usdcBalance.lt(MIN_USDC_REQUIRED)) {
        throw new Error(`INSUFFICIENT USDC: Need at least ${MIN_USDC_REQUIRED.toString()} USDC`);
    }
    console.log("STATUS: WALLET & BALANCES OK");
    console.log("PHASE 1 COMPLETE — SAFE TO PROCEED");
}
main().catch((err) => {
    console.error("EXECUTOR HALTED:", err.message);
    process.exit(1);
});
