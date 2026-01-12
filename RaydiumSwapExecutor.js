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
exports.RaydiumSwapExecutor = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const decimal_js_1 = __importDefault(require("decimal.js"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
/* =========================
   RAYDIUM SWAP EXECUTOR
========================= */
class RaydiumSwapExecutor {
    constructor(rpcManager, wallet, maxRetries = 3) {
        this.rpcManager = rpcManager;
        this.connection = rpcManager.getConnection();
        this.wallet = wallet;
        this.maxRetries = maxRetries;
    }
    /**
     * Fetch current price from Raydium AMM pool
     */
    async fetchRaydiumPrice(poolAddress, vaultA, vaultB) {
        try {
            // Fetch vault balances
            const vaultAPubkey = new web3_js_1.PublicKey(vaultA);
            const vaultBPubkey = new web3_js_1.PublicKey(vaultB);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            // SOL balance (vault A) in lamports
            const solBalance = new decimal_js_1.default(vaultAInfo.amount.toString()).div(1e9);
            // USDC balance (vault B) in micro-USDC
            const usdcBalance = new decimal_js_1.default(vaultBInfo.amount.toString()).div(1e6);
            // Price = USDC / SOL
            if (solBalance.isZero()) {
                console.error("SOL vault balance is zero");
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
     * Get swap quote from Raydium AMM
     * This is a simplified calculation based on constant product formula (x * y = k)
     */
    async getRaydiumSwapQuote(poolAddress, vaultA, vaultB, amountIn, tokenIn, slippageTolerance = 0.03) {
        try {
            // Fetch vault balances
            const vaultAPubkey = new web3_js_1.PublicKey(vaultA);
            const vaultBPubkey = new web3_js_1.PublicKey(vaultB);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                (0, spl_token_1.getAccount)(this.connection, vaultAPubkey),
                (0, spl_token_1.getAccount)(this.connection, vaultBPubkey),
            ]);
            const reserveSOL = new decimal_js_1.default(vaultAInfo.amount.toString()).div(1e9);
            const reserveUSDC = new decimal_js_1.default(vaultBInfo.amount.toString()).div(1e6);
            // Raydium AMM fee: 0.04% (0.0004)
            const FEE_RATE = 0.0004;
            let amountOut;
            let priceImpact;
            if (tokenIn === "USDC") {
                // Buying SOL with USDC
                // amountOut = (reserveSOL * amountIn * (1 - fee)) / (reserveUSDC + amountIn * (1 - fee))
                const amountInAfterFee = amountIn.mul(1 - FEE_RATE);
                amountOut = reserveSOL.mul(amountInAfterFee).div(reserveUSDC.add(amountInAfterFee));
                // Price impact = (amountIn / reserveUSDC)
                priceImpact = amountIn.div(reserveUSDC).toNumber();
            }
            else {
                // Selling SOL for USDC
                // amountOut = (reserveUSDC * amountIn * (1 - fee)) / (reserveSOL + amountIn * (1 - fee))
                const amountInAfterFee = amountIn.mul(1 - FEE_RATE);
                amountOut = reserveUSDC.mul(amountInAfterFee).div(reserveSOL.add(amountInAfterFee));
                // Price impact = (amountIn / reserveSOL)
                priceImpact = amountIn.div(reserveSOL).toNumber();
            }
            // Calculate minimum amount out with slippage
            const minAmountOut = amountOut.mul(1 - slippageTolerance);
            return {
                amountIn: amountIn.toString(),
                amountOut: amountOut.toString(),
                minAmountOut: minAmountOut.toString(),
                priceImpact,
            };
        }
        catch (error) {
            console.error(`Error getting Raydium swap quote: ${error.message}`);
            return null;
        }
    }
    /**
     * Execute swap on Raydium AMM pool
     */
    async executeRaydiumSwap(poolAddress, vaultA, vaultB, amountIn, tokenIn, slippageTolerance = 0.03, dryRun = false) {
        const startTime = Date.now();
        try {
            // Get swap quote
            const quote = await this.getRaydiumSwapQuote(poolAddress, vaultA, vaultB, amountIn, tokenIn, slippageTolerance);
            if (!quote) {
                return {
                    success: false,
                    error: "Failed to get swap quote",
                };
            }
            console.log(`Raydium swap quote: ${amountIn} ${tokenIn} -> ${quote.amountOut} ${tokenIn === "SOL" ? "USDC" : "SOL"}`);
            console.log(`Price impact: ${(quote.priceImpact * 100).toFixed(4)}%`);
            if (dryRun) {
                console.log("DRY RUN: Skipping actual swap execution");
                return {
                    success: true,
                    amountIn: quote.amountIn,
                    amountOut: quote.amountOut,
                    priceImpact: quote.priceImpact,
                    executionTime: Date.now() - startTime,
                };
            }
            // In production, you would use Raydium SDK to build and send the swap transaction
            // For now, this is a placeholder that shows the structure
            console.warn("⚠️ Raydium swap execution not fully implemented - requires Raydium SDK transaction building");
            console.log("You need to implement the actual swap transaction using @raydium-io/raydium-sdk");
            // TODO: Implement actual Raydium swap transaction
            // This would involve:
            // 1. Building the swap instruction using Raydium SDK
            // 2. Creating associated token accounts if needed
            // 3. Adding compute budget and priority fee
            // 4. Signing and sending the transaction
            // 5. Confirming the transaction
            return {
                success: false,
                error: "Raydium swap execution not yet implemented - placeholder only",
                amountIn: quote.amountIn,
                amountOut: quote.amountOut,
                priceImpact: quote.priceImpact,
                executionTime: Date.now() - startTime,
            };
        }
        catch (error) {
            console.error(`Error executing Raydium swap: ${error.message}`);
            return {
                success: false,
                error: error.message,
                executionTime: Date.now() - startTime,
            };
        }
    }
    /**
     * Check if token account exists, create if not
     */
    async ensureTokenAccount(mint, owner) {
        const ata = await (0, spl_token_1.getAssociatedTokenAddress)(mint, owner);
        try {
            await (0, spl_token_1.getAccount)(this.connection, ata);
            return { address: ata };
        }
        catch (error) {
            // Account doesn't exist, create instruction
            const instruction = (0, spl_token_1.createAssociatedTokenAccountInstruction)(owner, ata, owner, mint);
            return { address: ata, instruction };
        }
    }
}
exports.RaydiumSwapExecutor = RaydiumSwapExecutor;
