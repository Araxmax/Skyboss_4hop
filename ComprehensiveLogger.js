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
exports.ComprehensiveLogger = void 0;
exports.convertPathSimulationToOpportunity = convertPathSimulationToOpportunity;
exports.createExecutedTradeData = createExecutedTradeData;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ============================================
// COMPREHENSIVE LOGGER CLASS
// ============================================
class ComprehensiveLogger {
    constructor(logDir = "./logs") {
        this.opportunityCount = 0;
        this.tradableCount = 0;
        this.executedCount = 0;
        this.logDir = logDir;
        const dateStr = this.getDateString();
        this.allOpportunitiesPath = path.join(logDir, `ALL_OPPORTUNITIES_${dateStr}.csv`);
        this.tradableOpportunitiesPath = path.join(logDir, `TRADABLE_OPPORTUNITIES_${dateStr}.csv`);
        this.executedTradesPath = path.join(logDir, `EXECUTED_TRADES_${dateStr}.csv`);
        this.ensureLogDir();
        this.initializeCsvFiles();
    }
    // ============================================
    // INITIALIZATION
    // ============================================
    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
            console.log(`[ComprehensiveLogger] Created log directory: ${this.logDir}`);
        }
    }
    getDateString() {
        const now = new Date();
        return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    }
    initializeCsvFiles() {
        // File 1: ALL_OPPORTUNITIES.csv
        const allOppsHeader = [
            "timestamp", "scan_number", "path_id", "path_type", "description",
            "token_path", "pool_path", "pool_count",
            "initial_usdc", "final_usdc",
            "gross_profit_usdc", "gross_profit_pct",
            "net_profit_usdc", "net_profit_pct",
            "total_fees_pct", "total_price_impact_pct", "estimated_slippage_pct",
            "total_liquidity_usd", "min_pool_liquidity_usd", "avg_pool_liquidity_usd",
            // Pool 1
            "pool1_name", "pool1_token_in", "pool1_token_out",
            "pool1_amount_in", "pool1_amount_out",
            "pool1_fee_pct", "pool1_impact_pct", "pool1_liquidity_usd",
            "pool1_valid", "pool1_failure_reason",
            // Pool 2
            "pool2_name", "pool2_token_in", "pool2_token_out",
            "pool2_amount_in", "pool2_amount_out",
            "pool2_fee_pct", "pool2_impact_pct", "pool2_liquidity_usd",
            "pool2_valid", "pool2_failure_reason",
            // Pool 3
            "pool3_name", "pool3_token_in", "pool3_token_out",
            "pool3_amount_in", "pool3_amount_out",
            "pool3_fee_pct", "pool3_impact_pct", "pool3_liquidity_usd",
            "pool3_valid", "pool3_failure_reason",
            // Pool 4
            "pool4_name", "pool4_token_in", "pool4_token_out",
            "pool4_amount_in", "pool4_amount_out",
            "pool4_fee_pct", "pool4_impact_pct", "pool4_liquidity_usd",
            "pool4_valid", "pool4_failure_reason",
            // Status
            "is_tradable", "failure_reason", "simulation_time_ms"
        ].join(",");
        // File 2: TRADABLE_OPPORTUNITIES.csv
        const tradableHeader = [
            "timestamp", "scan_number", "path_id", "path_type", "opportunity_rank",
            "description", "token_path", "pool_path",
            "initial_usdc", "final_usdc",
            "net_profit_usdc", "net_profit_pct",
            "total_fees_pct", "total_impact_pct",
            "min_liquidity_usd", "total_liquidity_usd",
            "execution_pools", "trade_flow"
        ].join(",");
        // File 3: EXECUTED_TRADES.csv
        const executedHeader = [
            "timestamp", "scan_number", "path_id", "path_type", "opportunity_rank",
            "estimated_profit_usdc", "estimated_profit_pct", "trade_amount_usdc",
            "execution_mode", "execution_strategy", "execution_time_ms",
            "execution_status",
            "actual_profit_usdc", "actual_profit_pct", "slippage_pct",
            "tx_signatures", "tx_fee_sol", "block_time",
            "failure_stage", "error_message",
            "pre_balance_usdc", "post_balance_usdc",
            "pre_balance_sol", "post_balance_sol"
        ].join(",");
        // Initialize files if they don't exist
        if (!fs.existsSync(this.allOpportunitiesPath)) {
            fs.writeFileSync(this.allOpportunitiesPath, allOppsHeader + "\n");
            console.log(`[ComprehensiveLogger] Created: ${path.basename(this.allOpportunitiesPath)}`);
        }
        if (!fs.existsSync(this.tradableOpportunitiesPath)) {
            fs.writeFileSync(this.tradableOpportunitiesPath, tradableHeader + "\n");
            console.log(`[ComprehensiveLogger] Created: ${path.basename(this.tradableOpportunitiesPath)}`);
        }
        if (!fs.existsSync(this.executedTradesPath)) {
            fs.writeFileSync(this.executedTradesPath, executedHeader + "\n");
            console.log(`[ComprehensiveLogger] Created: ${path.basename(this.executedTradesPath)}`);
        }
    }
    // ============================================
    // PUBLIC LOGGING METHODS
    // ============================================
    /**
     * Log ALL opportunities (tradable + non-tradable)
     * This captures every single scan result
     */
    logAllOpportunities(scanNumber, opportunities) {
        for (const opp of opportunities) {
            const row = [
                opp.timestamp,
                scanNumber,
                opp.pathId,
                opp.pathType,
                `"${opp.description}"`,
                `"${opp.tokenPath}"`,
                `"${opp.poolPath}"`,
                opp.poolCount,
                opp.initialAmount.toFixed(6),
                opp.finalAmount.toFixed(6),
                opp.grossProfitUSDC.toFixed(6),
                opp.grossProfitPct.toFixed(4),
                opp.netProfitUSDC.toFixed(6),
                opp.netProfitPct.toFixed(4),
                opp.totalFeesPct.toFixed(4),
                opp.totalPriceImpactPct.toFixed(4),
                opp.estimatedSlippagePct.toFixed(4),
                opp.totalLiquidityUSD.toFixed(0),
                opp.minPoolLiquidityUSD.toFixed(0),
                opp.avgPoolLiquidityUSD.toFixed(0),
                // Pool details (4 pools max)
                ...this.formatPoolDetails(opp.pools, 4),
                // Status
                opp.isTradable ? "TRUE" : "FALSE",
                `"${opp.failureReason}"`,
                opp.simulationTimeMs
            ].join(",");
            fs.appendFileSync(this.allOpportunitiesPath, row + "\n");
            this.opportunityCount++;
        }
    }
    /**
     * Log only TRADABLE opportunities (passed all checks)
     * These are candidates for execution
     */
    logTradableOpportunities(scanNumber, opportunities) {
        const tradable = opportunities.filter(o => o.isTradable);
        for (let i = 0; i < tradable.length; i++) {
            const opp = tradable[i];
            // Build execution pools string
            const executionPools = opp.pools.map(p => p.poolName).join(" | ");
            // Build trade flow string
            const tradeFlow = opp.pools
                .map(p => `${p.tokenIn}->${p.tokenOut}`)
                .join(" | ");
            const row = [
                opp.timestamp,
                scanNumber,
                opp.pathId,
                opp.pathType,
                i + 1, // Rank (1 = best)
                `"${opp.description}"`,
                `"${opp.tokenPath}"`,
                `"${opp.poolPath}"`,
                opp.initialAmount.toFixed(6),
                opp.finalAmount.toFixed(6),
                opp.netProfitUSDC.toFixed(6),
                opp.netProfitPct.toFixed(4),
                opp.totalFeesPct.toFixed(4),
                opp.totalPriceImpactPct.toFixed(4),
                opp.minPoolLiquidityUSD.toFixed(0),
                opp.totalLiquidityUSD.toFixed(0),
                `"${executionPools}"`,
                `"${tradeFlow}"`
            ].join(",");
            fs.appendFileSync(this.tradableOpportunitiesPath, row + "\n");
            this.tradableCount++;
        }
    }
    /**
     * Log EXECUTED trades only (on-chain transactions)
     * This is the final record of what actually happened
     */
    logExecutedTrade(tradeData) {
        const row = [
            tradeData.timestamp,
            tradeData.scanNumber,
            tradeData.pathId,
            tradeData.pathType,
            tradeData.opportunityRank,
            tradeData.estimatedProfitUSDC.toFixed(6),
            tradeData.estimatedProfitPct.toFixed(4),
            tradeData.tradeAmountUSDC.toFixed(6),
            tradeData.executionMode,
            tradeData.executionStrategy,
            tradeData.executionTimeMs,
            tradeData.executionStatus,
            tradeData.actualProfitUSDC.toFixed(6),
            tradeData.actualProfitPct.toFixed(4),
            tradeData.slippagePct.toFixed(4),
            `"${tradeData.txSignatures}"`,
            tradeData.txFeeSOL.toFixed(9),
            tradeData.blockTime,
            `"${tradeData.failureStage || ""}"`,
            `"${tradeData.errorMessage || ""}"`,
            tradeData.preBalanceUSDC.toFixed(6),
            tradeData.postBalanceUSDC.toFixed(6),
            tradeData.preBalanceSOL.toFixed(9),
            tradeData.postBalanceSOL.toFixed(9)
        ].join(",");
        fs.appendFileSync(this.executedTradesPath, row + "\n");
        this.executedCount++;
    }
    // ============================================
    // HELPER METHODS
    // ============================================
    formatPoolDetails(pools, maxPools) {
        const result = [];
        for (let i = 0; i < maxPools; i++) {
            if (i < pools.length) {
                const p = pools[i];
                result.push(`"${p.poolName}"`, p.tokenIn, p.tokenOut, p.amountIn.toFixed(6), p.amountOut.toFixed(6), p.feeRatePct.toFixed(3), p.priceImpactPct.toFixed(4), p.liquidityUSD.toFixed(0), p.isValid ? "TRUE" : "FALSE", `"${p.failureReason || ""}"`);
            }
            else {
                // Empty pool slot
                result.push("", "", "", "", "", "", "", "", "", "");
            }
        }
        return result;
    }
    // ============================================
    // STATISTICS & INFO
    // ============================================
    getStatistics() {
        const tradableRate = this.opportunityCount > 0
            ? (this.tradableCount / this.opportunityCount) * 100
            : 0;
        const executionRate = this.tradableCount > 0
            ? (this.executedCount / this.tradableCount) * 100
            : 0;
        return {
            totalOpportunities: this.opportunityCount,
            tradableOpportunities: this.tradableCount,
            executedTrades: this.executedCount,
            tradableRate,
            executionRate
        };
    }
    getLogPaths() {
        return {
            allOpportunities: this.allOpportunitiesPath,
            tradableOpportunities: this.tradableOpportunitiesPath,
            executedTrades: this.executedTradesPath
        };
    }
    printStatistics() {
        const stats = this.getStatistics();
        console.log("\n" + "=".repeat(70));
        console.log("COMPREHENSIVE LOGGING STATISTICS");
        console.log("=".repeat(70));
        console.log(`Total Opportunities Scanned: ${stats.totalOpportunities}`);
        console.log(`Tradable Opportunities: ${stats.tradableOpportunities} (${stats.tradableRate.toFixed(2)}%)`);
        console.log(`Executed Trades: ${stats.executedTrades} (${stats.executionRate.toFixed(2)}% of tradable)`);
        console.log("=".repeat(70));
        console.log("\nLog Files:");
        console.log(`  All Data: ${path.basename(this.allOpportunitiesPath)}`);
        console.log(`  Tradable: ${path.basename(this.tradableOpportunitiesPath)}`);
        console.log(`  Executed: ${path.basename(this.executedTradesPath)}`);
        console.log("=".repeat(70) + "\n");
    }
}
exports.ComprehensiveLogger = ComprehensiveLogger;
// ============================================
// HELPER FUNCTIONS FOR INTEGRATION
// ============================================
/**
 * Convert PathSimulationResult to OpportunityData
 * (Use this to integrate with existing MultiPathCalculator)
 */
function convertPathSimulationToOpportunity(scanNumber, result) {
    // Build token path
    const tokenPath = result.swaps.length > 0
        ? [result.swaps[0].tokenIn, ...result.swaps.map((s) => s.tokenOut)].join("->")
        : "";
    // Build pool path
    const poolPath = result.swaps.map((s) => s.poolName).join("->");
    // Calculate average pool liquidity
    const avgLiquidity = result.swaps.length > 0
        ? result.swaps.reduce((sum, s) => sum + parseFloat(s.liquidityUSD.toString()), 0) / result.swaps.length
        : 0;
    // Convert pools
    const pools = result.swaps.map((swap) => ({
        poolName: swap.poolName,
        tokenIn: swap.tokenIn,
        tokenOut: swap.tokenOut,
        amountIn: parseFloat(swap.amountIn.toString()),
        amountOut: parseFloat(swap.amountOut.toString()),
        feeRatePct: parseFloat(swap.feeRate.mul(100).toString()),
        priceImpactPct: parseFloat(swap.priceImpact.mul(100).toString()),
        liquidityUSD: parseFloat(swap.liquidityUSD.toString()),
        isValid: swap.isValid,
        failureReason: swap.failureReason
    }));
    return {
        timestamp: new Date().toISOString(),
        scanNumber,
        pathId: result.pathId,
        pathType: result.pathType,
        description: result.description,
        tokenPath,
        poolPath,
        poolCount: result.swaps.length,
        initialAmount: parseFloat(result.initialUSDC.toString()),
        finalAmount: parseFloat(result.finalUSDC.toString()),
        grossProfitUSDC: parseFloat(result.grossProfitUSDC.toString()),
        grossProfitPct: parseFloat(result.grossProfitPct.mul(100).toString()),
        netProfitUSDC: parseFloat(result.netProfitUSDC.toString()),
        netProfitPct: parseFloat(result.netProfitPct.mul(100).toString()),
        totalFeesPct: parseFloat(result.totalFeesPct.mul(100).toString()),
        totalPriceImpactPct: parseFloat(result.totalPriceImpact.mul(100).toString()),
        estimatedSlippagePct: parseFloat(result.totalPriceImpact.mul(100).toString()), // Same as impact for now
        totalLiquidityUSD: parseFloat(result.totalLiquidityUSD.toString()),
        minPoolLiquidityUSD: parseFloat(result.minPoolLiquidityUSD.toString()),
        avgPoolLiquidityUSD: avgLiquidity,
        pools,
        isTradable: result.isExecutable,
        failureReason: result.failureReason || "",
        simulationTimeMs: result.simulationTimeMs
    };
}
/**
 * Create ExecutedTradeData from execution result
 */
function createExecutedTradeData(scanNumber, opportunity, rank, executionResult, // Your ExecutionResult type
walletBalances, isDryRun) {
    const actualProfit = executionResult.actualProfit || 0;
    const estimatedProfit = opportunity.netProfitUSDC;
    const slippage = estimatedProfit !== 0
        ? ((estimatedProfit - actualProfit) / estimatedProfit) * 100
        : 0;
    return {
        timestamp: new Date().toISOString(),
        scanNumber,
        pathId: opportunity.pathId,
        pathType: opportunity.pathType,
        opportunityRank: rank,
        estimatedProfitUSDC: estimatedProfit,
        estimatedProfitPct: opportunity.netProfitPct,
        tradeAmountUSDC: opportunity.initialAmount,
        executionMode: isDryRun ? "DRY_RUN" : "LIVE",
        executionStrategy: opportunity.poolCount === 2 ? "ATOMIC" : "SEQUENTIAL",
        executionTimeMs: executionResult.executionTimeMs || 0,
        executionStatus: executionResult.success ? "SUCCESS" : "FAILED",
        actualProfitUSDC: actualProfit,
        actualProfitPct: opportunity.initialAmount !== 0
            ? (actualProfit / opportunity.initialAmount) * 100
            : 0,
        slippagePct: slippage,
        txSignatures: executionResult.txSignature || "",
        txFeeSOL: executionResult.txFee || 0,
        blockTime: executionResult.blockTime || Date.now(),
        failureStage: executionResult.failureStage,
        errorMessage: executionResult.error || "",
        preBalanceUSDC: walletBalances.preUSDC,
        postBalanceUSDC: walletBalances.postUSDC,
        preBalanceSOL: walletBalances.preSOL,
        postBalanceSOL: walletBalances.postSOL
    };
}
