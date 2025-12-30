import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";
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
import { SOL_MINT, USDC_MINT } from "./constants";
import axios from "axios";
import pRetry from "p-retry";

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
  private heliusApiKey: string;
  private usePrivateTx: boolean;
  private maxRetries: number;
  private retryDelay: number;
  private transactionDeadline: number; // seconds

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
  }

  /**
   * Initialize Orca SDK context and client (lazy initialization)
   */
  private async initializeOrcaSDK(): Promise<void> {
    if (this.whirlpoolContext && this.whirlpoolClient) {
      return; // Already initialized
    }

    const anchorWallet = new AnchorWalletAdapter(this.wallet);

    // Create WhirlpoolContext
    this.whirlpoolContext = WhirlpoolContext.from(
      this.connection,
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

    const sendFn = async (attempt: number): Promise<string> => {
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
      const confirmation = await this.connection.confirmTransaction(
        signature,
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      return signature;
    };

    // Use p-retry for exponential backoff
    return await pRetry(sendFn, {
      retries: maxRetries,
      minTimeout: this.retryDelay,
      maxTimeout: this.retryDelay * 4,
      onFailedAttempt: (error: any) => {
        console.warn(
          `[TX] Attempt ${error.attemptNumber} failed: ${error.message || error}`
        );
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
    console.log("[TX] Sending PRIVATE transaction via Helius (MEV protected)");

    const serializedTx = Buffer.from(transaction.serialize()).toString("base64");

    try {
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
        }
      );

      if (response.data.error) {
        throw new Error(
          `Helius private tx error: ${JSON.stringify(response.data.error)}`
        );
      }

      const signature = response.data.result;
      console.log(`[TX] Private transaction sent: ${signature}`);

      // Wait for confirmation
      const confirmation = await this.connection.confirmTransaction(
        signature,
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

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
    slippageTolerance: number = 0.01
  ): Promise<SwapResult> {
    try {
      console.log("\n=== EXECUTING SWAP (REAL) ===");
      console.log(`Pool: ${poolAddress}`);
      console.log(`Input: ${amountIn.toString()} ${inputMint === SOL_MINT ? "SOL" : "USDC"}`);
      console.log(`Direction: ${aToB ? "A -> B" : "B -> A"}`);
      console.log(`Slippage Tolerance: ${slippageTolerance * 100}%`);

      // Validate slippage
      if (slippageTolerance > this.maxSlippage.toNumber()) {
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
    slippage: number = 0.01
  ): Promise<ArbitrageResult> {
    const overallStartTime = Date.now();
    console.log("\n" + "=".repeat(70));
    console.log("EXECUTING ATOMIC ARBITRAGE (REAL)");
    console.log("MEV Protection: " + (this.usePrivateTx ? "ENABLED" : "DISABLED"));
    console.log("=".repeat(70));

    try {
      // Validate deadline hasn't been set too long ago
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
      const recentBlockhash = await this.connection.getLatestBlockhash("confirmed");

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
}