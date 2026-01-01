"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleCsvLogger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class SimpleCsvLogger {
    constructor(logDir = './logs', logType = 'Scanner') {
        this.entryCount = 0;
        this.logType = logType;
        // Create logs directory if it doesn't exist
        if (!fs_1.default.existsSync(logDir)) {
            fs_1.default.mkdirSync(logDir, { recursive: true });
        }
        // Generate filename with type and date
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
        this.logFilePath = path_1.default.join(logDir, `${logType}_${dateStr}_${timeStr}.csv`);
        // Initialize CSV file with headers
        this.initializeCsvFile();
        // Count existing entries
        this.entryCount = this.countExistingEntries();
    }
    /**
     * Initialize CSV file with simplified headers
     */
    initializeCsvFile() {
        if (!fs_1.default.existsSync(this.logFilePath)) {
            const headers = [
                'Sl No.',
                'Timestamp',
                'Orca 0.01%',
                'Orca 0.05%',
                'Spread_USD',
                'Spread_PCT',
                'Net Profit',
                'Trade Possible',
                'Failure Reason'
            ].join(',');
            fs_1.default.writeFileSync(this.logFilePath, headers + '\n');
            console.log(`[CSV] Created ${this.logType} log file: ${this.logFilePath}`);
        }
    }
    /**
     * Count existing entries in CSV file
     */
    countExistingEntries() {
        if (!fs_1.default.existsSync(this.logFilePath)) {
            return 0;
        }
        const content = fs_1.default.readFileSync(this.logFilePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        return Math.max(0, lines.length - 1); // Subtract header
    }
    /**
     * Escape CSV value
     */
    escapeCsvValue(value) {
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
     * Format datetime to readable format
     */
    formatDateTime() {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        let hours = date.getHours();
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const hours12 = String(hours).padStart(2, '0');
        return `${year}-${month}-${day} ${hours12}:${minutes}:${seconds} ${ampm}`;
    }
    /**
     * Log a trade check
     */
    logTrade(entry) {
        this.entryCount++;
        const tradePossible = entry.trade_possible ? 'YES' : 'NO';
        const failureReason = entry.trade_possible ? '' : entry.failure_reason;
        const row = [
            this.entryCount, // Sl No.
            this.formatDateTime(), // Timestamp
            entry.price_001_pool.toFixed(6), // Orca 0.01%
            entry.price_005_pool.toFixed(6), // Orca 0.05%
            entry.spread_usd.toFixed(6), // Spread_USD
            entry.spread_pct.toFixed(4) + '%', // Spread_PCT
            entry.net_profit_pct.toFixed(4) + '%', // Net Profit
            tradePossible, // Trade Possible
            this.escapeCsvValue(failureReason) // Failure Reason
        ].join(',');
        fs_1.default.appendFileSync(this.logFilePath, row + '\n');
        // Console log
        const status = entry.trade_possible ? '✅ TRADEABLE' : '❌ NOT TRADEABLE';
        console.log(`[CSV] ${this.logType} #${this.entryCount}: ${status} | Profit: ${entry.net_profit_pct.toFixed(4)}%${failureReason ? ' | ' + failureReason : ''}`);
    }
    /**
     * Get log file path
     */
    getLogPath() {
        return this.logFilePath;
    }
    /**
     * Get entry count
     */
    getEntryCount() {
        return this.entryCount;
    }
}
exports.SimpleCsvLogger = SimpleCsvLogger;
