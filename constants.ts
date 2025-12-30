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

export interface PoolConfig {
  name: string;
  address: string;
  fee_rate: number;
  config?: string;
  vault_a?: string;
  vault_b?: string;
}

export const PREDEFINED_POOLS: PoolConfig[] = [
  {
    name: "SOL/USDC 0.05% [VERIFIED]",
    address: "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm",
    fee_rate: 0.0005,
    config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
    vault_a: "9RfZwn2Prux6QesG1Noo4HzMEBv3rPndJ2bN2Wwd6a7p",
    vault_b: "BVNo8ftg2LkkssnWT4ZWdtoFaevnfD6ExYeramwM27pe",
  },
  {
    name: "SOL/USDC 0.01% [VERIFIED]",
    address: "83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d",
    fee_rate: 0.0001,
    config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
    vault_a: "D3CDPQLoa9jY1LXCkpUqd3JQDWz8DX1LDE1dhmJt9fq4",
    vault_b: "dwxR9YF7WwnJJu7bPC4UNcWFpcSsooH6fxbpoa3fTbJ",
  },
];

/* =========================
   ARBITRAGE THRESHOLDS
========================= */

// Minimum profit threshold AFTER fees
// Pool fees: 0.01% + 0.05% = 0.06% total
// Gas fees: ~$0.02-0.05 per trade
// Need minimum 0.15% profit to break even
export const MIN_PROFIT_THRESHOLD = 0.0015; // 0.15% (realistic minimum)
export const OPTIMAL_PROFIT_THRESHOLD = 0.003; // 0.3% (good target)

/* =========================
   DECIMAL CONSTANTS (pre-computed for performance)
========================= */

import Decimal from "decimal.js";

export const DECIMAL_1E9 = new Decimal(1e9);
export const DECIMAL_1E6 = new Decimal(1e6);
export const DECIMAL_2_POW_64 = new Decimal(2).pow(64);
export const DECIMAL_10_POW_9 = new Decimal(10).pow(9);
export const DECIMAL_10_POW_6 = new Decimal(10).pow(6);

