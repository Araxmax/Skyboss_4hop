/**
 * Static Pool Metadata Cache
 *
 * Pre-computed pool metadata that NEVER changes.
 * Fetched once on startup, cached forever.
 *
 * This eliminates repeated RPC calls for static data.
 */

import { PublicKey } from '@solana/web3.js';

export interface PoolMetadata {
  poolId: string;
  name: string;
  dex: 'ORCA' | 'RAYDIUM_CLMM' | 'METEORA';
  tokenA: string;
  tokenB: string;
  decimalsA: number;
  decimalsB: number;
  vaultA: PublicKey;
  vaultB: PublicKey;
  programId: PublicKey;
  feeRate: number;
  tickSpacing?: number;
  feeTier?: number;
}

/**
 * Static pool metadata - NEVER changes, fetch once
 */
export const POOL_METADATA_CACHE: Map<string, PoolMetadata> = new Map();

/**
 * Program IDs (Static)
 */
const ORCA_WHIRLPOOL_PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const METEORA_DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

/**
 * Token Decimals (Static)
 */
const TOKEN_DECIMALS: { [key: string]: number } = {
  'SOL': 9,
  'USDC': 6,
  'BONK': 5
};

/**
 * SOL/USDC Pools Metadata (Static)
 */
export const SOL_USDC_POOLS: PoolMetadata[] = [
  // Raydium CLMM SOL/USDC 0.01%
  {
    poolId: '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj',
    name: 'SOL/USDC (CLMM 0.01%)',
    dex: 'RAYDIUM_CLMM',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('6P4tvbzRY6Bh3MiWDHuLqyHywovsRwRpfskPvyeSoHsz'),
    vaultB: new PublicKey('6mK4Pxs6GhwnessH7CvPivqDYauiHZmAdbEFDpXFk9zt'),
    programId: RAYDIUM_CLMM_PROGRAM_ID,
    feeRate: 0.0001,
    feeTier: 100
  },
  // Meteora DLMM SOL/USDC 0.01%
  {
    poolId: 'HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR',
    name: 'SOL/USDC (DLMM 0.01%)',
    dex: 'METEORA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('H7j5NPopj3tQvDg4N8CxwtYciTn3e8AEV6wSVrxpyDUc'),
    vaultB: new PublicKey('HbYjRzx7teCxqW3unpXBEcNHhfVZvW2vW9MQ99TkizWt'),
    programId: METEORA_DLMM_PROGRAM_ID,
    feeRate: 0.0001,
    feeTier: 100
  },
  // Raydium CLMM SOL/USDC 0.02%
  {
    poolId: 'CYbD9RaToYMtWKA7QZyoLahnHdWq553Vm62Lh6qWtuxq',
    name: 'SOL/USDC (CLMM 0.02%)',
    dex: 'RAYDIUM_CLMM',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('GviiXg2Xc1xCpyNY36r7h1EAy7uvse5UMkiiyHjRDU6Z'),
    vaultB: new PublicKey('3bWPj5eepJm8CxUzk5MMFMN2CFJkntxKvbmy4zwwtpJd'),
    programId: RAYDIUM_CLMM_PROGRAM_ID,
    feeRate: 0.0002,
    feeTier: 200
  },
  // Orca Whirlpool SOL/USDC 0.02%
  {
    poolId: 'FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q',
    name: 'SOL/USDC (Whirlpool 0.02%)',
    dex: 'ORCA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('6mQ8xEaHdTikyMvvMxUctYch6dUjnKgfoeib2msyMMi1'),
    vaultB: new PublicKey('AQ36QRk3HAe6PHqBCtKTQnYKpt2kAagq9YoeTqUPMGHx'),
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    feeRate: 0.0002,
    feeTier: 200
  },
  // Raydium CLMM SOL/USDC 0.04%
  {
    poolId: '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv',
    name: 'SOL/USDC (CLMM 0.04%)',
    dex: 'RAYDIUM_CLMM',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('4ct7br2vTPzfdmY3S5HLtTxcGSBfn6pnw98hsS6v359A'),
    vaultB: new PublicKey('5it83u57VRrVgc51oNV19TTmAJuffPx5GtGwQr7gQNUo'),
    programId: RAYDIUM_CLMM_PROGRAM_ID,
    feeRate: 0.0004,
    feeTier: 400
  },
  // Meteora DLMM SOL/USDC 0.04%
  {
    poolId: '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
    name: 'SOL/USDC (DLMM 0.04%)',
    dex: 'METEORA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('EYj9xKw6ZszwpyNibHY7JD5o3QgTVrSdcBp1fMJhrR9o'),
    vaultB: new PublicKey('CoaxzEh8p5YyGLcj36Eo3cUThVJxeKCs7qvLAGDYwBcz'),
    programId: METEORA_DLMM_PROGRAM_ID,
    feeRate: 0.0004,
    feeTier: 400
  },
  // Meteora DLMM SOL/USDC 0.05%
  {
    poolId: 'CgqwPLSFfht89pF5RSKGUUMFj5zRxoUt4861w2SkXaqY',
    name: 'SOL/USDC (DLMM 0.05%)',
    dex: 'METEORA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('4jTcZiooRV5Z5sb29xroJEu1FnPJbadmZcnEbXFsUuXi'),
    vaultB: new PublicKey('AsAhzfi3u9gihEYzV3zq6VnkfvQaM7yF13wnsTfAk936'),
    programId: METEORA_DLMM_PROGRAM_ID,
    feeRate: 0.0005,
    feeTier: 500
  },
  // Raydium CLMM SOL/USDC 0.05%
  {
    poolId: '2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv',
    name: 'SOL/USDC (CLMM 0.05%)',
    dex: 'RAYDIUM_CLMM',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('E2BcoCeJLTa27mAXDA4xwEq3pBUcyH6XXEHYk4KvKYTv'),
    vaultB: new PublicKey('4d35yC7C8zhCDec7JbPptL9SEb4NUddKHxURgmvD8hfo'),
    programId: RAYDIUM_CLMM_PROGRAM_ID,
    feeRate: 0.0005,
    feeTier: 500
  },
  // Orca Whirlpool SOL/USDC 0.05%
  {
    poolId: '7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm',
    name: 'SOL/USDC (Whirlpool 0.05%)',
    dex: 'ORCA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('9RfZwn2Prux6QesG1Noo4HzMEBv3rPndJ2bN2Wwd6a7p'),
    vaultB: new PublicKey('BVNo8ftg2LkkssnWT4ZWdtoFaevnfD6ExYeramwM27pe'),
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    feeRate: 0.0005,
    feeTier: 500
  },
  // Meteora DLMM SOL/USDC 0.05% (second pool)
  {
    poolId: '5XRqv7LCoC5FhWKk5JN8n4kCrJs3e4KH1XsYzKeMd5Nt',
    name: 'SOL/USDC (DLMM 0.05% #2)',
    dex: 'METEORA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('EN1RTvqZ3BpLmpJVXqpMb6Sc2w8ncbA5imsTQmQtRCZg'),
    vaultB: new PublicKey('BsLY7Qxh8NM61MDj6DK1UWdSprJfTEBPnp6Lc9iw2Gmw'),
    programId: METEORA_DLMM_PROGRAM_ID,
    feeRate: 0.0005,
    feeTier: 500
  },
  // Meteora DLMM SOL/USDC 0.10%
  {
    poolId: 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y',
    name: 'SOL/USDC (DLMM 0.10%)',
    dex: 'METEORA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    decimalsA: 9,
    decimalsB: 6,
    vaultA: new PublicKey('DwZz4S1Z1LBXomzmncQRVKCYhjCqSAMQ6RPKbUAadr7H'),
    vaultB: new PublicKey('4N22J4vW2juHocTntJNmXywSonYjkndCwahjZ2cYLDgb'),
    programId: METEORA_DLMM_PROGRAM_ID,
    feeRate: 0.001,
    feeTier: 1000
  }
];

/**
 * BONK/SOL Pools Metadata (Static)
 */
export const BONK_SOL_POOLS: PoolMetadata[] = [
  // Orca Whirlpool BONK/SOL 0.05%
  {
    poolId: '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9',
    name: 'BONK/SOL (Whirlpool 0.05%)',
    dex: 'ORCA',
    tokenA: 'SOL',
    tokenB: 'BONK',
    decimalsA: 9,
    decimalsB: 5,
    vaultA: new PublicKey('ES7yhSrYeFo4U1PfJHNRkbfCWxCwPLk2DjrEbmN8bg58'),
    vaultB: new PublicKey('4dmvFGeQH2eqa3ktNHMgm4wZ8vuTukBiK9M7gxW5oR9F'),
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    feeRate: 0.0005,
    feeTier: 500
  },
  // Orca Whirlpool BONK/SOL 0.30%
  {
    poolId: '3ne4mWqdYuNiYrYZC9TrA3FcfuFdErghH97vNPbjicr1',
    name: 'BONK/SOL (Whirlpool 0.30%)',
    dex: 'ORCA',
    tokenA: 'BONK',
    tokenB: 'SOL',
    decimalsA: 5,
    decimalsB: 9,
    vaultA: new PublicKey('9MSyH6ptUM1a885FUhawyYLd6YfVjDRUhqib4Apqjm3Z'),
    vaultB: new PublicKey('47BkLC5ReY8tfQF5Web2nk3zA4TKskdk8NARKuMGV8gE'),
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    feeRate: 0.003,
    feeTier: 3000
  },
  // Orca Whirlpool BONK/SOL 1.00%
  {
    poolId: 'BqnpCdDLPV2pFdAaLnVidmn3G93RP2p5oRdGEY2sJGez',
    name: 'BONK/SOL (Whirlpool 1.00%)',
    dex: 'ORCA',
    tokenA: 'BONK',
    tokenB: 'SOL',
    decimalsA: 5,
    decimalsB: 9,
    vaultA: new PublicKey('HTsaYAZ5yhpk98Dm3fDKrTueieEDX34ZkUjeacQYoVSV'),
    vaultB: new PublicKey('EA5NtnGXFe2zVnoov7gAcntreefhMTqXXTGWNerx41Jm'),
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    feeRate: 0.01,
    feeTier: 10000
  }
];

/**
 * BONK/USDC Pools Metadata (Static)
 */
export const BONK_USDC_POOLS: PoolMetadata[] = [
  // Meteora DLMM BONK/USDC 0.20%
  {
    poolId: '31p1hptjhFo6ZD8oBqkfutNXQKGGPyi7YcEAfsyKW777',
    name: 'BONK/USDC (DLMM 0.20%)',
    dex: 'METEORA',
    tokenA: 'BONK',
    tokenB: 'USDC',
    decimalsA: 5,
    decimalsB: 6,
    vaultA: new PublicKey('GdRr8u8c5deY6Sn22DLoCY6wNteb3vNTRUrJjbpf7dQf'),
    vaultB: new PublicKey('AEfbLQLmA3CiaP4kMWrXfkRjcha4XcekD9bqpriM7aYS'),
    programId: METEORA_DLMM_PROGRAM_ID,
    feeRate: 0.002,
    feeTier: 2000
  },
  // Orca Whirlpool BONK/USDC 0.30%
  {
    poolId: '8QaXeHBrShJTdtN1rWCccBxpSVvKksQ2PCu5nufb2zbk',
    name: 'BONK/USDC (Whirlpool 0.30%)',
    dex: 'ORCA',
    tokenA: 'BONK',
    tokenB: 'USDC',
    decimalsA: 5,
    decimalsB: 6,
    vaultA: new PublicKey('Ci4Xh3SRZ4uqZJULKFha3xWH2A31F7T6MNMnumFLeQMf'),
    vaultB: new PublicKey('GRzFQNPFBgchFZ5AxfruZUDXALw2anp5ipLt281Qut76'),
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    feeRate: 0.003,
    feeTier: 3000
  }
];

/**
 * All Pools Combined
 */
export const ALL_POOLS_METADATA: PoolMetadata[] = [
  ...SOL_USDC_POOLS,
  ...BONK_SOL_POOLS,
  ...BONK_USDC_POOLS
];

/**
 * Initialize metadata cache (call once on startup)
 */
export function initializeMetadataCache(): void {
  console.log('[PoolMetadataCache] Initializing static metadata cache...');

  let count = 0;

  // Add all pools to cache
  for (const pool of ALL_POOLS_METADATA) {
    POOL_METADATA_CACHE.set(pool.poolId, pool);
    count++;
  }

  console.log(`[PoolMetadataCache] ✅ Cached ${count} pool metadata entries`);
  console.log(`  - SOL/USDC pools: ${SOL_USDC_POOLS.length}`);
  console.log(`  - BONK/SOL pools: ${BONK_SOL_POOLS.length}`);
  console.log(`  - BONK/USDC pools: ${BONK_USDC_POOLS.length}`);
}

/**
 * Get pool metadata (instant, no RPC call)
 */
export function getPoolMetadata(poolId: string): PoolMetadata | undefined {
  return POOL_METADATA_CACHE.get(poolId);
}

/**
 * Get all cached pool IDs
 */
export function getAllPoolIds(): string[] {
  return Array.from(POOL_METADATA_CACHE.keys());
}

/**
 * Get pools by DEX
 */
export function getPoolsByDex(dex: 'ORCA' | 'RAYDIUM_CLMM' | 'METEORA'): PoolMetadata[] {
  return Array.from(POOL_METADATA_CACHE.values()).filter(p => p.dex === dex);
}

/**
 * Get pools by token pair
 */
export function getPoolsByTokenPair(tokenA: string, tokenB: string): PoolMetadata[] {
  return Array.from(POOL_METADATA_CACHE.values()).filter(p =>
    (p.tokenA === tokenA && p.tokenB === tokenB) ||
    (p.tokenA === tokenB && p.tokenB === tokenA)
  );
}

/**
 * Get pool statistics
 */
export function getPoolStats() {
  const allPools = Array.from(POOL_METADATA_CACHE.values());

  return {
    total: allPools.length,
    byDex: {
      orca: allPools.filter(p => p.dex === 'ORCA').length,
      raydium: allPools.filter(p => p.dex === 'RAYDIUM_CLMM').length,
      meteora: allPools.filter(p => p.dex === 'METEORA').length
    },
    byPair: {
      solUsdc: getPoolsByTokenPair('SOL', 'USDC').length,
      bonkSol: getPoolsByTokenPair('BONK', 'SOL').length,
      bonkUsdc: getPoolsByTokenPair('BONK', 'USDC').length
    }
  };
}
