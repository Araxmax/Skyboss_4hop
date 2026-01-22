"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalManager = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const decimal_js_1 = __importDefault(require("decimal.js"));
const constants_1 = require("./constants");
/* =========================
   SIGNAL MANAGER CLASS
========================= */
class SignalManager {
    constructor(signalPath = "./signal.json", minProfitPercent = 0.001, maxTradeAmount = 1000, signalMaxAge = 10) {
        this.signalPath = signalPath;
        this.minProfitPercent = new decimal_js_1.default(minProfitPercent);
        this.maxTradeAmount = new decimal_js_1.default(maxTradeAmount);
        this.signalMaxAge = signalMaxAge;
    }
    /**
     * Check if signal file exists
     */
    signalExists() {
        return fs_1.default.existsSync(this.signalPath);
    }
    /**
     * Read raw signal from file
     */
    readSignal() {
        try {
            if (!this.signalExists()) {
                return null;
            }
            const content = fs_1.default.readFileSync(this.signalPath, "utf8");
            const signal = JSON.parse(content);
            return signal;
        }
        catch (error) {
            console.error(`Error reading signal: ${error.message}`);
            return null;
        }
    }
    /**
     * Parse signal direction to extract pool addresses
     */
    parseDirection(direction) {
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
        const poolMapping = new Map();
        for (const pool of constants_1.PREDEFINED_POOLS) {
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
    validateAndParseSignal() {
        const signal = this.readSignal();
        if (!signal) {
            return {
                pool1Address: "",
                pool2Address: "",
                direction: "pool1-to-pool2",
                profitPercent: new decimal_js_1.default(0),
                tradeAmount: new decimal_js_1.default(0),
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
                profitPercent: new decimal_js_1.default(0),
                tradeAmount: new decimal_js_1.default(0),
                isValid: false,
                error: "Invalid direction format",
            };
        }
        // Validate profit percentage
        const profitPct = new decimal_js_1.default(signal.profit_pct);
        if (profitPct.lt(this.minProfitPercent)) {
            return {
                pool1Address: parsedDirection.pool1,
                pool2Address: parsedDirection.pool2,
                direction: parsedDirection.directionType,
                profitPercent: profitPct,
                tradeAmount: new decimal_js_1.default(signal.trade_usdc),
                isValid: false,
                error: `Profit ${profitPct.toString()}% below minimum ${this.minProfitPercent.toString()}%`,
            };
        }
        // Validate trade amount
        const tradeAmount = new decimal_js_1.default(signal.trade_usdc);
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
    deleteSignal() {
        try {
            if (this.signalExists()) {
                fs_1.default.unlinkSync(this.signalPath);
                console.log(`[SIGNAL] Deleted signal file: ${this.signalPath}`);
            }
        }
        catch (error) {
            console.error(`Error deleting signal: ${error.message}`);
        }
    }
    /**
     * Archive signal to history
     */
    archiveSignal(success, profit) {
        try {
            const signal = this.readSignal();
            if (!signal)
                return;
            const archivePath = "./signal_history.json";
            let history = [];
            if (fs_1.default.existsSync(archivePath)) {
                const content = fs_1.default.readFileSync(archivePath, "utf8");
                history = JSON.parse(content);
            }
            history.push({
                ...signal,
                executed_at: new Date().toISOString(),
                success,
                actual_profit: profit ? profit.toString() : null,
            });
            fs_1.default.writeFileSync(archivePath, JSON.stringify(history, null, 2));
            console.log(`[SIGNAL] Archived signal to history`);
        }
        catch (error) {
            console.error(`Error archiving signal: ${error.message}`);
        }
    }
    /**
     * Wait for new signal with timeout
     */
    async waitForSignal(timeoutSeconds = 60) {
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
    watchSignal(callback) {
        const dir = path_1.default.dirname(this.signalPath);
        const filename = path_1.default.basename(this.signalPath);
        console.log(`[SIGNAL] Watching for signal file: ${this.signalPath}`);
        // Debounce to avoid multiple rapid triggers
        let debounceTimer = null;
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
        const watcher = fs_1.default.watch(dir, (eventType, changedFile) => {
            if (changedFile === filename) {
                if (eventType === "rename" && this.signalExists()) {
                    // File created
                    processSignal();
                }
                else if (eventType === "change") {
                    // File modified
                    processSignal();
                }
            }
        });
        return watcher;
    }
}
exports.SignalManager = SignalManager;
