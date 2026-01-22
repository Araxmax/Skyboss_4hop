import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import Decimal from "decimal.js";
import BN from "bn.js";
import * as dotenv from "dotenv";
import { SOL_MINT, USDC_MINT, SOL_MINT_PUBKEY, USDC_MINT_PUBKEY } from "./constants";
import pRetry from "p-retry";
import { RpcConnectionManager } from "./RpcConnectionManager";
import {
  Liquidity,
  LiquidityPoolKeys,
  Token,
  TokenAmount,
  Percent,
  CurrencyAmount,
  Currency,
  SPL_ACCOUNT_LAYOUT,
  LIQUIDITY_STATE_LAYOUT_V4,
  MARKET_STATE_LAYOUT_V3,
  Market,
} from "@raydium-io/raydium-sdk";

dotenv.config();

/* =========================
   TYPES
========================= */

interface RaydiumSwapQuote {
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  priceImpact: number;
}

interface RaydiumSwapResult {
  success: boolean;
  signature?: string;
  error?: string;
  amountIn?: string;
  amountOut?: string;
  actualSlippage?: number;
  priceImpact?: number;
  executionTime?: number;
}

/* =========================
   RAYDIUM POOL CONFIGURATION
========================= */

// Raydium SOL/USDC Pool Keys (MainNet)
const RAYDIUM_SOL_USDC_POOL_KEYS: LiquidityPoolKeys = {
  id: new PublicKey("58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"),
  baseMint: SOL_MINT_PUBKEY,
  quoteMint: USDC_MINT_PUBKEY,
  lpMint: new PublicKey("8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaTUapubyvu"),
  baseDecimals: 9,
  quoteDecimals: 6,
  lpDecimals: 9,
  version: 4,
  programId: new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
  authority: new PublicKey("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"),
  openOrders: new PublicKey("HRk9CMrpq7Jn9sh7mzxE8CChHG8dneX9p475QKz4Fsfc"),
  targetOrders: new PublicKey("CZza3Ej4Mc58MnxWA385itCC9jCo3L1D7zc3LKy1bZMR"),
  baseVault: new PublicKey("DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz"),
  quoteVault: new PublicKey("HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz"),
  withdrawQueue: new PublicKey("G7xeGGLevkRwB5f44QNgQtrPKBdMfkT6ZZwpS9xcC97n"),
  lpVault: new PublicKey("Awpt6N7ZYPBa4vG4BQNFhFxDj4sxExAA9rpBAoBw2uok"),
  marketVersion: 3,
  marketProgramId: new PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
  marketId: new PublicKey("9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT"),
  marketAuthority: new PublicKey("F8Vyqk3unwxkXukZFQeYyGmFfTG3CAX4v24iyrjEYBJV"),
  marketBaseVault: new PublicKey("36c6YqAwyGKQG66XEp2dJc5JqjaBNv7sVghEtJv4c7u6"),
  marketQuoteVault: new PublicKey("8CFo8bL8mZQK8abbFyypFMwEDd8tVJjHTTojMLgQTUSZ"),
  marketBids: new PublicKey("14ivtgssEBoBjuZJtSAPKYgpUK7DmnSwuPMqJoVTSgKJ"),
  marketAsks: new PublicKey("CEQdAFKdycHugujQg9k2wbmxjcpdYZyVLfV9WerTnafJ"),
  marketEventQueue: new PublicKey("5KKsLVU6TcbVDK4BS6K1DGDxnh4Q9xjYJ8XaDCG5t8ht"),
  lookupTableAccount: PublicKey.default,
};

/* =========================
   RAYDIUM SWAP EXECUTOR
========================= */

export class RaydiumSwapExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private rpcManager: RpcConnectionManager;
  private maxRetries: number;
  private maxPriorityFee: number;

  constructor(
    rpcManager: RpcConnectionManager,
    wallet: Keypair,
    maxRetries: number = 3,
    maxPriorityFee: number = 100000
  ) {
    this.rpcManager = rpcManager;
    this.connection = rpcManager.getConnection();
    this.wallet = wallet;
    this.maxRetries = maxRetries;
    this.maxPriorityFee = maxPriorityFee;
  }

  /**
   * Fetch current price from Raydium AMM pool
   */
  async fetchRaydiumPrice(
    poolAddress: string,
    vaultA: string,
    vaultB: string
  ): Promise<Decimal | null> {
    try {
      // Fetch vault balances
      const vaultAPubkey = new PublicKey(vaultA);
      const vaultBPubkey = new PublicKey(vaultB);

      const [vaultAInfo, vaultBInfo] = await Promise.all([
        getAccount(this.connection, vaultAPubkey),
        getAccount(this.connection, vaultBPubkey),
      ]);

      // SOL balance (vault A) in lamports
      const solBalance = new Decimal(vaultAInfo.amount.toString()).div(1e9);

      // USDC balance (vault B) in micro-USDC
      const usdcBalance = new Decimal(vaultBInfo.amount.toString()).div(1e6);

      // Price = USDC / SOL
      if (solBalance.isZero()) {
        console.error("SOL vault balance is zero");
        return null;
      }

      const price = usdcBalance.div(solBalance);
      return price;
    } catch (error: any) {
      console.error(`Error fetching Raydium price: ${error.message}`);
      return null;
    }
  }

  /**
   * Get swap quote from Raydium AMM
   * This is a simplified calculation based on constant product formula (x * y = k)
   */
  async getRaydiumSwapQuote(
    poolAddress: string,
    vaultA: string,
    vaultB: string,
    amountIn: Decimal,
    tokenIn: "SOL" | "USDC",
    slippageTolerance: number = 0.03
  ): Promise<RaydiumSwapQuote | null> {
    try {
      // Fetch vault balances
      const vaultAPubkey = new PublicKey(vaultA);
      const vaultBPubkey = new PublicKey(vaultB);

      const [vaultAInfo, vaultBInfo] = await Promise.all([
        getAccount(this.connection, vaultAPubkey),
        getAccount(this.connection, vaultBPubkey),
      ]);

      const reserveSOL = new Decimal(vaultAInfo.amount.toString()).div(1e9);
      const reserveUSDC = new Decimal(vaultBInfo.amount.toString()).div(1e6);

      // Raydium AMM fee: 0.25% (0.0025) - SOL/USDC pool
      const FEE_RATE = 0.0025;

      let amountOut: Decimal;
      let priceImpact: number;

      if (tokenIn === "USDC") {
        // Buying SOL with USDC
        // amountOut = (reserveSOL * amountIn * (1 - fee)) / (reserveUSDC + amountIn * (1 - fee))
        const amountInAfterFee = amountIn.mul(1 - FEE_RATE);
        amountOut = reserveSOL.mul(amountInAfterFee).div(
          reserveUSDC.add(amountInAfterFee)
        );

        // Price impact = (amountIn / reserveUSDC)
        priceImpact = amountIn.div(reserveUSDC).toNumber();
      } else {
        // Selling SOL for USDC
        // amountOut = (reserveUSDC * amountIn * (1 - fee)) / (reserveSOL + amountIn * (1 - fee))
        const amountInAfterFee = amountIn.mul(1 - FEE_RATE);
        amountOut = reserveUSDC.mul(amountInAfterFee).div(
          reserveSOL.add(amountInAfterFee)
        );

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
    } catch (error: any) {
      console.error(`Error getting Raydium swap quote: ${error.message}`);
      return null;
    }
  }

  /**
   * Execute swap on Raydium AMM pool
   */
  async executeRaydiumSwap(
    poolAddress: string,
    vaultA: string,
    vaultB: string,
    amountIn: Decimal,
    tokenIn: "SOL" | "USDC",
    slippageTolerance: number = 0.03,
    dryRun: boolean = false
  ): Promise<RaydiumSwapResult> {
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
      const quote = await this.getRaydiumSwapQuote(
        poolAddress,
        vaultA,
        vaultB,
        amountIn,
        tokenIn,
        slippageTolerance
      );

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

      const transaction = await this.buildRaydiumSwapTransaction(
        amountIn,
        new Decimal(quote.minAmountOut),
        tokenIn,
        latestBlockhash.blockhash
      );

      console.log("[RAYDIUM] Transaction built successfully");
      console.log("[RAYDIUM] Sending transaction...");

      // Sign transaction
      transaction.sign(this.wallet);

      // Send transaction with processed commitment for speed
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: "processed",
        }
      );

      console.log(`[RAYDIUM] Transaction sent: ${signature}`);

      // Hybrid approach: WebSocket subscription (fast) + RPC fallback (reliable)
      // Reduces RPC calls from 30 to 1-3 max
      try {
        await new Promise<void>((resolve, reject) => {
          let subscriptionId: number;
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
                  } else if (status?.value?.err) {
                    return reject(new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`));
                  }

                  // Wait 1s before next attempt (except on last)
                  if (i < 2) await new Promise(r => setTimeout(r, 1000));
                } catch (err: any) {
                  if (i === 2) {
                    return reject(new Error(`Confirmation failed: ${err.message}`));
                  }
                }
              }

              reject(new Error('Confirmation timeout after 5s'));
            }
          }, 2000); // Check after 2s, then retry up to 3 times = max 5s total

          subscriptionId = this.connection.onSignature(
            signature,
            (result) => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                this.connection.removeSignatureListener(subscriptionId);

                if (result.err) {
                  reject(new Error(`Transaction failed: ${JSON.stringify(result.err)}`));
                } else {
                  resolve();
                }
              }
            },
            'processed'
          );
        });
      } catch (error: any) {
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
    } catch (error: any) {
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
  private async buildRaydiumSwapTransaction(
    amountIn: Decimal,
    minAmountOut: Decimal,
    tokenIn: "SOL" | "USDC",
    recentBlockhash?: string
  ): Promise<Transaction> {
    try {
      // Create Token objects
      const solToken = new Token(TOKEN_PROGRAM_ID, SOL_MINT_PUBKEY, 9, "SOL", "Wrapped SOL");
      const usdcToken = new Token(TOKEN_PROGRAM_ID, USDC_MINT_PUBKEY, 6, "USDC", "USD Coin");

      // Determine input/output tokens
      const tokenInObj = tokenIn === "SOL" ? solToken : usdcToken;
      const tokenOutObj = tokenIn === "SOL" ? usdcToken : solToken;

      // Convert amounts to TokenAmount
      const amountInRaw = new BN(
        amountIn.mul(10 ** tokenInObj.decimals).floor().toString()
      );
      const minAmountOutRaw = new BN(
        minAmountOut.mul(10 ** tokenOutObj.decimals).floor().toString()
      );

      const tokenAmountIn = new TokenAmount(tokenInObj, amountInRaw);
      const tokenAmountOutMin = new TokenAmount(tokenOutObj, minAmountOutRaw);

      // Get associated token accounts
      const userSourceTokenAccount = await getAssociatedTokenAddress(
        tokenInObj.mint,
        this.wallet.publicKey
      );

      const userDestinationTokenAccount = await getAssociatedTokenAddress(
        tokenOutObj.mint,
        this.wallet.publicKey
      );

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
      const sourceAccountInfo = SPL_ACCOUNT_LAYOUT.decode(sourceAccountInfoRaw.data);
      const destinationAccountInfo = SPL_ACCOUNT_LAYOUT.decode(destinationAccountInfoRaw.data);

      // Build tokenAccounts array following SDK examples
      const tokenAccounts = [
        {
          programId: TOKEN_PROGRAM_ID,
          pubkey: userSourceTokenAccount,
          accountInfo: sourceAccountInfo,
        },
        {
          programId: TOKEN_PROGRAM_ID,
          pubkey: userDestinationTokenAccount,
          accountInfo: destinationAccountInfo,
        },
      ];

      // Build swap instruction using correct API with properly decoded account info
      const swapInstruction = await Liquidity.makeSwapInstructionSimple({
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
      const transaction = new Transaction();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.wallet.publicKey;

      // Add priority fee and compute budget (matching Orca for speed)
      if (this.maxPriorityFee > 0) {
        transaction.add(
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: this.maxPriorityFee,
          })
        );
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: 600000, // Match Orca for consistent priority
          })
        );
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
    } catch (error: any) {
      console.error(`[RAYDIUM] Error building transaction: ${error.message}`);
      throw error;
    }
  }

  /**
   * Build Raydium swap instructions WITHOUT executing (for atomic transactions)
   * Returns instructions and quote information
   */
  async buildRaydiumSwapInstructions(
    poolAddress: string,
    vaultA: string,
    vaultB: string,
    amountIn: Decimal,
    tokenIn: "SOL" | "USDC",
    slippageTolerance: number = 0.03
  ): Promise<{
    instructions: TransactionInstruction[];
    quote: RaydiumSwapQuote;
  }> {
    try {
      console.log("[RAYDIUM] Building swap instructions (no execution)...");

      // Get quote
      const quote = await this.getRaydiumSwapQuote(
        poolAddress,
        vaultA,
        vaultB,
        amountIn,
        tokenIn,
        slippageTolerance
      );

      if (!quote) {
        throw new Error("Failed to get Raydium swap quote");
      }

      console.log(`[RAYDIUM] Quote: ${quote.amountOut} output, ${(quote.priceImpact * 100).toFixed(4)}% impact`);

      // Build transaction to extract instructions
      const transaction = await this.buildRaydiumSwapTransaction(
        amountIn,
        new Decimal(quote.minAmountOut),
        tokenIn
      );

      // Extract instructions (skip compute budget instructions if present)
      const instructions = transaction.instructions.filter(
        ix => !ix.programId.equals(ComputeBudgetProgram.programId)
      );

      console.log(`[RAYDIUM] Extracted ${instructions.length} swap instructions`);

      return {
        instructions,
        quote,
      };
    } catch (error: any) {
      console.error(`[RAYDIUM] Error building instructions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if token account exists, create if not
   */
  private async ensureTokenAccount(
    mint: PublicKey,
    owner: PublicKey
  ): Promise<{ address: PublicKey; instruction?: any }> {
    const ata = await getAssociatedTokenAddress(mint, owner);

    try {
      await getAccount(this.connection, ata);
      return { address: ata };
    } catch (error) {
      // Account doesn't exist, create instruction
      const instruction = createAssociatedTokenAccountInstruction(
        owner,
        ata,
        owner,
        mint
      );
      return { address: ata, instruction };
    }
  }
}
