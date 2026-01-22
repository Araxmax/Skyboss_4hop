/**
 * Static Pool Metadata Cache - LITE VERSION
 *
 * Reduced to 8 most liquid pools to work with free RPC
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
 * SOL/USDC Pools - Top 6 by liquidity
 */
export const SOL_USDC_POOLS: PoolMetadata[] = [
  // Raydium CLMM SOL/USDC 0.04% - $10.7M liquidity (HIGHEST)
  {
    poolId: '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv',
    name: 'SOL/USDC (CLMM 0.04%)',
    dex: 'RAYDIUM_CLMM',
    tokenA: 'SOL',
    tokenB: 'USDC',
    vaultA: new PublicKey('4ct7br2vTPzfdmY3S5HLtTxcGSBfn6pnw98hsS6v359A'),
    vaultB: new PublicKey('5it83u57VRrVgc51oNV19TTmAJuffPx5GtGwQr7gQNUo'),
    programId: RAYDIUM_CLMM_PROGRAM_ID,
    feeRate: 0.0004,
    feeTier: 400
  },
  // Meteora DLMM SOL/USDC 0.10% - $7.3M liquidity
  {
    poolId: 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y',
    name: 'SOL/USDC (DLMM 0.10%)',
    dex: 'METEORA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    vaultA: new PublicKey('DwZz4S1Z1LBXomzmncQRVKCYhjCqSAMQ6RPKbUAadr7H'),
    vaultB: new PublicKey('4N22J4vW2juHocTntJNmXywSonYjkndCwahjZ2cYLDgb'),
    programId: METEORA_DLMM_PROGRAM_ID,
    feeRate: 0.001,
    feeTier: 1000
  },
  // Meteora DLMM SOL/USDC 0.04% - $2.9M liquidity
  {
    poolId: '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
    name: 'SOL/USDC (DLMM 0.04%)',
    dex: 'METEORA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    vaultA: new PublicKey('EYj9xKw6ZszwpyNibHY7JD5o3QgTVrSdcBp1fMJhrR9o'),
    vaultB: new PublicKey('CoaxzEh8p5YyGLcj36Eo3cUThVJxeKCs7qvLAGDYwBcz'),
    programId: METEORA_DLMM_PROGRAM_ID,
    feeRate: 0.0004,
    feeTier: 400
  },
  // Raydium CLMM SOL/USDC 0.02% - $1.1M liquidity
  {
    poolId: 'CYbD9RaToYMtWKA7QZyoLahnHdWq553Vm62Lh6qWtuxq',
    name: 'SOL/USDC (CLMM 0.02%)',
    dex: 'RAYDIUM_CLMM',
    tokenA: 'SOL',
    tokenB: 'USDC',
    vaultA: new PublicKey('GviiXg2Xc1xCpyNY36r7h1EAy7uvse5UMkiiyHjRDU6Z'),
    vaultB: new PublicKey('3bWPj5eepJm8CxUzk5MMFMN2CFJkntxKvbmy4zwwtpJd'),
    programId: RAYDIUM_CLMM_PROGRAM_ID,
    feeRate: 0.0002,
    feeTier: 200
  },
  // Orca Whirlpool SOL/USDC 0.02% - $578K liquidity
  {
    poolId: 'FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q',
    name: 'SOL/USDC (Whirlpool 0.02%)',
    dex: 'ORCA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    vaultA: new PublicKey('6mQ8xEaHdTikyMvvMxUctYch6dUjnKgfoeib2msyMMi1'),
    vaultB: new PublicKey('AQ36QRk3HAe6PHqBCtKTQnYKpt2kAagq9YoeTqUPMGHx'),
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    feeRate: 0.0002,
    feeTier: 200
  },
  // Orca Whirlpool SOL/USDC 0.05% - $521K liquidity
  {
    poolId: '7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm',
    name: 'SOL/USDC (Whirlpool 0.05%)',
    dex: 'ORCA',
    tokenA: 'SOL',
    tokenB: 'USDC',
    vaultA: new PublicKey('9RfZwn2Prux6QesG1Noo4HzMEBv3rPndJ2bN2Wwd6a7p'),
    vaultB: new PublicKey('BVNo8ftg2LkkssnWT4ZWdtoFaevnfD6ExYeramwM27pe'),
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    feeRate: 0.0005,
    feeTier: 500
  }
];

/**
 * BONK/SOL Pools - Top 2 by liquidity
 */
export const BONK_SOL_POOLS: PoolMetadata[] = [
  // Orca Whirlpool BONK/SOL 0.30% - $1.1M liquidity (HIGHEST)
  {
    poolId: '3ne4mWqdYuNiYrYZC9TrA3FcfuFdErghH97vNPbjicr1',
    name: 'BONK/SOL (Whirlpool 0.30%)',
    dex: 'ORCA',
    tokenA: 'BONK',
    tokenB: 'SOL',
    vaultA: new PublicKey('9MSyH6ptUM1a885FUhawyYLd6YfVjDRUhqib4Apqjm3Z'),
    vaultB: new PublicKey('47BkLC5ReY8tfQF5Web2nk3zA4TKskdk8NARKuMGV8gE'),
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    feeRate: 0.003,
    feeTier: 3000
  },
  // Orca Whirlpool BONK/SOL 0.05% - $599K liquidity
  {
    poolId: '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9',
    name: 'BONK/SOL (Whirlpool 0.05%)',
    dex: 'ORCA',
    tokenA: 'SOL',
    tokenB: 'BONK',
    vaultA: new PublicKey('ES7yhSrYeFo4U1PfJHNRkbfCWxCwPLk2DjrEbmN8bg58'),
    vaultB: new PublicKey('4dmvFGeQH2eqa3ktNHMgm4wZ8vuTukBiK9M7gxW5oR9F'),
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    feeRate: 0.0005,
    feeTier: 500
  }
];

/**
 * All Pools Combined (8 TOTAL)
 */
export const ALL_POOLS_METADATA: PoolMetadata[] = [
  ...SOL_USDC_POOLS,
  ...BONK_SOL_POOLS
];

/**
 * Initialize metadata cache (call once on startup)
 */
export function initializeMetadataCache(): void {
  console.log('[PoolMetadataCache] Initializing LITE metadata cache (8 pools)...');

  let count = 0;

  // Add all pools to cache
  for (const pool of ALL_POOLS_METADATA) {
    POOL_METADATA_CACHE.set(pool.poolId, pool);
    count++;
  }

  console.log(`[PoolMetadataCache] ✅ Cached ${count} pool metadata entries (LITE)`);
  console.log(`  - SOL/USDC pools: ${SOL_USDC_POOLS.length}`);
  console.log(`  - BONK/SOL pools: ${BONK_SOL_POOLS.length}`);
  console.log(`  Note: Reduced to 8 most liquid pools for free RPC`);
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
      bonkSol: getPoolsByTokenPair('BONK', 'SOL').length
    }
  };
}
