import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import Decimal from "decimal.js";
import {
  PoolConfig,
  ALL_POOLS,
  USDC_DECIMALS,
  SOL_DECIMALS,
  BONK_DECIMALS,
} from "./MultiPathConstants";
import { MultiPathCalculator, PoolLiquidityData } from "./MultiPathCalculator";

/* =========================
   REAL-TIME PRICE & LIQUIDITY FETCHER
   Fetches from actual Solana pools
========================= */

export class MultiPathDataFetcher {
  private connection: Connection;
  private calculator: MultiPathCalculator;
  private tokenPrices: Map<string, Decimal> = new Map();
  private fetchIntervalMs: number;
  private isRunning: boolean = false;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    connection: Connection,
    calculator: MultiPathCalculator,
    fetchIntervalMs: number = 5000
  ) {
    this.connection = connection;
    this.calculator = calculator;
    this.fetchIntervalMs = fetchIntervalMs;
  }

  /**
   * Start continuous fetching
   */
  start(): void {
    if (this.isRunning) return;

    console.log(`[DataFetcher] Starting (interval: ${this.fetchIntervalMs}ms)`);
    this.isRunning = true;

    // Immediate first fetch
    this.fetchAllData().catch(err =>
      console.error("[DataFetcher] Initial fetch error:", err.message)
    );

    // Periodic fetch
    this.intervalHandle = setInterval(() => {
      this.fetchAllData().catch(err =>
        console.error("[DataFetcher] Fetch error:", err.message)
      );
    }, this.fetchIntervalMs);
  }

  /**
   * Stop fetching
   */
  stop(): void {
    if (!this.isRunning) return;

    console.log("[DataFetcher] Stopping...");
    this.isRunning = false;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Fetch all pool data
   */
  private async fetchAllData(): Promise<void> {
    const startTime = Date.now();

    // Fetch prices first
    await this.fetchTokenPrices();

    // Fetch all pool liquidity in parallel
    const promises = ALL_POOLS.map(pool => this.fetchPoolLiquidity(pool));
    const results = await Promise.allSettled(promises);

    let successCount = 0;
    results.forEach((result, i) => {
      if (result.status === "fulfilled" && result.value) {
        this.calculator.updatePoolLiquidity(result.value);
        successCount++;
      } else if (result.status === "rejected") {
        console.warn(`[DataFetcher] Pool ${ALL_POOLS[i].id}: ${result.reason.message}`);
      }
    });

    const elapsed = Date.now() - startTime;
    console.log(`[DataFetcher] Fetched ${successCount}/${ALL_POOLS.length} pools in ${elapsed}ms`);
  }

  /**
   * Fetch token prices (SOL, BONK in USD)
   */
  private async fetchTokenPrices(): Promise<void> {
    try {
      // USDC is always $1
      this.tokenPrices.set("USDC", new Decimal(1));

      // Fetch SOL price from a reliable USDC/SOL pool
      const solPrice = await this.fetchSOLPrice();
      if (solPrice) {
        this.tokenPrices.set("SOL", solPrice);
      }

      // Fetch BONK price (either direct USDC/BONK or via SOL)
      const bonkPrice = await this.fetchBONKPrice();
      if (bonkPrice) {
        this.tokenPrices.set("BONK", bonkPrice);
      }
    } catch (error: any) {
      console.error(`[DataFetcher] Price fetch error: ${error.message}`);
    }
  }

  /**
   * Fetch SOL price in USD
   */
  private async fetchSOLPrice(): Promise<Decimal | null> {
    try {
      // Find the first USDC/SOL pool with vault data
      const pool = ALL_POOLS.find(
        p =>
          ((p.tokenASymbol === "USDC" && p.tokenBSymbol === "SOL") ||
            (p.tokenASymbol === "SOL" && p.tokenBSymbol === "USDC")) &&
          p.vaultA &&
          p.vaultB &&
          p.vaultA !== "" &&
          p.vaultB !== ""
      );

      if (!pool) {
        console.warn("[DataFetcher] No USDC/SOL pool found, using fallback price");
        return new Decimal(200); // Fallback price
      }

      const vaultAPubkey = new PublicKey(pool.vaultA!);
      const vaultBPubkey = new PublicKey(pool.vaultB!);

      const [vaultAInfo, vaultBInfo] = await Promise.all([
        getAccount(this.connection, vaultAPubkey),
        getAccount(this.connection, vaultBPubkey),
      ]);

      // Determine which vault is USDC and which is SOL
      const isAtoB = pool.tokenASymbol === "USDC";
      const usdcBalance = new Decimal(
        (isAtoB ? vaultAInfo : vaultBInfo).amount.toString()
      ).div(10 ** USDC_DECIMALS);
      const solBalance = new Decimal(
        (isAtoB ? vaultBInfo : vaultAInfo).amount.toString()
      ).div(10 ** SOL_DECIMALS);

      if (solBalance.isZero()) {
        console.warn("[DataFetcher] SOL balance is zero, using fallback");
        return new Decimal(200);
      }

      const price = usdcBalance.div(solBalance);
      return price;
    } catch (error: any) {
      console.warn(`[DataFetcher] SOL price fetch failed: ${error.message}`);
      return new Decimal(200); // Fallback
    }
  }

  /**
   * Fetch BONK price in USD
   */
  private async fetchBONKPrice(): Promise<Decimal | null> {
    try {
      // Try direct USDC/BONK pool first
      const usdcBonkPool = ALL_POOLS.find(
        p =>
          ((p.tokenASymbol === "USDC" && p.tokenBSymbol === "BONK") ||
            (p.tokenASymbol === "BONK" && p.tokenBSymbol === "USDC")) &&
          p.vaultA &&
          p.vaultB &&
          p.vaultA !== "" &&
          p.vaultB !== ""
      );

      if (usdcBonkPool) {
        const vaultAPubkey = new PublicKey(usdcBonkPool.vaultA!);
        const vaultBPubkey = new PublicKey(usdcBonkPool.vaultB!);

        const [vaultAInfo, vaultBInfo] = await Promise.all([
          getAccount(this.connection, vaultAPubkey),
          getAccount(this.connection, vaultBPubkey),
        ]);

        const isAtoB = usdcBonkPool.tokenASymbol === "USDC";
        const usdcBalance = new Decimal(
          (isAtoB ? vaultAInfo : vaultBInfo).amount.toString()
        ).div(10 ** USDC_DECIMALS);
        const bonkBalance = new Decimal(
          (isAtoB ? vaultBInfo : vaultAInfo).amount.toString()
        ).div(10 ** BONK_DECIMALS);

        if (!bonkBalance.isZero()) {
          const price = usdcBalance.div(bonkBalance);
          return price;
        }
      }

      // Fallback: Use SOL/BONK pool to derive price
      const solPrice = this.tokenPrices.get("SOL");
      if (!solPrice) {
        console.warn("[DataFetcher] SOL price not available, using BONK fallback");
        return new Decimal(0.00002);
      }

      const solBonkPool = ALL_POOLS.find(
        p =>
          ((p.tokenASymbol === "SOL" && p.tokenBSymbol === "BONK") ||
            (p.tokenASymbol === "BONK" && p.tokenBSymbol === "SOL")) &&
          p.vaultA &&
          p.vaultB &&
          p.vaultA !== "" &&
          p.vaultB !== ""
      );

      if (!solBonkPool) {
        console.warn("[DataFetcher] No SOL/BONK pool found, using BONK fallback");
        return new Decimal(0.00002);
      }

      const vaultAPubkey = new PublicKey(solBonkPool.vaultA!);
      const vaultBPubkey = new PublicKey(solBonkPool.vaultB!);

      const [vaultAInfo, vaultBInfo] = await Promise.all([
        getAccount(this.connection, vaultAPubkey),
        getAccount(this.connection, vaultBPubkey),
      ]);

      const isAtoB = solBonkPool.tokenASymbol === "SOL";
      const solBalance = new Decimal(
        (isAtoB ? vaultAInfo : vaultBInfo).amount.toString()
      ).div(10 ** SOL_DECIMALS);
      const bonkBalance = new Decimal(
        (isAtoB ? vaultBInfo : vaultAInfo).amount.toString()
      ).div(10 ** BONK_DECIMALS);

      if (!bonkBalance.isZero() && !solBalance.isZero()) {
        const bonkPerSol = solBalance.div(bonkBalance);
        const bonkPriceUSD = solPrice.div(bonkPerSol);
        return bonkPriceUSD;
      }

      return new Decimal(0.00002); // Fallback
    } catch (error: any) {
      console.warn(`[DataFetcher] BONK price fetch failed: ${error.message}`);
      return new Decimal(0.00002); // Fallback
    }
  }

  /**
   * Fetch liquidity for a single pool
   */
  private async fetchPoolLiquidity(pool: PoolConfig): Promise<PoolLiquidityData | null> {
    try {
      // Route based on DEX type
      switch (pool.dex) {
        case "orca":
          // Check if this is a Whirlpool (has no vault addresses) or standard AMM pool
          if (!pool.vaultA || !pool.vaultB || pool.vaultA === "" || pool.vaultB === "") {
            return await this.fetchOrcaWhirlpoolLiquidity(pool);
          } else {
            return await this.fetchAMMPoolLiquidity(pool);
          }
        case "raydium_amm":
          return await this.fetchAMMPoolLiquidity(pool);
        case "raydium_clmm":
          return await this.fetchCLMMPoolLiquidity(pool);
        case "meteora":
          return await this.fetchMeteoraLiquidity(pool);
        case "phoenix":
          return await this.fetchPhoenixLiquidity(pool);
        default:
          return null;
      }
    } catch (error: any) {
      // Silently fail for individual pools
      return null;
    }
  }

  /**
   * Fetch AMM pool liquidity (Orca, Raydium AMM)
   */
  private async fetchAMMPoolLiquidity(pool: PoolConfig): Promise<PoolLiquidityData | null> {
    if (!pool.vaultA || !pool.vaultB || pool.vaultA === "" || pool.vaultB === "") {
      console.warn(`[DataFetcher] AMM pool ${pool.id} skipped (missing vault addresses)`);
      return null;
    }

    const vaultAPubkey = new PublicKey(pool.vaultA);
    const vaultBPubkey = new PublicKey(pool.vaultB);

    const [vaultAInfo, vaultBInfo] = await Promise.all([
      getAccount(this.connection, vaultAPubkey),
      getAccount(this.connection, vaultBPubkey),
    ]);

    const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
    const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);

    const tokenAReserve = new Decimal(vaultAInfo.amount.toString()).div(
      10 ** tokenADecimals
    );
    const tokenBReserve = new Decimal(vaultBInfo.amount.toString()).div(
      10 ** tokenBDecimals
    );

    // Calculate prices
    const priceAtoB = tokenAReserve.isZero()
      ? new Decimal(0)
      : tokenBReserve.div(tokenAReserve);
    const priceBtoA = tokenBReserve.isZero()
      ? new Decimal(0)
      : tokenAReserve.div(tokenBReserve);

    // Calculate liquidity USD
    const priceA = this.tokenPrices.get(pool.tokenASymbol) || new Decimal(0);
    const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new Decimal(0);
    const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));

    return {
      poolId: pool.id,
      tokenAReserve,
      tokenBReserve,
      liquidityUSD,
      priceAtoB,
      priceBtoA,
      lastUpdate: Date.now(),
    };
  }

  /**
   * Fetch CLMM pool liquidity (Raydium CLMM)
   */
  private async fetchCLMMPoolLiquidity(pool: PoolConfig): Promise<PoolLiquidityData | null> {
    try {
      // Use pre-configured vault addresses if available (faster!)
      if (pool.vaultA && pool.vaultB && pool.vaultA !== "" && pool.vaultB !== "") {
        const tokenVault0 = new PublicKey(pool.vaultA);
        const tokenVault1 = new PublicKey(pool.vaultB);

        // Get vault balances directly
        const [vault0, vault1] = await Promise.all([
          getAccount(this.connection, tokenVault0),
          getAccount(this.connection, tokenVault1),
        ]);

        // Get token decimals
        const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
        const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);

        // Convert to human-readable amounts
        const tokenAReserve = new Decimal(vault0.amount.toString()).div(10 ** tokenADecimals);
        const tokenBReserve = new Decimal(vault1.amount.toString()).div(10 ** tokenBDecimals);

        // Skip if reserves are zero
        if (tokenAReserve.isZero() || tokenBReserve.isZero()) {
          console.warn(`[DataFetcher] Raydium CLMM pool ${pool.id}: Zero reserves`);
          return null;
        }

        // Calculate prices
        const priceAtoB = tokenBReserve.div(tokenAReserve);
        const priceBtoA = tokenAReserve.div(tokenBReserve);

        // Calculate liquidity USD
        const priceA = this.tokenPrices.get(pool.tokenASymbol) || new Decimal(0);
        const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new Decimal(0);
        const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));

        return {
          poolId: pool.id,
          tokenAReserve,
          tokenBReserve,
          liquidityUSD,
          priceAtoB,
          priceBtoA,
          lastUpdate: Date.now(),
        };
      }

      // Fallback: Parse pool account if vaults not provided
      const poolPubkey = new PublicKey(pool.address);
      const poolAccountInfo = await this.connection.getAccountInfo(poolPubkey);

      if (!poolAccountInfo) {
        console.warn(`[DataFetcher] Raydium CLMM pool ${pool.id}: Pool account not found`);
        return null;
      }

      const tokenVault0 = new PublicKey(poolAccountInfo.data.slice(73, 105));
      const tokenVault1 = new PublicKey(poolAccountInfo.data.slice(105, 137));

      const [vault0, vault1] = await Promise.all([
        getAccount(this.connection, tokenVault0),
        getAccount(this.connection, tokenVault1),
      ]);

      // Get token decimals
      const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
      const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);

      // Convert to human-readable amounts
      const tokenAReserve = new Decimal(vault0.amount.toString()).div(10 ** tokenADecimals);
      const tokenBReserve = new Decimal(vault1.amount.toString()).div(10 ** tokenBDecimals);

      // Skip if reserves are zero
      if (tokenAReserve.isZero() || tokenBReserve.isZero()) {
        console.warn(`[DataFetcher] Raydium CLMM pool ${pool.id}: Zero reserves`);
        return null;
      }

      // Calculate prices
      const priceAtoB = tokenBReserve.div(tokenAReserve);
      const priceBtoA = tokenAReserve.div(tokenBReserve);

      // Calculate liquidity USD
      const priceA = this.tokenPrices.get(pool.tokenASymbol) || new Decimal(0);
      const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new Decimal(0);
      const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));

      return {
        poolId: pool.id,
        tokenAReserve,
        tokenBReserve,
        liquidityUSD,
        priceAtoB,
        priceBtoA,
        lastUpdate: Date.now(),
      };
    } catch (error: any) {
      console.warn(`[DataFetcher] Raydium CLMM pool ${pool.id} fetch error: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch Meteora DLMM liquidity
   */
  private async fetchMeteoraLiquidity(pool: PoolConfig): Promise<PoolLiquidityData | null> {
    try {
      // Use pre-configured vault addresses if available (faster!)
      if (pool.vaultA && pool.vaultB && pool.vaultA !== "" && pool.vaultB !== "") {
        const tokenVaultA = new PublicKey(pool.vaultA);
        const tokenVaultB = new PublicKey(pool.vaultB);

        // Get vault balances directly
        const [vaultA, vaultB] = await Promise.all([
          getAccount(this.connection, tokenVaultA),
          getAccount(this.connection, tokenVaultB),
        ]);

        // Get token decimals
        const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
        const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);

        // Convert to human-readable amounts
        const tokenAReserve = new Decimal(vaultA.amount.toString()).div(10 ** tokenADecimals);
        const tokenBReserve = new Decimal(vaultB.amount.toString()).div(10 ** tokenBDecimals);

        // Skip if reserves are zero
        if (tokenAReserve.isZero() || tokenBReserve.isZero()) {
          console.warn(`[DataFetcher] Meteora pool ${pool.id}: Zero reserves`);
          return null;
        }

        // Calculate prices
        const priceAtoB = tokenBReserve.div(tokenAReserve);
        const priceBtoA = tokenAReserve.div(tokenBReserve);

        // Calculate liquidity USD
        const priceA = this.tokenPrices.get(pool.tokenASymbol) || new Decimal(0);
        const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new Decimal(0);
        const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));

        return {
          poolId: pool.id,
          tokenAReserve,
          tokenBReserve,
          liquidityUSD,
          priceAtoB,
          priceBtoA,
          lastUpdate: Date.now(),
        };
      }

      // Fallback: Parse pool account
      const poolPubkey = new PublicKey(pool.address);
      const poolAccountInfo = await this.connection.getAccountInfo(poolPubkey);

      if (!poolAccountInfo) {
        console.warn(`[DataFetcher] Meteora pool ${pool.id}: Pool account not found`);
        return null;
      }

      // Meteora DLMM pool layout: Read reserves as BigInt
      const reserveXBuf = poolAccountInfo.data.slice(73, 89);
      const reserveYBuf = poolAccountInfo.data.slice(105, 121);

      const reserveX = BigInt("0x" + Buffer.from(reserveXBuf).reverse().toString("hex"));
      const reserveY = BigInt("0x" + Buffer.from(reserveYBuf).reverse().toString("hex"));

      const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
      const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);

      const tokenAReserve = new Decimal(reserveX.toString()).div(10 ** tokenADecimals);
      const tokenBReserve = new Decimal(reserveY.toString()).div(10 ** tokenBDecimals);

      // Skip if reserves are zero
      if (tokenAReserve.isZero() || tokenBReserve.isZero()) {
        console.warn(`[DataFetcher] Meteora pool ${pool.id}: Zero reserves`);
        return null;
      }

      // Calculate prices
      const priceAtoB = tokenBReserve.div(tokenAReserve);
      const priceBtoA = tokenAReserve.div(tokenBReserve);

      // Calculate liquidity USD
      const priceA = this.tokenPrices.get(pool.tokenASymbol) || new Decimal(0);
      const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new Decimal(0);
      const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));

      return {
        poolId: pool.id,
        tokenAReserve,
        tokenBReserve,
        liquidityUSD,
        priceAtoB,
        priceBtoA,
        lastUpdate: Date.now(),
      };
    } catch (error: any) {
      console.warn(`[DataFetcher] Meteora pool ${pool.id} fetch error: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch Orca Whirlpool liquidity
   */
  private async fetchOrcaWhirlpoolLiquidity(pool: PoolConfig): Promise<PoolLiquidityData | null> {
    try {
      // Use pre-configured vault addresses if available (faster!)
      let tokenVaultA: PublicKey;
      let tokenVaultB: PublicKey;

      if (pool.vaultA && pool.vaultB && pool.vaultA !== "" && pool.vaultB !== "") {
        tokenVaultA = new PublicKey(pool.vaultA);
        tokenVaultB = new PublicKey(pool.vaultB);
      } else {
        // Fallback: Parse pool account
        const poolPubkey = new PublicKey(pool.address);
        const poolAccountInfo = await this.connection.getAccountInfo(poolPubkey);

        if (!poolAccountInfo) {
          console.warn(`[DataFetcher] Orca Whirlpool ${pool.id}: Pool account not found`);
          return null;
        }

        // Orca Whirlpool layout: Offset 101-133: tokenVaultA, Offset 133-165: tokenVaultB
        tokenVaultA = new PublicKey(poolAccountInfo.data.slice(101, 133));
        tokenVaultB = new PublicKey(poolAccountInfo.data.slice(133, 165));
      }

      // Get vault balances
      const [vaultA, vaultB] = await Promise.all([
        getAccount(this.connection, tokenVaultA),
        getAccount(this.connection, tokenVaultB),
      ]);

      // Get token decimals
      const tokenADecimals = this.getTokenDecimals(pool.tokenASymbol);
      const tokenBDecimals = this.getTokenDecimals(pool.tokenBSymbol);

      // Convert to human-readable amounts
      const tokenAReserve = new Decimal(vaultA.amount.toString()).div(10 ** tokenADecimals);
      const tokenBReserve = new Decimal(vaultB.amount.toString()).div(10 ** tokenBDecimals);

      // Calculate prices
      const priceAtoB = tokenAReserve.isZero() ? new Decimal(0) : tokenBReserve.div(tokenAReserve);
      const priceBtoA = tokenBReserve.isZero() ? new Decimal(0) : tokenAReserve.div(tokenBReserve);

      // Calculate liquidity USD
      const priceA = this.tokenPrices.get(pool.tokenASymbol) || new Decimal(0);
      const priceB = this.tokenPrices.get(pool.tokenBSymbol) || new Decimal(0);
      const liquidityUSD = tokenAReserve.mul(priceA).plus(tokenBReserve.mul(priceB));

      return {
        poolId: pool.id,
        tokenAReserve,
        tokenBReserve,
        liquidityUSD,
        priceAtoB,
        priceBtoA,
        lastUpdate: Date.now(),
      };
    } catch (error: any) {
      console.warn(`[DataFetcher] Orca Whirlpool ${pool.id} fetch error: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch Phoenix liquidity
   * TODO: Implement with Phoenix SDK
   */
  private async fetchPhoenixLiquidity(pool: PoolConfig): Promise<PoolLiquidityData | null> {
    // For now, return null to skip Phoenix pools until SDK is implemented
    console.warn(`[DataFetcher] Phoenix pool ${pool.id} skipped (SDK not implemented)`);
    return null;
  }

  /**
   * Get token decimals
   */
  private getTokenDecimals(symbol: string): number {
    switch (symbol) {
      case "USDC": return USDC_DECIMALS;
      case "SOL": return SOL_DECIMALS;
      case "BONK": return BONK_DECIMALS;
      default: return 6;
    }
  }

  /**
   * Get current token prices
   */
  getTokenPrices(): Map<string, Decimal> {
    return new Map(this.tokenPrices);
  }
}
