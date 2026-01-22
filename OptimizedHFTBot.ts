/**
 * Optimized HFT Arbitrage Bot
 *
 * EVENT-DRIVEN ARCHITECTURE (NO POLLING)
 *
 * Key Improvements:
 * 1. Static pool metadata cached (no repeated RPC calls)
 * 2. gRPC streaming for price updates (no polling loops)
 * 3. Simulation only when prices change
 * 4. RPC call tracking and rate limiting
 * 5. Proper error handling and failover
 *
 * RPC Usage:
 * - Initial fetch: ~12 calls (one-time)
 * - Subscriptions: 24 subscriptions (one-time)
 * - Ongoing: ONLY when prices change (event-driven)
 *
 * Old bot: 1000+ RPC calls/minute
 * New bot: <10 RPC calls/minute
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { initializeMetadataCache, getPoolMetadata, getAllPoolIds } from './PoolMetadataCache';
import { GrpcPriceStreamer, PriceUpdateEvent, getGrpcStreamer } from './GrpcPriceStreamer';
import { SwapExecutor } from './SwapExecutor';
import Decimal from 'decimal.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

/**
 * Arbitrage opportunity
 */
interface ArbitrageOpportunity {
  poolA: string;
  poolB: string;
  spread: Decimal;
  netProfit: Decimal;
  profitPct: Decimal;
  timestamp: number;
}

/**
 * Bot Configuration
 */
interface BotConfig {
  tradeUSD: number;
  minProfitUSDC: number;
  maxSpreadPct: number;
  dryRun: boolean;
  enableSimulation: boolean; // New: control simulation frequency
  simulationThrottleMs: number; // New: minimum time between simulations
}

/**
 * Optimized Event-Driven HFT Bot
 */
export class OptimizedHFTBot {
  private connection: Connection;
  private wallet: Keypair;
  private priceStreamer: GrpcPriceStreamer;
  private swapExecutor: SwapExecutor;
  private config: BotConfig;
  private isRunning: boolean = false;

  // Simulation throttling
  private lastSimulationTime: number = 0;
  private pendingSimulation: boolean = false;

  // Statistics
  private totalOpportunities: number = 0;
  private profitableOpportunities: number = 0;
  private priceUpdatesReceived: number = 0;
  private simulationsRun: number = 0;
  private tradesExecuted: number = 0;
  private totalProfit: Decimal = new Decimal(0);

  constructor(connection: Connection, wallet: Keypair, config: BotConfig) {
    this.connection = connection;
    this.wallet = wallet;
    this.config = config;
    this.priceStreamer = getGrpcStreamer(connection);
    this.swapExecutor = new SwapExecutor(connection, wallet);
  }

  /**
   * Start the bot (event-driven)
   */
  async start(): Promise<void> {
    console.log('\n🚀 Starting Optimized HFT Bot...');
    console.log('═══════════════════════════════════════\n');

    // Step 1: Initialize static metadata cache (ONE-TIME)
    console.log('[Bot] Step 1: Loading static pool metadata...');
    initializeMetadataCache();

    const poolCount = getAllPoolIds().length;
    console.log(`[Bot] ✅ ${poolCount} pools cached (NO RPC CALLS)\n`);

    // Step 2: Start gRPC price streaming (EVENT-DRIVEN)
    console.log('[Bot] Step 2: Starting event-driven price streaming...');
    await this.priceStreamer.startStreaming();
    console.log('[Bot] ✅ Price streaming active (NO POLLING)\n');

    // Step 3: Subscribe to price update events
    console.log('[Bot] Step 3: Setting up event handlers...');
    this.setupEventHandlers();
    console.log('[Bot] ✅ Event handlers registered\n');

    this.isRunning = true;

    console.log('═══════════════════════════════════════');
    console.log('✅ BOT RUNNING (Event-Driven Mode)');
    console.log('═══════════════════════════════════════');
    console.log(`Trade Size: $${this.config.tradeUSD}`);
    console.log(`Min Profit: $${this.config.minProfitUSDC}`);
    console.log(`Max Spread: ${this.config.maxSpreadPct}%`);
    console.log(`Dry Run: ${this.config.dryRun ? 'YES' : 'NO'}`);
    console.log(`Simulation: ${this.config.enableSimulation ? 'ENABLED' : 'DISABLED'}`);
    console.log('═══════════════════════════════════════\n');

    // Stats logging
    setInterval(() => this.logStats(), 60000);
  }

  /**
   * Setup event handlers (REPLACES polling loops)
   */
  private setupEventHandlers(): void {
    // Listen for price updates (event-driven)
    this.priceStreamer.on('priceUpdate', (event: PriceUpdateEvent) => {
      this.handlePriceUpdate(event);
    });

    // Listen for errors
    this.priceStreamer.on('error', (error: Error) => {
      console.error('[Bot] Streamer error:', error.message);
    });
  }

  /**
   * Handle price update event (NO POLLING)
   *
   * ONLY runs when price actually changes
   */
  private handlePriceUpdate(event: PriceUpdateEvent): void {
    this.priceUpdatesReceived++;

    // Throttle simulation to avoid excessive calculations
    if (!this.config.enableSimulation) {
      return;
    }

    const now = Date.now();
    const timeSinceLastSim = now - this.lastSimulationTime;

    if (timeSinceLastSim < this.config.simulationThrottleMs) {
      // Schedule simulation for later
      if (!this.pendingSimulation) {
        this.pendingSimulation = true;
        setTimeout(() => {
          this.runArbitrageSimulation();
          this.pendingSimulation = false;
        }, this.config.simulationThrottleMs - timeSinceLastSim);
      }
      return;
    }

    // Run simulation immediately
    this.runArbitrageSimulation();
  }

  /**
   * Run arbitrage simulation (THROTTLED)
   *
   * ONLY runs when needed, not continuously
   */
  private runArbitrageSimulation(): void {
    this.lastSimulationTime = Date.now();
    this.simulationsRun++;

    try {
      // Get all current prices (NO RPC CALL - from cache)
      const allPrices = this.priceStreamer.getAllLivePrices();

      if (allPrices.size < 2) {
        return; // Not enough price data yet
      }

      // Find arbitrage opportunities
      const opportunities = this.findArbitrageOpportunities(allPrices);

      if (opportunities.length > 0) {
        this.totalOpportunities += opportunities.length;

        // Filter profitable opportunities
        const profitable = opportunities.filter(
          opp => opp.netProfit.gte(this.config.minProfitUSDC)
        );

        if (profitable.length > 0) {
          this.profitableOpportunities += profitable.length;
          // Fire and forget - execute in background without blocking price stream
          this.handleProfitableOpportunities(profitable).catch(error => {
            console.error('[Bot] Execution error:', error);
          });
        }
      }

    } catch (error) {
      console.error('[Bot] Simulation error:', error);
    }
  }

  /**
   * Find arbitrage opportunities (FAST, NO RPC)
   */
  private findArbitrageOpportunities(
    allPrices: Map<string, any>
  ): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    const priceArray = Array.from(allPrices.entries());

    // Compare all pool pairs
    for (let i = 0; i < priceArray.length; i++) {
      for (let j = i + 1; j < priceArray.length; j++) {
        const [poolIdA, priceA] = priceArray[i];
        const [poolIdB, priceB] = priceArray[j];

        const metadataA = getPoolMetadata(poolIdA);
        const metadataB = getPoolMetadata(poolIdB);

        if (!metadataA || !metadataB) continue;

        // TEMPORARY: Only use Orca Whirlpool pools (SwapExecutor only supports Orca)
        if (metadataA.dex !== 'ORCA' || metadataB.dex !== 'ORCA') continue;

        // Only compare same token pairs
        if (!this.isSameTokenPair(metadataA, metadataB)) continue;

        // Calculate spread
        const spread = priceA.price.minus(priceB.price).abs();
        const spreadPct = spread.div(priceA.price).times(100);

        // Validate spread
        if (spreadPct.gt(this.config.maxSpreadPct)) {
          continue; // Invalid spread
        }

        // Calculate profit (simplified)
        const netProfit = this.calculateNetProfit(
          priceA.price,
          priceB.price,
          new Decimal(this.config.tradeUSD)
        );

        opportunities.push({
          poolA: poolIdA,
          poolB: poolIdB,
          spread: spreadPct,
          netProfit,
          profitPct: netProfit.div(this.config.tradeUSD).times(100),
          timestamp: Date.now()
        });
      }
    }

    return opportunities.sort((a, b) => b.netProfit.minus(a.netProfit).toNumber());
  }

  /**
   * Check if same token pair
   */
  private isSameTokenPair(metadataA: any, metadataB: any): boolean {
    const tokensA = [metadataA.tokenA, metadataA.tokenB].sort();
    const tokensB = [metadataB.tokenA, metadataB.tokenB].sort();
    return tokensA[0] === tokensB[0] && tokensA[1] === tokensB[1];
  }

  /**
   * Calculate net profit (simplified)
   */
  private calculateNetProfit(
    priceA: Decimal,
    priceB: Decimal,
    tradeSize: Decimal
  ): Decimal {
    const spread = priceA.minus(priceB).abs();
    const grossProfit = spread.div(priceA).times(tradeSize);

    // Deduct fees (0.5% total)
    const fees = tradeSize.times(0.005);
    return grossProfit.minus(fees);
  }

  /**
   * Handle profitable opportunities
   */
  private async handleProfitableOpportunities(opportunities: ArbitrageOpportunity[]): Promise<void> {
    console.log('\n💰 PROFITABLE OPPORTUNITIES FOUND');
    console.log('═══════════════════════════════════════');

    for (const opp of opportunities.slice(0, 5)) { // Process top 5
      const metadataA = getPoolMetadata(opp.poolA);
      const metadataB = getPoolMetadata(opp.poolB);

      console.log(`\n${metadataA?.name} ⟷ ${metadataB?.name}`);
      console.log(`  Spread: ${opp.spread.toFixed(4)}%`);
      console.log(`  Profit: $${opp.netProfit.toFixed(4)} (${opp.profitPct.toFixed(4)}%)`);

      if (!this.config.dryRun) {
        console.log('  Status: EXECUTING TRADE...');
        try {
          // Execute the arbitrage trade
          const result = await this.executeArbitrageTrade(opp, metadataA, metadataB);
          if (result.success) {
            console.log(`  ✅ Trade Executed: ${result.signature}`);
            console.log(`  Profit Realized: $${result.profit}`);
            this.tradesExecuted++;
            this.totalProfit = this.totalProfit.plus(new Decimal(result.profit || 0));
            
            // Log to file
            this.logTradeResult(result);
          } else {
            console.log(`   Trade Failed: ${result.error}`);
          }
        } catch (error) {
          console.log(`   Execution Error: ${(error as any).message}`);
        }
      } else {
        console.log('  Status: DRY RUN (not executing)');
      }
    }

    console.log('\n═══════════════════════════════════════\n');
  }

  /**
   * Execute an arbitrage trade
   */
  private async executeArbitrageTrade(
    opp: ArbitrageOpportunity,
    metadataA: any,
    metadataB: any
  ): Promise<{ success: boolean; signature?: string; profit?: number; error?: string }> {
    try {
      const tradeSize = this.config.tradeUSD;
      const slippage = 0.005; // 0.5%

      console.log(`    [Executing] Swapping $${tradeSize} USDC...`);

      // Execute swap on pool A (buy) - USDC to SOL
      const swap1Result = await this.swapExecutor.executeSwap(
        opp.poolA,                    // poolAddress
        metadataA.tokenB,             // inputMint (USDC)
        metadataA.tokenA,             // outputMint (SOL)
        new Decimal(tradeSize),       // amountIn
        false,                        // aToB (B->A means tokenB to tokenA)
        slippage,                     // slippageTolerance
        false                         // skipValidation
      );

      if (!swap1Result.success) {
        return {
          success: false,
          error: `First swap failed: ${swap1Result.error}`
        };
      }

      const swap1Output = new Decimal(swap1Result.outputAmount || swap1Result.amountOut || '0');
      console.log(`    [Swap 1] Received: ${swap1Output.toString()}`);

      // Execute swap on pool B (sell) - SOL back to USDC
      const swap2Result = await this.swapExecutor.executeSwap(
        opp.poolB,                    // poolAddress
        metadataB.tokenA,             // inputMint (SOL)
        metadataB.tokenB,             // outputMint (USDC)
        swap1Output,                  // amountIn
        true,                         // aToB (A->B means tokenA to tokenB)
        slippage,                     // slippageTolerance
        false                         // skipValidation
      );

      if (!swap2Result.success) {
        return {
          success: false,
          error: `Second swap failed: ${swap2Result.error}`
        };
      }

      const swap2Output = new Decimal(swap2Result.outputAmount || swap2Result.amountOut || '0');
      console.log(`    [Swap 2] Received: ${swap2Output.toString()}`);

      // Calculate actual profit
      const actualProfit = swap2Output.minus(tradeSize).toNumber();

      return {
        success: true,
        signature: swap2Result.signature || swap1Result.signature || 'success',
        profit: actualProfit
      };
    } catch (error) {
      return {
        success: false,
        error: (error as any).message || 'Unknown error'
      };
    }
  }

  /**
   * Log trade result to CSV
   */
  private logTradeResult(result: any): void {
    try {
      const timestamp = new Date().toISOString();
      const line = `${timestamp},${result.signature},${result.profit}\n`;
      
      if (!fs.existsSync('trade_log.csv')) {
        fs.writeFileSync('trade_log.csv', 'Timestamp,Signature,Profit\n');
      }
      
      fs.appendFileSync('trade_log.csv', line);
    } catch (error) {
      console.error('Failed to log trade:', error);
    }
  }

  /**
   * Log statistics
   */
  private logStats(): void {
    const rpcStats = this.priceStreamer.getRPCStats();

    console.log('\n📊 BOT STATISTICS (Last Minute)');
    console.log('═══════════════════════════════════════');
    console.log(`Price Updates Received: ${this.priceUpdatesReceived}`);
    console.log(`Simulations Run: ${this.simulationsRun}`);
    console.log(`Total Opportunities: ${this.totalOpportunities}`);
    console.log(`Profitable Opportunities: ${this.profitableOpportunities}`);
    console.log(`Trades Executed: ${this.tradesExecuted}`);
    console.log(`Total Profit: $${this.totalProfit.toFixed(2)}`);
    console.log(`RPC Calls: ${rpcStats.totalCalls}`);
    console.log('═══════════════════════════════════════\n');

    // Reset counters
    this.priceUpdatesReceived = 0;
    this.simulationsRun = 0;
    this.totalOpportunities = 0;
    this.profitableOpportunities = 0;
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    console.log('\n[Bot] Stopping...');
    this.isRunning = false;
    await this.priceStreamer.stopStreaming();
    console.log('[Bot] Stopped\n');
  }
}

/**
 * Main entry point
 */
async function main() {
  // Load configuration
  const config: BotConfig = {
    tradeUSD: parseInt(process.env.TRADE_USD || '25'),
    minProfitUSDC: parseFloat(process.env.MIN_PROFIT_USDC || '0.05'),
    maxSpreadPct: parseFloat(process.env.MAX_SPREAD_PCT || '10'),
    dryRun: process.env.DRY_RUN === 'true', // Explicit: only true if DRY_RUN=true
    enableSimulation: process.env.ENABLE_SIMULATION !== 'false',
    simulationThrottleMs: parseInt(process.env.SIMULATION_THROTTLE_MS || '1000')
  };

  console.log('\n🤖 BOT CONFIGURATION');
  console.log('═══════════════════════════════════════');
  console.log(`Trade USD: $${config.tradeUSD}`);
  console.log(`Min Profit: $${config.minProfitUSDC}`);
  console.log(`Max Spread: ${config.maxSpreadPct}%`);
  console.log(`Dry Run Mode: ${config.dryRun ? 'YES ⚠️' : 'NO - LIVE TRADING 🚀'}`);
  console.log('═══════════════════════════════════════\n');

  // Setup connection (use free RPC for non-critical operations)
  const rpcUrl = process.env.QUICKNODE_HTTP_ENDPOINT || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000
  });

  // Load wallet
  const walletData = require('./my_wallet.json');
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));

  console.log('Wallet:', wallet.publicKey.toString());

  // Create and start bot
  const bot = new OptimizedHFTBot(connection, wallet, config);

  await bot.start();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Received SIGINT, shutting down...');
    await bot.stop();
    process.exit(0);
  });
}

// Run if main module
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
