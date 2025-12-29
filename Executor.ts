import { Connection, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import fs from "fs";
import * as dotenv from "dotenv";
import Decimal from "decimal.js";
import { USDC_MINT_PUBKEY, DECIMAL_1E9 } from "./constants";

dotenv.config();

/* =========================
   ENV VALIDATION
========================= */

const RPC_URL = process.env.RPC_URL;
const WALLET_PATH = process.env.WALLET_PATH;

if (!RPC_URL) throw new Error("RPC_URL missing in .env");
if (!WALLET_PATH) throw new Error("WALLET_PATH missing in .env");

/* =========================
   CONSTANTS
========================= */

const MIN_SOL_REQUIRED = new Decimal(0.02);
const MIN_USDC_REQUIRED = new Decimal(5);

/* =========================
   WALLET LOADING
========================= */

function loadWallet(): Keypair {
  const secret = JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

/* =========================
   MAIN
========================= */

async function main() {
  console.log("=== EXECUTOR PHASE 1: WALLET & SAFETY CHECK ===");

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadWallet();

  console.log("Wallet Address:", wallet.publicKey.toBase58());

  /* ---------- BALANCE CHECKS (parallelized) ---------- */
  const [solLamports, usdcAta] = await Promise.all([
    connection.getBalance(wallet.publicKey),
    getAssociatedTokenAddress(USDC_MINT_PUBKEY, wallet.publicKey),
  ]);

  const solBalance = new Decimal(solLamports).div(DECIMAL_1E9);
  console.log("SOL Balance:", solBalance.toFixed(6));

  if (solBalance.lt(MIN_SOL_REQUIRED)) {
    throw new Error(
      `INSUFFICIENT SOL: Need at least ${MIN_SOL_REQUIRED.toString()} SOL`
    );
  }

  const usdcAccountInfo = await connection.getTokenAccountBalance(usdcAta);
  const usdcBalance = new Decimal(usdcAccountInfo.value.uiAmount || 0);

  console.log("USDC Balance:", usdcBalance.toFixed(6));

  if (usdcBalance.lt(MIN_USDC_REQUIRED)) {
    throw new Error(
      `INSUFFICIENT USDC: Need at least ${MIN_USDC_REQUIRED.toString()} USDC`
    );
  }

  console.log("STATUS: WALLET & BALANCES OK");
  console.log("PHASE 1 COMPLETE — SAFE TO PROCEED");
}

main().catch((err) => {
  console.error("EXECUTOR HALTED:", err.message);
  process.exit(1);
});
