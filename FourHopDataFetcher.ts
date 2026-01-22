import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import Decimal from "decimal.js";
import {
  FourHopPoolConfig,
  FOUR_HOP_POOLS,
  USDC_MINT_PUBKEY,
  SOL_MINT_PUBKEY,
  BONK_MINT_PUBKEY,
  USDC_DECIMALS,
  SOL_DECIMALS,
  BONK_DECIMALS,
} from "./FourHopConstants";
import {
  PoolLiquidityData,
  SimplePriceOracle,
  FourHopCalculator,
} from "./FourHopCalculator";
import { fetchRaydiumPrice } from "./RaydiumPriceFetcher";

/* =========================
   REAL-TIME DATA FETCHER
   Fetches liquidity + prices from all DEXes
========================= */

export class FourHopDataFetcher {
  private connection: Connection;
  private calculator: FourHopCalculator;
  private priceOracle: SimplePriceOracle;
  private fetchIntervalMs: number;
  private isRunning: boolean = false;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    connection: Connection,
    calculator: FourHopCalculator,
    fetchIntervalMs: number = 5000 // 5 seconds default
  ) {
    this.connection = connection;
    this.calculator = calculator;
    this.priceOracle = new SimplePriceOracle();
    this.fetchIntervalMs = fetchIntervalMs;
  }

  /**
   * Start continuous data fetching
   */
  start(): void {
    if (this.isRunning) {
      console.log("[DataFetcher] Already running");
      return;
    }

    console.log(
      `[DataFetcher] Starting continuous fetch (interval: ${this.fetchIntervalMs}ms)`
    );
    this.isRunning = true;

    // Immediate first fetch
    this.fetchAllPoolData().catch((err) =>
      console.error("[DataFetcher] Initial fetch error:", err.message)
    );

    // Set up interval
    this.intervalHandle = setInterval(() => {
      this.fetchAllPoolData().catch((err) =>
        console.error("[DataFetcher] Fetch error:", err.message)
      );
    }, this.fetchIntervalMs);
  }

  /**
   * Stop data fetching
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log("[DataFetcher] Stopping...");
    this.isRunning = false;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Fetch all pool data (called periodically)
   */
  private async fetchAllPoolData(): Promise<void> {
    const startTime = Date.now();
    const results: {
      poolId: string;
      success: boolean;
      error?: string;
    }[] = [];

    // Fetch prices first (needed for liquidity USD calculations)
    await this.fetchTokenPrices();

    // Fetch liquidity for all pools in parallel
    const fetchPromises = FOUR_HOP_POOLS.map(async (pool) => {
      try {
        const liquidity = await this.fetchPoolLiquidity(pool);
        if (liquidity) {
          this.calculator.updatePoolLiquidity(liquidity);
          results.push({ poolId: pool.id, success: true });
        } else {
          results.push({
            poolId: pool.id,
            success: false,
            error: "Failed to fetch liquidity",
          });
        }
      } catch (error: any) {
        results.push({
          poolId: pool.id,
          success: false,
          error: error.message,
        });
      }
    });

    await Promise.all(fetchPromises);

    const elapsed = Date.now() - startTime;
    const successCount = results.filter((r) => r.success).length;

    console.log(
      `[DataFetcher] Fetched ${successCount}/${FOUR_HOP_POOLS.length} pools in ${elapsed}ms`
    );

    // Log failures
    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      console.warn(
        `[DataFetcher] ${failures.length} pools failed:`,
        failures.map((f) => `${f.poolId}: ${f.error}`).join(", ")
      );
    }
  }

  /**
   * Fetch token prices (from existing pools or external oracle)
   * For demo, we derive prices from pool reserves
   */
  private async fetchTokenPrices(): Promise<void> {
    try {
      // Fetch SOL/USDC price from a reliable pool (e.g., Orca or Raydium)
      const orcaPool = FOUR_HOP_POOLS.find((p) => p.id === "pool_1_orca_usdc_sol");
      if (orcaPool && orcaPool.vaultA && orcaPool.vaultB) {
        const solPrice = await this.fetchSOLPrice(
          orcaPool.vaultA,
          orcaPool.vaultB
        );
        if (solPrice) {
          this.priceOracle.updatePrice("SOL", solPrice);
          this.priceOracle.updatePrice("USDC", new Decimal(1)); // USDC = $1
        }
      }

      // Fetch BONK price from SOL/BONK pool
      const bonkPool = FOUR_HOP_POOLS.find((p) => p.id === "pool_4_raydium_sol_bonk");
      if (bonkPool && bonkPool.vaultA && bonkPool.vaultB) {
        const bonkPriceInSOL = await this.fetchBONKPriceInSOL(
          bonkPool.vaultA,
          bonkPool.vaultB
        );
        const solPrice = this.priceOracle.getPrice("SOL");
        if (bonkPriceInSOL && solPrice) {
          const bonkPriceUSD = bonkPriceInSOL.mul(solPrice);
          this.priceOracle.updatePrice("BONK", bonkPriceUSD);
        }
      }
    } catch (error: any) {
      console.error(`[DataFetcher] Price fetch error: ${error.message}`);
    }
  }

  /**
   * Fetch SOL price in USDC
   */
  private async fetchSOLPrice(
    usdcVault: string,
    solVault: string
  ): Promise<Decimal | null> {
    try {
      const vaultAPubkey = new PublicKey(usdcVault);
      const vaultBPubkey = new PublicKey(solVault);

      const [vaultAInfo, vaultBInfo] = await Promise.all([
        getAccount(this.connection, vaultAPubkey),
        getAccount(this.connection, vaultBPubkey),
      ]);

      const usdcBalance = new Decimal(vaultAInfo.amount.toString()).div(
        10 ** USDC_DECIMALS
      );
      const solBalance = new Decimal(vaultBInfo.amount.toString()).div(
        10 ** SOL_DECIMALS
      );

      if (solBalance.isZero()) return null;

      return usdcBalance.div(solBalance);
    } catch (error: any) {
      console.error(`[DataFetcher] SOL price fetch error: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch BONK price in SOL
   */
  private async fetchBONKPriceInSOL(
    solVault: string,
    bonkVault: string
  ): Promise<Decimal | null> {
    try {
      if (!solVault || !bonkVault) {
        // TODO: Replace with actual vault addresses
        console.warn("[DataFetcher] BONK vault addresses not configured");
        return new Decimal(0.000001); // Placeholder price
      }

      const vaultAPubkey = new PublicKey(solVault);
      const vaultBPubkey = new PublicKey(bonkVault);

      const [vaultAInfo, vaultBInfo] = await Promise.all([
        getAccount(this.connection, vaultAPubkey),
        getAccount(this.connection, vaultBPubkey),
      ]);

      const solBalance = new Decimal(vaultAInfo.amount.toString()).div(
        10 ** SOL_DECIMALS
      );
      const bonkBalance = new Decimal(vaultBInfo.amount.toString()).div(
        10 ** BONK_DECIMALS
      );

      if (bonkBalance.isZero()) return null;

      return solBalance.div(bonkBalance);
    } catch (error: any) {
      console.error(
        `[DataFetcher] BONK price fetch error: ${error.message}`
      );
      return new Decimal(0.000001); // Fallback price
    }
  }

  /**
   * Fetch liquidity for a single pool
   */
  private async fetchPoolLiquidity(
    pool: FourHopPoolConfig
  ): Promise<PoolLiquidityData | null> {
    try {
      // Route based on DEX type
      switch (pool.dex) {
        case "orca":
          return await this.fetchOrcaLiquidity(pool);
        case "raydium_amm":
          return await this.fetchRaydiumAMMLiquidity(pool);
        case "raydium_clmm":
          return await this.fetchRaydiumCLMMLiquidity(pool);
        case "meteora":
          return await this.fetchMeteoraLiquidity(pool);
        case "phoenix":
          return await this.fetchPhoenixLiquidity(pool);
        default:
          console.warn(`[DataFetcher] Unknown DEX type: ${pool.dex}`);
          return null;
      }
    } catch (error: any) {
      console.error(
        `[DataFetcher] Error fetching ${pool.id}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Fetch Orca Whirlpool liquidity
   */
  private async fetchOrcaLiquidity(
    pool: FourHopPoolConfig
  ): Promise<PoolLiquidityData | null> {
    if (!pool.vaultA || !pool.vaultB) {
      return null;
    }

    try {
      const vaultAPubkey = new PublicKey(pool.vaultA);
      const vaultBPubkey = new PublicKey(pool.vaultB);

      const [vaultAInfo, vaultBInfo] = await Promise.all([
        getAccount(this.connection, vaultAPubkey),
        getAccount(this.connection, vaultBPubkey),
      ]);

      const tokenADecimals = this.getTokenDecimals(pool.tokenA);
      const tokenBDecimals = this.getTokenDecimals(pool.tokenB);

      const tokenAReserve = new Decimal(vaultAInfo.amount.toString()).div(
        10 ** tokenADecimals
      );
      const tokenBReserve = new Decimal(vaultBInfo.amount.toString()).div(
        10 ** tokenBDecimals
      );

      // Calculate liquidity USD
      const liquidityUSD = this.priceOracle.calculatePoolLiquidityUSD(
        pool.tokenASymbol,
        pool.tokenBSymbol,
        tokenAReserve,
        tokenBReserve
      );

      if (!liquidityUSD) {
        return null;
      }

      return {
        poolId: pool.id,
        tokenAReserve,
        tokenBReserve,
        liquidityUSD,
        lastUpdate: Date.now(),
      };
    } catch (error: any) {
      console.error(
        `[DataFetcher] Orca fetch error for ${pool.id}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Fetch Raydium AMM liquidity
   */
  private async fetchRaydiumAMMLiquidity(
    pool: FourHopPoolConfig
  ): Promise<PoolLiquidityData | null> {
    if (!pool.vaultA || !pool.vaultB) {
      return null;
    }

    try {
      const vaultAPubkey = new PublicKey(pool.vaultA);
      const vaultBPubkey = new PublicKey(pool.vaultB);

      const [vaultAInfo, vaultBInfo] = await Promise.all([
        getAccount(this.connection, vaultAPubkey),
        getAccount(this.connection, vaultBPubkey),
      ]);

      const tokenADecimals = this.getTokenDecimals(pool.tokenA);
      const tokenBDecimals = this.getTokenDecimals(pool.tokenB);

      const tokenAReserve = new Decimal(vaultAInfo.amount.toString()).div(
        10 ** tokenADecimals
      );
      const tokenBReserve = new Decimal(vaultBInfo.amount.toString()).div(
        10 ** tokenBDecimals
      );

      const liquidityUSD = this.priceOracle.calculatePoolLiquidityUSD(
        pool.tokenASymbol,
        pool.tokenBSymbol,
        tokenAReserve,
        tokenBReserve
      );

      if (!liquidityUSD) {
        return null;
      }

      return {
        poolId: pool.id,
        tokenAReserve,
        tokenBReserve,
        liquidityUSD,
        lastUpdate: Date.now(),
      };
    } catch (error: any) {
      console.error(
        `[DataFetcher] Raydium AMM fetch error for ${pool.id}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Fetch Raydium CLMM liquidity
   * TODO: Implement actual CLMM liquidity fetching using Raydium SDK
   */
  private async fetchRaydiumCLMMLiquidity(
    pool: FourHopPoolConfig
  ): Promise<PoolLiquidityData | null> {
    console.warn(
      `[DataFetcher] Raydium CLMM fetching not yet implemented for ${pool.id}`
    );
    // Placeholder: Return mock data
    return {
      poolId: pool.id,
      tokenAReserve: new Decimal(1000000), // Mock
      tokenBReserve: new Decimal(5000), // Mock
      liquidityUSD: new Decimal(100000), // Mock $100k
      lastUpdate: Date.now(),
    };
  }

  /**
   * Fetch Meteora DLMM liquidity
   * TODO: Implement actual Meteora liquidity fetching using Meteora SDK
   */
  private async fetchMeteoraLiquidity(
    pool: FourHopPoolConfig
  ): Promise<PoolLiquidityData | null> {
    console.warn(
      `[DataFetcher] Meteora DLMM fetching not yet implemented for ${pool.id}`
    );
    // Placeholder: Return mock data
    return {
      poolId: pool.id,
      tokenAReserve: new Decimal(800000), // Mock
      tokenBReserve: new Decimal(4000), // Mock
      liquidityUSD: new Decimal(80000), // Mock $80k
      lastUpdate: Date.now(),
    };
  }

  /**
   * Fetch Phoenix liquidity
   * TODO: Implement Phoenix liquidity fetching using Phoenix SDK
   */
  private async fetchPhoenixLiquidity(
    pool: FourHopPoolConfig
  ): Promise<PoolLiquidityData | null> {
    console.warn(
      `[DataFetcher] Phoenix fetching not yet implemented for ${pool.id}`
    );
    // Placeholder: Return mock data
    return {
      poolId: pool.id,
      tokenAReserve: new Decimal(600000), // Mock
      tokenBReserve: new Decimal(3000), // Mock
      liquidityUSD: new Decimal(60000), // Mock $60k
      lastUpdate: Date.now(),
    };
  }

  /**
   * Get token decimals
   */
  private getTokenDecimals(mint: string): number {
    if (mint === USDC_MINT_PUBKEY.toBase58()) return USDC_DECIMALS;
    if (mint === SOL_MINT_PUBKEY.toBase58()) return SOL_DECIMALS;
    if (mint === BONK_MINT_PUBKEY.toBase58()) return BONK_DECIMALS;
    return 6; // Default
  }

  /**
   * Get current price oracle (for external use)
   */
  getPriceOracle(): SimplePriceOracle {
    return this.priceOracle;
  }
}
