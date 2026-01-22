import * as fs from "fs";
import * as path from "path";
import { PathSimulationResult } from "./MultiPathCalculator";
import { PoolLiquidityData } from "./MultiPathCalculator";

/* =========================
   MULTI-PATH CSV LOGGER
   Two separate files:
   1. Scanner_data.csv - All scans (tradable + non-tradable)
   2. Trade_data.csv - Only tradable opportunities
========================= */

export class MultiPathLogger {
  private logDir: string;
  private scannerCsvPath: string;
  private tradeCsvPath: string;

  constructor(logDir: string = "./logs/multipath") {
    this.logDir = logDir;
    this.scannerCsvPath = path.join(logDir, `Scanner_data_${this.getDateString()}.csv`);
    this.tradeCsvPath = path.join(logDir, `Trade_data_${this.getDateString()}.csv`);

    this.ensureLogDir();
    this.initializeCsvFiles();
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
      console.log(`[Logger] Created log directory: ${this.logDir}`);
    }
  }

  /**
   * Get date string for filename
   */
  private getDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }

  /**
   * Initialize CSV files with headers
   */
  private initializeCsvFiles(): void {
    const scannerHeader = [
      "timestamp",
      "scan_number",
      "path_id",
      "path_type",
      "path_description",
      "pool_count",
      "initial_usdc",
      "final_usdc",
      "gross_profit_usdc",
      "gross_profit_pct",
      "net_profit_usdc",
      "net_profit_pct",
      "total_fees_pct",
      "total_price_impact_pct",
      "total_liquidity_usd",
      "min_pool_liquidity_usd",
      "pool_1_name",
      "pool_1_in",
      "pool_1_out",
      "pool_1_fee_pct",
      "pool_1_impact_pct",
      "pool_1_liquidity_usd",
      "pool_2_name",
      "pool_2_in",
      "pool_2_out",
      "pool_2_fee_pct",
      "pool_2_impact_pct",
      "pool_2_liquidity_usd",
      "pool_3_name",
      "pool_3_in",
      "pool_3_out",
      "pool_3_fee_pct",
      "pool_3_impact_pct",
      "pool_3_liquidity_usd",
      "pool_4_name",
      "pool_4_in",
      "pool_4_out",
      "pool_4_fee_pct",
      "pool_4_impact_pct",
      "pool_4_liquidity_usd",
      "is_tradable",
      "failure_reason",
      "simulation_time_ms",
    ].join(",");

    const tradeHeader = [
      "timestamp",
      "scan_number",
      "path_id",
      "path_type",
      "opportunity_rank",
      "initial_usdc",
      "final_usdc",
      "net_profit_usdc",
      "net_profit_pct",
      "total_fees_pct",
      "total_impact_pct",
      "execution_pools",
      "trade_flow",
      "min_liquidity_usd",
      "total_liquidity_usd",
    ].join(",");

    // Scanner data file
    if (!fs.existsSync(this.scannerCsvPath)) {
      fs.writeFileSync(this.scannerCsvPath, scannerHeader + "\n");
      console.log(`[Logger] Created scanner log: ${this.scannerCsvPath}`);
    }

    // Trade data file
    if (!fs.existsSync(this.tradeCsvPath)) {
      fs.writeFileSync(this.tradeCsvPath, tradeHeader + "\n");
      console.log(`[Logger] Created trade log: ${this.tradeCsvPath}`);
    }
  }

  /**
   * Log all scan results (tradable + non-tradable)
   */
  logScannerData(scanNumber: number, results: PathSimulationResult[]): void {
    for (const result of results) {
      const row = [
        new Date().toISOString(),
        scanNumber,
        result.pathId,
        result.pathType,
        `"${result.description}"`,
        result.swaps.length,
        result.initialUSDC.toFixed(6),
        result.finalUSDC.toFixed(6),
        result.grossProfitUSDC.toFixed(6),
        (result.grossProfitPct.mul(100)).toFixed(4),
        result.netProfitUSDC.toFixed(6),
        (result.netProfitPct.mul(100)).toFixed(4),
        (result.totalFeesPct.mul(100)).toFixed(4),
        (result.totalPriceImpact.mul(100)).toFixed(4),
        result.totalLiquidityUSD.toFixed(0),
        result.minPoolLiquidityUSD.toFixed(0),
        // Pool 1
        result.swaps[0] ? `"${result.swaps[0].poolName}"` : "",
        result.swaps[0] ? result.swaps[0].amountIn.toFixed(6) : "",
        result.swaps[0] ? result.swaps[0].amountOut.toFixed(6) : "",
        result.swaps[0] ? (result.swaps[0].feeRate.mul(100)).toFixed(3) : "",
        result.swaps[0] ? (result.swaps[0].priceImpact.mul(100)).toFixed(4) : "",
        result.swaps[0] ? result.swaps[0].liquidityUSD.toFixed(0) : "",
        // Pool 2
        result.swaps[1] ? `"${result.swaps[1].poolName}"` : "",
        result.swaps[1] ? result.swaps[1].amountIn.toFixed(6) : "",
        result.swaps[1] ? result.swaps[1].amountOut.toFixed(6) : "",
        result.swaps[1] ? (result.swaps[1].feeRate.mul(100)).toFixed(3) : "",
        result.swaps[1] ? (result.swaps[1].priceImpact.mul(100)).toFixed(4) : "",
        result.swaps[1] ? result.swaps[1].liquidityUSD.toFixed(0) : "",
        // Pool 3
        result.swaps[2] ? `"${result.swaps[2].poolName}"` : "",
        result.swaps[2] ? result.swaps[2].amountIn.toFixed(6) : "",
        result.swaps[2] ? result.swaps[2].amountOut.toFixed(6) : "",
        result.swaps[2] ? (result.swaps[2].feeRate.mul(100)).toFixed(3) : "",
        result.swaps[2] ? (result.swaps[2].priceImpact.mul(100)).toFixed(4) : "",
        result.swaps[2] ? result.swaps[2].liquidityUSD.toFixed(0) : "",
        // Pool 4
        result.swaps[3] ? `"${result.swaps[3].poolName}"` : "",
        result.swaps[3] ? result.swaps[3].amountIn.toFixed(6) : "",
        result.swaps[3] ? result.swaps[3].amountOut.toFixed(6) : "",
        result.swaps[3] ? (result.swaps[3].feeRate.mul(100)).toFixed(3) : "",
        result.swaps[3] ? (result.swaps[3].priceImpact.mul(100)).toFixed(4) : "",
        result.swaps[3] ? result.swaps[3].liquidityUSD.toFixed(0) : "",
        // Status
        result.isExecutable ? "TRUE" : "FALSE",
        `"${result.failureReason || ""}"`,
        result.simulationTimeMs,
      ].join(",");

      fs.appendFileSync(this.scannerCsvPath, row + "\n");
    }
  }

  /**
   * Log only tradable opportunities
   */
  logTradeData(scanNumber: number, tradableResults: PathSimulationResult[]): void {
    for (let i = 0; i < tradableResults.length; i++) {
      const result = tradableResults[i];

      // Build trade flow string
      const tradeFlow = result.swaps
        .map((s, idx) => `${s.tokenIn}->${s.tokenOut}`)
        .join(" | ");

      // Build execution pools string
      const executionPools = result.swaps
        .map(s => s.poolName)
        .join(" | ");

      const row = [
        new Date().toISOString(),
        scanNumber,
        result.pathId,
        result.pathType,
        i + 1, // Rank (1 = best)
        result.initialUSDC.toFixed(6),
        result.finalUSDC.toFixed(6),
        result.netProfitUSDC.toFixed(6),
        (result.netProfitPct.mul(100)).toFixed(4),
        (result.totalFeesPct.mul(100)).toFixed(4),
        (result.totalPriceImpact.mul(100)).toFixed(4),
        `"${executionPools}"`,
        `"${tradeFlow}"`,
        result.minPoolLiquidityUSD.toFixed(0),
        result.totalLiquidityUSD.toFixed(0),
      ].join(",");

      fs.appendFileSync(this.tradeCsvPath, row + "\n");
    }
  }

  /**
   * Get log file paths
   */
  getLogPaths(): { scanner: string; trade: string } {
    return {
      scanner: this.scannerCsvPath,
      trade: this.tradeCsvPath,
    };
  }
}

/* =========================
   POOL PRICE LOGGER
   Logs DEX prices and spreads
========================= */

export interface PoolPriceData {
  poolId: string;
  poolName: string;
  dex: string;
  tokenPair: string;
  priceAtoB: string; // e.g., "0.005000" (1 USDC = 0.005 SOL)
  priceBtoA: string; // e.g., "200.000" (1 SOL = 200 USDC)
  liquidityUSD: string;
  lastUpdate: string;
}

export class PoolPriceLogger {
  private logDir: string;
  private priceCsvPath: string;

  constructor(logDir: string = "./logs/multipath") {
    this.logDir = logDir;
    this.priceCsvPath = path.join(logDir, `Pool_prices_${this.getDateString()}.csv`);

    this.ensureLogDir();
    this.initializeCsvFile();
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }

  private initializeCsvFile(): void {
    const header = [
      "timestamp",
      "pool_id",
      "pool_name",
      "dex",
      "token_pair",
      "price_a_to_b",
      "price_b_to_a",
      "liquidity_usd",
      "reserve_a",
      "reserve_b",
    ].join(",");

    if (!fs.existsSync(this.priceCsvPath)) {
      fs.writeFileSync(this.priceCsvPath, header + "\n");
      console.log(`[Logger] Created price log: ${this.priceCsvPath}`);
    }
  }

  /**
   * Log pool prices
   */
  logPoolPrices(poolsData: Map<string, PoolLiquidityData>): void {
    const timestamp = new Date().toISOString();

    poolsData.forEach((data, poolId) => {
      const row = [
        timestamp,
        data.poolId,
        `"${poolId}"`, // Pool name
        "N/A", // DEX (can be enhanced)
        "N/A", // Token pair (can be enhanced)
        data.priceAtoB.toFixed(9),
        data.priceBtoA.toFixed(9),
        data.liquidityUSD.toFixed(0),
        data.tokenAReserve.toFixed(6),
        data.tokenBReserve.toFixed(6),
      ].join(",");

      fs.appendFileSync(this.priceCsvPath, row + "\n");
    });
  }

  getPriceCsvPath(): string {
    return this.priceCsvPath;
  }
}
