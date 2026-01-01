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
const constants_1 = require("./constants");
dotenv.config();
async function checkWalletBalance() {
    try {
        // Load wallet
        const walletPath = process.env.WALLET_PATH || '';
        const secret = JSON.parse(fs_1.default.readFileSync(walletPath, 'utf8'));
        const wallet = web3_js_1.Keypair.fromSecretKey(new Uint8Array(secret));
        // Connect to RPC
        const connection = new web3_js_1.Connection(process.env.RPC_URL || '', 'confirmed');
        console.log('\n' + '='.repeat(70));
        console.log('WALLET BALANCE CHECK');
        console.log('='.repeat(70));
        console.log(`Wallet Address: ${wallet.publicKey.toBase58()}`);
        console.log('='.repeat(70));
        // Check SOL balance
        const solBalance = await connection.getBalance(wallet.publicKey);
        const solBalanceFormatted = (solBalance / web3_js_1.LAMPORTS_PER_SOL).toFixed(9);
        console.log(`\nSOL Balance: ${solBalanceFormatted} SOL ($${(parseFloat(solBalanceFormatted) * 124).toFixed(2)} USD)`);
        if (solBalance < 0.01 * web3_js_1.LAMPORTS_PER_SOL) {
            console.log(`❌ CRITICAL: Need at least 0.01 SOL for gas fees!`);
            console.log(`   Missing: ${(0.01 - parseFloat(solBalanceFormatted)).toFixed(9)} SOL`);
        }
        else {
            console.log(`✅ SOL balance sufficient for gas fees`);
        }
        // Check USDC balance
        try {
            const usdcMint = new web3_js_1.PublicKey(constants_1.USDC_MINT);
            const usdcTokenAccount = await (0, spl_token_1.getAssociatedTokenAddress)(usdcMint, wallet.publicKey);
            console.log(`\nUSDC Token Account: ${usdcTokenAccount.toBase58()}`);
            const accountInfo = await (0, spl_token_1.getAccount)(connection, usdcTokenAccount);
            const usdcBalance = Number(accountInfo.amount) / 1000000; // USDC has 6 decimals
            console.log(`USDC Balance: ${usdcBalance.toFixed(6)} USDC`);
            if (usdcBalance < 30) {
                console.log(`❌ CRITICAL: Need at least $30 USDC for trading!`);
                console.log(`   Missing: $${(30 - usdcBalance).toFixed(2)} USDC`);
            }
            else {
                console.log(`✅ USDC balance sufficient for $30 trades`);
            }
        }
        catch (error) {
            console.log(`\n❌ USDC Token Account: NOT FOUND OR NOT INITIALIZED`);
            console.log(`   Error: ${error.message}`);
            console.log(`\n   You need to:`);
            console.log(`   1. Create a USDC token account`);
            console.log(`   2. Deposit USDC to your wallet`);
        }
        console.log('\n' + '='.repeat(70));
        console.log('REQUIRED FOR TRADING:');
        console.log('='.repeat(70));
        console.log(`1. SOL: At least 0.01 SOL (~$1.24) for gas fees`);
        console.log(`2. USDC: At least $30 USDC for trading`);
        console.log(`3. USDC Token Account: Must be initialized`);
        console.log('='.repeat(70) + '\n');
    }
    catch (error) {
        console.error(`\n❌ ERROR: ${error.message}\n`);
        process.exit(1);
    }
}
checkWalletBalance();
