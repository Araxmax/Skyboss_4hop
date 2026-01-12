"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRaydiumPrice = fetchRaydiumPrice;
exports.subscribeToRaydiumVaults = subscribeToRaydiumVaults;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const decimal_js_1 = __importDefault(require("decimal.js"));
/* =========================
   RAYDIUM PRICE FETCHER
========================= */
/**
 * Fetch price from Raydium AMM pool using vault balances
 * Price calculation: USDC balance / SOL balance
 */
async function fetchRaydiumPrice(connection, vaultA, vaultB) {
    try {
        const vaultAPubkey = new web3_js_1.PublicKey(vaultA);
        const vaultBPubkey = new web3_js_1.PublicKey(vaultB);
        const [vaultAInfo, vaultBInfo] = await Promise.all([
            (0, spl_token_1.getAccount)(connection, vaultAPubkey),
            (0, spl_token_1.getAccount)(connection, vaultBPubkey),
        ]);
        // SOL balance (vault A) in lamports -> convert to SOL
        const solBalance = new decimal_js_1.default(vaultAInfo.amount.toString()).div(1e9);
        // USDC balance (vault B) in micro-USDC -> convert to USDC
        const usdcBalance = new decimal_js_1.default(vaultBInfo.amount.toString()).div(1e6);
        // Price = USDC / SOL
        if (solBalance.isZero()) {
            console.error("Raydium: SOL vault balance is zero");
            return null;
        }
        const price = usdcBalance.div(solBalance);
        return price;
    }
    catch (error) {
        console.error(`Error fetching Raydium price: ${error.message}`);
        return null;
    }
}
/**
 * Subscribe to Raydium vault changes to get real-time price updates
 */
function subscribeToRaydiumVaults(connection, vaultA, vaultB, callback, commitment = "processed") {
    const vaultAPubkey = new web3_js_1.PublicKey(vaultA);
    const vaultBPubkey = new web3_js_1.PublicKey(vaultB);
    let lastVaultABalance = null;
    let lastVaultBBalance = null;
    // Subscribe to vault A (SOL)
    const subIdA = connection.onAccountChange(vaultAPubkey, (accountInfo) => {
        try {
            // Token account data layout: first 64 bytes are header, then 8 bytes for amount
            const amount = accountInfo.data.readBigUInt64LE(64);
            lastVaultABalance = amount;
            // Trigger price update if we have both balances
            if (lastVaultBBalance !== null) {
                const solBalance = new decimal_js_1.default(lastVaultABalance.toString()).div(1e9);
                const usdcBalance = new decimal_js_1.default(lastVaultBBalance.toString()).div(1e6);
                if (!solBalance.isZero()) {
                    const price = usdcBalance.div(solBalance);
                    callback(price);
                }
            }
        }
        catch (error) {
            console.error(`Error processing Raydium vault A update: ${error.message}`);
        }
    }, commitment);
    // Subscribe to vault B (USDC)
    const subIdB = connection.onAccountChange(vaultBPubkey, (accountInfo) => {
        try {
            const amount = accountInfo.data.readBigUInt64LE(64);
            lastVaultBBalance = amount;
            // Trigger price update if we have both balances
            if (lastVaultABalance !== null) {
                const solBalance = new decimal_js_1.default(lastVaultABalance.toString()).div(1e9);
                const usdcBalance = new decimal_js_1.default(lastVaultBBalance.toString()).div(1e6);
                if (!solBalance.isZero()) {
                    const price = usdcBalance.div(solBalance);
                    callback(price);
                }
            }
        }
        catch (error) {
            console.error(`Error processing Raydium vault B update: ${error.message}`);
        }
    }, commitment);
    // Return cleanup function
    return () => {
        connection.removeAccountChangeListener(subIdA);
        connection.removeAccountChangeListener(subIdB);
    };
}
