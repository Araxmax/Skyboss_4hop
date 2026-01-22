"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafetyChecker = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const decimal_js_1 = __importDefault(require("decimal.js"));
const constants_1 = require("./constants");
/* =========================
   SAFETY CHECKER CLASS
========================= */
class SafetyChecker {
    constructor(connection, wallet, config = {}) {
        this.connection = connection;
        this.wallet = wallet;
        this.minSolBalance = new decimal_js_1.default(config.minSolBalance || 0.02);
        this.minUsdcBalance = new decimal_js_1.default(config.minUsdcBalance || 5);
        this.maxSlippage = new decimal_js_1.default(config.maxSlippage || 0.03);
        this.maxPriceImpact = new decimal_js_1.default(config.maxPriceImpact || 0.02);
        this.minLiquidityUSD = new decimal_js_1.default(config.minLiquidityUSD || 5000);
        this.maxTradeToLiquidityRatio = new decimal_js_1.default(config.maxTradeToLiquidityRatio || 0.01);
    }
    /**
     * Comprehensive pre-trade safety check
     */
    async performSafetyCheck(tradeAmountUSD, slippage) {
        const errors = [];
        const warnings = [];
        console.log("\n" + "=".repeat(70));
        console.log("SAFETY CHECK");
        console.log("=".repeat(70));
        // Check 1: Wallet balances
        const balanceCheck = await this.checkBalances();
        if (!balanceCheck.passed) {
            errors.push(...balanceCheck.errors);
        }
        if (balanceCheck.warnings.length > 0) {
            warnings.push(...balanceCheck.warnings);
        }
        // Check 2: Slippage tolerance
        if (slippage.gt(this.maxSlippage)) {
            errors.push(`Slippage ${slippage.mul(100).toFixed(2)}% exceeds maximum ${this.maxSlippage.mul(100).toFixed(2)}%`);
        }
        else if (slippage.gt(this.maxSlippage.mul(0.5))) {
            warnings.push(`High slippage: ${slippage.mul(100).toFixed(2)}% (max: ${this.maxSlippage.mul(100).toFixed(2)}%)`);
        }
        // Check 3: RPC connection
        const rpcCheck = await this.checkRPCConnection();
        if (!rpcCheck.passed) {
            errors.push(...rpcCheck.errors);
        }
        // Check 4: Trade size vs balance (STRICTER - 80% hard limit)
        if (balanceCheck.balances) {
            if (tradeAmountUSD.gt(balanceCheck.balances.usdc.mul(0.8))) {
                errors.push(`Trade amount ${tradeAmountUSD.toString()} USDC exceeds 80% limit (${balanceCheck.balances.usdc.toFixed(2)} USDC available)`);
            }
            else if (tradeAmountUSD.gt(balanceCheck.balances.usdc.mul(0.6))) {
                warnings.push(`Trade amount ${tradeAmountUSD.toString()} USDC uses >60% of balance`);
            }
        }
        console.log(`\n[✓] Checks completed: ${errors.length} errors, ${warnings.length} warnings`);
        return {
            passed: errors.length === 0,
            errors,
            warnings,
            balances: balanceCheck.balances,
        };
    }
    /**
     * Check wallet balances (optimized with parallel RPC calls)
     */
    async checkBalances() {
        const errors = [];
        const warnings = [];
        try {
            // Parallel RPC calls for better performance
            const [solLamports, usdcAta] = await Promise.all([
                this.connection.getBalance(this.wallet.publicKey),
                (0, spl_token_1.getAssociatedTokenAddress)(constants_1.USDC_MINT_PUBKEY, this.wallet.publicKey),
            ]);
            const solBalance = new decimal_js_1.default(solLamports).div(constants_1.DECIMAL_1E9);
            console.log(`\n[CHECK] SOL Balance: ${solBalance.toFixed(6)} SOL`);
            if (solBalance.lt(this.minSolBalance)) {
                errors.push(`Insufficient SOL: ${solBalance.toFixed(6)} < ${this.minSolBalance.toString()} required`);
            }
            else if (solBalance.lt(this.minSolBalance.mul(2))) {
                warnings.push(`Low SOL balance: ${solBalance.toFixed(6)} SOL (recommended: ${this.minSolBalance.mul(2).toString()})`);
            }
            // Check USDC balance
            let usdcBalance = new decimal_js_1.default(0);
            try {
                const usdcAccountInfo = await this.connection.getTokenAccountBalance(usdcAta);
                usdcBalance = new decimal_js_1.default(usdcAccountInfo.value.uiAmount || 0);
                console.log(`[CHECK] USDC Balance: ${usdcBalance.toFixed(6)} USDC`);
                if (usdcBalance.lt(this.minUsdcBalance)) {
                    errors.push(`Insufficient USDC: ${usdcBalance.toFixed(6)} < ${this.minUsdcBalance.toString()} required`);
                }
            }
            catch (error) {
                errors.push("USDC token account not found or not initialized");
            }
            return {
                passed: errors.length === 0,
                errors,
                warnings,
                balances: {
                    sol: solBalance,
                    usdc: usdcBalance,
                },
            };
        }
        catch (error) {
            return {
                passed: false,
                errors: [`Balance check failed: ${error.message}`],
                warnings,
            };
        }
    }
    /**
     * Check RPC connection health
     */
    async checkRPCConnection() {
        const errors = [];
        try {
            console.log(`[CHECK] RPC Connection...`);
            const startTime = Date.now();
            const slot = await this.connection.getSlot();
            const latency = Date.now() - startTime;
            console.log(`[CHECK] RPC Latency: ${latency}ms (Slot: ${slot})`);
            if (latency > 5000) {
                errors.push(`RPC latency too high: ${latency}ms`);
            }
            return {
                passed: errors.length === 0,
                errors,
                warnings: [],
            };
        }
        catch (error) {
            return {
                passed: false,
                errors: [`RPC connection failed: ${error.message}`],
                warnings: [],
            };
        }
    }
    /**
     * Check pool liquidity
     */
    async checkPoolLiquidity(vaultA, vaultB, tradeAmountUSD) {
        const errors = [];
        const warnings = [];
        try {
            console.log(`\n[CHECK] Pool Liquidity...`);
            // Get vault A balance (SOL)
            const vaultABalance = await this.connection.getBalance(new web3_js_1.PublicKey(vaultA));
            const solBalance = new decimal_js_1.default(vaultABalance).div(constants_1.DECIMAL_1E9);
            // Get vault B balance (USDC)
            let usdcBalance = new decimal_js_1.default(0);
            try {
                const vaultBInfo = await this.connection.getAccountInfo(new web3_js_1.PublicKey(vaultB));
                if (vaultBInfo && vaultBInfo.data.length >= 72) {
                    const amount = vaultBInfo.data.readBigUInt64LE(64);
                    usdcBalance = new decimal_js_1.default(amount.toString()).div(constants_1.DECIMAL_1E6);
                }
            }
            catch (error) {
                warnings.push("Could not read USDC vault balance");
            }
            console.log(`[CHECK] Pool SOL: ${solBalance.toFixed(2)}`);
            console.log(`[CHECK] Pool USDC: ${usdcBalance.toFixed(2)}`);
            // Estimate total liquidity in USD (assuming SOL price)
            // This is approximate - in production you'd fetch real SOL price
            const estimatedSolPrice = new decimal_js_1.default(200); // Approximate
            const totalLiquidityUSD = solBalance
                .mul(estimatedSolPrice)
                .plus(usdcBalance);
            console.log(`[CHECK] Estimated Liquidity: $${totalLiquidityUSD.toFixed(2)}`);
            if (totalLiquidityUSD.lt(this.minLiquidityUSD)) {
                errors.push(`Pool liquidity too low: $${totalLiquidityUSD.toFixed(2)} < $${this.minLiquidityUSD.toString()} required`);
            }
            // Check trade size vs liquidity
            const tradeRatio = tradeAmountUSD.div(totalLiquidityUSD);
            console.log(`[CHECK] Trade/Liquidity Ratio: ${tradeRatio.mul(100).toFixed(2)}%`);
            if (tradeRatio.gt(this.maxTradeToLiquidityRatio)) {
                errors.push(`Trade too large relative to liquidity: ${tradeRatio.mul(100).toFixed(2)}% > ${this.maxTradeToLiquidityRatio.mul(100).toFixed(2)}%`);
            }
            else if (tradeRatio.gt(this.maxTradeToLiquidityRatio.mul(0.5))) {
                warnings.push(`High trade/liquidity ratio: ${tradeRatio.mul(100).toFixed(2)}%`);
            }
            return {
                passed: errors.length === 0,
                errors,
                warnings,
            };
        }
        catch (error) {
            return {
                passed: false,
                errors: [`Liquidity check failed: ${error.message}`],
                warnings,
            };
        }
    }
    /**
     * Emergency stop check
     */
    shouldEmergencyStop(recentFailures, maxFailures = 3) {
        if (recentFailures >= maxFailures) {
            console.error(`\n[EMERGENCY STOP] ${recentFailures} consecutive failures - halting execution`);
            return true;
        }
        return false;
    }
    /**
     * Print safety summary
     */
    printSafetyReport(result) {
        console.log("\n" + "=".repeat(70));
        console.log("SAFETY CHECK REPORT");
        console.log("=".repeat(70));
        if (result.passed) {
            console.log("\n[✓] ALL CHECKS PASSED");
        }
        else {
            console.log("\n[✗] SAFETY CHECK FAILED");
        }
        if (result.errors.length > 0) {
            console.log("\nERRORS:");
            result.errors.forEach((err) => console.log(`  - ${err}`));
        }
        if (result.warnings.length > 0) {
            console.log("\nWARNINGS:");
            result.warnings.forEach((warn) => console.log(`  - ${warn}`));
        }
        if (result.balances) {
            console.log("\nCURRENT BALANCES:");
            console.log(`  SOL: ${result.balances.sol.toFixed(6)}`);
            console.log(`  USDC: ${result.balances.usdc.toFixed(6)}`);
        }
        console.log("=".repeat(70) + "\n");
    }
}
exports.SafetyChecker = SafetyChecker;
