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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FastArbitrageExecutor = void 0;
const web3_js_1 = require("@solana/web3.js");
const fs_1 = __importDefault(require("fs"));
const decimal_js_1 = __importDefault(require("decimal.js"));
const dotenv = __importStar(require("dotenv"));
const SwapExecutor_1 = require("./SwapExecutor");
const SignalManager_1 = require("./SignalManager");
const SafetyChecker_1 = require("./SafetyChecker");
const CsvLogger_1 = require("./CsvLogger");
const constants_1 = require("./constants");
const RpcConnectionManager_1 = require("./RpcConnectionManager");
dotenv.config();
class FastArbitrageExecutor {
    constructor(config) {
        this.isRunning = false;
        this.lastExecutionTime = 0;
        this.executionCount = 0;
        // Performance tracking
        this.avgExecutionTimeMs = 0;
        this.config = config;
        // CRITICAL FIX: Initialize RPC Manager for intelligent rate limit handling
        console.log("[EXECUTOR] Initializing RPC Connection Manager...");
        this.rpcManager = (0, RpcConnectionManager_1.createRpcManagerFromEnv)();
        // Use 'confirmed' commitment for balance, but 'processed' for speed
        this.connection = new web3_js_1.Connection(config.rpcUrl, {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: 60000,
        });
        this.wallet = this.loadWallet(config.walletPath);
        this.swapExecutor = new SwapExecutor_1.SwapExecutor(this.connection, this.wallet, config.maxSlippage, config.maxPriorityFee, {
            heliusApiKey: process.env.HELIUS_API_KEY,
            usePrivateTx: process.env.USE_HELIUS_PRIVATE_TX === 'true', // Read from env
            maxRetries: 3,
            retryDelay: 1000,
            transactionDeadline: 60, // Increased to 60s for better reliability
            rpcManager: this.rpcManager, // Pass RPC manager to executor
        });
        this.signalManager = new SignalManager_1.SignalManager("./signal.json", config.minProfitPercent, config.maxTradeAmount, 2 // Shorter signal max age for speed
        );
        this.safetyChecker = new SafetyChecker_1.SafetyChecker(this.connection, this.wallet, {
            minSolBalance: config.minSolBalance,
            minUsdcBalance: config.minUsdcBalance,
            maxSlippage: config.maxSlippage,
            maxPriceImpact: config.maxPriceImpact,
        });
        this.csvLogger = new CsvLogger_1.CsvLogger("./logs");
        console.log("\n" + "=".repeat(70));
        console.log("ULTRA-FAST ARBITRAGE EXECUTOR");
        console.log("=".repeat(70));
        console.log(`Wallet: ${this.wallet.publicKey.toBase58()}`);
        console.log(`Mode: ${config.dryRun ? "DRY RUN" : "🔥 LIVE TRADING 🔥"}`);
        console.log(`Priority Fees: ${config.usePriorityFees ? "ENABLED (faster)" : "disabled"}`);
        console.log("=".repeat(70));
    }
    loadWallet(walletPath) {
        try {
            const secret = JSON.parse(fs_1.default.readFileSync(walletPath, "utf8"));
            return web3_js_1.Keypair.fromSecretKey(new Uint8Array(secret));
        }
        catch (error) {
            throw new Error(`Failed to load wallet: ${error.message}`);
        }
    }
    /**
     * Process signal with maximum speed
     */
    async processSignalFast(signal) {
        const startTime = Date.now();
        console.log(`\n[⚡${this.executionCount}] Processing signal...`);
        // Fetch pool prices in parallel with safety checks
        const poolPricesPromise = this.fetchPoolPricesForEntry(signal);
        const safetyCheckPromise = this.safetyChecker.performSafetyCheck(signal.tradeAmount, new decimal_js_1.default(this.config.maxSlippage));
        // Wait for both in parallel
        const [poolPrices, safetyCheck] = await Promise.all([
            poolPricesPromise,
            safetyCheckPromise
        ]);
        const spread = poolPrices.price_001.minus(poolPrices.price_005).abs();
        const spreadPct = spread.div(decimal_js_1.default.min(poolPrices.price_001, poolPrices.price_005)).mul(100);
        // Initialize log entry
        const logEntry = {
            timestamp: Date.now().toString(),
            datetime: new Date().toISOString(),
            signal_direction: signal.direction,
            price_001_pool: poolPrices.price_001.toNumber(),
            price_005_pool: poolPrices.price_005.toNumber(),
            spread: spread.toNumber(),
            spread_pct: spreadPct.toNumber(),
            expected_profit_pct: signal.profitPercent.toNumber(), // Already a percentage
            trade_amount_usdc: signal.tradeAmount.toNumber(),
            safety_passed: safetyCheck.passed,
            safety_errors: safetyCheck.errors.join("; "),
            safety_warnings: safetyCheck.warnings.join("; "),
            sol_balance: safetyCheck.balances?.sol.toNumber() || 0,
            usdc_balance: safetyCheck.balances?.usdc.toNumber() || 0,
            executed: false,
            dry_run: this.config.dryRun,
            swap1_pool: signal.pool1Address,
            swap1_success: false,
            swap1_amount_in: 0,
            swap1_amount_out: 0,
            swap1_signature: "",
            swap1_error: "",
            swap2_pool: signal.pool2Address,
            swap2_success: false,
            swap2_amount_in: 0,
            swap2_amount_out: 0,
            swap2_signature: "",
            swap2_error: "",
            actual_profit_usdc: 0,
            actual_profit_pct: 0,
            failure_reason: "",
            failure_stage: "",
        };
        // Validate signal
        if (!signal.isValid) {
            logEntry.failure_reason = signal.error || "Invalid signal";
            logEntry.failure_stage = "validation";
            this.csvLogger.logTrade(logEntry);
            console.log(`[⚡] ✗ Signal invalid`);
            return false;
        }
        // Safety check
        if (!safetyCheck.passed) {
            logEntry.failure_reason = safetyCheck.errors.join("; ");
            logEntry.failure_stage = "safety";
            this.csvLogger.logTrade(logEntry);
            console.log(`[⚡] ✗ Safety failed: ${safetyCheck.errors[0]}`);
            return false;
        }
        // DRY RUN - simulate fast
        if (this.config.dryRun) {
            logEntry.executed = true;
            logEntry.swap1_success = true;
            logEntry.swap1_signature = "DRY_RUN_SIM";
            logEntry.swap2_success = true;
            logEntry.swap2_signature = "DRY_RUN_SIM";
            logEntry.actual_profit_pct = signal.profitPercent.mul(100).toNumber();
            this.csvLogger.logTrade(logEntry);
            const execTime = Date.now() - startTime;
            console.log(`[⚡] ✓ DRY RUN completed in ${execTime}ms`);
            this.updateStats(execTime);
            return true;
        }
        // LIVE EXECUTION
        const swapMode = (process.env.SWAP_MODE || 'ATOMIC').toUpperCase();
        console.log(`[⚡] 🔥 Executing LIVE trade... (Mode: ${swapMode})`);
        try {
            let result;
            if (swapMode === 'SINGLE') {
                // SINGLE MODE: Execute two separate swaps sequentially
                result = await this.executeSequentialSwaps(signal.pool1Address, signal.pool2Address, constants_1.SOL_MINT, constants_1.USDC_MINT, signal.tradeAmount, signal.direction, this.config.maxSlippage);
            }
            else {
                // ATOMIC MODE: Execute both swaps in one transaction (default)
                result = await this.swapExecutor.executeArbitrage(signal.pool1Address, signal.pool2Address, constants_1.SOL_MINT, constants_1.USDC_MINT, signal.tradeAmount, signal.direction, this.config.maxSlippage);
            }
            if (result.success && result.swap1 && result.swap2) {
                logEntry.executed = true;
                logEntry.swap1_success = result.swap1.success;
                logEntry.swap1_signature = result.swap1.signature || "";
                logEntry.swap2_success = result.swap2.success;
                logEntry.swap2_signature = result.swap2.signature || "";
                const profit = new decimal_js_1.default(result.swap2.amountOut || "0").minus(signal.tradeAmount);
                logEntry.actual_profit_usdc = profit.toNumber();
                logEntry.actual_profit_pct = profit.div(signal.tradeAmount).mul(100).toNumber();
                this.csvLogger.logTrade(logEntry);
                const execTime = Date.now() - startTime;
                console.log(`[⚡] ✓✓✓ Trade SUCCESS in ${execTime}ms!`);
                console.log(`[⚡]     Profit: $${profit.toFixed(6)}`);
                this.updateStats(execTime);
                return true;
            }
            else {
                logEntry.failure_reason = result.error || "Execution failed";
                logEntry.failure_stage = "execution";
                this.csvLogger.logTrade(logEntry);
                console.log(`[⚡] ✗ Trade failed: ${result.error}`);
                return false;
            }
        }
        catch (error) {
            logEntry.failure_reason = error.message;
            logEntry.failure_stage = "exception";
            this.csvLogger.logTrade(logEntry);
            console.log(`[⚡] ✗ Exception: ${error.message}`);
            return false;
        }
    }
    /**
     * Execute sequential swaps (SINGLE mode) - two separate transactions
     */
    async executeSequentialSwaps(pool1Address, pool2Address, tokenAMint, tokenBMint, initialAmount, direction, slippage, skipValidation = false) {
        console.log("\n" + "=".repeat(70));
        console.log("EXECUTING SEQUENTIAL SWAPS (SINGLE MODE)");
        console.log("=".repeat(70));
        try {
            // Determine swap direction and pools based on signal direction
            let firstPool;
            let secondPool;
            let firstInputMint;
            let firstOutputMint;
            let secondInputMint;
            let secondOutputMint;
            // Match the logic from ATOMIC mode - always start with USDC, buy SOL, sell SOL for USDC
            if (direction === "pool1-to-pool2") {
                firstPool = pool1Address;
                secondPool = pool2Address;
                firstInputMint = tokenBMint; // USDC
                firstOutputMint = tokenAMint; // SOL
                secondInputMint = tokenAMint; // SOL
                secondOutputMint = tokenBMint; // USDC
            }
            else {
                firstPool = pool2Address;
                secondPool = pool1Address;
                firstInputMint = tokenBMint; // USDC
                firstOutputMint = tokenAMint; // SOL
                secondInputMint = tokenAMint; // SOL
                secondOutputMint = tokenBMint; // USDC
            }
            console.log(`\n[SINGLE] Swap 1: ${firstInputMint === tokenBMint ? "USDC" : "SOL"} -> ${firstOutputMint === tokenBMint ? "USDC" : "SOL"} on ${firstPool.slice(0, 8)}...`);
            console.log(`[SINGLE]   Amount: ${initialAmount.toString()} ${firstInputMint === tokenBMint ? "USDC" : "SOL"}`);
            // Execute first swap: USDC -> SOL
            const swap1Result = await this.swapExecutor.executeSingleSwap(firstPool, firstInputMint, firstOutputMint, initialAmount, slippage, skipValidation);
            if (!swap1Result.success) {
                console.log(`[SINGLE] ✗ Swap 1 failed: ${swap1Result.error}`);
                return {
                    success: false,
                    error: `Swap 1 failed: ${swap1Result.error}`,
                    swap1: swap1Result,
                    swap2: null,
                };
            }
            console.log(`[SINGLE] ✓ Swap 1 completed: ${swap1Result.signature}`);
            console.log(`[SINGLE]   Output: ${swap1Result.amountOut}`);
            // Execute second swap with output from first swap: SOL -> USDC
            const secondSwapAmount = new decimal_js_1.default(swap1Result.amountOut || "0");
            console.log(`\n[SINGLE] Swap 2: ${secondInputMint === tokenBMint ? "USDC" : "SOL"} -> ${secondOutputMint === tokenBMint ? "USDC" : "SOL"} on ${secondPool.slice(0, 8)}...`);
            console.log(`[SINGLE]   Amount: ${secondSwapAmount.toString()} ${secondInputMint === tokenBMint ? "USDC" : "SOL"}`);
            const swap2Result = await this.swapExecutor.executeSingleSwap(secondPool, secondInputMint, secondOutputMint, secondSwapAmount, slippage, skipValidation);
            if (!swap2Result.success) {
                console.log(`[SINGLE] ✗ Swap 2 failed: ${swap2Result.error}`);
                console.log(`[SINGLE] ⚠️  Partial execution - Swap 1 succeeded but Swap 2 failed`);
                console.log(`[SINGLE] 🔄 Attempting recovery: reversing Swap 1...`);
                // CRITICAL: Attempt to recover by reversing Swap 1
                try {
                    const recoveryResult = await this.swapExecutor.executeSingleSwap(firstPool, // Reverse direction: sell back on same pool
                    firstOutputMint, // What we got from Swap 1 (SOL)
                    firstInputMint, // What we started with (USDC)
                    new decimal_js_1.default(swap1Result.amountOut || "0"), this.config.maxSlippage, true // skipValidation = true for emergency recovery
                    );
                    if (recoveryResult.success) {
                        console.log(`[SINGLE] ✓ Recovery successful: ${recoveryResult.signature}`);
                        console.log(`[SINGLE]   Recovered: ${recoveryResult.amountOut} ${firstInputMint === tokenBMint ? "USDC" : "SOL"}`);
                        return {
                            success: false,
                            error: `Swap 2 failed but RECOVERED via reverse Swap 1. Net loss: ${recoveryResult.amountOut ? new decimal_js_1.default(swap1Result.amountIn || "0").minus(recoveryResult.amountOut).toString() : "unknown"}`,
                            swap1: swap1Result,
                            swap2: swap2Result,
                        };
                    }
                    else {
                        console.log(`[SINGLE] ✗ Recovery FAILED: ${recoveryResult.error}`);
                        console.log(`[SINGLE] ⚠️  CRITICAL: Funds stuck in ${firstOutputMint === tokenBMint ? "USDC" : "SOL"}`);
                    }
                }
                catch (recoveryError) {
                    console.error(`[SINGLE] Recovery error: ${recoveryError.message}`);
                }
                return {
                    success: false,
                    error: `Swap 2 failed: ${swap2Result.error} (Partial execution - check wallet for stuck funds)`,
                    swap1: swap1Result,
                    swap2: swap2Result,
                };
            }
            console.log(`[SINGLE] ✓ Swap 2 completed: ${swap2Result.signature}`);
            console.log(`[SINGLE]   Output: ${swap2Result.amountOut}`);
            console.log("\n" + "=".repeat(70));
            console.log("SEQUENTIAL SWAPS COMPLETE");
            console.log("=".repeat(70));
            return {
                success: true,
                swap1: swap1Result,
                swap2: swap2Result,
            };
        }
        catch (error) {
            console.error(`[SINGLE] Sequential swap error: ${error.message}`);
            return {
                success: false,
                error: error.message,
                swap1: null,
                swap2: null,
            };
        }
    }
    /**
     * Decode Whirlpool sqrt price from account data
     */
    decodeSqrtPrice(data) {
        if (data.length < 81) {
            throw new Error('Invalid whirlpool data length');
        }
        // sqrt_price is at offset 65-81 (16 bytes, u128)
        return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
    }
    /**
     * Convert sqrt price X64 to regular price
     */
    sqrtPriceToPrice(sqrtPriceX64) {
        const sqrtPrice = new decimal_js_1.default(sqrtPriceX64.toString()).div(constants_1.DECIMAL_2_POW_64);
        const price = sqrtPrice.pow(2);
        return price.mul(constants_1.DECIMAL_10_POW_9).div(constants_1.DECIMAL_10_POW_6);
    }
    /**
     * Fetch pool prices for log entry (FIXED - was returning 0,0)
     */
    async fetchPoolPricesForEntry(signal) {
        try {
            const pool001Address = new web3_js_1.PublicKey(constants_1.PREDEFINED_POOLS[1].address); // 0.01% pool
            const pool005Address = new web3_js_1.PublicKey(constants_1.PREDEFINED_POOLS[0].address); // 0.05% pool
            const accountInfos = await this.connection.getMultipleAccountsInfo([pool001Address, pool005Address], { commitment: 'confirmed' });
            if (!accountInfos[0] || !accountInfos[1]) {
                console.warn('[FAST] Failed to fetch pool account data, using zero prices');
                return {
                    price_001: new decimal_js_1.default(0),
                    price_005: new decimal_js_1.default(0),
                };
            }
            const sqrtPrice001 = this.decodeSqrtPrice(accountInfos[0].data);
            const sqrtPrice005 = this.decodeSqrtPrice(accountInfos[1].data);
            const price001 = this.sqrtPriceToPrice(sqrtPrice001);
            const price005 = this.sqrtPriceToPrice(sqrtPrice005);
            return {
                price_001: price001,
                price_005: price005,
            };
        }
        catch (error) {
            console.error(`[FAST] Error fetching prices: ${error.message}`);
            return {
                price_001: new decimal_js_1.default(0),
                price_005: new decimal_js_1.default(0),
            };
        }
    }
    /**
     * Update performance statistics
     */
    updateStats(execTimeMs) {
        this.executionCount++;
        this.avgExecutionTimeMs = (this.avgExecutionTimeMs * (this.executionCount - 1) + execTimeMs) / this.executionCount;
    }
    /**
     * Execute a test swap on startup (BOT_SWAP_CHECK feature)
     * Validates wallet, pools, and connection before live trading
     */
    async executeTestSwap() {
        console.log("\n" + "=".repeat(70));
        console.log("🧪 EXECUTING STARTUP TEST SWAP");
        console.log("=".repeat(70));
        console.log("Purpose: Validate wallet, pools, and Orca SDK integration");
        console.log("Amount: Small test amount (regardless of profit/loss)");
        console.log("=".repeat(70) + "\n");
        try {
            // Use trade amount from env (default 10 USDC)
            const testAmount = new decimal_js_1.default(process.env.TRADE_USD || "10");
            const swapMode = (process.env.SWAP_MODE || 'ATOMIC').toUpperCase();
            console.log(`[TEST] Test amount: $${testAmount} USDC`);
            console.log(`[TEST] Swap mode: ${swapMode}`);
            console.log(`[TEST] Dry run: ${this.config.dryRun ? 'YES (simulated)' : 'NO (LIVE)'}\n`);
            // Use the first available direction (pool 0.05% -> pool 0.01%)
            const pool1 = constants_1.PREDEFINED_POOLS[0]; // 0.05% pool
            const pool2 = constants_1.PREDEFINED_POOLS[1]; // 0.01% pool
            const direction = "pool1-to-pool2";
            console.log(`[TEST] Direction: ${pool1.name} -> ${pool2.name}`);
            console.log(`[TEST] Pool 1: ${pool1.address}`);
            console.log(`[TEST] Pool 2: ${pool2.address}\n`);
            const startTime = Date.now();
            if (this.config.dryRun) {
                // DRY RUN - Simulate the test swap
                console.log("[TEST] 🔄 Simulating test swap (DRY RUN)...");
                await new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay
                const execTime = Date.now() - startTime;
                console.log("\n" + "=".repeat(70));
                console.log("✅ TEST SWAP SIMULATION COMPLETE");
                console.log("=".repeat(70));
                console.log(`Status: SUCCESS (simulated)`);
                console.log(`Execution time: ${execTime}ms`);
                console.log(`Mode: DRY RUN`);
                console.log("=".repeat(70) + "\n");
                return;
            }
            // LIVE EXECUTION
            console.log(`[TEST] 🔥 Executing LIVE test swap... (Mode: ${swapMode})`);
            // Use higher slippage for test swaps to ensure completion (even at a loss)
            // Test swap purpose: validate system works, not profit
            const testSlippage = 0.05; // 5% for test swap (allows completion even with losses)
            console.log(`[TEST] Using ${testSlippage * 100}% slippage (higher than normal for test completion)\n`);
            let result;
            if (swapMode === 'SINGLE') {
                // SINGLE MODE: Two separate transactions
                result = await this.executeSequentialSwaps(pool1.address, pool2.address, constants_1.SOL_MINT, constants_1.USDC_MINT, testAmount, direction, testSlippage, true // skipValidation = true for test swaps
                );
            }
            else {
                // ATOMIC MODE: One transaction with both swaps
                result = await this.swapExecutor.executeArbitrage(pool1.address, pool2.address, constants_1.SOL_MINT, constants_1.USDC_MINT, testAmount, direction, testSlippage, true // skipValidation = true for test swaps
                );
            }
            const execTime = Date.now() - startTime;
            console.log("\n" + "=".repeat(70));
            if (result.success && result.swap1 && result.swap2) {
                console.log("✅ TEST SWAP COMPLETE - SUCCESS");
                console.log("=".repeat(70));
                console.log(`Swap 1: ${result.swap1.success ? '✅ SUCCESS' : '❌ FAILED'}`);
                console.log(`  Signature: ${result.swap1.signature}`);
                console.log(`  Amount In: ${result.swap1.amountIn} USDC`);
                console.log(`  Amount Out: ${result.swap1.amountOut} SOL`);
                console.log(`Swap 2: ${result.swap2.success ? '✅ SUCCESS' : '❌ FAILED'}`);
                console.log(`  Signature: ${result.swap2.signature}`);
                console.log(`  Amount In: ${result.swap2.amountIn} SOL`);
                console.log(`  Amount Out: ${result.swap2.amountOut} USDC`);
                const finalOut = new decimal_js_1.default(result.swap2.amountOut || "0");
                const profit = finalOut.minus(testAmount);
                const profitPct = profit.div(testAmount).mul(100);
                console.log(`\nResult:`);
                console.log(`  Started with: ${testAmount} USDC`);
                console.log(`  Ended with: ${finalOut.toFixed(6)} USDC`);
                console.log(`  Profit/Loss: ${profit.toFixed(6)} USDC (${profitPct.toFixed(4)}%)`);
                console.log(`  Execution time: ${execTime}ms`);
                console.log(`  Mode: ${swapMode}`);
            }
            else {
                console.log("❌ TEST SWAP FAILED");
                console.log("=".repeat(70));
                console.log(`Error: ${result.error || 'Unknown error'}`);
                console.log(`Execution time: ${execTime}ms`);
                console.log(`Mode: ${swapMode}`);
            }
            console.log("=".repeat(70) + "\n");
            // Brief pause before continuing
            console.log("⏳ Waiting 3 seconds before starting normal operation...\n");
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        catch (error) {
            console.error("\n" + "=".repeat(70));
            console.error("❌ TEST SWAP ERROR");
            console.error("=".repeat(70));
            console.error(`Error: ${error.message}`);
            console.error("=".repeat(70) + "\n");
            console.log("⚠️  Test swap failed, but continuing to normal operation...");
            console.log("⏳ Waiting 3 seconds...\n");
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    /**
     * Watch for signals (fast polling)
     */
    async start() {
        // Execute test swap on startup if enabled
        const botSwapCheck = process.env.BOT_SWAP_CHECK === 'true';
        if (botSwapCheck) {
            await this.executeTestSwap();
        }
        else {
            console.log("[⚡] BOT_SWAP_CHECK disabled - skipping startup test swap\n");
        }
        console.log("\n[⚡] EXECUTOR READY - Watching for signals...");
        console.log("[⚡] Press Ctrl+C to stop\n");
        this.isRunning = true;
        // Fast polling loop (50ms)
        while (this.isRunning) {
            try {
                if (this.signalManager.signalExists()) {
                    const signal = this.signalManager.validateAndParseSignal();
                    if (signal && signal.isValid) {
                        // CRITICAL FIX: Delete signal IMMEDIATELY to prevent race condition
                        // If we delete after processing, the same signal could be picked up twice
                        this.signalManager.archiveSignal(true);
                        // Rate limit: min 100ms between executions
                        const now = Date.now();
                        if (now - this.lastExecutionTime >= 100) {
                            await this.processSignalFast(signal);
                            this.lastExecutionTime = now;
                        }
                    }
                }
                // Fast poll every 50ms
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            catch (error) {
                console.error(`[⚡] Error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }
    /**
     * Stop executor
     */
    stop() {
        this.isRunning = false;
        console.log(`\n[⚡] Executor stopped`);
        console.log(`[⚡] Total executions: ${this.executionCount}`);
        console.log(`[⚡] Avg execution time: ${this.avgExecutionTimeMs.toFixed(0)}ms`);
    }
}
exports.FastArbitrageExecutor = FastArbitrageExecutor;
/* =========================
   MAIN
========================= */
async function main() {
    const config = {
        rpcUrl: process.env.RPC_URL || "",
        walletPath: process.env.WALLET_PATH || "",
        dryRun: process.env.DRY_RUN?.toLowerCase() === "true", // FIXED: Case-insensitive check
        maxSlippage: parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.03"),
        maxPriceImpact: parseFloat(process.env.MAX_PRICE_IMPACT_PCT || "0.02"),
        minProfitPercent: parseFloat(process.env.MIN_SPREAD_PCT || "0.006") / 100,
        maxTradeAmount: parseFloat(process.env.TRADE_USD || "480"),
        minSolBalance: parseFloat(process.env.MIN_SOL_BALANCE_CRITICAL || "0.01"),
        minUsdcBalance: 10,
        maxPriorityFee: parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || "50000"),
        usePriorityFees: true,
    };
    const executor = new FastArbitrageExecutor(config);
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n[⚡] Shutting down...');
        executor.stop();
        process.exit(0);
    });
    await executor.start();
}
if (require.main === module) {
    main();
}
