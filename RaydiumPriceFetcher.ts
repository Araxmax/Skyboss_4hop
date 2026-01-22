import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import Decimal from "decimal.js";

/* =========================
   RAYDIUM PRICE FETCHER
========================= */

/**
 * Fetch price from Raydium AMM pool using vault balances
 * Price calculation: USDC balance / SOL balance
 */
export async function fetchRaydiumPrice(
  connection: Connection,
  vaultA: string,
  vaultB: string
): Promise<Decimal | null> {
  try {
    const vaultAPubkey = new PublicKey(vaultA);
    const vaultBPubkey = new PublicKey(vaultB);

    const [vaultAInfo, vaultBInfo] = await Promise.all([
      getAccount(connection, vaultAPubkey),
      getAccount(connection, vaultBPubkey),
    ]);

    // SOL balance (vault A) in lamports -> convert to SOL
    const solBalance = new Decimal(vaultAInfo.amount.toString()).div(1e9);

    // USDC balance (vault B) in micro-USDC -> convert to USDC
    const usdcBalance = new Decimal(vaultBInfo.amount.toString()).div(1e6);

    // Price = USDC / SOL
    if (solBalance.isZero()) {
      console.error("Raydium: SOL vault balance is zero");
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
 * Subscribe to Raydium vault changes to get real-time price updates
 */
export function subscribeToRaydiumVaults(
  connection: Connection,
  vaultA: string,
  vaultB: string,
  callback: (price: Decimal) => void,
  commitment: "processed" | "confirmed" | "finalized" = "processed"
): () => void {
  const vaultAPubkey = new PublicKey(vaultA);
  const vaultBPubkey = new PublicKey(vaultB);

  let lastVaultABalance: bigint | null = null;
  let lastVaultBBalance: bigint | null = null;

  // Subscribe to vault A (SOL)
  const subIdA = connection.onAccountChange(
    vaultAPubkey,
    (accountInfo) => {
      try {
        // Token account data layout: first 64 bytes are header, then 8 bytes for amount
        const amount = accountInfo.data.readBigUInt64LE(64);
        lastVaultABalance = amount;

        // Trigger price update if we have both balances
        if (lastVaultBBalance !== null) {
          const solBalance = new Decimal(lastVaultABalance.toString()).div(1e9);
          const usdcBalance = new Decimal(lastVaultBBalance.toString()).div(1e6);

          if (!solBalance.isZero()) {
            const price = usdcBalance.div(solBalance);
            callback(price);
          }
        }
      } catch (error: any) {
        console.error(`Error processing Raydium vault A update: ${error.message}`);
      }
    },
    commitment
  );

  // Subscribe to vault B (USDC)
  const subIdB = connection.onAccountChange(
    vaultBPubkey,
    (accountInfo) => {
      try {
        const amount = accountInfo.data.readBigUInt64LE(64);
        lastVaultBBalance = amount;

        // Trigger price update if we have both balances
        if (lastVaultABalance !== null) {
          const solBalance = new Decimal(lastVaultABalance.toString()).div(1e9);
          const usdcBalance = new Decimal(lastVaultBBalance.toString()).div(1e6);

          if (!solBalance.isZero()) {
            const price = usdcBalance.div(solBalance);
            callback(price);
          }
        }
      } catch (error: any) {
        console.error(`Error processing Raydium vault B update: ${error.message}`);
      }
    },
    commitment
  );

  // Return cleanup function
  return () => {
    connection.removeAccountChangeListener(subIdA);
    connection.removeAccountChangeListener(subIdB);
  };
}
