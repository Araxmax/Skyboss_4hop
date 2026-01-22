"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOUR_HOP_LOG_CONFIG = exports.DECIMAL_BONK_MULTIPLIER = exports.DECIMAL_SOL_MULTIPLIER = exports.DECIMAL_USDC_MULTIPLIER = exports.DECIMAL_100 = exports.DECIMAL_ONE = exports.DECIMAL_ZERO = exports.FOUR_HOP_PROFIT_THRESHOLDS = exports.BONK_RISK_PARAMS = exports.FOUR_HOP_POOLS = exports.BONK_DECIMALS = exports.BONK_MINT_PUBKEY = exports.BONK_MINT = exports.SOL_DECIMALS = exports.SOL_MINT_PUBKEY = exports.SOL_MINT = exports.USDC_DECIMALS = exports.USDC_MINT_PUBKEY = exports.USDC_MINT = void 0;
exports.generateFourHopPaths = generateFourHopPaths;
const web3_js_1 = require("@solana/web3.js");
const decimal_js_1 = __importDefault(require("decimal.js"));
/* =========================
   TOKEN MINTS FOR 4-HOP
========================= */
// Base currency (USDC) - ALL profit calculated in USDC
exports.USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
exports.USDC_MINT_PUBKEY = new web3_js_1.PublicKey(exports.USDC_MINT);
exports.USDC_DECIMALS = 6;
// Intermediate tokens
exports.SOL_MINT = "So11111111111111111111111111111111111111112";
exports.SOL_MINT_PUBKEY = new web3_js_1.PublicKey(exports.SOL_MINT);
exports.SOL_DECIMALS = 9;
exports.BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
exports.BONK_MINT_PUBKEY = new web3_js_1.PublicKey(exports.BONK_MINT);
exports.BONK_DECIMALS = 5;
/* =========================
   10 EXAMPLE POOLS FOR 4-HOP PATH
   Path: USDC -> SOL -> BONK -> USDC
========================= */
exports.FOUR_HOP_POOLS = [
    // ==================== HOP 1: USDC -> SOL ====================
    // Pool 1: Orca USDC/SOL (Whirlpool)
    {
        id: "pool_1_orca_usdc_sol",
        name: "Orca USDC/SOL 0.04%",
        dex: "orca",
        address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        tokenA: exports.USDC_MINT,
        tokenB: exports.SOL_MINT,
        tokenASymbol: "USDC",
        tokenBSymbol: "SOL",
        feeRate: 0.0004,
        vaultA: "2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP",
        vaultB: "EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9",
        minLiquidity: 100000, // $100k minimum
    },
    // Pool 2: Raydium AMM USDC/SOL
    {
        id: "pool_2_raydium_usdc_sol",
        name: "Raydium AMM USDC/SOL",
        dex: "raydium_amm",
        address: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
        tokenA: exports.USDC_MINT,
        tokenB: exports.SOL_MINT,
        tokenASymbol: "USDC",
        tokenBSymbol: "SOL",
        feeRate: 0.0025,
        vaultA: "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz", // USDC vault
        vaultB: "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz", // SOL vault
        minLiquidity: 500000, // $500k minimum
    },
    // Pool 3: Raydium CLMM USDC/SOL
    {
        id: "pool_3_raydium_clmm_usdc_sol",
        name: "Raydium CLMM USDC/SOL",
        dex: "raydium_clmm",
        address: "61R1ndXxvsWXXkWSyNkCxnzwd3zUNB8Q2ibmkiLPC8ht", // Example CLMM pool
        tokenA: exports.USDC_MINT,
        tokenB: exports.SOL_MINT,
        tokenASymbol: "USDC",
        tokenBSymbol: "SOL",
        feeRate: 0.0025,
        tickSpacing: 64,
        minLiquidity: 200000, // $200k minimum
    },
    // ==================== HOP 2: SOL -> BONK ====================
    // Pool 4: Raydium AMM SOL/BONK
    {
        id: "pool_4_raydium_sol_bonk",
        name: "Raydium AMM SOL/BONK",
        dex: "raydium_amm",
        address: "Dw8BAAALT7KRPWm1D2JQNDHUJMyjkH8C7r2zq7kQS1Hi", // Raydium SOL-BONK pool
        tokenA: exports.SOL_MINT,
        tokenB: exports.BONK_MINT,
        tokenASymbol: "SOL",
        tokenBSymbol: "BONK",
        feeRate: 0.0025,
        vaultA: "", // TODO: Add real vault addresses
        vaultB: "",
        minLiquidity: 50000, // $50k minimum for BONK
    },
    // Pool 5: Orca SOL/BONK (Whirlpool)
    {
        id: "pool_5_orca_sol_bonk",
        name: "Orca SOL/BONK 0.3%",
        dex: "orca",
        address: "EgJa7vKP6lYJWY67M8GQCXuJbGP1OZ3Gc2E5JStSeKzQ", // Example Orca SOL/BONK
        tokenA: exports.SOL_MINT,
        tokenB: exports.BONK_MINT,
        tokenASymbol: "SOL",
        tokenBSymbol: "BONK",
        feeRate: 0.003,
        vaultA: "", // TODO: Add real vault addresses
        vaultB: "",
        minLiquidity: 30000, // $30k minimum for BONK
    },
    // Pool 6: Meteora DLMM SOL/BONK
    {
        id: "pool_6_meteora_sol_bonk",
        name: "Meteora DLMM SOL/BONK",
        dex: "meteora",
        address: "ArMfvT7n9H6m3jmFu9Fg8khJW3qSjxaFrw9zToLBhJM1", // Example Meteora pool
        tokenA: exports.SOL_MINT,
        tokenB: exports.BONK_MINT,
        tokenASymbol: "SOL",
        tokenBSymbol: "BONK",
        feeRate: 0.002,
        minLiquidity: 40000, // $40k minimum
    },
    // ==================== HOP 3: BONK -> USDC ====================
    // Pool 7: Raydium AMM BONK/USDC
    {
        id: "pool_7_raydium_bonk_usdc",
        name: "Raydium AMM BONK/USDC",
        dex: "raydium_amm",
        address: "FBJvwmKPJJZk1g3k4FLUF9AVh3c2Pv8Mv8KdRb4RRXG4", // Example Raydium BONK/USDC
        tokenA: exports.BONK_MINT,
        tokenB: exports.USDC_MINT,
        tokenASymbol: "BONK",
        tokenBSymbol: "USDC",
        feeRate: 0.0025,
        vaultA: "", // TODO: Add real vault addresses
        vaultB: "",
        minLiquidity: 50000, // $50k minimum
    },
    // Pool 8: Orca BONK/USDC (Whirlpool)
    {
        id: "pool_8_orca_bonk_usdc",
        name: "Orca BONK/USDC 0.3%",
        dex: "orca",
        address: "CdmkZQavBxHyXj1bqFrxvgZlH3gEZBxckTZvVAGRTmGE", // Example Orca BONK/USDC
        tokenA: exports.BONK_MINT,
        tokenB: exports.USDC_MINT,
        tokenASymbol: "BONK",
        tokenBSymbol: "USDC",
        feeRate: 0.003,
        vaultA: "", // TODO: Add real vault addresses
        vaultB: "",
        minLiquidity: 30000, // $30k minimum
    },
    // Pool 9: Raydium CLMM BONK/USDC
    {
        id: "pool_9_raydium_clmm_bonk_usdc",
        name: "Raydium CLMM BONK/USDC",
        dex: "raydium_clmm",
        address: "EK8WY6Y4dVCHAKAGQPXJdNYGCmj1vE3KqGm6VLpJGK3C", // Example CLMM pool
        tokenA: exports.BONK_MINT,
        tokenB: exports.USDC_MINT,
        tokenASymbol: "BONK",
        tokenBSymbol: "USDC",
        feeRate: 0.0025,
        tickSpacing: 64,
        minLiquidity: 40000, // $40k minimum
    },
    // Pool 10: Meteora DLMM BONK/USDC
    {
        id: "pool_10_meteora_bonk_usdc",
        name: "Meteora DLMM BONK/USDC",
        dex: "meteora",
        address: "HxFLKUAmAMLz1jtT3hbvCMELwH5H9tpM2QugP8sKyfhW", // Example Meteora pool
        tokenA: exports.BONK_MINT,
        tokenB: exports.USDC_MINT,
        tokenASymbol: "BONK",
        tokenBSymbol: "USDC",
        feeRate: 0.002,
        minLiquidity: 35000, // $35k minimum
    },
];
/* =========================
   RISK PARAMETERS FOR BONK
========================= */
exports.BONK_RISK_PARAMS = {
    // Maximum trade size in USD
    MAX_TRADE_SIZE_USD: 500, // Cap at $500 per trade for BONK volatility
    // Minimum liquidity thresholds
    MIN_POOL_LIQUIDITY_USD: 30000, // $30k minimum per pool
    MIN_TOTAL_PATH_LIQUIDITY_USD: 100000, // $100k total for all 3 hops
    // Slippage limits
    MAX_SLIPPAGE_PER_HOP: 0.02, // 2% max per hop
    MAX_TOTAL_SLIPPAGE: 0.05, // 5% max total
    // Fee stacking awareness
    MIN_PROFIT_AFTER_FEES: 0.01, // 1% minimum profit after all fees
    // Re-simulation requirement
    MAX_QUOTE_AGE_MS: 2000, // Quotes older than 2s must be refreshed
    // Emergency circuit breaker
    MAX_PRICE_IMPACT_PER_HOP: 0.03, // 3% max price impact per hop
};
/* =========================
   PROFIT THRESHOLDS
========================= */
// 4-hop arbitrage has much higher fees than 2-hop
// Fee calculation:
// - Hop 1 (USDC->SOL): ~0.04-0.25% depending on pool
// - Hop 2 (SOL->BONK): ~0.25-0.30%
// - Hop 3 (BONK->USDC): ~0.25-0.30%
// Total fees: ~0.54-0.85%
// Add slippage + priority fees + safety margin: ~1-1.5% total cost
exports.FOUR_HOP_PROFIT_THRESHOLDS = {
    // Minimum profit to even consider executing
    MIN_PROFIT_THRESHOLD: 0.015, // 1.5%
    // Optimal profit threshold (good opportunity)
    OPTIMAL_PROFIT_THRESHOLD: 0.025, // 2.5%
    // Excellent profit threshold (rare, execute immediately)
    EXCELLENT_PROFIT_THRESHOLD: 0.04, // 4%
};
/* =========================
   DECIMAL CONSTANTS
========================= */
exports.DECIMAL_ZERO = new decimal_js_1.default(0);
exports.DECIMAL_ONE = new decimal_js_1.default(1);
exports.DECIMAL_100 = new decimal_js_1.default(100);
// Pre-computed decimal multipliers for performance
exports.DECIMAL_USDC_MULTIPLIER = new decimal_js_1.default(10).pow(exports.USDC_DECIMALS);
exports.DECIMAL_SOL_MULTIPLIER = new decimal_js_1.default(10).pow(exports.SOL_DECIMALS);
exports.DECIMAL_BONK_MULTIPLIER = new decimal_js_1.default(10).pow(exports.BONK_DECIMALS);
/* =========================
   HELPER: Generate all possible 4-hop paths
========================= */
function generateFourHopPaths() {
    const paths = [];
    // Filter pools by hop
    const hop1Pools = exports.FOUR_HOP_POOLS.filter(p => p.tokenASymbol === "USDC" && p.tokenBSymbol === "SOL");
    const hop2Pools = exports.FOUR_HOP_POOLS.filter(p => p.tokenASymbol === "SOL" && p.tokenBSymbol === "BONK");
    const hop3Pools = exports.FOUR_HOP_POOLS.filter(p => p.tokenASymbol === "BONK" && p.tokenBSymbol === "USDC");
    // Generate all combinations
    let pathCounter = 1;
    for (const hop1 of hop1Pools) {
        for (const hop2 of hop2Pools) {
            for (const hop3 of hop3Pools) {
                const totalFeeRate = hop1.feeRate + hop2.feeRate + hop3.feeRate;
                paths.push({
                    pathId: `path_${pathCounter}`,
                    pools: {
                        hop1,
                        hop2,
                        hop3,
                    },
                    totalFeeRate,
                    description: `${hop1.name} -> ${hop2.name} -> ${hop3.name}`,
                });
                pathCounter++;
            }
        }
    }
    return paths;
}
/* =========================
   LOGGING CONSTANTS
========================= */
exports.FOUR_HOP_LOG_CONFIG = {
    LOG_DIR: "./logs/4hop",
    CSV_COLUMNS: [
        "timestamp",
        "path_id",
        "path_description",
        "initial_usdc",
        "hop1_sol_out",
        "hop2_bonk_out",
        "hop3_usdc_out",
        "final_usdc",
        "gross_profit_usdc",
        "gross_profit_pct",
        "total_fees_pct",
        "net_profit_usdc",
        "net_profit_pct",
        "hop1_liquidity",
        "hop2_liquidity",
        "hop3_liquidity",
        "hop1_price_impact",
        "hop2_price_impact",
        "hop3_price_impact",
        "total_price_impact",
        "is_executable",
        "failure_reason",
        "simulation_time_ms",
    ],
};
