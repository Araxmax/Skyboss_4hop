import { Connection, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config();

async function getRaydiumVaults() {
  const connection = new Connection(process.env.RPC_URL || "", "confirmed");
  
  const poolAddress = new PublicKey("58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2");
  
  console.log("Fetching Raydium USDC/SOL pool data...\n");
  console.log("Pool:", poolAddress.toString());
  
  const poolAccountInfo = await connection.getAccountInfo(poolAddress);
  
  if (!poolAccountInfo) {
    console.log("Pool not found!");
    return;
  }
  
  console.log("Owner:", poolAccountInfo.owner.toString());
  console.log("Data length:", poolAccountInfo.data.length, "bytes\n");
  
  // Parse Raydium AMM layout
  const baseMint = new PublicKey(poolAccountInfo.data.slice(192, 224));
  const quoteMint = new PublicKey(poolAccountInfo.data.slice(224, 256));
  const baseVault = new PublicKey(poolAccountInfo.data.slice(128, 160));
  const quoteVault = new PublicKey(poolAccountInfo.data.slice(160, 192));
  
  console.log("Base Mint (should be SOL):", baseMint.toString());
  console.log("Quote Mint (should be USDC):", quoteMint.toString());
  console.log("\nBase Vault:", baseVault.toString());
  console.log("Quote Vault:", quoteVault.toString());
  
  // Expected values
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  
  console.log("\n✓ Check:");
  if (baseMint.toString() === SOL_MINT) {
    console.log("  Base is SOL ✅");
  } else {
    console.log("  Base is NOT SOL ❌ (Got:", baseMint.toString() + ")");
  }
  
  if (quoteMint.toString() === USDC_MINT) {
    console.log("  Quote is USDC ✅");
  } else {
    console.log("  Quote is NOT USDC ❌ (Got:", quoteMint.toString() + ")");
  }
}

getRaydiumVaults().catch(console.error);
