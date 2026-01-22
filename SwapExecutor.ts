import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import Decimal from "decimal.js";
import BN from "bn.js";
import * as dotenv from "dotenv";
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
  ORCA_WHIRLPOOL_PROGRAM_ID,
} from "@orca-so/whirlpools-sdk";
import type { Wallet } from "@coral-xyz/anchor/dist/cjs/provider";
import { Percentage } from "@orca-so/common-sdk";
import { SOL_MINT, USDC_MINT, PREDEFINED_POOLS } from "./constants";
import axios from "axios";
import pRetry from "p-retry";
import { RpcConnectionManager } from "./RpcConnectionManager";
import { RaydiumSwapExecutor } from "./RaydiumSwapExecutor";

dotenv.config();

// Pre-computed Decimal constants for performance
const DECIMAL_1 = new Decimal(1);

/* =========================
   TYPES
========================= */

interface SwapQuote {
  estimatedAmountIn: string;
  estimatedAmountOut: string;
  otherAmountThreshold: string;
  sqrtPriceLimit: string;
  aToB: boolean;
  slippage: number;
}

interface SwapResult {
  success: boolean;
  signature?: string;
  error?: string;
  amountIn?: string;
  amountOut?: string;
  outputAmount?: any;  // Alias for amountOut for backward compatibility
  actualSlippage?: number;
  priceImpact?: number;
  executionTime?: number;
}

interface ArbitrageResult {
  success: boolean;
  swap1?: SwapResult;
  swap2?: SwapResult;
  error?: string;
  profit?: Decimal;
  profitPct?: number;
  totalExecutionTime?: number;
  bundleSignature?: string;
}

/* =========================
   ANCHOR WALLET ADAPTER
========================= */

class AnchorWalletAdapter implements Wallet {
  readonly payer?: Keypair;

  constructor(private keypair: Keypair) {
    this.payer = keypair;
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this.keypair]);
    } else {
      tx.partialSign(this.keypair);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    return txs.map((tx) => {
      if (tx instanceof VersionedTransaction) {
        tx.sign([this.keypair]);
      } else {
        tx.partialSign(this.keypair);
      }
      return tx;
    });
  }
}

/* =========================
   SWAP EXECUTOR CLASS
========================= */

export class SwapExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private maxSlippage: Decimal;
  private maxPriorityFee: number;
  private whirlpoolContext: WhirlpoolContext | null = null;
  private whirlpoolClient: ReturnType<typeof buildWhirlpoolClient> | null = null;
  private raydiumExecutor: RaydiumSwapExecutor | null = null;
  private heliusApiKey: string;
  private usePrivateTx: boolean;
  private maxRetries: number;
  private retryDelay: number;
  private transactionDeadline: number; // seconds
  private rpcManager: RpcConnectionManager | null = null;

  constructor(
    connection: Connection,
    wallet: Keypair,
    maxSlippage: number = 0.03,
    maxPriorityFee: number = 50000,
    config: {
      heliusApiKey?: string;
      usePrivateTx?: boolean;
      maxRetries?: number;
      retryDelay?: number;
      transactionDeadline?: number;
      rpcManager?: RpcConnectionManager;
    } = {}
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.maxSlippage = new Decimal(maxSlippage);
    this.maxPriorityFee = maxPriorityFee;
    this.heliusApiKey = config.heliusApiKey || process.env.HELIUS_API_KEY || "";
    this.usePrivateTx = config.usePrivateTx ?? true;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;
    this.transactionDeadline = config.transactionDeadline ?? 30; // 30 seconds
    this.rpcManager = config.rpcManager || null;

    // Initialize Raydium executor if RPC manager is available
    if (this.rpcManager) {
      this.raydiumExecutor = new RaydiumSwapExecutor(
        this.rpcManager,
        wallet,
        this.maxRetries,
        maxPriorityFee
      );
    }
  }

  /**
   * Get connection with RPC Manager fallback
   */
  private getActiveConnection(): Connection {
    if (this.rpcManager) {
      return this.rpcManager.getConnection();
    }
    return this.connection;
  }

  /**
   * Initialize Orca SDK context and client (lazy initialization)
   */
  private async initializeOrcaSDK(): Promise<void> {
    if (this.whirlpoolContext && this.whirlpoolClient) {
      return; // Already initialized
    }

    const anchorWallet = new AnchorWalletAdapter(this.wallet);

    // Use active connection (with RPC manager if available)
    const activeConnection = this.getActiveConnection();

    // Create WhirlpoolContext
    this.whirlpoolContext = WhirlpoolContext.from(
      activeConnection,
      anchorWallet,
      undefined, // fetcher (will use default)
      undefined, // lookupTableFetcher
      {
        userDefaultConfirmCommitment: "confirmed",
      }
    );

    // Create WhirlpoolClient
    this.whirlpoolClient = buildWhirlpoolClient(this.whirlpoolContext);
  }

  /**
   * Ensure wSOL Associated Token Account exists for the wallet
   * This prevents the SDK from adding wrap/unwrap instructions
   */
  private async ensureWsolAccount(): Promise<PublicKey> {
    try {
      const wsolMint = new PublicKey(SOL_MINT);
      const wsolATA = await getAssociatedTokenAddress(
        wsolMint,
        this.wallet.publicKey
      );

      // Check if account exists
      try {
        await getAccount(this.connection, wsolATA);
        console.log(`wSOL ATA already exists: ${wsolATA.toBase58()}`);
        return wsolATA;
      } catch (error: any) {
        // Account doesn't exist, create it
        if (error.name === 'TokenAccountNotFoundError' || error.message?.includes('could not find account')) {
          console.log(`Creating wSOL ATA: ${wsolATA.toBase58()}`);

          const transaction = new Transaction().add(
            createAssociatedTokenAccountInstruction(
              this.wallet.publicKey,  // payer
              wsolATA,                 // associatedToken
              this.wallet.publicKey,  // owner
              wsolMint                 // mint
            )
          );

          const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = this.wallet.publicKey;
          transaction.sign(this.wallet);

          const signature = await this.connection.sendRawTransaction(
            transaction.serialize(),
            { skipPreflight: false }
          );

          await this.connection.confirmTransaction(signature, "confirmed");
          console.log(`wSOL ATA created successfully: ${signature}`);
          return wsolATA;
        }
        throw error;
      }
    } catch (error: any) {
      console.error("Error ensuring wSOL account:", error);
      throw error;
    }
  }

  /**
   * Send transaction with Helius private transaction support (MEV protection)
   */
  private async sendTransactionWithRetry(
    transaction: VersionedTransaction,
    options: {
      skipPreflight?: boolean;
      maxRetries?: number;
    } = {}
  ): Promise<string> {
    const startTime = Date.now();
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let attemptCount = 0;

    // CRITICAL FIX: p-retry expects a function with NO parameters!
    const sendFn = async (): Promise<string> => {
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
        const confirmationPromise = this.connection.confirmTransaction(
          signature,
          "confirmed"
        );

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Confirmation timeout (30s)')), confirmationTimeout)
        );

        try {
          const confirmation = await Promise.race([confirmationPromise, timeoutPromise]);

          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }

          console.log(`[TX] Transaction confirmed: ${signature}`);
          return signature;
        } catch (timeoutError: any) {
          // If confirmation times out, check the transaction status manually
          if (timeoutError.message === 'Confirmation timeout (30s)') {
            console.log(`[TX] Confirmation timeout - checking transaction status...`);
            try {
              const status = await this.connection.getSignatureStatus(signature);
              if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
                console.log(`[TX] Transaction was actually confirmed: ${signature}`);
                return signature;
              } else if (status?.value?.err) {
                console.error(`[TX] Transaction failed:`, status.value.err);
                throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
              }
            } catch (statusError) {
              console.error(`[TX] Failed to check transaction status:`, statusError);
            }
          }
          throw timeoutError;
        }
      } catch (error: any) {
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
    return await pRetry(sendFn, {
      retries: maxRetries,
      minTimeout: this.retryDelay,
      maxTimeout: this.retryDelay * 4,
      onFailedAttempt: (error: any) => {
        // Better error logging - handle all error types
        let errorMsg = '';
        if (error && error.message) {
          errorMsg = error.message;
        } else if (typeof error === 'string') {
          errorMsg = error;
        } else if (error && typeof error === 'object') {
          errorMsg = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
        } else {
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
  private async sendPrivateTransaction(
    transaction: VersionedTransaction
  ): Promise<string> {
    const serializedTx = Buffer.from(transaction.serialize()).toString("base64");

    try {
      // Send transaction with 10-second timeout for the POST request
      const response = await axios.post(
        `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`,
        {
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
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 second timeout for sending
        }
      );

      if (response.data.error) {
        throw new Error(
          `Helius error: ${JSON.stringify(response.data.error)}`
        );
      }

      const signature = response.data.result;
      console.log(`[TX] Private transaction sent: ${signature}`);
      console.log(`[TX] Waiting for confirmation...`);

      // Wait for confirmation with 30-second timeout (same as public tx)
      const confirmationTimeout = 30000;
      const confirmationPromise = this.connection.confirmTransaction(
        signature,
        "confirmed"
      );

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Confirmation timeout (30s)')), confirmationTimeout)
      );

      const confirmation = await Promise.race([confirmationPromise, timeoutPromise]);

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log(`[TX] Private transaction confirmed: ${signature}`);
      return signature;
    } catch (error: any) {
      console.error(`[TX] Private transaction failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Convert Decimal amount to BN (native token units)
   */
  private decimalToBN(amount: Decimal, decimals: number): BN {
    const multiplier = new Decimal(10).pow(decimals);
    const nativeAmount = amount.mul(multiplier);
    return new BN(nativeAmount.floor().toString());
  }

  /**
   * Convert BN amount to Decimal (human-readable units)
   */
  private bnToDecimal(amount: BN, decimals: number): Decimal {
    const divisor = new Decimal(10).pow(decimals);
    return new Decimal(amount.toString()).div(divisor);
  }

  /**
   * Get decimals for a token mint
   */
  private getTokenDecimals(mint: string): number {
    if (mint === SOL_MINT) {
      return 9; // SOL has 9 decimals
    } else if (mint === USDC_MINT) {
      return 6; // USDC has 6 decimals
    }
    // Default to 6 for unknown tokens (shouldn't happen for SOL/USDC pairs)
    return 6;
  }

  /**
   * Execute a swap on a Whirlpool using Orca SDK
   */
  async executeSwap(
    poolAddress: string,
    inputMint: string,
    outputMint: string,
    amountIn: Decimal,
    aToB: boolean,
    slippageTolerance: number = 0.01,
    skipValidation: boolean = false
  ): Promise<SwapResult> {
    try {
      console.log("\n=== EXECUTING SWAP (REAL) ===");
      console.log(`Pool: ${poolAddress}`);
      console.log(`Input: ${amountIn.toString()} ${inputMint === SOL_MINT ? "SOL" : "USDC"}`);
      console.log(`Direction: ${aToB ? "A -> B" : "B -> A"}`);
      console.log(`Slippage Tolerance: ${slippageTolerance * 100}%`);

      // Validate slippage (skip for test swaps)
      if (!skipValidation && slippageTolerance > this.maxSlippage.toNumber()) {
        throw new Error(
          `Slippage ${slippageTolerance} exceeds maximum ${this.maxSlippage}`
        );
      }

      // Initialize Orca SDK if needed
      await this.initializeOrcaSDK();

      if (!this.whirlpoolContext || !this.whirlpoolClient) {
        throw new Error("Failed to initialize Orca SDK");
      }

      // Get pool
      const poolPublicKey = new PublicKey(poolAddress);
      const whirlpool = await this.whirlpoolClient.getPool(poolPublicKey);

      // Get token decimals
      const inputDecimals = this.getTokenDecimals(inputMint);
      const outputDecimals = this.getTokenDecimals(outputMint);

      // Convert amount to native units (BN)
      const amountInBN = this.decimalToBN(amountIn, inputDecimals);

      console.log(`Amount in (native): ${amountInBN.toString()}`);

      // Validate input mint matches one of the pool tokens
      const inputMintPubkey = new PublicKey(inputMint);
      const outputMintPubkey = new PublicKey(outputMint);
      const tokenAInfo = whirlpool.getTokenAInfo();
      const tokenBInfo = whirlpool.getTokenBInfo();

      const isInputTokenA = tokenAInfo.mint.equals(inputMintPubkey);
      const isInputTokenB = tokenBInfo.mint.equals(inputMintPubkey);

      if (!isInputTokenA && !isInputTokenB) {
        throw new Error(
          `Input mint ${inputMint} does not match pool tokens (${tokenAInfo.mint.toBase58()}, ${tokenBInfo.mint.toBase58()})`
        );
      }

      // Validate output mint matches the other pool token
      const expectedOutputMint = isInputTokenA ? tokenBInfo.mint : tokenAInfo.mint;
      if (!expectedOutputMint.equals(outputMintPubkey)) {
        throw new Error(
          `Output mint ${outputMint} does not match expected output (${expectedOutputMint.toBase58()})`
        );
      }

      console.log(`Swap: ${inputMint === SOL_MINT ? "SOL" : "USDC"} -> ${outputMint === SOL_MINT ? "SOL" : "USDC"}`);

      // Get swap quote
      const slippagePercentage = Percentage.fromDecimal(
        new Decimal(slippageTolerance)
      );

      console.log("Getting swap quote from Orca SDK...");
      const quoteStartTime = Date.now();
      const quote = await swapQuoteByInputToken(
        whirlpool,
        inputMintPubkey,
        amountInBN,
        slippagePercentage,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        this.whirlpoolContext.fetcher
      );

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
      const signature = await swapTxBuilder.buildAndExecute(
        {
          maxSupportedTransactionVersion: "legacy",
          blockhashCommitment: "confirmed",
          computeBudgetOption: this.maxPriorityFee > 0
            ? {
                type: "fixed",
                priorityFeeLamports: this.maxPriorityFee,
              }
            : { type: "none" },
        },
        {
          skipPreflight: false,
        },
        "confirmed"
      );

      console.log(`Transaction confirmed: ${signature}`);
      console.log(`Explorer: https://solscan.io/tx/${signature}`);

      // Calculate actual output amount (we'll use the quote's estimated amount)
      // In a production system, you'd verify the actual amount by checking balances
      const amountOutDecimal = this.bnToDecimal(
        quote.estimatedAmountOut,
        outputDecimals
      );

      return {
        success: true,
        signature: signature,
        amountIn: amountIn.toString(),
        amountOut: amountOutDecimal.toString(),
      };
    } catch (error: any) {
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
   * Detect if a pool is Raydium or Orca based on pool address
   */
  private isRaydiumPool(poolAddress: string): boolean {
    // Check against known Raydium pool from constants
    const RAYDIUM_POOL_ADDRESS = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";
    return poolAddress === RAYDIUM_POOL_ADDRESS;
  }

  /**
   * Execute a SINGLE swap transaction (simpler alternative to atomic arbitrage)
   * Used for sequential swap mode where each swap is a separate transaction
   */
  async executeSingleSwap(
    poolAddress: string,
    inputMint: string,
    outputMint: string,
    amountIn: Decimal,
    slippageTolerance: number = 0.01,
    skipValidation: boolean = false
  ): Promise<SwapResult> {
    try {
      console.log("\n=== EXECUTING SINGLE SWAP ===");
      console.log(`Pool: ${poolAddress}`);
      console.log(`Input: ${amountIn.toString()} ${inputMint === SOL_MINT ? "SOL" : "USDC"}`);
      console.log(`Output: ${outputMint === SOL_MINT ? "SOL" : "USDC"}`);
      console.log(`Slippage Tolerance: ${slippageTolerance * 100}%`);

      // CRITICAL: Check if this is a Raydium pool and route accordingly
      if (this.isRaydiumPool(poolAddress)) {
        console.log("✓ Raydium pool detected - routing to Raydium executor");

        if (!this.raydiumExecutor) {
          return {
            success: false,
            error: "Raydium executor not initialized - RPC manager required",
          };
        }

        // Find pool config to get vaults
        const poolConfig = PREDEFINED_POOLS.find(p => p.address === poolAddress);
        if (!poolConfig || !poolConfig.vault_a || !poolConfig.vault_b) {
          return {
            success: false,
            error: "Raydium pool configuration not found or invalid",
          };
        }

        // Determine token direction
        const tokenIn: "SOL" | "USDC" = inputMint === SOL_MINT ? "SOL" : "USDC";

        // Execute Raydium swap
        return await this.raydiumExecutor.executeRaydiumSwap(
          poolAddress,
          poolConfig.vault_a,
          poolConfig.vault_b,
          amountIn,
          tokenIn,
          slippageTolerance,
          false // not a dry run
        );
      }

      // Validate slippage (skip for test swaps)
      if (!skipValidation && slippageTolerance > this.maxSlippage.toNumber()) {
        throw new Error(
          `Slippage ${slippageTolerance} exceeds maximum ${this.maxSlippage}`
        );
      }

      // Initialize Orca SDK if needed
      await this.initializeOrcaSDK();

      if (!this.whirlpoolContext || !this.whirlpoolClient) {
        throw new Error("Failed to initialize Orca SDK");
      }

      // Ensure wSOL account exists if trading SOL/wSOL
      if (inputMint === SOL_MINT || outputMint === SOL_MINT) {
        console.log("Ensuring wSOL ATA exists before swap...");
        await this.ensureWsolAccount();
      }

      // Get pool
      const poolPublicKey = new PublicKey(poolAddress);
      const whirlpool = await this.whirlpoolClient.getPool(poolPublicKey);

      // Get token decimals
      const inputDecimals = this.getTokenDecimals(inputMint);
      const outputDecimals = this.getTokenDecimals(outputMint);

      // Convert amount to native units (BN)
      const amountInBN = this.decimalToBN(amountIn, inputDecimals);

      console.log(`Amount in (native): ${amountInBN.toString()}`);

      // Validate input/output mints match pool tokens
      const inputMintPubkey = new PublicKey(inputMint);
      const outputMintPubkey = new PublicKey(outputMint);
      const tokenAInfo = whirlpool.getTokenAInfo();
      const tokenBInfo = whirlpool.getTokenBInfo();

      const isInputTokenA = tokenAInfo.mint.equals(inputMintPubkey);
      const isInputTokenB = tokenBInfo.mint.equals(inputMintPubkey);

      if (!isInputTokenA && !isInputTokenB) {
        throw new Error(
          `Input mint ${inputMint} does not match pool tokens`
        );
      }

      const expectedOutputMint = isInputTokenA ? tokenBInfo.mint : tokenAInfo.mint;
      if (!expectedOutputMint.equals(outputMintPubkey)) {
        throw new Error(
          `Output mint ${outputMint} does not match expected output`
        );
      }

      // Get swap quote
      const slippagePercentage = Percentage.fromDecimal(
        new Decimal(slippageTolerance)
      );

      console.log("Getting swap quote from Orca SDK...");
      const quoteStartTime = Date.now();
      const quote = await swapQuoteByInputToken(
        whirlpool,
        inputMintPubkey,
        amountInBN,
        slippagePercentage,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        this.whirlpoolContext.fetcher
      );

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
      if (tx instanceof VersionedTransaction) {
        console.log("Using VersionedTransaction...");

        // Sign with wallet (and additional signers if needed)
        if ('signTransaction' in this.wallet && typeof this.wallet.signTransaction === 'function') {
          // Sign with additional signers first if needed
          if (signers.length > 0) {
            tx.sign(signers);
          }
          // Then sign with wallet adapter
          tx = await (this.wallet.signTransaction as (tx: VersionedTransaction) => Promise<VersionedTransaction>)(tx);
        } else {
          // For Keypair wallet, sign the VersionedTransaction with all signers at once
          const allSigners = signers.length > 0 ? [this.wallet, ...signers] : [this.wallet];
          tx.sign(allSigners);
        }
      } else {
        console.log("Using legacy Transaction...");

        // Get latest blockhash
        const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;

        // Add priority fees if configured
        if (this.maxPriorityFee > 0) {
          tx.add(
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: this.maxPriorityFee,
            })
          );
        }

        // Sign transaction with additional signers if needed
        if (signers.length > 0) {
          tx.partialSign(...signers);
        }

        // Sign with wallet
        if ('signTransaction' in this.wallet && typeof this.wallet.signTransaction === 'function') {
          tx = await (this.wallet.signTransaction as (tx: Transaction) => Promise<Transaction>)(tx);
        } else {
          tx.sign(this.wallet as Keypair);
        }
      }

      // Send transaction
      // Skip preflight for test swaps to avoid RPC compatibility issues
      const signature = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: skipValidation, // Skip simulation for test swaps
        preflightCommitment: "confirmed",
      });

      // Wait for confirmation with timeout (60 seconds)
      const confirmationTimeout = 60000; // 60 seconds
      const latestBlockhash = await this.connection.getLatestBlockhash();

      const confirmationPromise = this.connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
      );

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Confirmation timeout")), confirmationTimeout)
      );

      let confirmation: any = null;
      try {
        confirmation = await Promise.race([confirmationPromise, timeoutPromise]);
      } catch (timeoutError) {
        // Check if transaction actually succeeded despite timeout
        console.log(`[ORCA] Confirmation timeout - checking transaction status...`);
        const status = await this.connection.getSignatureStatus(signature);
        if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
          console.log(`[ORCA] Transaction was actually confirmed: ${signature}`);
          confirmation = { value: { err: null } };
        } else {
          throw new Error(`Transaction confirmation timeout after ${confirmationTimeout}ms. Status: ${status?.value?.confirmationStatus || 'unknown'}`);
        }
      }

      if (confirmation?.value?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      const executionTime = Date.now() - startTime;

      console.log(`Transaction confirmed: ${signature}`);
      console.log(`Explorer: https://solscan.io/tx/${signature}`);
      console.log(`Execution time: ${executionTime}ms`);

      // Calculate actual output amount
      const amountOutDecimal = this.bnToDecimal(
        quote.estimatedAmountOut,
        outputDecimals
      );

      return {
        success: true,
        signature: signature,
        amountIn: amountIn.toString(),
        amountOut: amountOutDecimal.toString(),
        executionTime: executionTime,
      };
    } catch (error: any) {
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
  async getSwapQuote(
    poolAddress: string,
    inputMint: string,
    amountIn: Decimal,
    aToB: boolean,
    slippageTolerance: number = 0.01
  ): Promise<SwapQuote | null> {
    try {
      // Initialize Orca SDK if needed
      await this.initializeOrcaSDK();

      if (!this.whirlpoolContext || !this.whirlpoolClient) {
        throw new Error("Failed to initialize Orca SDK");
      }

      // Get pool
      const poolPublicKey = new PublicKey(poolAddress);
      const whirlpool = await this.whirlpoolClient.getPool(poolPublicKey);

      // Get token decimals
      const inputDecimals = this.getTokenDecimals(inputMint);

      // Convert amount to native units (BN)
      const amountInBN = this.decimalToBN(amountIn, inputDecimals);

      // Get swap quote
      const inputMintPubkey = new PublicKey(inputMint);
      const slippagePercentage = Percentage.fromDecimal(
        new Decimal(slippageTolerance)
      );

      const quote = await swapQuoteByInputToken(
        whirlpool,
        inputMintPubkey,
        amountInBN,
        slippagePercentage,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        this.whirlpoolContext.fetcher
      );

      return {
        estimatedAmountIn: quote.estimatedAmountIn.toString(),
        estimatedAmountOut: quote.estimatedAmountOut.toString(),
        otherAmountThreshold: quote.otherAmountThreshold.toString(),
        sqrtPriceLimit: quote.sqrtPriceLimit.toString(),
        aToB: quote.aToB,
        slippage: slippageTolerance,
      };
    } catch (error: any) {
      console.error("Error getting quote:", error.message);
      return null;
    }
  }

  /**
   * Simulate swap to check if it would succeed
   */
  async simulateSwap(
    poolAddress: string,
    inputMint: string,
    outputMint: string,
    amountIn: Decimal,
    aToB: boolean,
    slippageTolerance: number = 0.01
  ): Promise<boolean> {
    try {
      const quote = await this.getSwapQuote(
        poolAddress,
        inputMint,
        amountIn,
        aToB,
        slippageTolerance
      );

      return quote !== null;
    } catch (error: any) {
      console.error("Simulation error:", error.message);
      return false;
    }
  }

  /**
   * Execute ATOMIC arbitrage: both swaps in single transaction (CRITICAL FIX)
   * This prevents partial execution and front-running
   */
  async executeArbitrage(
    pool1Address: string,
    pool2Address: string,
    tokenAMint: string,
    tokenBMint: string,
    amountToTrade: Decimal,
    direction: "pool1-to-pool2" | "pool2-to-pool1",
    slippage: number = 0.01,
    skipValidation: boolean = false
  ): Promise<ArbitrageResult> {
    const overallStartTime = Date.now();
    console.log("\n" + "=".repeat(70));
    console.log("EXECUTING ATOMIC ARBITRAGE (REAL)");
    console.log("MEV Protection: " + (this.usePrivateTx ? "ENABLED" : "DISABLED"));
    console.log("=".repeat(70));

    try {
      // Check if any pool is Raydium (for cross-DEX atomic arbitrage)
      const isPool1Raydium = this.isRaydiumPool(pool1Address);
      const isPool2Raydium = this.isRaydiumPool(pool2Address);
      const hasRaydiumPool = isPool1Raydium || isPool2Raydium;

      if (hasRaydiumPool) {
        console.log("⚠️  Cross-DEX arbitrage detected (Orca + Raydium)");
        console.log("⚠️  Cross-DEX atomic transactions exceed Solana's transaction size limit");
        console.log("⚠️  Automatically falling back to SINGLE mode for this arbitrage");
        console.log("⚠️  (Sequential execution: Swap 1 → Confirm → Swap 2)\n");

        // Fall back to SINGLE mode for cross-DEX arbitrage
        // Atomic transactions with Orca + Raydium are too large (>1232 bytes)
        return await this.executeSequentialSwaps(
          pool1Address,
          pool2Address,
          tokenAMint,
          tokenBMint,
          amountToTrade,
          direction,
          slippage,
          skipValidation
        );
      }

      // Continue with Orca-only atomic arbitrage
      console.log("🌊 Orca-only atomic arbitrage");
      const currentTime = Date.now();

      let firstPool: string;
      let secondPool: string;
      let firstSwapAToB: boolean;
      let secondSwapAToB: boolean;
      let firstInputMint: string;
      let firstOutputMint: string;
      let secondInputMint: string;
      let secondOutputMint: string;

      if (direction === "pool1-to-pool2") {
        firstPool = pool1Address;
        secondPool = pool2Address;
        firstInputMint = tokenBMint; // USDC
        firstOutputMint = tokenAMint; // SOL
        firstSwapAToB = false; // B -> A (USDC -> SOL)
        secondInputMint = tokenAMint; // SOL
        secondOutputMint = tokenBMint; // USDC
        secondSwapAToB = true; // A -> B (SOL -> USDC)
      } else {
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
      console.log(`  Swap 1: ${firstInputMint === USDC_MINT ? "USDC" : "SOL"} -> ${firstOutputMint === USDC_MINT ? "USDC" : "SOL"} on ${firstPool.slice(0, 8)}...`);
      console.log(`  Swap 2: ${secondInputMint === USDC_MINT ? "USDC" : "SOL"} -> ${secondOutputMint === USDC_MINT ? "USDC" : "SOL"} on ${secondPool.slice(0, 8)}...`);

      // Initialize Orca SDK
      await this.initializeOrcaSDK();

      if (!this.whirlpoolContext || !this.whirlpoolClient) {
        throw new Error("Failed to initialize Orca SDK");
      }

      // Get both pools
      const pool1Pubkey = new PublicKey(firstPool);
      const pool2Pubkey = new PublicKey(secondPool);
      const whirlpool1 = await this.whirlpoolClient.getPool(pool1Pubkey);
      const whirlpool2 = await this.whirlpoolClient.getPool(pool2Pubkey);

      // Get first swap quote
      const inputDecimals1 = this.getTokenDecimals(firstInputMint);
      const amountInBN1 = this.decimalToBN(amountToTrade, inputDecimals1);
      const inputMintPubkey1 = new PublicKey(firstInputMint);
      const slippagePercentage = Percentage.fromDecimal(new Decimal(slippage));

      console.log(`\n[ATOMIC] Getting quote for Swap 1...`);
      const quote1 = await swapQuoteByInputToken(
        whirlpool1,
        inputMintPubkey1,
        amountInBN1,
        slippagePercentage,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        this.whirlpoolContext.fetcher
      );

      console.log(`  Quote 1: Out = ${quote1.estimatedAmountOut.toString()}`);

      // Get second swap quote (using output from first swap)
      const inputMintPubkey2 = new PublicKey(secondInputMint);

      console.log(`[ATOMIC] Getting quote for Swap 2...`);
      const quote2 = await swapQuoteByInputToken(
        whirlpool2,
        inputMintPubkey2,
        quote1.estimatedAmountOut, // Use estimated output from swap1
        slippagePercentage,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        this.whirlpoolContext.fetcher
      );

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
        recentBlockhash = await this.rpcManager.executeWithRetry(
          (conn) => conn.getLatestBlockhash("confirmed"),
          "getLatestBlockhash"
        );
      } else {
        recentBlockhash = await this.connection.getLatestBlockhash("confirmed");
      }

      // Get instructions from both swaps
      const swap1Instructions = await swap1TxBuilder.compressIx(true);
      const swap2Instructions = await swap2TxBuilder.compressIx(true);

      // Add compute budget for priority fees
      const computeUnits = 400000; // Increased for two swaps
      const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: this.maxPriorityFee,
      });
      const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: computeUnits,
      });

      // Build versioned transaction with all instructions
      const message = new TransactionMessage({
        payerKey: this.wallet.publicKey,
        recentBlockhash: recentBlockhash.blockhash,
        instructions: [
          computeLimitIx,
          priorityFeeIx,
          ...swap1Instructions.instructions,
          ...swap2Instructions.instructions,
        ],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(message);

      // CRITICAL FIX: Collect all signers from both swaps
      const allSigners: Keypair[] = [this.wallet];
      if (swap1Instructions.signers && swap1Instructions.signers.length > 0) {
        // Filter and cast only Keypair signers
        const keypairSigners = swap1Instructions.signers.filter((s): s is Keypair => s instanceof Keypair);
        allSigners.push(...keypairSigners);
      }
      if (swap2Instructions.signers && swap2Instructions.signers.length > 0) {
        // Filter and cast only Keypair signers
        const keypairSigners = swap2Instructions.signers.filter((s): s is Keypair => s instanceof Keypair);
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
    } catch (error: any) {
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

  /**
   * Execute ATOMIC cross-DEX arbitrage: Orca + Raydium in single transaction
   * Combines instructions from both DEXes into one atomic transaction
   */
  private async executeCrossDexAtomicArbitrage(
    pool1Address: string,
    pool2Address: string,
    tokenAMint: string,
    tokenBMint: string,
    amountToTrade: Decimal,
    direction: "pool1-to-pool2" | "pool2-to-pool1",
    slippage: number,
    isPool1Raydium: boolean,
    isPool2Raydium: boolean
  ): Promise<ArbitrageResult> {
    const overallStartTime = Date.now();

    try {
      console.log("\n[CROSS-DEX] Building atomic transaction with Orca + Raydium");

      // Determine order and types
      const firstPool = direction === "pool1-to-pool2" ? pool1Address : pool2Address;
      const secondPool = direction === "pool1-to-pool2" ? pool2Address : pool1Address;
      const isFirstPoolRaydium = direction === "pool1-to-pool2" ? isPool1Raydium : isPool2Raydium;
      const isSecondPoolRaydium = direction === "pool1-to-pool2" ? isPool2Raydium : isPool1Raydium;

      const firstInputMint = tokenBMint; // USDC
      const firstOutputMint = tokenAMint; // SOL
      const secondInputMint = tokenAMint; // SOL
      const secondOutputMint = tokenBMint; // USDC

      console.log(`[CROSS-DEX] Swap 1: ${isFirstPoolRaydium ? 'Raydium' : 'Orca'} (${firstPool.slice(0, 8)}...)`);
      console.log(`[CROSS-DEX] Swap 2: ${isSecondPoolRaydium ? 'Raydium' : 'Orca'} (${secondPool.slice(0, 8)}...)`);

      // Get quotes and instructions for both swaps
      const swap1Instructions: TransactionInstruction[] = [];
      const swap2Instructions: TransactionInstruction[] = [];
      let estimatedAmountOut1: BN;
      let estimatedAmountOut2: BN;

      // Build Swap 1 instructions
      if (isFirstPoolRaydium) {
        console.log("[CROSS-DEX] Building Raydium swap 1 instructions...");

        if (!this.raydiumExecutor) {
          throw new Error("Raydium executor not initialized");
        }

        // Get Raydium pool config
        const poolConfig = PREDEFINED_POOLS.find(p => p.address === firstPool);
        if (!poolConfig || !poolConfig.vault_a || !poolConfig.vault_b) {
          throw new Error("Raydium pool config not found");
        }

        // Build Raydium swap instructions
        const raydiumResult = await this.raydiumExecutor.buildRaydiumSwapInstructions(
          firstPool,
          poolConfig.vault_a,
          poolConfig.vault_b,
          amountToTrade,
          firstInputMint === SOL_MINT ? "SOL" : "USDC",
          slippage
        );

        estimatedAmountOut1 = this.decimalToBN(new Decimal(raydiumResult.quote.amountOut), this.getTokenDecimals(firstOutputMint));
        swap1Instructions.push(...raydiumResult.instructions);

        console.log(`[CROSS-DEX] Raydium swap 1: ${raydiumResult.instructions.length} instructions, output: ${raydiumResult.quote.amountOut}`);

      } else {
        console.log("[CROSS-DEX] Building Orca swap 1 instructions...");

        await this.initializeOrcaSDK();
        if (!this.whirlpoolContext || !this.whirlpoolClient) {
          throw new Error("Failed to initialize Orca SDK");
        }

        const pool1Pubkey = new PublicKey(firstPool);
        const whirlpool1 = await this.whirlpoolClient.getPool(pool1Pubkey);

        const inputDecimals1 = this.getTokenDecimals(firstInputMint);
        const amountInBN1 = this.decimalToBN(amountToTrade, inputDecimals1);
        const inputMintPubkey1 = new PublicKey(firstInputMint);
        const slippagePercentage = Percentage.fromDecimal(new Decimal(slippage));

        const quote1 = await swapQuoteByInputToken(
          whirlpool1,
          inputMintPubkey1,
          amountInBN1,
          slippagePercentage,
          ORCA_WHIRLPOOL_PROGRAM_ID,
          this.whirlpoolContext.fetcher
        );

        estimatedAmountOut1 = quote1.estimatedAmountOut;

        const swap1TxBuilder = await whirlpool1.swap(quote1, this.wallet.publicKey);
        const swap1TxPayload = await swap1TxBuilder.compressIx(true);
        swap1Instructions.push(...swap1TxPayload.instructions);
      }

      // Build Swap 2 instructions
      if (isSecondPoolRaydium) {
        console.log("[CROSS-DEX] Building Raydium swap 2 instructions...");

        if (!this.raydiumExecutor) {
          throw new Error("Raydium executor not initialized");
        }

        // Get Raydium pool config
        const poolConfig = PREDEFINED_POOLS.find(p => p.address === secondPool);
        if (!poolConfig || !poolConfig.vault_a || !poolConfig.vault_b) {
          throw new Error("Raydium pool config not found");
        }

        // Convert estimatedAmountOut1 to Decimal
        const amountInSwap2 = this.bnToDecimal(estimatedAmountOut1, this.getTokenDecimals(secondInputMint));

        // Build Raydium swap instructions
        const raydiumResult = await this.raydiumExecutor.buildRaydiumSwapInstructions(
          secondPool,
          poolConfig.vault_a,
          poolConfig.vault_b,
          amountInSwap2,
          secondInputMint === SOL_MINT ? "SOL" : "USDC",
          slippage
        );

        estimatedAmountOut2 = this.decimalToBN(new Decimal(raydiumResult.quote.amountOut), this.getTokenDecimals(secondOutputMint));
        swap2Instructions.push(...raydiumResult.instructions);

        console.log(`[CROSS-DEX] Raydium swap 2: ${raydiumResult.instructions.length} instructions, output: ${raydiumResult.quote.amountOut}`);

      } else {
        console.log("[CROSS-DEX] Building Orca swap 2 instructions...");

        await this.initializeOrcaSDK();
        if (!this.whirlpoolContext || !this.whirlpoolClient) {
          throw new Error("Failed to initialize Orca SDK");
        }

        const pool2Pubkey = new PublicKey(secondPool);
        const whirlpool2 = await this.whirlpoolClient.getPool(pool2Pubkey);

        const inputMintPubkey2 = new PublicKey(secondInputMint);
        const slippagePercentage = Percentage.fromDecimal(new Decimal(slippage));

        const quote2 = await swapQuoteByInputToken(
          whirlpool2,
          inputMintPubkey2,
          estimatedAmountOut1,
          slippagePercentage,
          ORCA_WHIRLPOOL_PROGRAM_ID,
          this.whirlpoolContext.fetcher
        );

        estimatedAmountOut2 = quote2.estimatedAmountOut;

        const swap2TxBuilder = await whirlpool2.swap(quote2, this.wallet.publicKey);
        const swap2TxPayload = await swap2TxBuilder.compressIx(true);
        swap2Instructions.push(...swap2TxPayload.instructions);
      }

      // Combine instructions into single transaction
      console.log("[CROSS-DEX] Combining instructions into atomic transaction...");

      let recentBlockhash;
      if (this.rpcManager) {
        recentBlockhash = await this.rpcManager.executeWithRetry(
          (conn) => conn.getLatestBlockhash("confirmed"),
          "getLatestBlockhash"
        );
      } else {
        recentBlockhash = await this.connection.getLatestBlockhash("confirmed");
      }

      const computeUnits = 600000; // Increased for cross-DEX
      const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: this.maxPriorityFee,
      });
      const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: computeUnits,
      });

      const message = new TransactionMessage({
        payerKey: this.wallet.publicKey,
        recentBlockhash: recentBlockhash.blockhash,
        instructions: [
          computeLimitIx,
          priorityFeeIx,
          ...swap1Instructions,
          ...swap2Instructions,
        ],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(message);
      transaction.sign([this.wallet]);

      console.log(`[CROSS-DEX] Sending atomic transaction with ${swap1Instructions.length + swap2Instructions.length + 2} instructions...`);

      const signature = await this.sendTransactionWithRetry(transaction, {
        skipPreflight: false,
        maxRetries: 0,
      });

      const executionTime = Date.now() - overallStartTime;

      const outputDecimals2 = this.getTokenDecimals(secondOutputMint);
      const finalAmountOut = this.bnToDecimal(estimatedAmountOut2, outputDecimals2);
      const expectedProfit = finalAmountOut.minus(amountToTrade);
      const expectedProfitPct = expectedProfit.div(amountToTrade).mul(100).toNumber();

      console.log("\n" + "=".repeat(70));
      console.log("CROSS-DEX ATOMIC ARBITRAGE COMPLETE");
      console.log("=".repeat(70));
      console.log(`Bundle Signature: ${signature}`);
      console.log(`Explorer: https://solscan.io/tx/${signature}`);
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
          amountOut: this.bnToDecimal(estimatedAmountOut1, this.getTokenDecimals(firstOutputMint)).toString(),
          executionTime: executionTime,
        },
        swap2: {
          success: true,
          signature: signature,
          amountIn: this.bnToDecimal(estimatedAmountOut1, this.getTokenDecimals(firstOutputMint)).toString(),
          amountOut: finalAmountOut.toString(),
          executionTime: executionTime,
        },
        profit: expectedProfit,
        profitPct: expectedProfitPct,
        totalExecutionTime: executionTime,
      };

    } catch (error: any) {
      const executionTime = Date.now() - overallStartTime;
      console.error(`[CROSS-DEX] Error: ${error.message}`);

      return {
        success: false,
        error: `Cross-DEX atomic arbitrage failed: ${error.message}. Use SINGLE mode as fallback.`,
        totalExecutionTime: executionTime,
      };
    }
  }

  /**
   * Execute sequential swaps (SINGLE mode) - two separate transactions
   * Used for cross-DEX arbitrage that exceeds transaction size limits
   */
  private async executeSequentialSwaps(
    pool1Address: string,
    pool2Address: string,
    tokenAMint: string,
    tokenBMint: string,
    initialAmount: Decimal,
    direction: "pool1-to-pool2" | "pool2-to-pool1",
    slippage: number,
    skipValidation: boolean = false
  ): Promise<ArbitrageResult> {
    const overallStartTime = Date.now();
    console.log("\n" + "=".repeat(70));
    console.log("EXECUTING SEQUENTIAL SWAPS (SINGLE MODE)");
    console.log("MEV Protection: " + (this.usePrivateTx ? "ENABLED" : "DISABLED"));
    console.log("=".repeat(70));

    try {
      // Determine swap direction and pools based on signal direction
      let firstPool: string;
      let secondPool: string;
      let firstInputMint: string;
      let firstOutputMint: string;
      let secondInputMint: string;
      let secondOutputMint: string;

      // Match the logic from ATOMIC mode - always start with USDC, buy SOL, sell SOL for USDC
      if (direction === "pool1-to-pool2") {
        firstPool = pool1Address;
        secondPool = pool2Address;
        firstInputMint = tokenBMint; // USDC
        firstOutputMint = tokenAMint; // SOL
        secondInputMint = tokenAMint; // SOL
        secondOutputMint = tokenBMint; // USDC
      } else {
        firstPool = pool2Address;
        secondPool = pool1Address;
        firstInputMint = tokenBMint; // USDC
        firstOutputMint = tokenAMint; // SOL
        secondInputMint = tokenAMint; // SOL
        secondOutputMint = tokenBMint; // USDC
      }

      console.log(`\n[SINGLE] Swap 1: ${firstInputMint === tokenBMint ? "USDC" : "SOL"} -> ${firstOutputMint === tokenBMint ? "USDC" : "SOL"} on ${firstPool.slice(0, 8)}...`);
      console.log(`[SINGLE]   Amount: ${initialAmount.toString()} ${firstInputMint === tokenBMint ? "USDC" : "SOL"}`);

      // Execute first swap: USDC -> SOL
      const swap1StartTime = Date.now();
      const swap1Result = await this.executeSingleSwap(
        firstPool,
        firstInputMint,
        firstOutputMint,
        initialAmount,
        slippage,
        skipValidation
      );
      const swap1Time = Date.now() - swap1StartTime;

      if (!swap1Result.success) {
        console.log(`[SINGLE] ✗ Swap 1 failed: ${swap1Result.error}`);
        return {
          success: false,
          error: `Swap 1 failed: ${swap1Result.error}`,
          totalExecutionTime: Date.now() - overallStartTime,
        };
      }

      console.log(`[SINGLE] ✓ Swap 1 completed: ${swap1Result.signature}`);
      console.log(`[SINGLE]   Output: ${swap1Result.amountOut}`);
      console.log(`[SINGLE]   Time: ${swap1Time}ms`);

      // Execute second swap with output from first swap: SOL -> USDC
      const secondSwapAmount = new Decimal(swap1Result.amountOut || "0");

      console.log(`\n[SINGLE] Swap 2: ${secondInputMint === tokenBMint ? "USDC" : "SOL"} -> ${secondOutputMint === tokenBMint ? "USDC" : "SOL"} on ${secondPool.slice(0, 8)}...`);
      console.log(`[SINGLE]   Amount: ${secondSwapAmount.toString()} ${secondInputMint === tokenBMint ? "USDC" : "SOL"}`);

      const swap2StartTime = Date.now();
      const swap2Result = await this.executeSingleSwap(
        secondPool,
        secondInputMint,
        secondOutputMint,
        secondSwapAmount,
        slippage,
        skipValidation
      );
      const swap2Time = Date.now() - swap2StartTime;

      if (!swap2Result.success) {
        console.log(`[SINGLE] ✗ Swap 2 failed: ${swap2Result.error}`);
        console.log(`[SINGLE] ⚠️  Partial execution - Swap 1 succeeded but Swap 2 failed`);
        console.log(`[SINGLE] 🔄 Attempting recovery: reversing Swap 1...`);

        // CRITICAL: Attempt to recover by reversing Swap 1
        try {
          const recoveryResult = await this.executeSingleSwap(
            firstPool, // Reverse direction: sell back on same pool
            firstOutputMint, // What we got from Swap 1 (SOL)
            firstInputMint, // What we started with (USDC)
            new Decimal(swap1Result.amountOut || "0"),
            slippage,
            true // skipValidation = true for emergency recovery
          );

          if (recoveryResult.success) {
            console.log(`[SINGLE] ✓ Recovery successful: ${recoveryResult.signature}`);
            console.log(`[SINGLE]   Recovered: ${recoveryResult.amountOut} ${firstInputMint === tokenBMint ? "USDC" : "SOL"}`);
            const netLoss = new Decimal(swap1Result.amountIn || "0").minus(new Decimal(recoveryResult.amountOut || "0"));
            return {
              success: false,
              error: `Swap 2 failed but RECOVERED via reverse Swap 1. Net loss: ${netLoss.toString()}`,
              totalExecutionTime: Date.now() - overallStartTime,
            };
          } else {
            console.log(`[SINGLE] ✗ Recovery FAILED: ${recoveryResult.error}`);
            console.log(`[SINGLE] ⚠️  CRITICAL: Funds stuck in ${firstOutputMint === tokenBMint ? "USDC" : "SOL"}`);
          }
        } catch (recoveryError: any) {
          console.error(`[SINGLE] Recovery error: ${recoveryError.message}`);
        }

        return {
          success: false,
          error: `Swap 2 failed: ${swap2Result.error} (Partial execution - check wallet for stuck funds)`,
          totalExecutionTime: Date.now() - overallStartTime,
        };
      }

      console.log(`[SINGLE] ✓ Swap 2 completed: ${swap2Result.signature}`);
      console.log(`[SINGLE]   Output: ${swap2Result.amountOut}`);
      console.log(`[SINGLE]   Time: ${swap2Time}ms`);

      // Calculate profit
      const finalAmountOut = new Decimal(swap2Result.amountOut || "0");
      const profit = finalAmountOut.minus(initialAmount);

      console.log("\n" + "=".repeat(70));
      console.log("SEQUENTIAL SWAPS COMPLETE");
      console.log(`Total execution time: ${Date.now() - overallStartTime}ms`);
      console.log(`Net profit: ${profit.toString()} USDC`);
      console.log("=".repeat(70));

      return {
        success: true,
        bundleSignature: `${swap1Result.signature}, ${swap2Result.signature}`,
        swap1: swap1Result,
        swap2: swap2Result,
        profit: profit,
        totalExecutionTime: Date.now() - overallStartTime,
      };
    } catch (error: any) {
      console.error(`[SINGLE] Sequential swap error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        totalExecutionTime: Date.now() - overallStartTime,
      };
    }
  }
}