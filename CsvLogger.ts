import fs from 'fs';
import path from 'path';
import Decimal from 'decimal.js';

/* =========================
   CSV LOGGER CLASS
========================= */

export interface TradeLogEntry {
  timestamp: string;
  datetime: string;
  signal_direction: string;

  // Pool prices
  price_001_pool: number;  // Price of 0.01% fee pool
  price_005_pool: number;  // Price of 0.05% fee pool
  spread: number;          // Absolute price difference
  spread_pct: number;      // Spread as percentage

  expected_profit_pct: number;
  trade_amount_usdc: number;

  // Safety checks
  safety_passed: boolean;
  safety_errors: string;
  safety_warnings: string;

  sol_balance: number;
  usdc_balance: number;

  // Execution
  executed: boolean;
  dry_run: boolean;

  // Swap 1
  swap1_pool: string;
  swap1_success: boolean;
  swap1_amount_in: number;
  swap1_amount_out: number;
  swap1_signature: string;
  swap1_error: string;

  // Swap 2
  swap2_pool: string;
  swap2_success: boolean;
  swap2_amount_in: number;
  swap2_amount_out: number;
  swap2_signature: string;
  swap2_error: string;

  // Results
  actual_profit_usdc: number;
  actual_profit_pct: number;

  // Failure reasons
  failure_reason: string;
  failure_stage: string;
}

export class CsvLogger {
  private logFilePath: string;
  private summaryFilePath: string;
  private entryCount: number = 0;

  constructor(logDir: string = './logs') {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    this.logFilePath = path.join(logDir, `trades_${date}.csv`);
    this.summaryFilePath = path.join(logDir, `summary_${date}.csv`);

    // Initialize CSV file with headers if it doesn't exist
    this.initializeCsvFile();

    // Count existing entries to continue numbering
    this.entryCount = this.countExistingEntries();
  }

  /**
   * Initialize CSV file with headers
   */
  private initializeCsvFile(): void {
    if (!fs.existsSync(this.logFilePath)) {
      const headers = [
        'No.',
        'Timestamp',
        'DateTime',
        'Signal Direction',
        'Price 0.01% Pool',
        'Price 0.05% Pool',
        'Spread',
        'Spread %',
        'Expected Profit %',
        'Trade Amount USDC',
        'Safety Passed',
        'Safety Errors',
        'Safety Warnings',
        'SOL Balance',
        'USDC Balance',
        'Executed',
        'Dry Run',
        'Swap1 Pool',
        'Swap1 Success',
        'Swap1 Amount In',
        'Swap1 Amount Out',
        'Swap1 Signature',
        'Swap1 Error',
        'Swap2 Pool',
        'Swap2 Success',
        'Swap2 Amount In',
        'Swap2 Amount Out',
        'Swap2 Signature',
        'Swap2 Error',
        'Actual Profit USDC',
        'Actual Profit %',
        'Failure Reason',
        'Failure Stage',
      ].join(',');

      fs.writeFileSync(this.logFilePath, headers + '\n');
      console.log(`[CSV] Created log file: ${this.logFilePath}`);
    }
  }

  /**
   * Count existing entries in CSV file
   */
  private countExistingEntries(): number {
    if (!fs.existsSync(this.logFilePath)) {
      return 0;
    }

    const content = fs.readFileSync(this.logFilePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    // Subtract 1 for header row
    return Math.max(0, lines.length - 1);
  }

  /**
   * Escape CSV value
   */
  private escapeCsvValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    const str = String(value);

    // If contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }

  /**
   * Format datetime to 12-hour format with AM/PM
   */
  private formatDateTime12Hour(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const hours12 = String(hours).padStart(2, '0');

    return `${year}-${month}-${day} ${hours12}:${minutes}:${seconds}.${milliseconds} ${ampm}`;
  }

  /**
   * Log a trade attempt
   */
  logTrade(entry: TradeLogEntry): void {
    // Increment entry count
    this.entryCount++;

    // Convert datetime to 12-hour format
    const date = new Date(entry.datetime);
    const datetime12h = this.formatDateTime12Hour(date);

    const row = [
      this.entryCount,  // Serial number
      entry.timestamp,
      this.escapeCsvValue(datetime12h),
      this.escapeCsvValue(entry.signal_direction),
      entry.price_001_pool,
      entry.price_005_pool,
      entry.spread,
      entry.spread_pct,
      entry.expected_profit_pct,
      entry.trade_amount_usdc,
      entry.safety_passed,
      this.escapeCsvValue(entry.safety_errors),
      this.escapeCsvValue(entry.safety_warnings),
      entry.sol_balance,
      entry.usdc_balance,
      entry.executed,
      entry.dry_run,
      this.escapeCsvValue(entry.swap1_pool),
      entry.swap1_success,
      entry.swap1_amount_in,
      entry.swap1_amount_out,
      this.escapeCsvValue(entry.swap1_signature),
      this.escapeCsvValue(entry.swap1_error),
      this.escapeCsvValue(entry.swap2_pool),
      entry.swap2_success,
      entry.swap2_amount_in,
      entry.swap2_amount_out,
      this.escapeCsvValue(entry.swap2_signature),
      this.escapeCsvValue(entry.swap2_error),
      entry.actual_profit_usdc,
      entry.actual_profit_pct,
      this.escapeCsvValue(entry.failure_reason),
      this.escapeCsvValue(entry.failure_stage),
    ].join(',');

    fs.appendFileSync(this.logFilePath, row + '\n');

    console.log(`[CSV] Logged trade #${this.entryCount}: ${entry.executed ? 'EXECUTED' : 'FAILED'} - ${entry.failure_reason || 'Success'}`);
  }

  /**
   * Create a summary report
   */
  writeSummary(stats: {
    totalSignals: number;
    safetyPassed: number;
    safetyFailed: number;
    executed: number;
    successful: number;
    failed: number;
    totalProfit: Decimal;
    avgProfit: Decimal;
  }): void {
    const summary = [
      ['Metric', 'Value'],
      ['Total Signals Received', stats.totalSignals],
      ['Safety Checks Passed', stats.safetyPassed],
      ['Safety Checks Failed', stats.safetyFailed],
      ['Trades Executed', stats.executed],
      ['Successful Trades', stats.successful],
      ['Failed Trades', stats.failed],
      ['Success Rate', `${stats.executed > 0 ? ((stats.successful / stats.executed) * 100).toFixed(2) : 0}%`],
      ['Total Profit (USDC)', stats.totalProfit.toFixed(6)],
      ['Average Profit (USDC)', stats.avgProfit.toFixed(6)],
      ['Timestamp', new Date().toISOString()],
    ].map(row => row.join(',')).join('\n');

    fs.writeFileSync(this.summaryFilePath, summary);
    console.log(`[CSV] Summary written: ${this.summaryFilePath}`);
  }

  /**
   * Get log file path
   */
  getLogPath(): string {
    return this.logFilePath;
  }

  /**
   * Read recent trades
   */
  readRecentTrades(count: number = 10): TradeLogEntry[] {
    if (!fs.existsSync(this.logFilePath)) {
      return [];
    }

    const lines = fs.readFileSync(this.logFilePath, 'utf8').split('\n');
    const recentLines = lines.slice(-count - 1, -1); // Exclude header and last empty line

    return recentLines.map(line => {
      const values = line.split(',');
      return {
        timestamp: values[0],
        datetime: values[1],
        signal_direction: values[2],
        price_001_pool: parseFloat(values[3]) || 0,
        price_005_pool: parseFloat(values[4]) || 0,
        spread: parseFloat(values[5]) || 0,
        spread_pct: parseFloat(values[6]) || 0,
        expected_profit_pct: parseFloat(values[7]) || 0,
        trade_amount_usdc: parseFloat(values[8]) || 0,
        safety_passed: values[9] === 'true',
        safety_errors: values[10],
        safety_warnings: values[11],
        sol_balance: parseFloat(values[12]) || 0,
        usdc_balance: parseFloat(values[13]) || 0,
        executed: values[14] === 'true',
        dry_run: values[15] === 'true',
        swap1_pool: values[16],
        swap1_success: values[17] === 'true',
        swap1_amount_in: parseFloat(values[18]) || 0,
        swap1_amount_out: parseFloat(values[19]) || 0,
        swap1_signature: values[20],
        swap1_error: values[21],
        swap2_pool: values[22],
        swap2_success: values[23] === 'true',
        swap2_amount_in: parseFloat(values[24]) || 0,
        swap2_amount_out: parseFloat(values[25]) || 0,
        swap2_signature: values[26],
        swap2_error: values[27],
        actual_profit_usdc: parseFloat(values[28]) || 0,
        actual_profit_pct: parseFloat(values[29]) || 0,
        failure_reason: values[30],
        failure_stage: values[31],
      } as TradeLogEntry;
    });
  }
}
