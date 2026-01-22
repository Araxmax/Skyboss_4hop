import { Connection, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config();

/* =========================
   FETCH POOL INFO SCRIPT
   Helps find vault addresses for pools
========================= */

async function fetchPoolInfo() {
  const RPC_URL = process.env.RPC_URL || "";
  if (!RPC_URL) {
    console.error("ERROR: RPC_URL not set in .env");
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, "confirmed");

  // Known pool addresses from web search
  const pools = [
    {
      name: "Raydium SOL/BONK",
      address: "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv",
    },
    {
      name: "Raydium USDC/BONK",
      address: "G7mw1d83ismcQJKkzt62Ug4noXCjVhu3eV7U5EMgge6Z",
    },
    {
      name: "Orca SOL/BONK",
      address: "EgJa7vKP6lYJWY67M8GQCXuJbGP1OZ3Gc2E5JStSeKzQ", // From your constants
    },
  ];

  console.log("\n" + "=".repeat(80));
  console.log(" FETCHING POOL INFO FROM SOLANA");
  console.log("=".repeat(80));

  for (const pool of pools) {
    try {
      console.log(`\n${pool.name}:`);
      console.log(`  Pool Address: ${pool.address}`);

      const poolPubkey = new PublicKey(pool.address);
      const poolAccountInfo = await connection.getAccountInfo(poolPubkey);

      if (!poolAccountInfo) {
        console.log(`   Pool account not found`);
        continue;
      }

      console.log(`   Pool account found`);
      console.log(`  Owner: ${poolAccountInfo.owner.toString()}`);
      console.log(`  Data length: ${poolAccountInfo.data.length} bytes`);

      // For Raydium AMM pools, the layout is:
      // - Bytes 0-7: Status
      // - Bytes 8-39: Nonce (32 bytes)
      // - Bytes 40-71: Order num (32 bytes)
      // - Bytes 72-79: Depth (8 bytes)
      // - Bytes 80-87: Base lot size (8 bytes)
      // - Bytes 88-95: Quote lot size (8 bytes)
      // - Bytes 96-103: Fee numerator (8 bytes)
      // - Bytes 104-111: Fee denominator (8 bytes)
      // - Bytes 112-119: Base mint decimals (8 bytes)
      // - Bytes 120-127: Quote mint decimals (8 bytes)
      // - Bytes 128-159: Base vault (32 bytes)
      // - Bytes 160-191: Quote vault (32 bytes)
      // - Bytes 192-223: Base mint (32 bytes)
      // - Bytes 224-255: Quote mint (32 bytes)

      if (poolAccountInfo.data.length >= 256) {
        try {
          // Try to parse as Raydium AMM
          const baseVault = new PublicKey(poolAccountInfo.data.slice(128, 160));
          const quoteVault = new PublicKey(poolAccountInfo.data.slice(160, 192));
          const baseMint = new PublicKey(poolAccountInfo.data.slice(192, 224));
          const quoteMint = new PublicKey(poolAccountInfo.data.slice(224, 256));

          console.log(`  Base Mint: ${baseMint.toString()}`);
          console.log(`  Quote Mint: ${quoteMint.toString()}`);
          console.log(`  Base Vault: ${baseVault.toString()}`);
          console.log(`  Quote Vault: ${quoteVault.toString()}`);
        } catch (parseError: any) {
          console.log(`    Could not parse pool layout: ${parseError.message}`);
        }
      } else {
        console.log(`    Data too short for Raydium AMM layout (${poolAccountInfo.data.length} bytes)`);
      }
    } catch (error: any) {
      console.error(`   Error: ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(80));
}

fetchPoolInfo().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
