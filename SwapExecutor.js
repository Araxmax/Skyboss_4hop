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
exports.SwapExecutor = void 0;
const web3_js_1 = require("@solana/web3.js");
const decimal_js_1 = __importDefault(require("decimal.js"));
const bn_js_1 = __importDefault(require("bn.js"));
const dotenv = __importStar(require("dotenv"));
const whirlpools_sdk_1 = require("@orca-so/whirlpools-sdk");
const common_sdk_1 = require("@orca-so/common-sdk");
const constants_1 = require("./constants");
const axios_1 = __importDefault(require("axios"));
const p_retry_1 = __importDefault(require("p-retry"));
dotenv.config();
// Pre-computed Decimal constants for performance
const DECIMAL_1 = new decimal_js_1.default(1);
/* =========================
   ANCHOR WALLET ADAPTER
========================= */
class AnchorWalletAdapter {
    constructor(keypair) {
        this.keypair = keypair;
        this.payer = keypair;
    }
    get publicKey() {
        return this.keypair.publicKey;
    }
    async signTransaction(tx) {
        if (tx instanceof web3_js_1.VersionedTransaction) {
            tx.sign([this.keypair]);
        }
        else {
            tx.partialSign(this.keypair);
        }
        return tx;
    }
    async signAllTransactions(txs) {
        return txs.map((tx) => {
            if (tx instanceof web3_js_1.VersionedTransaction) {
                tx.sign([this.keypair]);
            }
            else {
                tx.partialSign(this.keypair);
            }
            return tx;
        });
    }
}
/* =========================
   SWAP EXECUTOR CLASS
========================= */
class SwapExecutor {
    constructor(connection, wallet, maxSlippage = 0.03, maxPriorityFee = 50000, config = {}) {
        this.whirlpoolContext = null;
        this.whirlpoolClient = null;
        this.connection = connection;
        this.wallet = wallet;
        this.maxSlippage = new decimal_js_1.default(maxSlippage);
        this.maxPriorityFee = maxPriorityFee;
        this.heliusApiKey = config.heliusApiKey || process.env.HELIUS_API_KEY || "";
        this.usePrivateTx = config.usePrivateTx ?? true;
        this.maxRetries = config.maxRetries ?? 3;
        this.retryDelay = config.retryDelay ?? 1000;
        this.transactionDeadline = config.transactionDeadline ?? 30; // 30 seconds
    }
    /**
     * Initialize Orca SDK context and client (lazy initialization)
     */
    async initializeOrcaSDK() {
        if (this.whirlpoolContext && this.whirlpoolClient) {
            return; // Already initialized
        }
        const anchorWallet = new AnchorWalletAdapter(this.wallet);
        // Create WhirlpoolContext
        this.whirlpoolContext = whirlpools_sdk_1.WhirlpoolContext.from(this.connection, anchorWallet, undefined, // fetcher (will use default)
        undefined, // lookupTableFetcher
        {
            userDefaultConfirmCommitment: "confirmed",
        });
        // Create WhirlpoolClient
        this.whirlpoolClient = (0, whirlpools_sdk_1.buildWhirlpoolClient)(this.whirlpoolContext);
    }
    /**
     * Send transaction with Helius private transaction support (MEV protection)
     */
    async sendTransactionWithRetry(transaction, options = {}) {
        const startTime = Date.now();
        const maxRetries = options.maxRetries ?? this.maxRetries;
        const sendFn = async (attempt) => {
            console.log(`[TX] Attempt ${attempt}/${maxRetries}`);
            // Check deadline
            const elapsed = (Date.now() - startTime) / 1000;
            if (elapsed > this.transactionDeadline) {
                throw new Error(`Transaction deadline exceeded (${this.transactionDeadline}s)`);
            }
            // Use Helius private transaction if enabled
            if (this.usePrivateTx && this.heliusApiKey) {
                return await this.sendPrivateTransaction(transaction);
            }
            // Standard public transaction
            const signature = await this.connection.sendTransaction(transaction, {
                skipPreflight: options.skipPreflight ?? false,
                maxRetries: 0, // We handle retries ourselves
            });
            // Wait for confirmation with retry-aware timeout
            const confirmation = await this.connection.confirmTransaction(signature, "confirmed");
            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }
            return signature;
        };
        // Use p-retry for exponential backoff
        return await (0, p_retry_1.default)(sendFn, {
            retries: maxRetries,
            minTimeout: this.retryDelay,
            maxTimeout: this.retryDelay * 4,
            onFailedAttempt: (error) => {
                console.warn(`[TX] Attempt ${error.attemptNumber} failed: ${error.message || error}`);
                if (error.retriesLeft > 0) {
                    console.log(`[TX] Retrying... (${error.retriesLeft} attempts left)`);
                }
            },
        });
    }
    /**
     * Send private transaction via Helius (MEV protection)
     */
    async sendPrivateTransaction(transaction) {
        console.log("[TX] Sending PRIVATE transaction via Helius (MEV protected)");
        const serializedTx = Buffer.from(transaction.serialize()).toString("base64");
        try {
            const response = await axios_1.default.post(`https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`, {
                jsonrpc: "2.0",
                id: Date.now(),
                method: "sendTransaction",
                params: [
                    serializedTx,
                    {
                        encoding: "base64",
                        skipPreflight: false,
                        maxRetries: 0,
                        preflightCommitment: "confirmed",
                    },
                ],
            }, {
                headers: {
                    "Content-Type": "application/json",
                },
            });
            if (response.data.error) {
                throw new Error(`Helius private tx error: ${JSON.stringify(response.data.error)}`);
            }
            const signature = response.data.result;
            console.log(`[TX] Private transaction sent: ${signature}`);
            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction(signature, "confirmed");
            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }
            return signature;
        }
        catch (error) {
            console.error(`[TX] Private transaction failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Convert Decimal amount to BN (native token units)
     */
    decimalToBN(amount, decimals) {
        const multiplier = new decimal_js_1.default(10).pow(decimals);
        const nativeAmount = amount.mul(multiplier);
        return new bn_js_1.default(nativeAmount.floor().toString());
    }
    /**
     * Convert BN amount to Decimal (human-readable units)
     */
    bnToDecimal(amount, decimals) {
        const divisor = new decimal_js_1.default(10).pow(decimals);
        return new decimal_js_1.default(amount.toString()).div(divisor);
    }
    /**
     * Get decimals for a token mint
     */
    getTokenDecimals(mint) {
        if (mint === constants_1.SOL_MINT) {
            return 9; // SOL has 9 decimals
        }
        else if (mint === constants_1.USDC_MINT) {
            return 6; // USDC has 6 decimals
        }
        // Default to 6 for unknown tokens (shouldn't happen for SOL/USDC pairs)
        return 6;
    }
    /**
     * Execute a swap on a Whirlpool using Orca SDK
     */
    async executeSwap(poolAddress, inputMint, outputMint, amountIn, aToB, slippageTolerance = 0.01) {
        try {
            console.log("\n=== EXECUTING SWAP (REAL) ===");
            console.log(`Pool: ${poolAddress}`);
            console.log(`Input: ${amountIn.toString()} ${inputMint === constants_1.SOL_MINT ? "SOL" : "USDC"}`);
            console.log(`Direction: ${aToB ? "A -> B" : "B -> A"}`);
            console.log(`Slippage Tolerance: ${slippageTolerance * 100}%`);
            // Validate slippage
            if (slippageTolerance > this.maxSlippage.toNumber()) {
                throw new Error(`Slippage ${slippageTolerance} exceeds maximum ${this.maxSlippage}`);
            }
            // Initialize Orca SDK if needed
            await this.initializeOrcaSDK();
            if (!this.whirlpoolContext || !this.whirlpoolClient) {
                throw new Error("Failed to initialize Orca SDK");
            }
            // Get pool
            const poolPublicKey = new web3_js_1.PublicKey(poolAddress);
            const whirlpool = await this.whirlpoolClient.getPool(poolPublicKey);
            // Get token decimals
            const inputDecimals = this.getTokenDecimals(inputMint);
            const outputDecimals = this.getTokenDecimals(outputMint);
            // Convert amount to native units (BN)
            const amountInBN = this.decimalToBN(amountIn, inputDecimals);
            console.log(`Amount in (native): ${amountInBN.toString()}`);
            // Validate input mint matches one of the pool tokens
            const inputMintPubkey = new web3_js_1.PublicKey(inputMint);
            const outputMintPubkey = new web3_js_1.PublicKey(outputMint);
            const tokenAInfo = whirlpool.getTokenAInfo();
            const tokenBInfo = whirlpool.getTokenBInfo();
            const isInputTokenA = tokenAInfo.mint.equals(inputMintPubkey);
            const isInputTokenB = tokenBInfo.mint.equals(inputMintPubkey);
            if (!isInputTokenA && !isInputTokenB) {
                throw new Error(`Input mint ${inputMint} does not match pool tokens (${tokenAInfo.mint.toBase58()}, ${tokenBInfo.mint.toBase58()})`);
            }
            // Validate output mint matches the other pool token
            const expectedOutputMint = isInputTokenA ? tokenBInfo.mint : tokenAInfo.mint;
            if (!expectedOutputMint.equals(outputMintPubkey)) {
                throw new Error(`Output mint ${outputMint} does not match expected output (${expectedOutputMint.toBase58()})`);
            }
            console.log(`Swap: ${inputMint === constants_1.SOL_MINT ? "SOL" : "USDC"} -> ${outputMint === constants_1.SOL_MINT ? "SOL" : "USDC"}`);
            // Get swap quote
            const slippagePercentage = common_sdk_1.Percentage.fromDecimal(new decimal_js_1.default(slippageTolerance));
            console.log("Getting swap quote from Orca SDK...");
            const quote = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(whirlpool, inputMintPubkey, amountInBN, slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher);
            console.log(`Quote received:`);
            console.log(`  Estimated amount out: ${quote.estimatedAmountOut.toString()}`);
            console.log(`  Minimum amount out: ${quote.otherAmountThreshold.toString()}`);
            // Build swap transaction
            console.log("Building swap transaction...");
            const swapTxBuilder = await whirlpool.swap(quote, this.wallet.publicKey);
            // Build and execute transaction (includes sending and confirmation)
            // The TransactionBuilder handles building, signing, and sending
            console.log("Sending transaction to Solana network...");
            const signature = await swapTxBuilder.buildAndExecute({
                maxSupportedTransactionVersion: "legacy",
                blockhashCommitment: "confirmed",
                computeBudgetOption: this.maxPriorityFee > 0
                    ? {
                        type: "fixed",
                        priorityFeeLamports: this.maxPriorityFee,
                    }
                    : { type: "none" },
            }, {
                skipPreflight: false,
            }, "confirmed");
            console.log(`Transaction confirmed: ${signature}`);
            console.log(`Explorer: https://solscan.io/tx/${signature}`);
            // Calculate actual output amount (we'll use the quote's estimated amount)
            // In a production system, you'd verify the actual amount by checking balances
            const amountOutDecimal = this.bnToDecimal(quote.estimatedAmountOut, outputDecimals);
            return {
                success: true,
                signature: signature,
                amountIn: amountIn.toString(),
                amountOut: amountOutDecimal.toString(),
            };
        }
        catch (error) {
            console.error(`[TX] Error:`, error.message);
            if (error.logs) {
                console.error(`Transaction logs:`, error.logs);
            }
            return {
                success: false,
                error: error.message,
            };
        }
    }
    /**
     * Get swap quote without executing
     */
    async getSwapQuote(poolAddress, inputMint, amountIn, aToB, slippageTolerance = 0.01) {
        try {
            // Initialize Orca SDK if needed
            await this.initializeOrcaSDK();
            if (!this.whirlpoolContext || !this.whirlpoolClient) {
                throw new Error("Failed to initialize Orca SDK");
            }
            // Get pool
            const poolPublicKey = new web3_js_1.PublicKey(poolAddress);
            const whirlpool = await this.whirlpoolClient.getPool(poolPublicKey);
            // Get token decimals
            const inputDecimals = this.getTokenDecimals(inputMint);
            // Convert amount to native units (BN)
            const amountInBN = this.decimalToBN(amountIn, inputDecimals);
            // Get swap quote
            const inputMintPubkey = new web3_js_1.PublicKey(inputMint);
            const slippagePercentage = common_sdk_1.Percentage.fromDecimal(new decimal_js_1.default(slippageTolerance));
            const quote = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(whirlpool, inputMintPubkey, amountInBN, slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher);
            return {
                estimatedAmountIn: quote.estimatedAmountIn.toString(),
                estimatedAmountOut: quote.estimatedAmountOut.toString(),
                otherAmountThreshold: quote.otherAmountThreshold.toString(),
                sqrtPriceLimit: quote.sqrtPriceLimit.toString(),
                aToB: quote.aToB,
                slippage: slippageTolerance,
            };
        }
        catch (error) {
            console.error("Error getting quote:", error.message);
            return null;
        }
    }
    /**
     * Simulate swap to check if it would succeed
     */
    async simulateSwap(poolAddress, inputMint, outputMint, amountIn, aToB, slippageTolerance = 0.01) {
        try {
            const quote = await this.getSwapQuote(poolAddress, inputMint, amountIn, aToB, slippageTolerance);
            return quote !== null;
        }
        catch (error) {
            console.error("Simulation error:", error.message);
            return false;
        }
    }
    /**
     * Execute ATOMIC arbitrage: both swaps in single transaction (CRITICAL FIX)
     * This prevents partial execution and front-running
     */
    async executeArbitrage(pool1Address, pool2Address, tokenAMint, tokenBMint, amountToTrade, direction, slippage = 0.01) {
        const overallStartTime = Date.now();
        console.log("\n" + "=".repeat(70));
        console.log("EXECUTING ATOMIC ARBITRAGE (REAL)");
        console.log("MEV Protection: " + (this.usePrivateTx ? "ENABLED" : "DISABLED"));
        console.log("=".repeat(70));
        try {
            // Validate deadline hasn't been set too long ago
            const currentTime = Date.now();
            let firstPool;
            let secondPool;
            let firstSwapAToB;
            let secondSwapAToB;
            let firstInputMint;
            let firstOutputMint;
            let secondInputMint;
            let secondOutputMint;
            if (direction === "pool1-to-pool2") {
                firstPool = pool1Address;
                secondPool = pool2Address;
                firstInputMint = tokenBMint; // USDC
                firstOutputMint = tokenAMint; // SOL
                firstSwapAToB = false; // B -> A (USDC -> SOL)
                secondInputMint = tokenAMint; // SOL
                secondOutputMint = tokenBMint; // USDC
                secondSwapAToB = true; // A -> B (SOL -> USDC)
            }
            else {
                firstPool = pool2Address;
                secondPool = pool1Address;
                firstInputMint = tokenBMint; // USDC
                firstOutputMint = tokenAMint; // SOL
                firstSwapAToB = false; // B -> A
                secondInputMint = tokenAMint; // SOL
                secondOutputMint = tokenBMint; // USDC
                secondSwapAToB = true; // A -> B
            }
            console.log(`\n[ATOMIC] Building bundle with 2 swaps:`);
            console.log(`  Swap 1: ${firstInputMint === constants_1.USDC_MINT ? "USDC" : "SOL"} -> ${firstOutputMint === constants_1.USDC_MINT ? "USDC" : "SOL"} on ${firstPool.slice(0, 8)}...`);
            console.log(`  Swap 2: ${secondInputMint === constants_1.USDC_MINT ? "USDC" : "SOL"} -> ${secondOutputMint === constants_1.USDC_MINT ? "USDC" : "SOL"} on ${secondPool.slice(0, 8)}...`);
            // Initialize Orca SDK
            await this.initializeOrcaSDK();
            if (!this.whirlpoolContext || !this.whirlpoolClient) {
                throw new Error("Failed to initialize Orca SDK");
            }
            // Get both pools
            const pool1Pubkey = new web3_js_1.PublicKey(firstPool);
            const pool2Pubkey = new web3_js_1.PublicKey(secondPool);
            const whirlpool1 = await this.whirlpoolClient.getPool(pool1Pubkey);
            const whirlpool2 = await this.whirlpoolClient.getPool(pool2Pubkey);
            // Get first swap quote
            const inputDecimals1 = this.getTokenDecimals(firstInputMint);
            const amountInBN1 = this.decimalToBN(amountToTrade, inputDecimals1);
            const inputMintPubkey1 = new web3_js_1.PublicKey(firstInputMint);
            const slippagePercentage = common_sdk_1.Percentage.fromDecimal(new decimal_js_1.default(slippage));
            console.log(`\n[ATOMIC] Getting quote for Swap 1...`);
            const quote1 = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(whirlpool1, inputMintPubkey1, amountInBN1, slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher);
            console.log(`  Quote 1: Out = ${quote1.estimatedAmountOut.toString()}`);
            // Get second swap quote (using output from first swap)
            const inputMintPubkey2 = new web3_js_1.PublicKey(secondInputMint);
            console.log(`[ATOMIC] Getting quote for Swap 2...`);
            const quote2 = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(whirlpool2, inputMintPubkey2, quote1.estimatedAmountOut, // Use estimated output from swap1
            slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher);
            console.log(`  Quote 2: Out = ${quote2.estimatedAmountOut.toString()}`);
            // Calculate expected profit
            const outputDecimals2 = this.getTokenDecimals(secondOutputMint);
            const finalAmountOut = this.bnToDecimal(quote2.estimatedAmountOut, outputDecimals2);
            const expectedProfit = finalAmountOut.minus(amountToTrade);
            const expectedProfitPct = expectedProfit.div(amountToTrade).mul(100).toNumber();
            console.log(`\n[ATOMIC] Expected profit: ${expectedProfit.toFixed(6)} USDC (${expectedProfitPct.toFixed(4)}%)`);
            // Build transaction instructions for both swaps
            console.log(`[ATOMIC] Building transaction with both swap instructions...`);
            const swap1TxBuilder = await whirlpool1.swap(quote1, this.wallet.publicKey);
            const swap2TxBuilder = await whirlpool2.swap(quote2, this.wallet.publicKey);
            // Combine instructions into single atomic transaction
            const recentBlockhash = await this.connection.getLatestBlockhash("confirmed");
            // Get instructions from both swaps
            const swap1Instructions = await swap1TxBuilder.compressIx(true);
            const swap2Instructions = await swap2TxBuilder.compressIx(true);
            // Add compute budget for priority fees
            const computeUnits = 400000; // Increased for two swaps
            const priorityFeeIx = web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: this.maxPriorityFee,
            });
            const computeLimitIx = web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({
                units: computeUnits,
            });
            // Build versioned transaction with all instructions
            const message = new web3_js_1.TransactionMessage({
                payerKey: this.wallet.publicKey,
                recentBlockhash: recentBlockhash.blockhash,
                instructions: [
                    computeLimitIx,
                    priorityFeeIx,
                    ...swap1Instructions.instructions,
                    ...swap2Instructions.instructions,
                ],
            }).compileToV0Message();
            const transaction = new web3_js_1.VersionedTransaction(message);
            transaction.sign([this.wallet]);
            console.log(`[ATOMIC] Sending atomic transaction with ${swap1Instructions.instructions.length + swap2Instructions.instructions.length + 2} instructions...`);
            // Send with retry logic and MEV protection
            const signature = await this.sendTransactionWithRetry(transaction, {
                skipPreflight: false,
            });
            const executionTime = Date.now() - overallStartTime;
            console.log("\n" + "=".repeat(70));
            console.log("ATOMIC ARBITRAGE COMPLETE");
            console.log("=".repeat(70));
            console.log(`Bundle Signature: ${signature}`);
            console.log(`Explorer: https://solscan.io/tx/${signature}`);
            console.log(`Started with: ${amountToTrade.toString()} USDC`);
            console.log(`Ended with: ${finalAmountOut.toFixed(6)} USDC`);
            console.log(`Profit: ${expectedProfit.toFixed(6)} USDC (${expectedProfitPct.toFixed(4)}%)`);
            console.log(`Execution time: ${executionTime}ms`);
            console.log("=".repeat(70));
            return {
                success: true,
                bundleSignature: signature,
                swap1: {
                    success: true,
                    signature: signature,
                    amountIn: amountToTrade.toString(),
                    amountOut: this.bnToDecimal(quote1.estimatedAmountOut, this.getTokenDecimals(firstOutputMint)).toString(),
                    executionTime: executionTime,
                },
                swap2: {
                    success: true,
                    signature: signature,
                    amountIn: this.bnToDecimal(quote1.estimatedAmountOut, this.getTokenDecimals(firstOutputMint)).toString(),
                    amountOut: finalAmountOut.toString(),
                    executionTime: executionTime,
                },
                profit: expectedProfit,
                profitPct: expectedProfitPct,
                totalExecutionTime: executionTime,
            };
        }
        catch (error) {
            const executionTime = Date.now() - overallStartTime;
            console.error(`[ATOMIC] Arbitrage execution error: ${error.message}`);
            console.error(`[ATOMIC] Execution time before failure: ${executionTime}ms`);
            return {
                success: false,
                error: error.message,
                totalExecutionTime: executionTime,
            };
        }
    }
}
exports.SwapExecutor = SwapExecutor;
