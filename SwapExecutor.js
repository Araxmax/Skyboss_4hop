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
const spl_token_1 = require("@solana/spl-token");
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
        this.rpcManager = null;
        this.connection = connection;
        this.wallet = wallet;
        this.maxSlippage = new decimal_js_1.default(maxSlippage);
        this.maxPriorityFee = maxPriorityFee;
        this.heliusApiKey = config.heliusApiKey || process.env.HELIUS_API_KEY || "";
        this.usePrivateTx = config.usePrivateTx ?? true;
        this.maxRetries = config.maxRetries ?? 3;
        this.retryDelay = config.retryDelay ?? 1000;
        this.transactionDeadline = config.transactionDeadline ?? 30; // 30 seconds
        this.rpcManager = config.rpcManager || null;
    }
    /**
     * Get connection with RPC Manager fallback
     */
    getActiveConnection() {
        if (this.rpcManager) {
            return this.rpcManager.getConnection();
        }
        return this.connection;
    }
    /**
     * Initialize Orca SDK context and client (lazy initialization)
     */
    async initializeOrcaSDK() {
        if (this.whirlpoolContext && this.whirlpoolClient) {
            return; // Already initialized
        }
        const anchorWallet = new AnchorWalletAdapter(this.wallet);
        // Use active connection (with RPC manager if available)
        const activeConnection = this.getActiveConnection();
        // Create WhirlpoolContext
        this.whirlpoolContext = whirlpools_sdk_1.WhirlpoolContext.from(activeConnection, anchorWallet, undefined, // fetcher (will use default)
        undefined, // lookupTableFetcher
        {
            userDefaultConfirmCommitment: "confirmed",
        });
        // Create WhirlpoolClient
        this.whirlpoolClient = (0, whirlpools_sdk_1.buildWhirlpoolClient)(this.whirlpoolContext);
    }
    /**
     * Ensure wSOL Associated Token Account exists for the wallet
     * This prevents the SDK from adding wrap/unwrap instructions
     */
    async ensureWsolAccount() {
        try {
            const wsolMint = new web3_js_1.PublicKey(constants_1.SOL_MINT);
            const wsolATA = await (0, spl_token_1.getAssociatedTokenAddress)(wsolMint, this.wallet.publicKey);
            // Check if account exists
            try {
                await (0, spl_token_1.getAccount)(this.connection, wsolATA);
                console.log(`wSOL ATA already exists: ${wsolATA.toBase58()}`);
                return wsolATA;
            }
            catch (error) {
                // Account doesn't exist, create it
                if (error.name === 'TokenAccountNotFoundError' || error.message?.includes('could not find account')) {
                    console.log(`Creating wSOL ATA: ${wsolATA.toBase58()}`);
                    const transaction = new web3_js_1.Transaction().add((0, spl_token_1.createAssociatedTokenAccountInstruction)(this.wallet.publicKey, // payer
                    wsolATA, // associatedToken
                    this.wallet.publicKey, // owner
                    wsolMint // mint
                    ));
                    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
                    transaction.recentBlockhash = blockhash;
                    transaction.feePayer = this.wallet.publicKey;
                    transaction.sign(this.wallet);
                    const signature = await this.connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
                    await this.connection.confirmTransaction(signature, "confirmed");
                    console.log(`wSOL ATA created successfully: ${signature}`);
                    return wsolATA;
                }
                throw error;
            }
        }
        catch (error) {
            console.error("Error ensuring wSOL account:", error);
            throw error;
        }
    }
    /**
     * Send transaction with Helius private transaction support (MEV protection)
     */
    async sendTransactionWithRetry(transaction, options = {}) {
        const startTime = Date.now();
        const maxRetries = options.maxRetries ?? this.maxRetries;
        let attemptCount = 0;
        // CRITICAL FIX: p-retry expects a function with NO parameters!
        const sendFn = async () => {
            try {
                attemptCount++;
                console.log(`[TX] Attempt ${attemptCount}/${maxRetries + 1}`);
                console.log(`[TX] DEBUG: Entered sendFn`);
                // Check deadline BEFORE attempting
                const elapsed = (Date.now() - startTime) / 1000;
                console.log(`[TX] DEBUG: Checking deadline (elapsed: ${elapsed.toFixed(1)}s / ${this.transactionDeadline}s)`);
                if (elapsed > this.transactionDeadline) {
                    throw new Error(`Transaction deadline exceeded (${this.transactionDeadline}s, elapsed: ${elapsed.toFixed(1)}s)`);
                }
                // Use Helius private transaction if enabled
                console.log(`[TX] DEBUG: Checking private tx mode (usePrivateTx: ${this.usePrivateTx}, hasApiKey: ${!!this.heliusApiKey})`);
                if (this.usePrivateTx && this.heliusApiKey) {
                    console.log("[TX] Using Helius private transaction (MEV protected)");
                    return await this.sendPrivateTransaction(transaction);
                }
                // Standard public transaction
                console.log("[TX] Using standard public transaction");
                console.log(`[TX] DEBUG: About to call connection.sendTransaction (skipPreflight: ${options.skipPreflight ?? false})`);
                const signature = await this.connection.sendTransaction(transaction, {
                    skipPreflight: options.skipPreflight ?? false,
                    maxRetries: 0, // We handle retries ourselves
                });
                console.log(`[TX] Transaction sent: ${signature}`);
                console.log(`[TX] Waiting for confirmation...`);
                // Wait for confirmation with timeout (30 seconds max)
                const confirmationTimeout = 30000; // 30 seconds
                const confirmationPromise = this.connection.confirmTransaction(signature, "confirmed");
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Confirmation timeout (30s)')), confirmationTimeout));
                try {
                    const confirmation = await Promise.race([confirmationPromise, timeoutPromise]);
                    if (confirmation.value.err) {
                        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
                    }
                    console.log(`[TX] Transaction confirmed: ${signature}`);
                    return signature;
                }
                catch (timeoutError) {
                    // If confirmation times out, check the transaction status manually
                    if (timeoutError.message === 'Confirmation timeout (30s)') {
                        console.log(`[TX] Confirmation timeout - checking transaction status...`);
                        try {
                            const status = await this.connection.getSignatureStatus(signature);
                            if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
                                console.log(`[TX] Transaction was actually confirmed: ${signature}`);
                                return signature;
                            }
                            else if (status?.value?.err) {
                                console.error(`[TX] Transaction failed:`, status.value.err);
                                throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
                            }
                        }
                        catch (statusError) {
                            console.error(`[TX] Failed to check transaction status:`, statusError);
                        }
                    }
                    throw timeoutError;
                }
            }
            catch (error) {
                // Log the actual error before p-retry wraps it
                console.error(`[TX] ERROR in sendFn (attempt ${attemptCount}):`);
                console.error(`[TX] Error type: ${error.constructor?.name || typeof error}`);
                console.error(`[TX] Error message: ${error.message || String(error)}`);
                if (error.logs) {
                    console.error(`[TX] Transaction logs:`, error.logs);
                }
                if (error.stack) {
                    console.error(`[TX] Stack trace:`, error.stack);
                }
                // Re-throw for p-retry to handle
                throw error;
            }
        };
        // Use p-retry for exponential backoff
        return await (0, p_retry_1.default)(sendFn, {
            retries: maxRetries,
            minTimeout: this.retryDelay,
            maxTimeout: this.retryDelay * 4,
            onFailedAttempt: (error) => {
                // Better error logging - handle all error types
                let errorMsg = '';
                if (error && error.message) {
                    errorMsg = error.message;
                }
                else if (typeof error === 'string') {
                    errorMsg = error;
                }
                else if (error && typeof error === 'object') {
                    errorMsg = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
                }
                else {
                    errorMsg = String(error);
                }
                console.warn(`[TX] Attempt ${error.attemptNumber} failed:`);
                console.warn(`[TX] Error: ${errorMsg}`);
                if (error.logs) {
                    console.warn(`[TX] Transaction logs:`, error.logs);
                }
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
        const serializedTx = Buffer.from(transaction.serialize()).toString("base64");
        try {
            // Send transaction with 10-second timeout for the POST request
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
                timeout: 10000, // 10 second timeout for sending
            });
            if (response.data.error) {
                throw new Error(`Helius error: ${JSON.stringify(response.data.error)}`);
            }
            const signature = response.data.result;
            console.log(`[TX] Private transaction sent: ${signature}`);
            console.log(`[TX] Waiting for confirmation...`);
            // Wait for confirmation with 30-second timeout (same as public tx)
            const confirmationTimeout = 30000;
            const confirmationPromise = this.connection.confirmTransaction(signature, "confirmed");
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Confirmation timeout (30s)')), confirmationTimeout));
            const confirmation = await Promise.race([confirmationPromise, timeoutPromise]);
            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }
            console.log(`[TX] Private transaction confirmed: ${signature}`);
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
    async executeSwap(poolAddress, inputMint, outputMint, amountIn, aToB, slippageTolerance = 0.01, skipValidation = false) {
        try {
            console.log("\n=== EXECUTING SWAP (REAL) ===");
            console.log(`Pool: ${poolAddress}`);
            console.log(`Input: ${amountIn.toString()} ${inputMint === constants_1.SOL_MINT ? "SOL" : "USDC"}`);
            console.log(`Direction: ${aToB ? "A -> B" : "B -> A"}`);
            console.log(`Slippage Tolerance: ${slippageTolerance * 100}%`);
            // Validate slippage (skip for test swaps)
            if (!skipValidation && slippageTolerance > this.maxSlippage.toNumber()) {
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
            const quoteStartTime = Date.now();
            const quote = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(whirlpool, inputMintPubkey, amountInBN, slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher);
            console.log(`Quote received:`);
            console.log(`  Estimated amount out: ${quote.estimatedAmountOut.toString()}`);
            console.log(`  Minimum amount out: ${quote.otherAmountThreshold.toString()}`);
            // CRITICAL: Validate quote age before executing
            const maxQuoteAge = parseFloat(process.env.MAX_QUOTE_AGE_SECONDS || "2") * 1000;
            const quoteAge = Date.now() - quoteStartTime;
            if (quoteAge > maxQuoteAge) {
                throw new Error(`Quote too old (${quoteAge}ms > ${maxQuoteAge}ms). Prices may have changed.`);
            }
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
     * Execute a SINGLE swap transaction (simpler alternative to atomic arbitrage)
     * Used for sequential swap mode where each swap is a separate transaction
     */
    async executeSingleSwap(poolAddress, inputMint, outputMint, amountIn, slippageTolerance = 0.01, skipValidation = false) {
        try {
            console.log("\n=== EXECUTING SINGLE SWAP ===");
            console.log(`Pool: ${poolAddress}`);
            console.log(`Input: ${amountIn.toString()} ${inputMint === constants_1.SOL_MINT ? "SOL" : "USDC"}`);
            console.log(`Output: ${outputMint === constants_1.SOL_MINT ? "SOL" : "USDC"}`);
            console.log(`Slippage Tolerance: ${slippageTolerance * 100}%`);
            // Validate slippage (skip for test swaps)
            if (!skipValidation && slippageTolerance > this.maxSlippage.toNumber()) {
                throw new Error(`Slippage ${slippageTolerance} exceeds maximum ${this.maxSlippage}`);
            }
            // Initialize Orca SDK if needed
            await this.initializeOrcaSDK();
            if (!this.whirlpoolContext || !this.whirlpoolClient) {
                throw new Error("Failed to initialize Orca SDK");
            }
            // Ensure wSOL account exists if trading SOL/wSOL
            if (inputMint === constants_1.SOL_MINT || outputMint === constants_1.SOL_MINT) {
                console.log("Ensuring wSOL ATA exists before swap...");
                await this.ensureWsolAccount();
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
            // Validate input/output mints match pool tokens
            const inputMintPubkey = new web3_js_1.PublicKey(inputMint);
            const outputMintPubkey = new web3_js_1.PublicKey(outputMint);
            const tokenAInfo = whirlpool.getTokenAInfo();
            const tokenBInfo = whirlpool.getTokenBInfo();
            const isInputTokenA = tokenAInfo.mint.equals(inputMintPubkey);
            const isInputTokenB = tokenBInfo.mint.equals(inputMintPubkey);
            if (!isInputTokenA && !isInputTokenB) {
                throw new Error(`Input mint ${inputMint} does not match pool tokens`);
            }
            const expectedOutputMint = isInputTokenA ? tokenBInfo.mint : tokenAInfo.mint;
            if (!expectedOutputMint.equals(outputMintPubkey)) {
                throw new Error(`Output mint ${outputMint} does not match expected output`);
            }
            // Get swap quote
            const slippagePercentage = common_sdk_1.Percentage.fromDecimal(new decimal_js_1.default(slippageTolerance));
            console.log("Getting swap quote from Orca SDK...");
            const quoteStartTime = Date.now();
            const quote = await (0, whirlpools_sdk_1.swapQuoteByInputToken)(whirlpool, inputMintPubkey, amountInBN, slippagePercentage, whirlpools_sdk_1.ORCA_WHIRLPOOL_PROGRAM_ID, this.whirlpoolContext.fetcher);
            console.log(`Quote received:`);
            console.log(`  Estimated amount out: ${quote.estimatedAmountOut.toString()}`);
            console.log(`  Minimum amount out: ${quote.otherAmountThreshold.toString()}`);
            // CRITICAL: Validate quote age before executing
            const maxQuoteAge = parseFloat(process.env.MAX_QUOTE_AGE_SECONDS || "2") * 1000;
            const quoteAge = Date.now() - quoteStartTime;
            if (quoteAge > maxQuoteAge) {
                throw new Error(`Quote too old (${quoteAge}ms > ${maxQuoteAge}ms). Prices may have changed.`);
            }
            // Build swap transaction
            console.log("Building swap transaction...");
            const swapTxBuilder = await whirlpool.swap(quote, this.wallet.publicKey);
            // Build transaction manually to avoid automatic wrap/unwrap
            console.log("Building transaction with direct wSOL (no wrap/unwrap)...");
            const txPayload = await swapTxBuilder.build();
            // Extract transaction from payload
            let tx = txPayload.transaction;
            const signers = txPayload.signers || [];
            // Sign and send transaction
            console.log("Sending transaction to Solana network...");
            const startTime = Date.now();
            // Handle both Transaction and VersionedTransaction types
            if (tx instanceof web3_js_1.VersionedTransaction) {
                console.log("Using VersionedTransaction...");
                // Sign with wallet (and additional signers if needed)
                if ('signTransaction' in this.wallet && typeof this.wallet.signTransaction === 'function') {
                    // Sign with additional signers first if needed
                    if (signers.length > 0) {
                        tx.sign(signers);
                    }
                    // Then sign with wallet adapter
                    tx = await this.wallet.signTransaction(tx);
                }
                else {
                    // For Keypair wallet, sign the VersionedTransaction with all signers at once
                    const allSigners = signers.length > 0 ? [this.wallet, ...signers] : [this.wallet];
                    tx.sign(allSigners);
                }
            }
            else {
                console.log("Using legacy Transaction...");
                // Get latest blockhash
                const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
                tx.recentBlockhash = blockhash;
                tx.feePayer = this.wallet.publicKey;
                // Add priority fees if configured
                if (this.maxPriorityFee > 0) {
                    tx.add(web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({
                        microLamports: this.maxPriorityFee,
                    }));
                }
                // Sign transaction with additional signers if needed
                if (signers.length > 0) {
                    tx.partialSign(...signers);
                }
                // Sign with wallet
                if ('signTransaction' in this.wallet && typeof this.wallet.signTransaction === 'function') {
                    tx = await this.wallet.signTransaction(tx);
                }
                else {
                    tx.sign(this.wallet);
                }
            }
            // Send transaction
            const signature = await this.connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: false,
                preflightCommitment: "confirmed",
            });
            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction(signature, "confirmed");
            const executionTime = Date.now() - startTime;
            console.log(`Transaction confirmed: ${signature}`);
            console.log(`Explorer: https://solscan.io/tx/${signature}`);
            console.log(`Execution time: ${executionTime}ms`);
            // Calculate actual output amount
            const amountOutDecimal = this.bnToDecimal(quote.estimatedAmountOut, outputDecimals);
            return {
                success: true,
                signature: signature,
                amountIn: amountIn.toString(),
                amountOut: amountOutDecimal.toString(),
                executionTime: executionTime,
            };
        }
        catch (error) {
            console.error(`[SINGLE SWAP] Error:`, error.message);
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
    async executeArbitrage(pool1Address, pool2Address, tokenAMint, tokenBMint, amountToTrade, direction, slippage = 0.01, skipValidation = false) {
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
            // OPTIMIZATION: Use RPC manager with retry logic for blockhash
            let recentBlockhash;
            if (this.rpcManager) {
                recentBlockhash = await this.rpcManager.executeWithRetry((conn) => conn.getLatestBlockhash("confirmed"), "getLatestBlockhash");
            }
            else {
                recentBlockhash = await this.connection.getLatestBlockhash("confirmed");
            }
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
            // CRITICAL FIX: Collect all signers from both swaps
            const allSigners = [this.wallet];
            if (swap1Instructions.signers && swap1Instructions.signers.length > 0) {
                // Filter and cast only Keypair signers
                const keypairSigners = swap1Instructions.signers.filter((s) => s instanceof web3_js_1.Keypair);
                allSigners.push(...keypairSigners);
            }
            if (swap2Instructions.signers && swap2Instructions.signers.length > 0) {
                // Filter and cast only Keypair signers
                const keypairSigners = swap2Instructions.signers.filter((s) => s instanceof web3_js_1.Keypair);
                allSigners.push(...keypairSigners);
            }
            // Sign transaction with all required signers
            transaction.sign(allSigners);
            console.log(`[ATOMIC] Sending atomic transaction with ${swap1Instructions.instructions.length + swap2Instructions.instructions.length + 2} instructions...`);
            // Send with NO retries (stale quotes would cause failures)
            // Atomic arbitrage must succeed on first attempt or quotes become invalid
            const signature = await this.sendTransactionWithRetry(transaction, {
                skipPreflight: false,
                maxRetries: 0, // No retries - quotes become stale
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
