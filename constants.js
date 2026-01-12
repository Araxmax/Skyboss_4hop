"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECIMAL_10_POW_6 = exports.DECIMAL_10_POW_9 = exports.DECIMAL_2_POW_64 = exports.DECIMAL_1E6 = exports.DECIMAL_1E9 = exports.OPTIMAL_PROFIT_THRESHOLD = exports.MIN_PROFIT_THRESHOLD = exports.PREDEFINED_POOLS = exports.USDC_MINT_PUBKEY = exports.SOL_MINT_PUBKEY = exports.USDC_MINT = exports.SOL_MINT = void 0;
const web3_js_1 = require("@solana/web3.js");
/* =========================
   TOKEN MINTS
========================= */
exports.SOL_MINT = "So11111111111111111111111111111111111111112";
exports.USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
exports.SOL_MINT_PUBKEY = new web3_js_1.PublicKey(exports.SOL_MINT);
exports.USDC_MINT_PUBKEY = new web3_js_1.PublicKey(exports.USDC_MINT);
exports.PREDEFINED_POOLS = [
    {
        name: "SOL/USDC 0.04% Orca [VERIFIED]",
        address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        fee_rate: 0.0004,
        type: "orca",
        config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
        vault_a: "EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9",
        vault_b: "2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP",
    },
    {
        name: "SOL/USDC Raydium [VERIFIED]",
        address: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
        fee_rate: 0.0025,
        type: "raydium",
        vault_a: "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz",
        vault_b: "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz",
    },
];
/* =========================
   ARBITRAGE THRESHOLDS
========================= */
// Minimum profit threshold AFTER fees
// Orca fee: 0.04%
// Raydium fee: 0.25%
// Total: 0.29% for Raydium-Orca arbitrage
// Gas fees: ~$0.02-0.05 per trade
// Need minimum 0.35% profit to break even
exports.MIN_PROFIT_THRESHOLD = 0.0035; // 0.35% (realistic minimum)
exports.OPTIMAL_PROFIT_THRESHOLD = 0.005; // 0.5% (good target)
/* =========================
   DECIMAL CONSTANTS (pre-computed for performance)
========================= */
const decimal_js_1 = __importDefault(require("decimal.js"));
exports.DECIMAL_1E9 = new decimal_js_1.default(1e9);
exports.DECIMAL_1E6 = new decimal_js_1.default(1e6);
exports.DECIMAL_2_POW_64 = new decimal_js_1.default(2).pow(64);
exports.DECIMAL_10_POW_9 = new decimal_js_1.default(10).pow(9);
exports.DECIMAL_10_POW_6 = new decimal_js_1.default(10).pow(6);
