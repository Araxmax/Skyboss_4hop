import fs from "fs";
import path from "path";
import Decimal from "decimal.js";
import { PREDEFINED_POOLS } from "./constants";

/* =========================
   TYPES
========================= */

export interface ArbitrageSignal {
  base: string;
  direction: string;
  profit_pct: number;
  trade_usdc: number;
  timestamp?: number;
}

export interface ParsedSignal {
  pool1Address: string;
  pool2Address: string;
  direction: "pool1-to-pool2" | "pool2-to-pool1";
  profitPercent: Decimal;
  tradeAmount: Decimal;
  isValid: boolean;
  error?: string;
}

/* =========================
   SIGNAL MANAGER CLASS
========================= */

export class SignalManager {
  private signalPath: string;
  private minProfitPercent: Decimal;
  private maxTradeAmount: Decimal;
  private signalMaxAge: number; // in seconds

  constructor(
    signalPath: string = "./signal.json",
    minProfitPercent: number = 0.001,
    maxTradeAmount: number = 1000,
    signalMaxAge: number = 10
  ) {
    this.signalPath = signalPath;
    this.minProfitPercent = new Decimal(minProfitPercent);
    this.maxTradeAmount = new Decimal(maxTradeAmount);
    this.signalMaxAge = signalMaxAge;
  }

  /**
   * Check if signal file exists
   */
  signalExists(): boolean {
    return fs.existsSync(this.signalPath);
  }

  /**
   * Read raw signal from file
   */
  readSignal(): ArbitrageSignal | null {
    try {
      if (!this.signalExists()) {
        return null;
      }

      const content = fs.readFileSync(this.signalPath, "utf8");
      const signal: ArbitrageSignal = JSON.parse(content);

      return signal;
    } catch (error: any) {
      console.error(`Error reading signal: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse signal direction to extract pool addresses
   */
  private parseDirection(direction: string): {
    pool1: string;
    pool2: string;
    directionType: "pool1-to-pool2" | "pool2-to-pool1";
  } | null {
    // Expected format: "SOL/USDC 0.05% [VERIFIED] -> SOL/USDC 0.01% [VERIFIED]"
    // This tells us to buy on first pool, sell on second pool

    const parts = direction.split(" -> ");
    if (parts.length !== 2) {
      console.error("Invalid direction format");
      return null;
    }

    const pool1Name = parts[0].trim();
    const pool2Name = parts[1].trim();

    // Map pool names to addresses (from constants)
    const poolMapping = new Map<string, string>();
    for (const pool of PREDEFINED_POOLS) {
      poolMapping.set(pool.name, pool.address);
    }

    const pool1Address = poolMapping.get(pool1Name);
    const pool2Address = poolMapping.get(pool2Name);

    if (!pool1Address || !pool2Address) {
      console.error("Unknown pool in direction");
      return null;
    }

    return {
      pool1: pool1Address,
      pool2: pool2Address,
      directionType: "pool1-to-pool2",
    };
  }

  /**
   * Validate and parse signal
   */
  validateAndParseSignal(): ParsedSignal {
    const signal = this.readSignal();

    if (!signal) {
      return {
        pool1Address: "",
        pool2Address: "",
        direction: "pool1-to-pool2",
        profitPercent: new Decimal(0),
        tradeAmount: new Decimal(0),
        isValid: false,
        error: "No signal file found",
      };
    }

    // Parse direction
    const parsedDirection = this.parseDirection(signal.direction);
    if (!parsedDirection) {
      return {
        pool1Address: "",
        pool2Address: "",
        direction: "pool1-to-pool2",
        profitPercent: new Decimal(0),
        tradeAmount: new Decimal(0),
        isValid: false,
        error: "Invalid direction format",
      };
    }

    // Validate profit percentage
    const profitPct = new Decimal(signal.profit_pct);
    if (profitPct.lt(this.minProfitPercent)) {
      return {
        pool1Address: parsedDirection.pool1,
        pool2Address: parsedDirection.pool2,
        direction: parsedDirection.directionType,
        profitPercent: profitPct,
        tradeAmount: new Decimal(signal.trade_usdc),
        isValid: false,
        error: `Profit ${profitPct.toString()}% below minimum ${this.minProfitPercent.toString()}%`,
      };
    }

    // Validate trade amount
    const tradeAmount = new Decimal(signal.trade_usdc);
    if (tradeAmount.gt(this.maxTradeAmount)) {
      return {
        pool1Address: parsedDirection.pool1,
        pool2Address: parsedDirection.pool2,
        direction: parsedDirection.directionType,
        profitPercent: profitPct,
        tradeAmount: tradeAmount,
        isValid: false,
        error: `Trade amount ${tradeAmount.toString()} exceeds maximum ${this.maxTradeAmount.toString()}`,
      };
    }

    // All validations passed
    return {
      pool1Address: parsedDirection.pool1,
      pool2Address: parsedDirection.pool2,
      direction: parsedDirection.directionType,
      profitPercent: profitPct,
      tradeAmount: tradeAmount,
      isValid: true,
    };
  }

  /**
   * Delete signal file after processing
   */
  deleteSignal(): void {
    try {
      if (this.signalExists()) {
        fs.unlinkSync(this.signalPath);
        console.log(`[SIGNAL] Deleted signal file: ${this.signalPath}`);
      }
    } catch (error: any) {
      console.error(`Error deleting signal: ${error.message}`);
    }
  }

  /**
   * Archive signal to history
   */
  archiveSignal(success: boolean, profit?: Decimal): void {
    try {
      const signal = this.readSignal();
      if (!signal) return;

      const archivePath = "./signal_history.json";
      let history: any[] = [];

      if (fs.existsSync(archivePath)) {
        const content = fs.readFileSync(archivePath, "utf8");
        history = JSON.parse(content);
      }

      history.push({
        ...signal,
        executed_at: new Date().toISOString(),
        success,
        actual_profit: profit ? profit.toString() : null,
      });

      fs.writeFileSync(archivePath, JSON.stringify(history, null, 2));
      console.log(`[SIGNAL] Archived signal to history`);
    } catch (error: any) {
      console.error(`Error archiving signal: ${error.message}`);
    }
  }

  /**
   * Wait for new signal with timeout
   */
  async waitForSignal(timeoutSeconds: number = 60): Promise<boolean> {
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    console.log(`[SIGNAL] Waiting for signal (timeout: ${timeoutSeconds}s)...`);

    while (Date.now() - startTime < timeoutMs) {
      if (this.signalExists()) {
        console.log("[SIGNAL] New signal detected!");
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("[SIGNAL] Timeout waiting for signal");
    return false;
  }

  /**
   * Monitor signal file for changes (optimized with debouncing)
   */
  watchSignal(callback: (signal: ParsedSignal) => void): fs.FSWatcher {
    const dir = path.dirname(this.signalPath);
    const filename = path.basename(this.signalPath);

    console.log(`[SIGNAL] Watching for signal file: ${this.signalPath}`);

    // Debounce to avoid multiple rapid triggers
    let debounceTimer: NodeJS.Timeout | null = null;
    const DEBOUNCE_MS = 100;

    const processSignal = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        if (this.signalExists()) {
          console.log("\n[SIGNAL] Signal file detected!");
          const parsed = this.validateAndParseSignal();
          callback(parsed);
        }
        debounceTimer = null;
      }, DEBOUNCE_MS);
    };

    const watcher = fs.watch(dir, (eventType, changedFile) => {
      if (changedFile === filename) {
        if (eventType === "rename" && this.signalExists()) {
          // File created
          processSignal();
        } else if (eventType === "change") {
          // File modified
          processSignal();
        }
      }
    });

    return watcher;
  }
}
