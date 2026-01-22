import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";

/* =========================
   MULTI-PATH ARBITRAGE CONSTANTS
   Supports 1-hop, 2-hop, 3-hop, 4-hop combinations
   All vault addresses provided by user
========================= */

// Token mints
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

export const USDC_DECIMALS = 6;
export const SOL_DECIMALS = 9;
export const BONK_DECIMALS = 5;

/* =========================
   POOL DEFINITION (not "hop")
========================= */

export type DexType = "orca" | "raydium_amm" | "raydium_clmm" | "meteora" | "phoenix";

export interface PoolConfig {
  id: string;
  name: string;
  dex: DexType;
  address: string;
  tokenA: string; // mint address
  tokenB: string; // mint address
  tokenASymbol: string;
  tokenBSymbol: string;
  feeRate: number; // e.g., 0.0025 for 0.25%

  // AMM pool data
  vaultA?: string;
  vaultB?: string;

  // CLMM pool data
  tickSpacing?: number;

  // Risk parameters
  minLiquidityUSD?: number;
}

/* =========================
   ALL AVAILABLE POOLS
   Updated with correct addresses and vaults from user data
========================= */

export const ALL_POOLS: PoolConfig[] = [
  // ==================== SOL/USDC POOLS ====================

  // Raydium AMM SOL/USDC 0.25%
  {
    id: "Pool 1",
    name: "Raydium AMM SOL/USDC 0.25%",
    dex: "raydium_amm",
    address: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0025,
    vaultA: "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz", // Coin Vault (WSOL)
    vaultB: "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz", // Pc Vault (USDC)
    minLiquidityUSD: 500000,
  },

  // Orca Whirlpool SOL/USDC 0.04%
  {
    id: "Pool 2",
    name: "Orca Whirlpool SOL/USDC 0.04%",
    dex: "orca",
    address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0004,
    vaultA: "EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9", // Vault A (SOL)
    vaultB: "2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP", // Vault B (USDC)
    minLiquidityUSD: 100000,
  },

  // Raydium CLMM SOL/USDC 0.01%
  {
    id: "Pool 3",
    name: "Raydium CLMM SOL/USDC 0.01%",
    dex: "raydium_clmm",
    address: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0001,
    vaultA: "6P4tvbzRY6Bh3MiWDHuLqyHywovsRwRpfskPvyeSoHsz",
    vaultB: "6mK4Pxs6GhwnessH7CvPivqDYauiHZmAdbEFDpXFk9zt",
    tickSpacing: 1,
    minLiquidityUSD: 100000,
  },

  // Meteora DLMM SOL/USDC 0.01%
  {
    id: "Pool 4",
    name: "Meteora DLMM SOL/USDC 0.01%",
    dex: "meteora",
    address: "HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0001,
    vaultA: "H7j5NPopj3tQvDg4N8CxwtYciTn3e8AEV6wSVrxpyDUc",
    vaultB: "HbYjRzx7teCxqW3unpXBEcNHhfVZvW2vW9MQ99TkizWt",
    minLiquidityUSD: 100000,
  },

  // Raydium CLMM SOL/USDC 0.02%
  {
    id: "Pool 5",
    name: "Raydium CLMM SOL/USDC 0.02%",
    dex: "raydium_clmm",
    address: "CYbD9RaToYMtWKA7QZyoLahnHdWq553Vm62Lh6qWtuxq",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0002,
    vaultA: "GviiXg2Xc1xCpyNY36r7h1EAy7uvse5UMkiiyHjRDU6Z",
    vaultB: "3bWPj5eepJm8CxUzk5MMFMN2CFJkntxKvbmy4zwwtpJd",
    tickSpacing: 8,
    minLiquidityUSD: 1123155,
  },

  // Orca Whirlpool SOL/USDC 0.02%
  {
    id: "Pool 6",
    name: "Orca Whirlpool SOL/USDC 0.02%",
    dex: "orca",
    address: "FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0002,
    vaultA: "6mQ8xEaHdTikyMvvMxUctYch6dUjnKgfoeib2msyMMi1",
    vaultB: "AQ36QRk3HAe6PHqBCtKTQnYKpt2kAagq9YoeTqUPMGHx",
    minLiquidityUSD: 578845,
  },

  // Raydium CLMM SOL/USDC 0.04%
  {
    id: "Pool 7",
    name: "Raydium CLMM SOL/USDC 0.04%",
    dex: "raydium_clmm",
    address: "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0004,
    vaultA: "4ct7br2vTPzfdmY3S5HLtTxcGSBfn6pnw98hsS6v359A",
    vaultB: "5it83u57VRrVgc51oNV19TTmAJuffPx5GtGwQr7gQNUo",
    tickSpacing: 16,
    minLiquidityUSD: 10703967,
  },

  // Meteora DLMM SOL/USDC 0.04%
  {
    id: "Pool 8",
    name: "Meteora DLMM SOL/USDC 0.04%",
    dex: "meteora",
    address: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0004,
    vaultA: "EYj9xKw6ZszwpyNibHY7JD5o3QgTVrSdcBp1fMJhrR9o",
    vaultB: "CoaxzEh8p5YyGLcj36Eo3cUThVJxeKCs7qvLAGDYwBcz",
    minLiquidityUSD: 2896401,
  },

  // Meteora DLMM SOL/USDC 0.05% #1
  {
    id: "Pool 9",
    name: "Meteora DLMM SOL/USDC 0.05% #1",
    dex: "meteora",
    address: "CgqwPLSFfht89pF5RSKGUUMFj5zRxoUt4861w2SkXaqY",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0005,
    vaultA: "4jTcZiooRV5Z5sb29xroJEu1FnPJbadmZcnEbXFsUuXi",
    vaultB: "AsAhzfi3u9gihEYzV3zq6VnkfvQaM7yF13wnsTfAk936",
    minLiquidityUSD: 1286556,
  },

  // Raydium CLMM SOL/USDC 0.05%
  {
    id: "Pool 10",
    name: "Raydium CLMM SOL/USDC 0.05%",
    dex: "raydium_clmm",
    address: "2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0005,
    vaultA: "E2BcoCeJLTa27mAXDA4xwEq3pBUcyH6XXEHYk4KvKYTv",
    vaultB: "4d35yC7C8zhCDec7JbPptL9SEb4NUddKHxURgmvD8hfo",
    tickSpacing: 20,
    minLiquidityUSD: 554185,
  },

  // Orca Whirlpool SOL/USDC 0.05%
  {
    id: "Pool 11",
    name: "Orca Whirlpool SOL/USDC 0.05%",
    dex: "orca",
    address: "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0005,
    vaultA: "9RfZwn2Prux6QesG1Noo4HzMEBv3rPndJ2bN2Wwd6a7p",
    vaultB: "BVNo8ftg2LkkssnWT4ZWdtoFaevnfD6ExYeramwM27pe",
    minLiquidityUSD: 521034,
  },

  // Meteora DLMM SOL/USDC 0.05% #2
  {
    id: "Pool 12",
    name: "Meteora DLMM SOL/USDC 0.05% #2",
    dex: "meteora",
    address: "5XRqv7LCoC5FhWKk5JN8n4kCrJs3e4KH1XsYzKeMd5Nt",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.0005,
    vaultA: "EN1RTvqZ3BpLmpJVXqpMb6Sc2w8ncbA5imsTQmQtRCZg",
    vaultB: "BsLY7Qxh8NM61MDj6DK1UWdSprJfTEBPnp6Lc9iw2Gmw",
    minLiquidityUSD: 251318,
  },

  // Meteora DLMM SOL/USDC 0.10%
  {
    id: "Pool 13",
    name: "Meteora DLMM SOL/USDC 0.10%",
    dex: "meteora",
    address: "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
    tokenA: SOL_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "USDC",
    feeRate: 0.001,
    vaultA: "DwZz4S1Z1LBXomzmncQRVKCYhjCqSAMQ6RPKbUAadr7H",
    vaultB: "4N22J4vW2juHocTntJNmXywSonYjkndCwahjZ2cYLDgb",
    minLiquidityUSD: 7264233,
  },

  // ==================== BONK/SOL POOLS ====================

  // Orca Whirlpool BONK/SOL 0.05%
  {
    id: "Pool 14",
    name: "Orca Whirlpool BONK/SOL 0.05%",
    dex: "orca",
    address: "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9",
    tokenA: SOL_MINT,
    tokenB: BONK_MINT,
    tokenASymbol: "SOL",
    tokenBSymbol: "BONK",
    feeRate: 0.0005,
    vaultA: "ES7yhSrYeFo4U1PfJHNRkbfCWxCwPLk2DjrEbmN8bg58",
    vaultB: "4dmvFGeQH2eqa3ktNHMgm4wZ8vuTukBiK9M7gxW5oR9F",
    minLiquidityUSD: 598919,
  },

  // Orca Whirlpool BONK/SOL 0.30%
  {
    id: "Pool 15",
    name: "Orca Whirlpool BONK/SOL 0.30%",
    dex: "orca",
    address: "3ne4mWqdYuNiYrYZC9TrA3FcfuFdErghH97vNPbjicr1",
    tokenA: BONK_MINT,
    tokenB: SOL_MINT,
    tokenASymbol: "BONK",
    tokenBSymbol: "SOL",
    feeRate: 0.003,
    vaultA: "9MSyH6ptUM1a885FUhawyYLd6YfVjDRUhqib4Apqjm3Z",
    vaultB: "47BkLC5ReY8tfQF5Web2nk3zA4TKskdk8NARKuMGV8gE",
    minLiquidityUSD: 1142142,
  },

  // Orca Whirlpool BONK/SOL 1.00%
  {
    id: "Pool 16",
    name: "Orca Whirlpool BONK/SOL 1.00%",
    dex: "orca",
    address: "BqnpCdDLPV2pFdAaLnVidmn3G93RP2p5oRdGEY2sJGez",
    tokenA: BONK_MINT,
    tokenB: SOL_MINT,
    tokenASymbol: "BONK",
    tokenBSymbol: "SOL",
    feeRate: 0.01,
    vaultA: "HTsaYAZ5yhpk98Dm3fDKrTueieEDX34ZkUjeacQYoVSV",
    vaultB: "EA5NtnGXFe2zVnoov7gAcntreefhMTqXXTGWNerx41Jm",
    minLiquidityUSD: 469113,
  },

  // ==================== BONK/USDC POOLS ====================

  // Meteora DLMM BONK/USDC 0.20%
  {
    id: "Pool 17",
    name: "Meteora DLMM BONK/USDC 0.20%",
    dex: "meteora",
    address: "31p1hptjhFo6ZD8oBqkfutNXQKGGPyi7YcEAfsyKW777",
    tokenA: BONK_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "BONK",
    tokenBSymbol: "USDC",
    feeRate: 0.002,
    vaultA: "GdRr8u8c5deY6Sn22DLoCY6wNteb3vNTRUrJjbpf7dQf",
    vaultB: "AEfbLQLmA3CiaP4kMWrXfkRjcha4XcekD9bqpriM7aYS",
    minLiquidityUSD: 171450,
  },

  // Orca Whirlpool BONK/USDC 0.30%
  {
    id: "Pool 18",
    name: "Orca Whirlpool BONK/USDC 0.30%",
    dex: "orca",
    address: "8QaXeHBrShJTdtN1rWCccBxpSVvKksQ2PCu5nufb2zbk",
    tokenA: BONK_MINT,
    tokenB: USDC_MINT,
    tokenASymbol: "BONK",
    tokenBSymbol: "USDC",
    feeRate: 0.003,
    vaultA: "Ci4Xh3SRZ4uqZJULKFha3xWH2A31F7T6MNMnumFLeQMf",
    vaultB: "GRzFQNPFBgchFZ5AxfruZUDXALw2anp5ipLt281Qut76",
    minLiquidityUSD: 1107995,
  },
];

/* =========================
   PATH TYPES
========================= */

export type PathType = "1hop" | "2hop" | "3hop" | "4hop";

export interface ArbitragePath {
  pathId: string;
  pathType: PathType;
  pools: PoolConfig[];
  description: string;
  totalFeeRate: number;
}

/* =========================
   RISK PARAMETERS
========================= */

export const RISK_PARAMS = {
  // Trade size limits
  MAX_TRADE_SIZE_USD: 500,
  MIN_TRADE_SIZE_USD: 10,

  // Liquidity requirements
  MIN_POOL_LIQUIDITY_USD: 30000,
  MIN_TOTAL_PATH_LIQUIDITY_USD: 100000,

  // Slippage limits
  MAX_SLIPPAGE_PER_POOL: 0.03, // 3% max per pool
  MAX_TOTAL_SLIPPAGE: 0.10, // 10% max total

  // Profit thresholds by path type
  MIN_PROFIT_1HOP: 0.005, // 0.5% for 1-hop (fees ~0.04-0.30%)
  MIN_PROFIT_2HOP: 0.010, // 1.0% for 2-hop (fees ~0.54-0.60%)
  MIN_PROFIT_3HOP: 0.015, // 1.5% for 3-hop (fees ~0.79-0.90%)
  MIN_PROFIT_4HOP: 0.020, // 2.0% for 4-hop (fees ~1.04-1.20%)

  // Quote freshness
  MAX_QUOTE_AGE_MS: 2000, // 2 seconds max

  // Price impact limits
  MAX_PRICE_IMPACT_PER_POOL: 0.03, // 3%
};

/* =========================
   HELPER FUNCTIONS
========================= */

/**
 * Get pools by token pair
 */
export function getPoolsByPair(tokenA: string, tokenB: string): PoolConfig[] {
  return ALL_POOLS.filter(p =>
    (p.tokenA === tokenA && p.tokenB === tokenB) ||
    (p.tokenA === tokenB && p.tokenB === tokenA)
  );
}

/**
 * Get all USDC/SOL pools
 */
export function getUSDCSOLPools(): PoolConfig[] {
  return getPoolsByPair(USDC_MINT, SOL_MINT);
}

/**
 * Get all SOL/BONK pools
 */
export function getSOLBONKPools(): PoolConfig[] {
  return getPoolsByPair(SOL_MINT, BONK_MINT);
}

/**
 * Get all USDC/BONK pools
 */
export function getUSDCBONKPools(): PoolConfig[] {
  return getPoolsByPair(USDC_MINT, BONK_MINT);
}

/**
 * Get minimum profit threshold for path type
 */
export function getMinProfitThreshold(pathType: PathType): number {
  switch (pathType) {
    case "1hop": return RISK_PARAMS.MIN_PROFIT_1HOP;
    case "2hop": return RISK_PARAMS.MIN_PROFIT_2HOP;
    case "3hop": return RISK_PARAMS.MIN_PROFIT_3HOP;
    case "4hop": return RISK_PARAMS.MIN_PROFIT_4HOP;
  }
}

/* =========================
   DECIMAL CONSTANTS
========================= */

export const DECIMAL_ZERO = new Decimal(0);
export const DECIMAL_ONE = new Decimal(1);
export const DECIMAL_100 = new Decimal(100);

export const DECIMAL_USDC_MULTIPLIER = new Decimal(10).pow(USDC_DECIMALS);
export const DECIMAL_SOL_MULTIPLIER = new Decimal(10).pow(SOL_DECIMALS);
export const DECIMAL_BONK_MULTIPLIER = new Decimal(10).pow(BONK_DECIMALS);
