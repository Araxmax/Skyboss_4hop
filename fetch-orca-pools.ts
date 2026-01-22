import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import * as dotenv from "dotenv";

dotenv.config();

/* =========================
   FETCH ORCA POOL INFO
   Find vault addresses for Orca Whirlpools
========================= */

async function fetchOrcaPoolInfo() {
  const RPC_URL = process.env.RPC_URL || "";
  if (!RPC_URL) {
    console.error("ERROR: RPC_URL not set in .env");
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, "confirmed");

  // Known Orca pool addresses from your constants
  const pools = [
    {
      name: "Orca USDC/SOL",
      address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
    },
    {
      name: "Orca SOL/BONK",
      address: "EgJa7vKP6lYJWY67M8GQCXuJbGP1OZ3Gc2E5JStSeKzQ",
    },
    {
      name: "Orca USDC/BONK",
      address: "CdmkZQavBxHyXj1bqFrxvgZlH3gEZBxckTZvVAGRTmGE",
    },
  ];

  console.log("\n" + "=".repeat(80));
  console.log(" FETCHING ORCA POOL INFO");
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

     
      if (poolAccountInfo.data.length >= 200) {
        try {
          const tokenMintA = new PublicKey(poolAccountInfo.data.slice(8, 40));
          const tokenMintB = new PublicKey(poolAccountInfo.data.slice(40, 72));
          const tokenVaultA = new PublicKey(poolAccountInfo.data.slice(101, 133));
          const tokenVaultB = new PublicKey(poolAccountInfo.data.slice(133, 165));

          console.log(`  Token Mint A: ${tokenMintA.toString()}`);
          console.log(`  Token Mint B: ${tokenMintB.toString()}`);
          console.log(`  Token Vault A: ${tokenVaultA.toString()}`);
          console.log(`  Token Vault B: ${tokenVaultB.toString()}`);

          // Try to fetch vault balances
          try {
            const [vaultAInfo, vaultBInfo] = await Promise.all([
              getAccount(connection, tokenVaultA),
              getAccount(connection, tokenVaultB),
            ]);

            console.log(`  Vault A Balance: ${vaultAInfo.amount.toString()}`);
            console.log(`  Vault B Balance: ${vaultBInfo.amount.toString()}`);
          } catch (vaultError: any) {
            console.log(`    Could not fetch vault balances: ${vaultError.message}`);
          }
        } catch (parseError: any) {
          console.log(`    Could not parse pool layout: ${parseError.message}`);
        }
      } else {
        console.log(`    Data too short (${poolAccountInfo.data.length} bytes)`);
      }
    } catch (error: any) {
      console.error(`   Error: ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(80));
}

fetchOrcaPoolInfo().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
