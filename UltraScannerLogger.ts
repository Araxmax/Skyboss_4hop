import fs from 'fs';
import path from 'path';
import Decimal from 'decimal.js';

/* =========================
   ULTRA SCANNER CSV LOGGER
========================= */

export interface UltraScanLogEntry {
  scan_number: number;
  timestamp: string;
  raydium_price: number;
  orca_price: number;
  spread_usd: number;
  spread_pct: number;
  net_profit: number;
  is_tradable: boolean;
  failure_reason: string;
}

export class UltraScannerLogger {
  private logDir: string;
  private currentLogFile: string;
  private currentDate: string;

  constructor(logDir: string = './logs') {
    this.logDir = logDir;
    this.currentDate = this.getDateString();
    this.currentLogFile = this.getLogFilePath();
    this.ensureLogDirExists();
    this.ensureHeaderExists();
  }

  /**
   * Get current date string in YYYY-MM-DD format
   */
  private getDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Get log file path for current date
   */
  private getLogFilePath(): string {
    return path.join(this.logDir, `Ultrascanner_${this.currentDate}.csv`);
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirExists(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Ensure CSV header exists in file
   */
  private ensureHeaderExists(): void {
    if (!fs.existsSync(this.currentLogFile)) {
      const header = 'Sl No.,Timestamp,Radiyum Prc,Orca prc,Spread_USD,Spread_PCT,Net Profit,Trade Possible,Failure Reason';

      fs.writeFileSync(this.currentLogFile, header + '\n');
      console.log(`[UltraScanner] Created new log file: ${this.currentLogFile}`);
    }
  }

  /**
   * Check if date has changed and update log file
   */
  private checkDateChange(): void {
    const newDate = this.getDateString();
    if (newDate !== this.currentDate) {
      this.currentDate = newDate;
      this.currentLogFile = this.getLogFilePath();
      this.ensureHeaderExists();
      console.log(`[UltraScanner] Date changed, new log file: ${this.currentLogFile}`);
    }
  }

  /**
   * Log a scan entry
   */
  logScan(entry: UltraScanLogEntry): void {
    try {
      this.checkDateChange();

      const row = [
        entry.scan_number,
        entry.timestamp,
        entry.raydium_price.toFixed(6),
        entry.orca_price.toFixed(6),
        entry.spread_usd.toFixed(6),
        entry.spread_pct.toFixed(4),
        entry.net_profit.toFixed(4),
        entry.is_tradable ? 'YES' : 'NO',
        entry.failure_reason
      ].join(',');

      fs.appendFileSync(this.currentLogFile, row + '\n');
    } catch (error: any) {
      console.error(`[UltraScanner] Error logging scan: ${error.message}`);
    }
  }

  /**
   * Get current log file path (for external access)
   */
  getCurrentLogFile(): string {
    return this.currentLogFile;
  }
}
