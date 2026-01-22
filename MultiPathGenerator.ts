import {
  PoolConfig,
  ArbitragePath,
  PathType,
  USDC_MINT,
  SOL_MINT,
  BONK_MINT,
  getUSDCSOLPools,
  getSOLBONKPools,
  getUSDCBONKPools,
} from "./MultiPathConstants";

/* =========================
   Generates ONLY specified arbitrage paths:
   - 1-hop: USDC -> SOL -> USDC (only)
   - 2-hop: USDC -> SOL -> BONK -> USDC (only)
   - 3-hop: USDC -> SOL -> BONK -> SOL -> USDC (only)
   - 4-hop: USDC <-> SOL bidirectional OR USDC <-> BONK bidirectional
========================= */

export class MultiPathGenerator {
  private pathCounter: number = 0;

  /**
   * Generate ONLY specified arbitrage paths
   */
  generateAllPaths(): ArbitragePath[] {
    const paths: ArbitragePath[] = [];

    // 1-hop paths
    paths.push(...this.generate1HopPaths());

    // 2-hop paths
    paths.push(...this.generate2HopPaths());

    // 3-hop paths
    paths.push(...this.generate3HopPaths());

    // 4-hop paths
    paths.push(...this.generate4HopPaths());

    return paths;
  }

  /**
   * 1-HOP PATHS (RESTRICTED)
   * Route: USDC -> SOL -> USDC (ONLY)
   * No BONK paths for 1-hop
   */
  private generate1HopPaths(): ArbitragePath[] {
    const paths: ArbitragePath[] = [];

    // USDC -> SOL -> USDC (ONLY THIS ROUTE)
    const usdcSolPools = getUSDCSOLPools();
    for (const buyPool of usdcSolPools) {
      for (const sellPool of usdcSolPools) {
        if (buyPool.id !== sellPool.id) {
          paths.push({
            pathId: `1hop_${++this.pathCounter}`,
            pathType: "1hop",
            pools: [buyPool, sellPool],
            description: `Buy SOL on ${buyPool.name}, Sell SOL on ${sellPool.name}`,
            totalFeeRate: buyPool.feeRate + sellPool.feeRate,
          });
        }
      }
    }

    return paths;
  }

  /**
   * 2-HOP PATHS (RESTRICTED)
   * Route: USDC -> SOL -> BONK -> USDC (ONLY)
   * No other 2-hop routes allowed
   */
  private generate2HopPaths(): ArbitragePath[] {
    const paths: ArbitragePath[] = [];

    const usdcSolPools = getUSDCSOLPools();
    const solBonkPools = getSOLBONKPools();
    const usdcBonkPools = getUSDCBONKPools();

    // ONLY Route: USDC -> SOL -> BONK -> USDC
    for (const pool1 of usdcSolPools) {      // USDC -> SOL
      for (const pool2 of solBonkPools) {    // SOL -> BONK
        for (const pool3 of usdcBonkPools) { // BONK -> USDC
          paths.push({
            pathId: `2hop_${++this.pathCounter}`,
            pathType: "2hop",
            pools: [pool1, pool2, pool3],
            description: `${pool1.name} -> ${pool2.name} -> ${pool3.name}`,
            totalFeeRate: pool1.feeRate + pool2.feeRate + pool3.feeRate,
          });
        }
      }
    }

    return paths;
  }

  /**
   * 3-HOP PATHS (RESTRICTED)
   * Route: USDC -> SOL -> BONK -> SOL -> USDC (ONLY)
   */
  private generate3HopPaths(): ArbitragePath[] {
    const paths: ArbitragePath[] = [];

    const usdcSolPools = getUSDCSOLPools();
    const solBonkPools = getSOLBONKPools();

    // ONLY Route: USDC -> SOL -> BONK -> SOL -> USDC
    for (const pool1 of usdcSolPools) {      // USDC -> SOL
      for (const pool2 of solBonkPools) {    // SOL -> BONK
        for (const pool3 of solBonkPools) {  // BONK -> SOL (reverse)
          if (pool2.id !== pool3.id) {
            for (const pool4 of usdcSolPools) { // SOL -> USDC
              if (pool1.id !== pool4.id) {
                paths.push({
                  pathId: `3hop_${++this.pathCounter}`,
                  pathType: "3hop",
                  pools: [pool1, pool2, pool3, pool4],
                  description: `${pool1.name} -> ${pool2.name} -> ${pool3.name} -> ${pool4.name}`,
                  totalFeeRate: pool1.feeRate + pool2.feeRate + pool3.feeRate + pool4.feeRate,
                });
              }
            }
          }
        }
      }
    }

    return paths;
  }

  /**
   * 4-HOP PATHS (RESTRICTED)
   * Two bidirectional routes ONLY:
   * A) USDC -> SOL <-> SOL -> USDC (bidirectional SOL trading)
   * B) USDC -> BONK <-> BONK -> USDC (bidirectional BONK trading)
   */
  private generate4HopPaths(): ArbitragePath[] {
    const paths: ArbitragePath[] = [];

    const usdcSolPools = getUSDCSOLPools();
    const usdcBonkPools = getUSDCBONKPools();

    // Route A: USDC -> SOL <-> SOL -> USDC (bidirectional SOL trade)
    for (const pool1 of usdcSolPools) { // Buy SOL
      for (const pool2 of usdcSolPools) { // Sell SOL
        if (pool1.id !== pool2.id) {
          for (const pool3 of usdcSolPools) { // Buy SOL again
            if (pool3.id !== pool1.id && pool3.id !== pool2.id) {
              for (const pool4 of usdcSolPools) { // Sell SOL again
                if (pool4.id !== pool1.id && pool4.id !== pool2.id && pool4.id !== pool3.id) {
                  paths.push({
                    pathId: `4hop_${++this.pathCounter}`,
                    pathType: "4hop",
                    pools: [pool1, pool2, pool3, pool4],
                    description: `${pool1.name} <-> ${pool2.name} <-> ${pool3.name} <-> ${pool4.name}`,
                    totalFeeRate: pool1.feeRate + pool2.feeRate + pool3.feeRate + pool4.feeRate,
                  });
                }
              }
            }
          }
        }
      }
    }

    // Route B: USDC -> BONK <-> BONK -> USDC (bidirectional BONK trade)
    for (const pool1 of usdcBonkPools) { // Buy BONK
      for (const pool2 of usdcBonkPools) { // Sell BONK
        if (pool1.id !== pool2.id) {
          for (const pool3 of usdcBonkPools) { // Buy BONK again
            if (pool3.id !== pool1.id && pool3.id !== pool2.id) {
              for (const pool4 of usdcBonkPools) { // Sell BONK again
                if (pool4.id !== pool1.id && pool4.id !== pool2.id && pool4.id !== pool3.id) {
                  paths.push({
                    pathId: `4hop_${++this.pathCounter}`,
                    pathType: "4hop",
                    pools: [pool1, pool2, pool3, pool4],
                    description: `${pool1.name} <-> ${pool2.name} <-> ${pool3.name} <-> ${pool4.name}`,
                    totalFeeRate: pool1.feeRate + pool2.feeRate + pool3.feeRate + pool4.feeRate,
                  });
                }
              }
            }
          }
        }
      }
    }

    return paths;
  }

  /**
   * Generate paths by type
   */
  generatePathsByType(pathType: PathType): ArbitragePath[] {
    switch (pathType) {
      case "1hop":
        return this.generate1HopPaths();
      case "2hop":
        return this.generate2HopPaths();
      case "3hop":
        return this.generate3HopPaths();
      case "4hop":
        return this.generate4HopPaths();
    }
  }

  /**
   * Get path summary statistics
   */
  getPathStats(paths: ArbitragePath[]): {
    total: number;
    byType: Record<PathType, number>;
    avgFeeRate: number;
    minFeeRate: number;
    maxFeeRate: number;
  } {
    const byType: Record<PathType, number> = {
      "1hop": 0,
      "2hop": 0,
      "3hop": 0,
      "4hop": 0,
    };

    let totalFees = 0;
    let minFee = Infinity;
    let maxFee = 0;

    for (const path of paths) {
      byType[path.pathType]++;
      totalFees += path.totalFeeRate;
      minFee = Math.min(minFee, path.totalFeeRate);
      maxFee = Math.max(maxFee, path.totalFeeRate);
    }

    return {
      total: paths.length,
      byType,
      avgFeeRate: paths.length > 0 ? totalFees / paths.length : 0,
      minFeeRate: minFee === Infinity ? 0 : minFee,
      maxFeeRate: maxFee,
    };
  }
}

/**
 * Helper: Print path summary
 */
export function printPathSummary(paths: ArbitragePath[]): void {
  const generator = new MultiPathGenerator();
  const stats = generator.getPathStats(paths);

  console.log("\n" + "=".repeat(80));
  console.log("PATH GENERATION SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total Paths: ${stats.total}`);
  console.log();
  console.log("By Type:");
  console.log(`  1-hop paths: ${stats.byType["1hop"]}`);
  console.log(`  2-hop paths: ${stats.byType["2hop"]}`);
  console.log(`  3-hop paths: ${stats.byType["3hop"]}`);
  console.log(`  4-hop paths: ${stats.byType["4hop"]}`);
  console.log();
  console.log("Fee Statistics:");
  console.log(`  Average fee: ${(stats.avgFeeRate * 100).toFixed(3)}%`);
  console.log(`  Min fee: ${(stats.minFeeRate * 100).toFixed(3)}%`);
  console.log(`  Max fee: ${(stats.maxFeeRate * 100).toFixed(3)}%`);
  console.log("=".repeat(80));
}
