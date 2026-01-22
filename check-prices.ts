import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import * as dotenv from "dotenv";

dotenv.config();

async function checkPools() {
  const connection = new Connection(process.env.RPC_URL || "", "confirmed");

  // Orca USDC/SOL
  const orcaVaultA = new PublicKey("2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP");
  const orcaVaultB = new PublicKey("EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9");

  // Raydium USDC/SOL
  const raydiumVaultA = new PublicKey("HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz");
  const raydiumVaultB = new PublicKey("DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz");

  console.log("Fetching pool data...\n");

  const [orcaA, orcaB, raydiumA, raydiumB] = await Promise.all([
    getAccount(connection, orcaVaultA),
    getAccount(connection, orcaVaultB),
    getAccount(connection, raydiumVaultA),
    getAccount(connection, raydiumVaultB),
  ]);

  const orcaUSDC = Number(orcaA.amount) / 1e6;
  const orcaSOL = Number(orcaB.amount) / 1e9;
  const orcaPrice = orcaUSDC / orcaSOL;

  const raydiumUSDC = Number(raydiumA.amount) / 1e6;
  const raydiumSOL = Number(raydiumB.amount) / 1e9;
  const raydiumPrice = raydiumUSDC / raydiumSOL;

  console.log("Orca USDC/SOL:");
  console.log("  USDC Reserve:", orcaUSDC.toFixed(2));
  console.log("  SOL Reserve:", orcaSOL.toFixed(2));
  console.log("  Price: $" + orcaPrice.toFixed(4) + " per SOL");

  console.log("\nRaydium USDC/SOL:");
  console.log("  USDC Reserve:", raydiumUSDC.toFixed(2));
  console.log("  SOL Reserve:", raydiumSOL.toFixed(2));
  console.log("  Price: $" + raydiumPrice.toFixed(4) + " per SOL");

  console.log("\nPrice Difference:");
  const diff = Math.abs(orcaPrice - raydiumPrice);
  const diffPct = (diff / Math.min(orcaPrice, raydiumPrice)) * 100;
  console.log("  Absolute: $" + diff.toFixed(4));
  console.log("  Percentage: " + diffPct.toFixed(4) + "%");

  // Simulate 100 USDC swap
  console.log("\n\nSimulating 100 USDC arbitrage:");
  console.log("Step 1: Buy SOL on Orca with 100 USDC");
  const orcaFee = 0.0004;
  const usdcAfterFee = 100 * (1 - orcaFee);
  const solOut = (orcaSOL * usdcAfterFee) / (orcaUSDC + usdcAfterFee);
  console.log("  Input: 100 USDC (fee: " + (orcaFee * 100) + "%)");
  console.log("  Output: " + solOut.toFixed(6) + " SOL");

  console.log("\nStep 2: Sell SOL on Raydium");
  const raydiumFee = 0.0025;
  const solAfterFee = solOut * (1 - raydiumFee);
  const usdcOut = (raydiumUSDC * solAfterFee) / (raydiumSOL + solAfterFee);
  console.log("  Input: " + solOut.toFixed(6) + " SOL (fee: " + (raydiumFee * 100) + "%)");
  console.log("  Output: " + usdcOut.toFixed(6) + " USDC");

  console.log("\nResult:");
  const profit = usdcOut - 100;
  const profitPct = (profit / 100) * 100;
  console.log("  Net Profit: " + profit.toFixed(6) + " USDC (" + profitPct.toFixed(4) + "%)");

  if (profitPct > 50) {
    console.log("\n⚠️  WARNING: Profit is unrealistically high!");
    console.log("This suggests a bug in the calculation or data.");
  }
}

checkPools().catch(console.error);
