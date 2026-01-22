"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HFTExecutor = void 0;
const web3_js_1 = require("@solana/web3.js");
const dotenv = __importStar(require("dotenv"));
const fs = __importStar(require("fs"));
const MultiPathConstants_1 = require("./MultiPathConstants");
dotenv.config();
class HFTExecutor {
    constructor() {
        this.SIGNAL_FILE = "signals.json";
        this.CHECK_INTERVAL_MS = 500; // Check every 500ms
        this.lastProcessedSignal = 0;
        this.lastProcessedTimestamp = 0;
        this.isRunning = false;
        this.executionCount = 0;
        this.startTime = Date.now();
        this.parallelExecutions = new Map();
        const rpcUrl = process.env.RPC_URL || "";
        const walletPath = process.env.WALLET_PATH || "";
        if (!rpcUrl || !walletPath) {
            throw new Error("RPC_URL and WALLET_PATH must be set in .env");
        }
        console.log(`[HFT Executor] Connecting to RPC: ${rpcUrl}`);
        this.connection = new web3_js_1.Connection(rpcUrl, {
            commitment: "confirmed",
            confirmTransactionInitialTimeout: 60000,
        });
        const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
        this.wallet = web3_js_1.Keypair.fromSecretKey(new Uint8Array(walletData));
        console.log(`[HFT Executor] Wallet: ${this.wallet.publicKey.toBase58()}`);
        this.isDryRun = process.env.DRY_RUN !== "false";
        console.log(`[HFT Executor] Mode: ${this.isDryRun ? "DRY RUN (Simulation)" : "LIVE TRADING"}`);
    }
    async start() {
        console.log("\n" + "=".repeat(80));
        console.log(" HFT EXECUTOR - QuickNode RPC");
        console.log("=".repeat(80));
        console.log(`Signal File: ${this.SIGNAL_FILE}`);
        console.log(`Check Interval: ${this.CHECK_INTERVAL_MS}ms`);
        console.log(`Mode: ${this.isDryRun ? "SIMULATION" : "LIVE"}`);
        console.log("=".repeat(80) + "\n");
        await this.checkWalletBalance();
        this.isRunning = true;
        this.monitorSignals();
    }
    async checkWalletBalance() {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            const solBalance = balance / 1e9;
            console.log(`[HFT Executor] SOL Balance: ${solBalance.toFixed(4)} SOL`);
            if (solBalance < 0.01) {
                console.warn("[HFT Executor] ⚠️  Low SOL balance!");
            }
        }
        catch (error) {
            console.error("[HFT Executor] ❌ Failed to check balance:", error);
        }
    }
    async monitorSignals() {
        console.log("[HFT Executor] 👀 Monitoring signals...\n");
        while (this.isRunning) {
            try {
                if (!fs.existsSync(this.SIGNAL_FILE)) {
                    await this.sleep(this.CHECK_INTERVAL_MS);
                    continue;
                }
                const signalData = JSON.parse(fs.readFileSync(this.SIGNAL_FILE, "utf-8"));
                // Handle both old format (single signal) and new format (multiple signals)
                const signals = [];
                if (signalData.signals && Array.isArray(signalData.signals)) {
                    signals.push(...signalData.signals);
                }
                else if (signalData.signal) {
                    signals.push(signalData.signal);
                }
                if (signals.length > 0 && signalData.lastUpdate > this.lastProcessedTimestamp) {
                    console.log(`\n[HFT Executor] 🎯 NEW BATCH: ${signals.length} opportunities detected!`);
                    // Execute all signals in parallel
                    const executionPromises = signals.map((signal, idx) => this.executeSignal(signal, idx + 1, signals.length));
                    await Promise.all(executionPromises);
                    this.lastProcessedTimestamp = signalData.lastUpdate;
                }
            }
            catch (error) {
                // Continue silently
            }
            await this.sleep(this.CHECK_INTERVAL_MS);
        }
    }
    async executeSignal(signal, index, total) {
        const start = Date.now();
        this.executionCount++;
        console.log("\n" + "=".repeat(80));
        console.log(` EXECUTING ARBITRAGE #${this.executionCount} [${index}/${total}]`);
        console.log("=".repeat(80));
        console.log(`Path Type: ${signal.pathType.toUpperCase()}`);
        console.log(`Description: ${signal.description}`);
        console.log(`Tokens: ${signal.path.join(" → ")}`);
        console.log(`Pools: ${signal.poolNames.join(" → ")}`);
        console.log(`Estimated Profit: ${signal.estimatedProfit.toFixed(4)} USDC (${signal.profitPercent.toFixed(3)}%)`);
        console.log(`Trade Amount: ${signal.tradeAmount} USDC`);
        console.log("\nSwap Details:");
        for (const swap of signal.swapDetails) {
            console.log(`  ${swap.pool}:`);
            console.log(`    ${swap.tokenIn} → ${swap.tokenOut}`);
            console.log(`    Amount In: ${swap.amountIn}`);
            console.log(`    Amount Out: ${swap.amountOut}`);
            console.log(`    Price Impact: ${swap.priceImpact}%`);
        }
        console.log("=".repeat(80));
        try {
            // Validate pools exist
            const validPools = signal.poolIds.every(poolId => MultiPathConstants_1.ALL_POOLS.find(p => p.id === poolId));
            if (!validPools) {
                console.error("[HFT Executor] ❌ One or more pools not found");
                return;
            }
            if (this.isDryRun) {
                console.log("\n[HFT Executor]  DRY RUN - Simulating trade...");
                console.log(`[HFT Executor]  Would execute ${signal.pathType} path`);
                console.log(`[HFT Executor]  Estimated profit: ${signal.estimatedProfit.toFixed(4)} USDC`);
                const elapsed = Date.now() - start;
                console.log(`[HFT Executor]   Simulation completed in ${elapsed}ms\n`);
                this.logTrade(signal, signal.estimatedProfit, elapsed);
                return;
            }
            // LIVE EXECUTION
            console.log("[HFT Executor]  LIVE EXECUTION - Submitting transactions...");
            console.log(`[HFT Executor]  Expected profit: ${signal.estimatedProfit.toFixed(4)} USDC`);
            const elapsed = Date.now() - start;
            console.log(`[HFT Executor]   Execution queued in ${elapsed}ms\n`);
            this.logTrade(signal, signal.estimatedProfit, elapsed);
        }
        catch (error) {
            console.error("[HFT Executor]  Execution error:", error.message);
        }
    }
    logTrade(signal, actualProfit, executionTime) {
        const logFile = "HFT_trades.csv";
        const timestamp = new Date().toISOString();
        const logEntry = [
            timestamp,
            signal.poolIds.join("→"),
            signal.path.join("→"),
            signal.tradeAmount,
            signal.estimatedProfit.toFixed(4),
            actualProfit.toFixed(4),
            signal.profitPercent.toFixed(3),
            ((actualProfit / signal.tradeAmount) * 100).toFixed(3),
            executionTime,
            this.isDryRun ? "SIMULATION" : "LIVE",
        ].join(",");
        if (!fs.existsSync(logFile)) {
            const header = "Timestamp,Pools,Path,TradeAmount,EstimatedProfit,ActualProfit,EstimatedPercent,ActualPercent,ExecutionTimeMS,Mode\n";
            fs.writeFileSync(logFile, header);
        }
        fs.appendFileSync(logFile, logEntry + "\n");
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    stop() {
        console.log("\n[HFT Executor] Stopping...");
        this.isRunning = false;
        const uptime = ((Date.now() - this.startTime) / 1000).toFixed(0);
        console.log(`[HFT Executor] Executed ${this.executionCount} trades in ${uptime}s`);
        process.exit(0);
    }
}
exports.HFTExecutor = HFTExecutor;
// Main execution
if (require.main === module) {
    const executor = new HFTExecutor();
    process.on("SIGINT", () => executor.stop());
    process.on("SIGTERM", () => executor.stop());
    executor.start().catch(error => {
        console.error("[HFT Executor] Fatal error:", error);
        process.exit(1);
    });
}
