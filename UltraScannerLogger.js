"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UltraScannerLogger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class UltraScannerLogger {
    constructor(logDir = './logs') {
        this.logDir = logDir;
        this.currentDate = this.getDateString();
        this.currentLogFile = this.getLogFilePath();
        this.ensureLogDirExists();
        this.ensureHeaderExists();
    }
    /**
     * Get current date string in YYYY-MM-DD format
     */
    getDateString() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    /**
     * Get log file path for current date
     */
    getLogFilePath() {
        return path_1.default.join(this.logDir, `Ultrascanner_${this.currentDate}.csv`);
    }
    /**
     * Ensure log directory exists
     */
    ensureLogDirExists() {
        if (!fs_1.default.existsSync(this.logDir)) {
            fs_1.default.mkdirSync(this.logDir, { recursive: true });
        }
    }
    /**
     * Ensure CSV header exists in file
     */
    ensureHeaderExists() {
        if (!fs_1.default.existsSync(this.currentLogFile)) {
            const header = 'Sl No.,Timestamp,Radiyum Prc,Orca prc,Spread_USD,Spread_PCT,Net Profit,Trade Possible,Failure Reason';
            fs_1.default.writeFileSync(this.currentLogFile, header + '\n');
            console.log(`[UltraScanner] Created new log file: ${this.currentLogFile}`);
        }
    }
    /**
     * Check if date has changed and update log file
     */
    checkDateChange() {
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
    logScan(entry) {
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
            fs_1.default.appendFileSync(this.currentLogFile, row + '\n');
        }
        catch (error) {
            console.error(`[UltraScanner] Error logging scan: ${error.message}`);
        }
    }
    /**
     * Get current log file path (for external access)
     */
    getCurrentLogFile() {
        return this.currentLogFile;
    }
}
exports.UltraScannerLogger = UltraScannerLogger;
