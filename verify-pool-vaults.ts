import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getMint } from "@solana/spl-token";
import * as dotenv from "dotenv";

dotenv.config();

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

async function verifyPoolVaults() {
  const RPC_URL = process.env.RPC_URL || "";
  const connection = new Connection(RPC_URL, "confirmed");

  const pools = [
    {
      name: "Raydium SOL/BONK",
      address: "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv",
    },
    {
      name: "Raydium USDC/BONK",
      address: "G7mw1d83ismcQJKkzt62Ug4noXCjVhu3eV7U5EMgge6Z",
    },
  ];

  console.log("\n" + "=".repeat(80));
  console.log(" VERIFYING POOL VAULTS");
  console.log("=".repeat(80));

  for (const pool of pools) {
    console.log(`\n${pool.name}:`);
    console.log(`  Pool: ${pool.address}`);

    try {
      const poolPubkey = new PublicKey(pool.address);
      const poolAccountInfo = await connection.getAccountInfo(poolPubkey);

      if (!poolAccountInfo) {
        console.log(`  ❌ Pool not found`);
        continue;
      }

      // Parse Raydium AMM layout
      const baseMint = new PublicKey(poolAccountInfo.data.slice(192, 224));
      const quoteMint = new PublicKey(poolAccountInfo.data.slice(224, 256));
      const baseVault = new PublicKey(poolAccountInfo.data.slice(128, 160));
      const quoteVault = new PublicKey(poolAccountInfo.data.slice(160, 192));

      console.log(`  Base Mint: ${baseMint.toString()}`);
      console.log(`  Quote Mint: ${quoteMint.toString()}`);

      // Identify tokens
      let baseName = "UNKNOWN";
      let quoteName = "UNKNOWN";

      if (baseMint.toString() === SOL_MINT) baseName = "SOL";
      else if (baseMint.toString() === USDC_MINT) baseName = "USDC";
      else if (baseMint.toString() === BONK_MINT) baseName = "BONK";

      if (quoteMint.toString() === SOL_MINT) quoteName = "SOL";
      else if (quoteMint.toString() === USDC_MINT) quoteName = "USDC";
      else if (quoteMint.toString() === BONK_MINT) quoteName = "BONK";

      console.log(`  Tokens: ${baseName}/${quoteName}`);
      console.log(`  Base Vault: ${baseVault.toString()}`);
      console.log(`  Quote Vault: ${quoteVault.toString()}`);

      // Fetch vault balances
      try {
        const [baseVaultInfo, quoteVaultInfo] = await Promise.all([
          getAccount(connection, baseVault),
          getAccount(connection, quoteVault),
        ]);

        console.log(`  Base Vault Balance: ${baseVaultInfo.amount.toString()}`);
        console.log(`  Quote Vault Balance: ${quoteVaultInfo.amount.toString()}`);

        // Get decimals
        const [baseMintInfo, quoteMintInfo] = await Promise.all([
          getMint(connection, baseMint),
          getMint(connection, quoteMint),
        ]);

        console.log(`  Base Decimals: ${baseMintInfo.decimals}`);
        console.log(`  Quote Decimals: ${quoteMintInfo.decimals}`);

        const baseAmount = Number(baseVaultInfo.amount) / (10 ** baseMintInfo.decimals);
        const quoteAmount = Number(quoteVaultInfo.amount) / (10 ** quoteMintInfo.decimals);

        console.log(`  Base Amount: ${baseAmount.toLocaleString()} ${baseName}`);
        console.log(`  Quote Amount: ${quoteAmount.toLocaleString()} ${quoteName}`);

        // Calculate price
        if (baseAmount > 0) {
          const price = quoteAmount / baseAmount;
          console.log(`  Price (${baseName}/${quoteName}): ${price.toFixed(9)}`);
        }

        console.log(`  ✅ Pool verified successfully`);
      } catch (vaultError: any) {
        console.log(`  ❌ Vault fetch error: ${vaultError.message}`);
      }
    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(80));
}

verifyPoolVaults().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
