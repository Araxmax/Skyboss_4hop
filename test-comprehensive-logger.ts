import {
  ComprehensiveLogger,
  OpportunityData,
  ExecutedTradeData,
  PoolDetail
} from "./ComprehensiveLogger";

/**
 * Test the comprehensive logging system
 * This demonstrates how to use all three CSV files
 */

async function testComprehensiveLogger() {
  console.log("🧪 Testing Comprehensive Logger\n");

  // Initialize logger (will save to ./logs directory)
  const logger = new ComprehensiveLogger("./logs");
  console.log("✅ Logger initialized\n");

  // ============================================
  // SCAN #1: Simulate a scan with mixed results
  // ============================================
  console.log("📊 Scan #1: Simulating 5 opportunities (3 tradable, 2 non-tradable)\n");

  const scan1Opportunities: OpportunityData[] = [
    // Opportunity 1: TRADABLE (Best profit)
    {
      timestamp: new Date().toISOString(),
      scanNumber: 1,
      pathId: "path_001",
      pathType: "2hop",
      description: "Orca SOL/USDC -> Raydium SOL/USDC",
      tokenPath: "USDC->SOL->USDC",
      poolPath: "Orca_SOL_USDC->Raydium_SOL_USDC",
      poolCount: 2,
      initialAmount: 100,
      finalAmount: 100.52,
      grossProfitUSDC: 0.52,
      grossProfitPct: 0.52,
      netProfitUSDC: 0.48,
      netProfitPct: 0.48,
      totalFeesPct: 0.04,
      totalPriceImpactPct: 0.05,
      estimatedSlippagePct: 0.05,
      totalLiquidityUSD: 150000,
      minPoolLiquidityUSD: 50000,
      avgPoolLiquidityUSD: 75000,
      pools: [
        {
          poolName: "Orca_SOL_USDC",
          tokenIn: "USDC",
          tokenOut: "SOL",
          amountIn: 100,
          amountOut: 0.495,
          feeRatePct: 0.02,
          priceImpactPct: 0.03,
          liquidityUSD: 80000,
          isValid: true
        },
        {
          poolName: "Raydium_SOL_USDC",
          tokenIn: "SOL",
          tokenOut: "USDC",
          amountIn: 0.495,
          amountOut: 100.48,
          feeRatePct: 0.02,
          priceImpactPct: 0.02,
          liquidityUSD: 70000,
          isValid: true
        }
      ],
      isTradable: true,
      failureReason: "",
      simulationTimeMs: 15
    },

    // Opportunity 2: NON-TRADABLE (Price impact too high)
    {
      timestamp: new Date().toISOString(),
      scanNumber: 1,
      pathId: "path_002",
      pathType: "3hop",
      description: "3-hop via BONK with high impact",
      tokenPath: "USDC->SOL->BONK->USDC",
      poolPath: "Orca_SOL_USDC->Orca_BONK_SOL->Raydium_BONK_USDC",
      poolCount: 3,
      initialAmount: 100,
      finalAmount: 100.35,
      grossProfitUSDC: 0.35,
      grossProfitPct: 0.35,
      netProfitUSDC: 0.20,
      netProfitPct: 0.20,
      totalFeesPct: 0.06,
      totalPriceImpactPct: 1.52, // TOO HIGH!
      estimatedSlippagePct: 1.52,
      totalLiquidityUSD: 25000,
      minPoolLiquidityUSD: 5000,
      avgPoolLiquidityUSD: 8333,
      pools: [
        {
          poolName: "Orca_SOL_USDC",
          tokenIn: "USDC",
          tokenOut: "SOL",
          amountIn: 100,
          amountOut: 0.495,
          feeRatePct: 0.02,
          priceImpactPct: 0.03,
          liquidityUSD: 15000,
          isValid: true
        },
        {
          poolName: "Orca_BONK_SOL",
          tokenIn: "SOL",
          tokenOut: "BONK",
          amountIn: 0.495,
          amountOut: 50000,
          feeRatePct: 0.02,
          priceImpactPct: 1.20, // HIGH IMPACT
          liquidityUSD: 5000,
          isValid: true
        },
        {
          poolName: "Raydium_BONK_USDC",
          tokenIn: "BONK",
          tokenOut: "USDC",
          amountIn: 50000,
          amountOut: 100.20,
          feeRatePct: 0.02,
          priceImpactPct: 0.29,
          liquidityUSD: 5000,
          isValid: true
        }
      ],
      isTradable: false,
      failureReason: "Total impact 1.52% > 1.0% max allowed",
      simulationTimeMs: 22
    },

    // Opportunity 3: TRADABLE (Good 1-hop arb)
    {
      timestamp: new Date().toISOString(),
      scanNumber: 1,
      pathId: "path_003",
      pathType: "1hop",
      description: "Simple 1-hop round-trip",
      tokenPath: "USDC->SOL->USDC",
      poolPath: "Orca_SOL_USDC(round-trip)",
      poolCount: 2,
      initialAmount: 50,
      finalAmount: 50.22,
      grossProfitUSDC: 0.22,
      grossProfitPct: 0.44,
      netProfitUSDC: 0.20,
      netProfitPct: 0.40,
      totalFeesPct: 0.04,
      totalPriceImpactPct: 0.02,
      estimatedSlippagePct: 0.02,
      totalLiquidityUSD: 200000,
      minPoolLiquidityUSD: 100000,
      avgPoolLiquidityUSD: 100000,
      pools: [
        {
          poolName: "Orca_SOL_USDC",
          tokenIn: "USDC",
          tokenOut: "SOL",
          amountIn: 50,
          amountOut: 0.248,
          feeRatePct: 0.02,
          priceImpactPct: 0.01,
          liquidityUSD: 100000,
          isValid: true
        },
        {
          poolName: "Orca_SOL_USDC",
          tokenIn: "SOL",
          tokenOut: "USDC",
          amountIn: 0.248,
          amountOut: 50.20,
          feeRatePct: 0.02,
          priceImpactPct: 0.01,
          liquidityUSD: 100000,
          isValid: true
        }
      ],
      isTradable: true,
      failureReason: "",
      simulationTimeMs: 10
    },

    // Opportunity 4: NON-TRADABLE (Profit too low)
    {
      timestamp: new Date().toISOString(),
      scanNumber: 1,
      pathId: "path_004",
      pathType: "2hop",
      description: "Low profit opportunity",
      tokenPath: "USDC->SOL->USDC",
      poolPath: "Orca_SOL_USDC->Raydium_SOL_USDC",
      poolCount: 2,
      initialAmount: 100,
      finalAmount: 100.03,
      grossProfitUSDC: 0.03,
      grossProfitPct: 0.03,
      netProfitUSDC: 0.02,
      netProfitPct: 0.02,
      totalFeesPct: 0.01,
      totalPriceImpactPct: 0.01,
      estimatedSlippagePct: 0.01,
      totalLiquidityUSD: 120000,
      minPoolLiquidityUSD: 60000,
      avgPoolLiquidityUSD: 60000,
      pools: [
        {
          poolName: "Orca_SOL_USDC",
          tokenIn: "USDC",
          tokenOut: "SOL",
          amountIn: 100,
          amountOut: 0.495,
          feeRatePct: 0.02,
          priceImpactPct: 0.01,
          liquidityUSD: 60000,
          isValid: true
        },
        {
          poolName: "Raydium_SOL_USDC",
          tokenIn: "SOL",
          tokenOut: "USDC",
          amountIn: 0.495,
          amountOut: 100.02,
          feeRatePct: 0.02,
          priceImpactPct: 0.01,
          liquidityUSD: 60000,
          isValid: true
        }
      ],
      isTradable: false,
      failureReason: "Net profit $0.02 < $0.05 minimum required",
      simulationTimeMs: 12
    },

    // Opportunity 5: TRADABLE (Medium profit 3-hop)
    {
      timestamp: new Date().toISOString(),
      scanNumber: 1,
      pathId: "path_005",
      pathType: "3hop",
      description: "3-hop via BONK (good liquidity)",
      tokenPath: "USDC->SOL->BONK->USDC",
      poolPath: "Orca_SOL_USDC->Orca_BONK_SOL->Raydium_BONK_USDC",
      poolCount: 3,
      initialAmount: 100,
      finalAmount: 100.38,
      grossProfitUSDC: 0.38,
      grossProfitPct: 0.38,
      netProfitUSDC: 0.30,
      netProfitPct: 0.30,
      totalFeesPct: 0.06,
      totalPriceImpactPct: 0.12,
      estimatedSlippagePct: 0.12,
      totalLiquidityUSD: 90000,
      minPoolLiquidityUSD: 20000,
      avgPoolLiquidityUSD: 30000,
      pools: [
        {
          poolName: "Orca_SOL_USDC",
          tokenIn: "USDC",
          tokenOut: "SOL",
          amountIn: 100,
          amountOut: 0.495,
          feeRatePct: 0.02,
          priceImpactPct: 0.03,
          liquidityUSD: 50000,
          isValid: true
        },
        {
          poolName: "Orca_BONK_SOL",
          tokenIn: "SOL",
          tokenOut: "BONK",
          amountIn: 0.495,
          amountOut: 50000,
          feeRatePct: 0.02,
          priceImpactPct: 0.05,
          liquidityUSD: 20000,
          isValid: true
        },
        {
          poolName: "Raydium_BONK_USDC",
          tokenIn: "BONK",
          tokenOut: "USDC",
          amountIn: 50000,
          amountOut: 100.30,
          feeRatePct: 0.02,
          priceImpactPct: 0.04,
          liquidityUSD: 20000,
          isValid: true
        }
      ],
      isTradable: true,
      failureReason: "",
      simulationTimeMs: 18
    }
  ];

  // ✅ LOG ALL OPPORTUNITIES (File 1)
  logger.logAllOpportunities(1, scan1Opportunities);
  console.log(`✅ Logged ${scan1Opportunities.length} opportunities to ALL_OPPORTUNITIES.csv`);

  // ✅ LOG TRADABLE OPPORTUNITIES ONLY (File 2)
  logger.logTradableOpportunities(1, scan1Opportunities);
  const tradableCount = scan1Opportunities.filter(o => o.isTradable).length;
  console.log(`✅ Logged ${tradableCount} tradable opportunities to TRADABLE_OPPORTUNITIES.csv\n`);

  // ============================================
  // EXECUTION #1: Execute best opportunity (path_001)
  // ============================================
  console.log("🚀 Executing path_001 (Best opportunity)\n");

  const executedTrade1: ExecutedTradeData = {
    timestamp: new Date().toISOString(),
    scanNumber: 1,
    pathId: "path_001",
    pathType: "2hop",
    opportunityRank: 1,
    estimatedProfitUSDC: 0.48,
    estimatedProfitPct: 0.48,
    tradeAmountUSDC: 100,
    executionMode: "LIVE",
    executionStrategy: "ATOMIC",
    executionTimeMs: 1250,
    executionStatus: "SUCCESS",
    actualProfitUSDC: 0.45, // Slight slippage
    actualProfitPct: 0.45,
    slippagePct: 6.25, // Lost 6.25% of expected profit to slippage
    txSignatures: "5Xy9aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5",
    txFeeSOL: 0.000005,
    blockTime: Date.now(),
    preBalanceUSDC: 1000,
    postBalanceUSDC: 1000.45,
    preBalanceSOL: 10.5,
    postBalanceSOL: 10.499995
  };

  // ✅ LOG EXECUTED TRADE (File 3)
  logger.logExecutedTrade(executedTrade1);
  console.log("✅ Logged successful trade to EXECUTED_TRADES.csv");
  console.log(`   Actual profit: $${executedTrade1.actualProfitUSDC.toFixed(6)}`);
  console.log(`   Slippage: ${executedTrade1.slippagePct.toFixed(2)}%\n`);

  // ============================================
  // EXECUTION #2: Execute second best (path_003)
  // ============================================
  console.log("🚀 Executing path_003 (Second best opportunity)\n");

  const executedTrade2: ExecutedTradeData = {
    timestamp: new Date().toISOString(),
    scanNumber: 1,
    pathId: "path_003",
    pathType: "1hop",
    opportunityRank: 2,
    estimatedProfitUSDC: 0.20,
    estimatedProfitPct: 0.40,
    tradeAmountUSDC: 50,
    executionMode: "LIVE",
    executionStrategy: "ATOMIC",
    executionTimeMs: 0,
    executionStatus: "FAILED",
    actualProfitUSDC: 0,
    actualProfitPct: 0,
    slippagePct: 100, // Total loss - failed execution
    txSignatures: "",
    txFeeSOL: 0,
    blockTime: Date.now(),
    failureStage: "Quote",
    errorMessage: "Slippage exceeded: Expected 50.20 USDC, got quote for 49.85 USDC",
    preBalanceUSDC: 1000.45,
    postBalanceUSDC: 1000.45, // No change - failed before execution
    preBalanceSOL: 10.499995,
    postBalanceSOL: 10.499995
  };

  // ✅ LOG FAILED TRADE (File 3)
  logger.logExecutedTrade(executedTrade2);
  console.log("✅ Logged failed trade to EXECUTED_TRADES.csv");
  console.log(`   Status: ${executedTrade2.executionStatus}`);
  console.log(`   Reason: ${executedTrade2.errorMessage}\n`);

  // ============================================
  // SCAN #2: Another scan with different opportunities
  // ============================================
  console.log("📊 Scan #2: Simulating 3 more opportunities\n");

  const scan2Opportunities: OpportunityData[] = [
    {
      timestamp: new Date().toISOString(),
      scanNumber: 2,
      pathId: "path_006",
      pathType: "2hop",
      description: "Scan 2 - Opportunity 1",
      tokenPath: "USDC->SOL->USDC",
      poolPath: "Orca_SOL_USDC->Raydium_SOL_USDC",
      poolCount: 2,
      initialAmount: 100,
      finalAmount: 100.55,
      grossProfitUSDC: 0.55,
      grossProfitPct: 0.55,
      netProfitUSDC: 0.50,
      netProfitPct: 0.50,
      totalFeesPct: 0.04,
      totalPriceImpactPct: 0.06,
      estimatedSlippagePct: 0.06,
      totalLiquidityUSD: 140000,
      minPoolLiquidityUSD: 60000,
      avgPoolLiquidityUSD: 70000,
      pools: [
        {
          poolName: "Orca_SOL_USDC",
          tokenIn: "USDC",
          tokenOut: "SOL",
          amountIn: 100,
          amountOut: 0.495,
          feeRatePct: 0.02,
          priceImpactPct: 0.03,
          liquidityUSD: 80000,
          isValid: true
        },
        {
          poolName: "Raydium_SOL_USDC",
          tokenIn: "SOL",
          tokenOut: "USDC",
          amountIn: 0.495,
          amountOut: 100.50,
          feeRatePct: 0.02,
          priceImpactPct: 0.03,
          liquidityUSD: 60000,
          isValid: true
        }
      ],
      isTradable: true,
      failureReason: "",
      simulationTimeMs: 14
    },
    {
      timestamp: new Date().toISOString(),
      scanNumber: 2,
      pathId: "path_007",
      pathType: "4hop",
      description: "Complex 4-hop path (low liquidity)",
      tokenPath: "USDC->SOL->BONK->SOL->USDC",
      poolPath: "Orca_SOL_USDC->Orca_BONK_SOL->Raydium_BONK_SOL->Raydium_SOL_USDC",
      poolCount: 4,
      initialAmount: 100,
      finalAmount: 100.15,
      grossProfitUSDC: 0.15,
      grossProfitPct: 0.15,
      netProfitUSDC: 0.05,
      netProfitPct: 0.05,
      totalFeesPct: 0.08,
      totalPriceImpactPct: 0.35,
      estimatedSlippagePct: 0.35,
      totalLiquidityUSD: 15000,
      minPoolLiquidityUSD: 2000,
      avgPoolLiquidityUSD: 3750,
      pools: [
        {
          poolName: "Orca_SOL_USDC",
          tokenIn: "USDC",
          tokenOut: "SOL",
          amountIn: 100,
          amountOut: 0.495,
          feeRatePct: 0.02,
          priceImpactPct: 0.05,
          liquidityUSD: 8000,
          isValid: true
        },
        {
          poolName: "Orca_BONK_SOL",
          tokenIn: "SOL",
          tokenOut: "BONK",
          amountIn: 0.495,
          amountOut: 50000,
          feeRatePct: 0.02,
          priceImpactPct: 0.10,
          liquidityUSD: 2000,
          isValid: true
        },
        {
          poolName: "Raydium_BONK_SOL",
          tokenIn: "BONK",
          tokenOut: "SOL",
          amountIn: 50000,
          amountOut: 0.492,
          feeRatePct: 0.02,
          priceImpactPct: 0.10,
          liquidityUSD: 2000,
          isValid: true
        },
        {
          poolName: "Raydium_SOL_USDC",
          tokenIn: "SOL",
          tokenOut: "USDC",
          amountIn: 0.492,
          amountOut: 100.05,
          feeRatePct: 0.02,
          priceImpactPct: 0.10,
          liquidityUSD: 3000,
          isValid: true
        }
      ],
      isTradable: false,
      failureReason: "Min liquidity $2000 < $5000 required for 4-hop paths",
      simulationTimeMs: 28
    },
    {
      timestamp: new Date().toISOString(),
      scanNumber: 2,
      pathId: "path_008",
      pathType: "2hop",
      description: "Scan 2 - Opportunity 3",
      tokenPath: "USDC->SOL->USDC",
      poolPath: "Raydium_SOL_USDC->Orca_SOL_USDC",
      poolCount: 2,
      initialAmount: 75,
      finalAmount: 75.28,
      grossProfitUSDC: 0.28,
      grossProfitPct: 0.37,
      netProfitUSDC: 0.25,
      netProfitPct: 0.33,
      totalFeesPct: 0.04,
      totalPriceImpactPct: 0.03,
      estimatedSlippagePct: 0.03,
      totalLiquidityUSD: 130000,
      minPoolLiquidityUSD: 65000,
      avgPoolLiquidityUSD: 65000,
      pools: [
        {
          poolName: "Raydium_SOL_USDC",
          tokenIn: "USDC",
          tokenOut: "SOL",
          amountIn: 75,
          amountOut: 0.371,
          feeRatePct: 0.02,
          priceImpactPct: 0.02,
          liquidityUSD: 65000,
          isValid: true
        },
        {
          poolName: "Orca_SOL_USDC",
          tokenIn: "SOL",
          tokenOut: "USDC",
          amountIn: 0.371,
          amountOut: 75.25,
          feeRatePct: 0.02,
          priceImpactPct: 0.01,
          liquidityUSD: 65000,
          isValid: true
        }
      ],
      isTradable: true,
      failureReason: "",
      simulationTimeMs: 13
    }
  ];

  // ✅ LOG SCAN #2
  logger.logAllOpportunities(2, scan2Opportunities);
  logger.logTradableOpportunities(2, scan2Opportunities);
  const scan2Tradable = scan2Opportunities.filter(o => o.isTradable).length;
  console.log(`✅ Logged ${scan2Opportunities.length} opportunities (${scan2Tradable} tradable)\n`);

  // ============================================
  // PRINT FINAL STATISTICS
  // ============================================
  logger.printStatistics();

  const paths = logger.getLogPaths();
  console.log("📁 CSV Files Generated:");
  console.log(`   1. ${paths.allOpportunities}`);
  console.log(`   2. ${paths.tradableOpportunities}`);
  console.log(`   3. ${paths.executedTrades}\n`);

  console.log("✅ Test completed! Check the logs/ directory.\n");
}

// Run test
testComprehensiveLogger().catch(console.error);
