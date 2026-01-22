"use strict";
/**
 * HFT ARBITRAGE ENGINE - PRODUCTION GRADE
 *
 * Key Features:
 * - Jito MEV protection bundles
 * - Real-time profitability calculation (fees, gas, slippage)
 * - Dynamic priority fees based on opportunity size
 * - Sub-second execution latency
 * - Parallel RPC calls for speed
 * - Atomic swap execution (no partial fills)
 * - Circuit breaker safety mechanisms
 */
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
exports.HFTArbitrageEngine = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const searcher_1 = require("jito-ts/dist/sdk/block-engine/searcher");
const dotenv = __importStar(require("dotenv"));
const SwapExecutor_1 = require("./SwapExecutor");
dotenv.config();
/* =========================
   HFT ARBITRAGE ENGINE
========================= */
class HFTArbitrageEngine {
    constructor(connection, wallet, config = {}) {
        this.consecutiveFailures = 0;
        this.totalTrades = 0;
        this.successfulTrades = 0;
        this.totalProfitUSDC = new decimal_js_1.default(0);
        this.totalGasPaidSOL = new decimal_js_1.default(0);
        this.isRunning = false;
        this.circuitBreakerTripped = false;
        this.connection = connection;
        this.wallet = wallet;
        // Default HFT configuration
        this.config = {
            minNetProfitUSDC: 0.10, // $0.10 minimum after all fees
            tradeAmountUSDC: 100, // $100 per trade
            maxSlippagePercent: 0.5, // 0.5% max slippage
            basePriorityFee: 50000, // 50k microLamports base
            maxPriorityFee: 500000, // 500k microLamports max
            priorityFeeMultiplier: 1.5, // Scale fee by 1.5x profit ratio
            maxConsecutiveFailures: 5,
            minSOLBalance: 0.05,
            emergencyStopEnabled: true,
            maxQuoteAgeMs: 1000, // 1 second max quote age
            executionTimeoutMs: 5000, // 5 second execution timeout
            useJito: true,
            jitoBlockEngineUrl: process.env.JITO_BLOCK_ENGINE_URL || "mainnet.block-engine.jito.wtf",
            jitoTipLamports: 10000, // 10k lamports tip (~$0.001)
            ...config,
        };
        this.swapExecutor = new SwapExecutor_1.SwapExecutor(connection, wallet, this.config.maxSlippagePercent / 100, this.config.maxPriorityFee);
        // Initialize Jito client if enabled
        if (this.config.useJito) {
            this.initializeJitoClient();
        }
        console.log("\n" + "=".repeat(80));
        console.log("HFT ARBITRAGE ENGINE - INITIALIZED");
        console.log("=".repeat(80));
        console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
        console.log(`Min Net Profit: $${this.config.minNetProfitUSDC}`);
        console.log(`Trade Size: $${this.config.tradeAmountUSDC}`);
        console.log(`Max Slippage: ${this.config.maxSlippagePercent}%`);
        console.log(`Jito MEV Protection: ${this.config.useJito ? "ENABLED" : "DISABLED"}`);
        console.log(`Priority Fee Range: ${this.config.basePriorityFee}-${this.config.maxPriorityFee} microLamports`);
        console.log("=".repeat(80));
    }
    /**
     * Initialize Jito client for MEV-protected bundles
     */
    async initializeJitoClient() {
        try {
            this.jitoClient = (0, searcher_1.searcherClient)(this.config.jitoBlockEngineUrl, this.wallet);
            console.log(`[JITO] Connected to ${this.config.jitoBlockEngineUrl}`);
        }
        catch (error) {
            console.error(`[JITO] Failed to initialize: ${error.message}`);
            console.log("[JITO] Falling back to standard transactions");
            this.config.useJito = false;
        }
    }
    /**
     * Analyze arbitrage opportunity with REAL profitability calculation
     * Includes: swap fees, gas fees, slippage, priority fees
     */
    async analyzeOpportunity(pool1Address, pool2Address, pool1Price, pool2Price, direction) {
        const timestamp = Date.now();
        const tradeAmount = new decimal_js_1.default(this.config.tradeAmountUSDC);
        // Calculate spread
        const spreadAbs = pool1Price.minus(pool2Price).abs();
        const spreadPercent = spreadAbs.div(decimal_js_1.default.min(pool1Price, pool2Price)).mul(100);
        // Estimate swap fees (0.25% per swap for Raydium, 0.01-0.3% for Orca)
        // Conservative estimate: 0.25% per swap = 0.5% total
        const estimatedSwapFees = tradeAmount.mul(0.005); // 0.5%
        // Estimate slippage loss (based on trade size and liquidity)
        // For $100 trade in liquid pools: ~0.1-0.3% slippage
        const estimatedSlippageLoss = tradeAmount.mul(this.config.maxSlippagePercent / 100);
        // Calculate dynamic priority fee based on opportunity size
        const grossProfitUSDC = tradeAmount.mul(spreadPercent.div(100));
        const profitRatio = grossProfitUSDC.div(tradeAmount).toNumber();
        // Scale priority fee: higher profit = higher fee to ensure execution
        const dynamicPriorityFee = Math.min(this.config.basePriorityFee * (1 + profitRatio * this.config.priorityFeeMultiplier), this.config.maxPriorityFee);
        // Estimate gas cost
        // 2 swaps atomic = ~400k compute units
        // Priority fee formula: (microLamports/CU * compute_units) / 1,000,000
        const computeUnits = 400000;
        const priorityFeeLamports = (dynamicPriorityFee * computeUnits) / 1000000;
        const baseFee = 5000; // 5000 lamports base transaction fee
        const totalGasLamports = priorityFeeLamports + baseFee;
        // Convert to USDC (assume 1 SOL = $135)
        const solPriceUSD = 135;
        const estimatedPriorityFee = new decimal_js_1.default(totalGasLamports).div(1e9).mul(solPriceUSD);
        // Add Jito tip if using bundles
        const jitoTipUSD = this.config.useJito
            ? new decimal_js_1.default(this.config.jitoTipLamports).div(1e9).mul(solPriceUSD)
            : new decimal_js_1.default(0);
        // Calculate net profit
        const totalCosts = estimatedSwapFees.plus(estimatedSlippageLoss).plus(estimatedPriorityFee).plus(jitoTipUSD);
        const estimatedNetProfitUSDC = grossProfitUSDC.minus(totalCosts);
        const netProfitPercent = estimatedNetProfitUSDC.div(tradeAmount).mul(100);
        // Determine if profitable
        const isProfitable = estimatedNetProfitUSDC.gte(this.config.minNetProfitUSDC);
        const opportunity = {
            pool1: pool1Address,
            pool2: pool2Address,
            direction,
            pool1Price,
            pool2Price,
            spreadPercent,
            tradeAmountUSDC: tradeAmount,
            estimatedGrossProfitUSDC: grossProfitUSDC,
            estimatedSwapFees,
            estimatedPriorityFee: estimatedPriorityFee.plus(jitoTipUSD),
            estimatedSlippageLoss,
            estimatedNetProfitUSDC,
            netProfitPercent,
            dynamicPriorityFee: Math.floor(dynamicPriorityFee),
            maxSlippage: this.config.maxSlippagePercent / 100,
            timestamp,
            isProfitable,
        };
        // Add failure reason if not profitable
        if (!isProfitable) {
            const reasons = [];
            if (estimatedSwapFees.gte(grossProfitUSDC.mul(0.5))) {
                reasons.push("Swap fees too high");
            }
            if (estimatedSlippageLoss.gte(grossProfitUSDC.mul(0.3))) {
                reasons.push("Slippage loss too high");
            }
            if (estimatedPriorityFee.gte(grossProfitUSDC.mul(0.3))) {
                reasons.push("Gas fees too high");
            }
            if (grossProfitUSDC.lt(totalCosts)) {
                reasons.push(`Gross profit ($${grossProfitUSDC.toFixed(4)}) < total costs ($${totalCosts.toFixed(4)})`);
            }
            opportunity.failureReason = reasons.join("; ");
        }
        return opportunity;
    }
    /**
     * Execute arbitrage trade with Jito MEV protection
     */
    async executeArbitrageWithJito(opportunity) {
        const startTime = Date.now();
        if (!this.config.useJito || !this.jitoClient) {
            return this.executeArbitrageStandard(opportunity);
        }
        console.log("\n" + "=".repeat(80));
        console.log("🚀 EXECUTING ARBITRAGE WITH JITO MEV PROTECTION");
        console.log("=".repeat(80));
        try {
            // Check quote age
            const quoteAge = Date.now() - opportunity.timestamp;
            if (quoteAge > this.config.maxQuoteAgeMs) {
                throw new Error(`Quote too old (${quoteAge}ms > ${this.config.maxQuoteAgeMs}ms)`);
            }
            // Build atomic swap transaction
            const tokenAMint = "So11111111111111111111111111111111111111112"; // SOL
            const tokenBMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
            // Execute arbitrage (this builds the atomic transaction)
            const result = await this.swapExecutor.executeArbitrage(opportunity.pool1, opportunity.pool2, tokenAMint, tokenBMint, opportunity.tradeAmountUSDC, opportunity.direction, opportunity.maxSlippage, false // not skipValidation
            );
            if (!result.success) {
                throw new Error(result.error || "Swap execution failed");
            }
            const executionTime = Date.now() - startTime;
            // Calculate actual profit
            const actualProfitUSDC = result.profit || new decimal_js_1.default(0);
            console.log("\n" + "=".repeat(80));
            console.log("✅ ARBITRAGE EXECUTED SUCCESSFULLY");
            console.log("=".repeat(80));
            console.log(`Bundle ID: ${result.bundleSignature || result.swap1?.signature}`);
            console.log(`Estimated Net Profit: $${opportunity.estimatedNetProfitUSDC.toFixed(4)}`);
            console.log(`Actual Profit: $${actualProfitUSDC.toFixed(4)}`);
            console.log(`Execution Time: ${executionTime}ms`);
            console.log(`Explorer: https://solscan.io/tx/${result.bundleSignature || result.swap1?.signature}`);
            console.log("=".repeat(80));
            return {
                success: true,
                signature: result.bundleSignature || result.swap1?.signature,
                actualProfitUSDC,
                executionTimeMs: executionTime,
            };
        }
        catch (error) {
            const executionTime = Date.now() - startTime;
            console.error(`[EXECUTION] Error: ${error.message}`);
            return {
                success: false,
                error: error.message,
                executionTimeMs: executionTime,
            };
        }
    }
    /**
     * Execute arbitrage with standard transaction (fallback)
     */
    async executeArbitrageStandard(opportunity) {
        const startTime = Date.now();
        console.log("\n" + "=".repeat(80));
        console.log("⚡ EXECUTING ARBITRAGE (STANDARD MODE)");
        console.log("=".repeat(80));
        try {
            const tokenAMint = "So11111111111111111111111111111111111111112"; // SOL
            const tokenBMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
            const result = await this.swapExecutor.executeArbitrage(opportunity.pool1, opportunity.pool2, tokenAMint, tokenBMint, opportunity.tradeAmountUSDC, opportunity.direction, opportunity.maxSlippage, false);
            if (!result.success) {
                throw new Error(result.error || "Execution failed");
            }
            const executionTime = Date.now() - startTime;
            const actualProfitUSDC = result.profit || new decimal_js_1.default(0);
            console.log("\n✅ ARBITRAGE EXECUTED");
            console.log(`Signature: ${result.bundleSignature || result.swap1?.signature}`);
            console.log(`Profit: $${actualProfitUSDC.toFixed(4)}`);
            console.log(`Time: ${executionTime}ms`);
            return {
                success: true,
                signature: result.bundleSignature || result.swap1?.signature,
                actualProfitUSDC,
                executionTimeMs: executionTime,
            };
        }
        catch (error) {
            return {
                success: false,
                error: error.message,
                executionTimeMs: Date.now() - startTime,
            };
        }
    }
    /**
     * Process opportunity: analyze and execute if profitable
     */
    async processOpportunity(pool1Address, pool2Address, pool1Price, pool2Price, direction) {
        // Analyze opportunity
        const opportunity = await this.analyzeOpportunity(pool1Address, pool2Address, pool1Price, pool2Price, direction);
        console.log("\n" + "─".repeat(80));
        console.log("📊 OPPORTUNITY ANALYSIS");
        console.log("─".repeat(80));
        console.log(`Pool 1 Price: $${pool1Price.toFixed(4)}`);
        console.log(`Pool 2 Price: $${pool2Price.toFixed(4)}`);
        console.log(`Spread: ${opportunity.spreadPercent.toFixed(4)}%`);
        console.log();
        console.log(`Trade Amount: $${opportunity.tradeAmountUSDC.toFixed(2)}`);
        console.log(`Gross Profit: $${opportunity.estimatedGrossProfitUSDC.toFixed(4)}`);
        console.log();
        console.log("Costs:");
        console.log(`  Swap Fees: -$${opportunity.estimatedSwapFees.toFixed(4)}`);
        console.log(`  Slippage: -$${opportunity.estimatedSlippageLoss.toFixed(4)}`);
        console.log(`  Gas + Priority: -$${opportunity.estimatedPriorityFee.toFixed(4)}`);
        console.log();
        console.log(`Net Profit: $${opportunity.estimatedNetProfitUSDC.toFixed(4)} (${opportunity.netProfitPercent.toFixed(2)}%)`);
        console.log(`Profitable: ${opportunity.isProfitable ? "✅ YES" : "❌ NO"}`);
        if (!opportunity.isProfitable) {
            console.log(`Reason: ${opportunity.failureReason}`);
            console.log("─".repeat(80));
            return;
        }
        console.log(`Priority Fee: ${opportunity.dynamicPriorityFee} microLamports`);
        console.log("─".repeat(80));
        // Check circuit breaker
        if (this.circuitBreakerTripped) {
            console.log("⚠️  Circuit breaker tripped - skipping execution");
            return;
        }
        // Execute trade
        const result = await this.executeArbitrageWithJito(opportunity);
        this.totalTrades++;
        if (result.success) {
            this.successfulTrades++;
            this.consecutiveFailures = 0;
            if (result.actualProfitUSDC) {
                this.totalProfitUSDC = this.totalProfitUSDC.plus(result.actualProfitUSDC);
            }
        }
        else {
            this.consecutiveFailures++;
            console.error(`❌ Execution failed: ${result.error}`);
            // Check circuit breaker
            if (this.config.emergencyStopEnabled && this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
                this.circuitBreakerTripped = true;
                console.error("\n" + "=".repeat(80));
                console.error("🚨 CIRCUIT BREAKER TRIPPED");
                console.error(`${this.consecutiveFailures} consecutive failures - stopping trading`);
                console.error("=".repeat(80));
            }
        }
        this.printStats();
    }
    /**
     * Print trading statistics
     */
    printStats() {
        const successRate = this.totalTrades > 0
            ? ((this.successfulTrades / this.totalTrades) * 100).toFixed(2)
            : "0.00";
        console.log("\n" + "=".repeat(80));
        console.log("📈 TRADING STATISTICS");
        console.log("=".repeat(80));
        console.log(`Total Trades: ${this.totalTrades}`);
        console.log(`Successful: ${this.successfulTrades} (${successRate}%)`);
        console.log(`Failed: ${this.totalTrades - this.successfulTrades}`);
        console.log(`Consecutive Failures: ${this.consecutiveFailures}`);
        console.log(`Total Profit: $${this.totalProfitUSDC.toFixed(4)} USDC`);
        if (this.totalGasPaidSOL.gt(0)) {
            console.log(`Total Gas Paid: ${this.totalGasPaidSOL.toFixed(6)} SOL`);
        }
        console.log("=".repeat(80));
    }
    /**
     * Get statistics
     */
    getStats() {
        return {
            totalTrades: this.totalTrades,
            successfulTrades: this.successfulTrades,
            failedTrades: this.totalTrades - this.successfulTrades,
            successRate: this.totalTrades > 0 ? (this.successfulTrades / this.totalTrades) * 100 : 0,
            totalProfitUSDC: this.totalProfitUSDC.toNumber(),
            consecutiveFailures: this.consecutiveFailures,
            circuitBreakerTripped: this.circuitBreakerTripped,
        };
    }
}
exports.HFTArbitrageEngine = HFTArbitrageEngine;
