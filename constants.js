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
        name: "SOL/USDC 0.05% [VERIFIED]",
        address: "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm",
        fee_rate: 0.0005,
        config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
        vault_a: "9RfZwn2Prux6QesG1Noo4HzMEBv3rPndJ2bN2Wwd6a7p",
        vault_b: "BVNo8ftg2LkkssnWT4ZWdtoFaevnfD6ExYeramwM27pe",
    },
    {
        name: "SOL/USDC 0.01% [VERIFIED]",
        address: "83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d",
        fee_rate: 0.0001,
        config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
        vault_a: "D3CDPQLoa9jY1LXCkpUqd3JQDWz8DX1LDE1dhmJt9fq4",
        vault_b: "dwxR9YF7WwnJJu7bPC4UNcWFpcSsooH6fxbpoa3fTbJ",
    },
];
/* =========================
   ARBITRAGE THRESHOLDS
========================= */
// Minimum profit threshold AFTER fees
// Pool fees: 0.01% + 0.05% = 0.06% total
// Gas fees: ~$0.02-0.05 per trade
// Need minimum 0.15% profit to break even
exports.MIN_PROFIT_THRESHOLD = 0.0015; // 0.15% (realistic minimum)
exports.OPTIMAL_PROFIT_THRESHOLD = 0.003; // 0.3% (good target)
/* =========================
   DECIMAL CONSTANTS (pre-computed for performance)
========================= */
const decimal_js_1 = __importDefault(require("decimal.js"));
exports.DECIMAL_1E9 = new decimal_js_1.default(1e9);
exports.DECIMAL_1E6 = new decimal_js_1.default(1e6);
exports.DECIMAL_2_POW_64 = new decimal_js_1.default(2).pow(64);
exports.DECIMAL_10_POW_9 = new decimal_js_1.default(10).pow(9);
exports.DECIMAL_10_POW_6 = new decimal_js_1.default(10).pow(6);
