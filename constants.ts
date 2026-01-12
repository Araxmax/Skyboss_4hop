import { PublicKey } from "@solana/web3.js";

/* =========================
   TOKEN MINTS
========================= */

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const SOL_MINT_PUBKEY = new PublicKey(SOL_MINT);
export const USDC_MINT_PUBKEY = new PublicKey(USDC_MINT);

/* =========================
   POOL CONFIGURATION
========================= */

export type PoolType = "orca" | "raydium";

export interface PoolConfig {
  name: string;
  address: string;
  fee_rate: number;
  type: PoolType;
  config?: string;
  vault_a?: string;
  vault_b?: string;
}

export const PREDEFINED_POOLS: PoolConfig[] = [
  {
    name: "SOL/USDC 0.04% Orca [VERIFIED]",
    address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
    fee_rate: 0.0004,
    type: "orca",
    config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
    vault_a: "EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9",
    vault_b: "2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP",
  },
  {
    name: "SOL/USDC Raydium [VERIFIED]",
    address: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
    fee_rate: 0.0025,
    type: "raydium",
    vault_a: "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz",
    vault_b: "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz",
  },
];

/* =========================
   ARBITRAGE THRESHOLDS
========================= */

// Minimum profit threshold AFTER fees
// Orca fee: 0.04%
// Raydium fee: 0.25%
// Total: 0.29% for Raydium-Orca arbitrage
// Gas fees: ~$0.02-0.05 per trade
// Need minimum 0.35% profit to break even
export const MIN_PROFIT_THRESHOLD = 0.0035; // 0.35% (realistic minimum)
export const OPTIMAL_PROFIT_THRESHOLD = 0.005; // 0.5% (good target)

/* =========================
   DECIMAL CONSTANTS (pre-computed for performance)
========================= */

import Decimal from "decimal.js";

export const DECIMAL_1E9 = new Decimal(1e9);
export const DECIMAL_1E6 = new Decimal(1e6);
export const DECIMAL_2_POW_64 = new Decimal(2).pow(64);
export const DECIMAL_10_POW_9 = new Decimal(10).pow(9);
export const DECIMAL_10_POW_6 = new Decimal(10).pow(6);

