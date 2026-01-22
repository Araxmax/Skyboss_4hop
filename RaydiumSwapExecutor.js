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
const bn_js_1 = __importDefault(require("bn.js"));
const dotenv = __importStar(require("dotenv"));
const constants_1 = require("./constants");
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
dotenv.config();
/* =========================
   RAYDIUM POOL CONFIGURATION
========================= */
// Raydium SOL/USDC Pool Keys (MainNet)
const RAYDIUM_SOL_USDC_POOL_KEYS = {
    id: new web3_js_1.PublicKey("58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"),
    baseMint: constants_1.SOL_MINT_PUBKEY,
    quoteMint: constants_1.USDC_MINT_PUBKEY,
    lpMint: new web3_js_1.PublicKey("8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaTUapubyvu"),
    baseDecimals: 9,
    quoteDecimals: 6,
    lpDecimals: 9,
    version: 4,
    programId: new web3_js_1.PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
    authority: new web3_js_1.PublicKey("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"),
    openOrders: new web3_js_1.PublicKey("HRk9CMrpq7Jn9sh7mzxE8CChHG8dneX9p475QKz4Fsfc"),
    targetOrders: new web3_js_1.PublicKey("CZza3Ej4Mc58MnxWA385itCC9jCo3L1D7zc3LKy1bZMR"),
    baseVault: new web3_js_1.PublicKey("DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz"),
    quoteVault: new web3_js_1.PublicKey("HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz"),
    withdrawQueue: new web3_js_1.PublicKey("G7xeGGLevkRwB5f44QNgQtrPKBdMfkT6ZZwpS9xcC97n"),
    lpVault: new web3_js_1.PublicKey("Awpt6N7ZYPBa4vG4BQNFhFxDj4sxExAA9rpBAoBw2uok"),
    marketVersion: 3,
    marketProgramId: new web3_js_1.PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
    marketId: new web3_js_1.PublicKey("9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT"),
    marketAuthority: new web3_js_1.PublicKey("F8Vyqk3unwxkXukZFQeYyGmFfTG3CAX4v24iyrjEYBJV"),
    marketBaseVault: new web3_js_1.PublicKey("36c6YqAwyGKQG66XEp2dJc5JqjaBNv7sVghEtJv4c7u6"),
    marketQuoteVault: new web3_js_1.PublicKey("8CFo8bL8mZQK8abbFyypFMwEDd8tVJjHTTojMLgQTUSZ"),
    marketBids: new web3_js_1.PublicKey("14ivtgssEBoBjuZJtSAPKYgpUK7DmnSwuPMqJoVTSgKJ"),
    marketAsks: new web3_js_1.PublicKey("CEQdAFKdycHugujQg9k2wbmxjcpdYZyVLfV9WerTnafJ"),
    marketEventQueue: new web3_js_1.PublicKey("5KKsLVU6TcbVDK4BS6K1DGDxnh4Q9xjYJ8XaDCG5t8ht"),
    lookupTableAccount: web3_js_1.PublicKey.default,
};
/* =========================
   RAYDIUM SWAP EXECUTOR
========================= */
class RaydiumSwapExecutor {
    constructor(rpcManager, wallet, maxRetries = 3, maxPriorityFee = 100000) {
        this.rpcManager = rpcManager;
        this.connection = rpcManager.getConnection();
        this.wallet = wallet;
        this.maxRetries = maxRetries;
        this.maxPriorityFee = maxPriorityFee;
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
            // Raydium AMM fee: 0.25% (0.0025) - SOL/USDC pool
            const FEE_RATE = 0.0025;
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
            console.log("\n" + "=".repeat(70));
            console.log("EXECUTING RAYDIUM SWAP");
            console.log("=".repeat(70));
            console.log(`Pool: ${poolAddress}`);
            console.log(`Input: ${amountIn.toString()} ${tokenIn}`);
            console.log(`Output: ${tokenIn === "SOL" ? "USDC" : "SOL"}`);
            console.log(`Slippage: ${(slippageTolerance * 100).toFixed(2)}%`);
            console.log("=".repeat(70));
            // Get swap quote
            const quote = await this.getRaydiumSwapQuote(poolAddress, vaultA, vaultB, amountIn, tokenIn, slippageTolerance);
            if (!quote) {
                return {
                    success: false,
                    error: "Failed to get swap quote",
                };
            }
            console.log(`\n[RAYDIUM] Quote received:`);
            console.log(`  Amount out: ${quote.amountOut} ${tokenIn === "SOL" ? "USDC" : "SOL"}`);
            console.log(`  Min amount out: ${quote.minAmountOut}`);
            console.log(`  Price impact: ${(quote.priceImpact * 100).toFixed(4)}%`);
            if (dryRun) {
                console.log("\n[RAYDIUM] DRY RUN: Skipping actual swap execution");
                return {
                    success: true,
                    amountIn: quote.amountIn,
                    amountOut: quote.amountOut,
                    priceImpact: quote.priceImpact,
                    executionTime: Date.now() - startTime,
                };
            }
            // Build and execute swap transaction
            console.log("\n[RAYDIUM] Building swap transaction...");
            // Get blockhash once and reuse it
            const latestBlockhash = await this.connection.getLatestBlockhash("processed");
            const transaction = await this.buildRaydiumSwapTransaction(amountIn, new decimal_js_1.default(quote.minAmountOut), tokenIn, latestBlockhash.blockhash);
            console.log("[RAYDIUM] Transaction built successfully");
            console.log("[RAYDIUM] Sending transaction...");
            // Sign transaction
            transaction.sign(this.wallet);
            // Send transaction with processed commitment for speed
            const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: false,
                preflightCommitment: "processed",
            });
            console.log(`[RAYDIUM] Transaction sent: ${signature}`);
            // Hybrid approach: WebSocket subscription (fast) + RPC fallback (reliable)
            // Reduces RPC calls from 30 to 1-3 max
            try {
                await new Promise((resolve, reject) => {
                    let subscriptionId;
                    let resolved = false;
                    const timeout = setTimeout(async () => {
                        if (!resolved) {
                            resolved = true;
                            if (subscriptionId !== undefined) {
                                this.connection.removeSignatureListener(subscriptionId);
                            }
                            // Fallback: Poll status with 3 attempts (max 3 RPC calls)
                            // This is much better than 30 calls and avoids rate limits
                            for (let i = 0; i < 3; i++) {
                                try {
                                    const status = await this.connection.getSignatureStatus(signature);
                                    if (status?.value?.confirmationStatus === 'processed' ||
                                        status?.value?.confirmationStatus === 'confirmed' ||
                                        status?.value?.confirmationStatus === 'finalized') {
                                        return resolve();
                                    }
                                    else if (status?.value?.err) {
                                        return reject(new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`));
                                    }
                                    // Wait 1s before next attempt (except on last)
                                    if (i < 2)
                                        await new Promise(r => setTimeout(r, 1000));
                                }
                                catch (err) {
                                    if (i === 2) {
                                        return reject(new Error(`Confirmation failed: ${err.message}`));
                                    }
                                }
                            }
                            reject(new Error('Confirmation timeout after 5s'));
                        }
                    }, 2000); // Check after 2s, then retry up to 3 times = max 5s total
                    subscriptionId = this.connection.onSignature(signature, (result) => {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            this.connection.removeSignatureListener(subscriptionId);
                            if (result.err) {
                                reject(new Error(`Transaction failed: ${JSON.stringify(result.err)}`));
                            }
                            else {
                                resolve();
                            }
                        }
                    }, 'processed');
                });
            }
            catch (error) {
                throw error;
            }
            const executionTime = Date.now() - startTime;
            console.log("\n" + "=".repeat(70));
            console.log("RAYDIUM SWAP COMPLETE");
            console.log("=".repeat(70));
            console.log(`Signature: ${signature}`);
            console.log(`Explorer: https://solscan.io/tx/${signature}`);
            console.log(`Execution time: ${executionTime}ms`);
            console.log("=".repeat(70));
            return {
                success: true,
                signature,
                amountIn: quote.amountIn,
                amountOut: quote.amountOut,
                priceImpact: quote.priceImpact,
                executionTime,
            };
        }
        catch (error) {
            console.error(`[RAYDIUM] Error executing swap: ${error.message}`);
            if (error.logs) {
                console.error(`[RAYDIUM] Transaction logs:`, error.logs);
            }
            return {
                success: false,
                error: error.message,
                executionTime: Date.now() - startTime,
            };
        }
    }
    /**
     * Build Raydium swap transaction using Raydium SDK
     */
    async buildRaydiumSwapTransaction(amountIn, minAmountOut, tokenIn, recentBlockhash) {
        try {
            // Create Token objects
            const solToken = new raydium_sdk_1.Token(spl_token_1.TOKEN_PROGRAM_ID, constants_1.SOL_MINT_PUBKEY, 9, "SOL", "Wrapped SOL");
            const usdcToken = new raydium_sdk_1.Token(spl_token_1.TOKEN_PROGRAM_ID, constants_1.USDC_MINT_PUBKEY, 6, "USDC", "USD Coin");
            // Determine input/output tokens
            const tokenInObj = tokenIn === "SOL" ? solToken : usdcToken;
            const tokenOutObj = tokenIn === "SOL" ? usdcToken : solToken;
            // Convert amounts to TokenAmount
            const amountInRaw = new bn_js_1.default(amountIn.mul(10 ** tokenInObj.decimals).floor().toString());
            const minAmountOutRaw = new bn_js_1.default(minAmountOut.mul(10 ** tokenOutObj.decimals).floor().toString());
            const tokenAmountIn = new raydium_sdk_1.TokenAmount(tokenInObj, amountInRaw);
            const tokenAmountOutMin = new raydium_sdk_1.TokenAmount(tokenOutObj, minAmountOutRaw);
            // Get associated token accounts
            const userSourceTokenAccount = await (0, spl_token_1.getAssociatedTokenAddress)(tokenInObj.mint, this.wallet.publicKey);
            const userDestinationTokenAccount = await (0, spl_token_1.getAssociatedTokenAddress)(tokenOutObj.mint, this.wallet.publicKey);
            // Fetch RAW account info for both token accounts IN PARALLEL (faster)
            const [sourceAccountInfoRaw, destinationAccountInfoRaw] = await Promise.all([
                this.connection.getAccountInfo(userSourceTokenAccount),
                this.connection.getAccountInfo(userDestinationTokenAccount)
            ]);
            if (!sourceAccountInfoRaw || !sourceAccountInfoRaw.data) {
                throw new Error(`Source token account not found: ${userSourceTokenAccount.toBase58()}`);
            }
            if (!destinationAccountInfoRaw || !destinationAccountInfoRaw.data) {
                throw new Error(`Destination token account not found: ${userDestinationTokenAccount.toBase58()}`);
            }
            // Decode using SPL_ACCOUNT_LAYOUT (required by Raydium SDK)
            const sourceAccountInfo = raydium_sdk_1.SPL_ACCOUNT_LAYOUT.decode(sourceAccountInfoRaw.data);
            const destinationAccountInfo = raydium_sdk_1.SPL_ACCOUNT_LAYOUT.decode(destinationAccountInfoRaw.data);
            // Build tokenAccounts array following SDK examples
            const tokenAccounts = [
                {
                    programId: spl_token_1.TOKEN_PROGRAM_ID,
                    pubkey: userSourceTokenAccount,
                    accountInfo: sourceAccountInfo,
                },
                {
                    programId: spl_token_1.TOKEN_PROGRAM_ID,
                    pubkey: userDestinationTokenAccount,
                    accountInfo: destinationAccountInfo,
                },
            ];
            // Build swap instruction using correct API with properly decoded account info
            const swapInstruction = await raydium_sdk_1.Liquidity.makeSwapInstructionSimple({
                connection: this.connection,
                poolKeys: RAYDIUM_SOL_USDC_POOL_KEYS,
                userKeys: {
                    tokenAccounts: tokenAccounts,
                    owner: this.wallet.publicKey,
                },
                amountIn: tokenAmountIn,
                amountOut: tokenAmountOutMin,
                fixedSide: "in",
                makeTxVersion: 0, // Use legacy transaction
                config: {
                    bypassAssociatedCheck: false,
                },
            });
            // Use provided blockhash or fetch new one (avoid double fetch)
            const blockhash = recentBlockhash || (await this.connection.getLatestBlockhash("processed")).blockhash;
            // Create transaction
            const transaction = new web3_js_1.Transaction();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.wallet.publicKey;
            // Add priority fee and compute budget (matching Orca for speed)
            if (this.maxPriorityFee > 0) {
                transaction.add(web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: this.maxPriorityFee,
                }));
                transaction.add(web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({
                    units: 600000, // Match Orca for consistent priority
                }));
            }
            // Add swap instructions from innerTransactions
            if (swapInstruction.innerTransactions && swapInstruction.innerTransactions.length > 0) {
                for (const innerTx of swapInstruction.innerTransactions) {
                    transaction.add(...innerTx.instructions);
                    // Add signers if any
                    if (innerTx.signers && innerTx.signers.length > 0) {
                        transaction.partialSign(...innerTx.signers);
                    }
                }
            }
            return transaction;
        }
        catch (error) {
            console.error(`[RAYDIUM] Error building transaction: ${error.message}`);
            throw error;
        }
    }
    /**
     * Build Raydium swap instructions WITHOUT executing (for atomic transactions)
     * Returns instructions and quote information
     */
    async buildRaydiumSwapInstructions(poolAddress, vaultA, vaultB, amountIn, tokenIn, slippageTolerance = 0.03) {
        try {
            console.log("[RAYDIUM] Building swap instructions (no execution)...");
            // Get quote
            const quote = await this.getRaydiumSwapQuote(poolAddress, vaultA, vaultB, amountIn, tokenIn, slippageTolerance);
            if (!quote) {
                throw new Error("Failed to get Raydium swap quote");
            }
            console.log(`[RAYDIUM] Quote: ${quote.amountOut} output, ${(quote.priceImpact * 100).toFixed(4)}% impact`);
            // Build transaction to extract instructions
            const transaction = await this.buildRaydiumSwapTransaction(amountIn, new decimal_js_1.default(quote.minAmountOut), tokenIn);
            // Extract instructions (skip compute budget instructions if present)
            const instructions = transaction.instructions.filter(ix => !ix.programId.equals(web3_js_1.ComputeBudgetProgram.programId));
            console.log(`[RAYDIUM] Extracted ${instructions.length} swap instructions`);
            return {
                instructions,
                quote,
            };
        }
        catch (error) {
            console.error(`[RAYDIUM] Error building instructions: ${error.message}`);
            throw error;
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
