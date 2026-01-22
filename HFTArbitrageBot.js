"use strict";
/**
 * HFT ARBITRAGE BOT - PRODUCTION READY
 *
 * Integrates:
 * - UltraFastGrpcScanner for real-time price feeds
 * - HFTArbitrageEngine for profitable execution
 * - Advanced logging and monitoring
 *
 * Usage:
 *   npm run bot:hft
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
exports.HFTArbitrageBot = void 0;
const web3_js_1 = require("@solana/web3.js");
const fs_1 = __importDefault(require("fs"));
const decimal_js_1 = __importDefault(require("decimal.js"));
const dotenv = __importStar(require("dotenv"));
const HFTArbitrageEngine_1 = require("./HFTArbitrageEngine");
const constants_1 = require("./constants");
const yellowstone_grpc_1 = __importStar(require("@triton-one/yellowstone-grpc"));
dotenv.config();
/* =========================
   HFT ARBITRAGE BOT
========================= */
class HFTArbitrageBot {
    constructor(config) {
        this.grpcClient = null;
        this.grpcStream = null;
        this.poolPrices = new Map();
        this.lastPriceUpdate = new Map();
        this.updateCount = 0;
        this.scanCount = 0;
        this.isRunning = false;
        this.config = config;
        // Setup connection with fast commitment
        this.connection = new web3_js_1.Connection(config.rpcUrl, {
            commitment: "processed",
            disableRetryOnRateLimit: false,
        });
        // Load wallet
        this.wallet = this.loadWallet(config.walletPath);
        // Initialize HFT engine
        this.engine = new HFTArbitrageEngine_1.HFTArbitrageEngine(this.connection, this.wallet, {
            minNetProfitUSDC: config.minNetProfitUSDC,
            tradeAmountUSDC: config.tradeAmountUSDC,
            maxSlippagePercent: config.maxSlippagePercent,
            basePriorityFee: config.basePriorityFee,
            maxPriorityFee: config.maxPriorityFee,
            useJito: config.useJito,
            jitoTipLamports: config.jitoTipLamports,
            maxConsecutiveFailures: config.maxConsecutiveFailures,
            minSOLBalance: config.minSOLBalance,
        });
        console.log("\n" + "=".repeat(80));
        console.log("⚡ HFT ARBITRAGE BOT - INITIALIZED");
        console.log("=".repeat(80));
        console.log(`Wallet: ${this.wallet.publicKey.toBase58()}`);
        console.log(`Mode: ${config.dryRun ? "🧪 DRY RUN" : "💰 LIVE TRADING"}`);
        console.log(`Min Net Profit: $${config.minNetProfitUSDC}`);
        console.log(`Trade Size: $${config.tradeAmountUSDC}`);
        console.log(`Jito MEV Protection: ${config.useJito ? "ENABLED" : "DISABLED"}`);
        console.log("=".repeat(80));
    }
    /**
     * Load wallet from file
     */
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
     * Decode sqrt price from Orca Whirlpool
     */
    decodeSqrtPrice(data) {
        try {
            return data.readBigUInt64LE(65) + (BigInt(data.readUInt32LE(73)) << BigInt(64));
        }
        catch {
            throw new Error("Invalid whirlpool data");
        }
    }
    /**
     * Convert sqrt price to regular price
     */
    sqrtPriceToPrice(sqrtPriceX64) {
        const sqrtPrice = new decimal_js_1.default(sqrtPriceX64.toString()).div(constants_1.DECIMAL_2_POW_64);
        const price = sqrtPrice.pow(2);
        return price.mul(constants_1.DECIMAL_10_POW_9).div(constants_1.DECIMAL_10_POW_6);
    }
    /**
     * Fetch Raydium price from vaults
     */
    async fetchRaydiumPrice(vaultA, vaultB) {
        try {
            const { getAccount } = await Promise.resolve().then(() => __importStar(require("@solana/spl-token")));
            const { PublicKey } = await Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
            const vaultAPubkey = new PublicKey(vaultA);
            const vaultBPubkey = new PublicKey(vaultB);
            const [vaultAInfo, vaultBInfo] = await Promise.all([
                getAccount(this.connection, vaultAPubkey),
                getAccount(this.connection, vaultBPubkey),
            ]);
            const solBalance = new decimal_js_1.default(vaultAInfo.amount.toString()).div(1e9);
            const usdcBalance = new decimal_js_1.default(vaultBInfo.amount.toString()).div(1e6);
            if (solBalance.isZero())
                return null;
            return usdcBalance.div(solBalance);
        }
        catch (error) {
            console.error(`[RAYDIUM] Price fetch error: ${error.message}`);
            return null;
        }
    }
    /**
     * Process price update and check for arbitrage
     */
    async processPriceUpdate(poolAddress, poolName, price) {
        this.poolPrices.set(poolAddress, price);
        this.lastPriceUpdate.set(poolAddress, Date.now());
        this.updateCount++;
        // Log every 10th update
        if (this.updateCount % 10 === 0) {
            console.log(`[⚡${this.updateCount}] ${poolName}: $${price.toFixed(6)}`);
        }
        // Check arbitrage
        await this.checkArbitrage();
    }
    /**
     * Check for arbitrage opportunities
     */
    async checkArbitrage() {
        if (this.poolPrices.size < 2)
            return;
        this.scanCount++;
        // Get pool prices
        const orcaPool = constants_1.PREDEFINED_POOLS.find(p => p.type === "orca");
        const raydiumPool = constants_1.PREDEFINED_POOLS.find(p => p.type === "raydium");
        if (!orcaPool || !raydiumPool)
            return;
        const orcaPrice = this.poolPrices.get(orcaPool.address);
        const raydiumPrice = this.poolPrices.get(raydiumPool.address);
        if (!orcaPrice || !raydiumPrice)
            return;
        // Calculate spread
        const spread = orcaPrice.minus(raydiumPrice).abs();
        const spreadPercent = spread.div(decimal_js_1.default.min(orcaPrice, raydiumPrice)).mul(100);
        // Log every 20 scans or if spread > 0.2%
        if (this.scanCount % 20 === 0 || spreadPercent.gte(0.2)) {
            console.log(`\n[SCAN ${this.scanCount}]`);
            console.log(`  Orca: $${orcaPrice.toFixed(6)}`);
            console.log(`  Raydium: $${raydiumPrice.toFixed(6)}`);
            console.log(`  Spread: ${spreadPercent.toFixed(4)}%`);
        }
        // Determine direction
        if (orcaPrice.lt(raydiumPrice)) {
            // Buy on Orca (cheaper), sell on Raydium (expensive)
            await this.engine.processOpportunity(orcaPool.address, raydiumPool.address, orcaPrice, raydiumPrice, "pool1-to-pool2");
        }
        else if (raydiumPrice.lt(orcaPrice)) {
            // Buy on Raydium (cheaper), sell on Orca (expensive)
            await this.engine.processOpportunity(raydiumPool.address, orcaPool.address, raydiumPrice, orcaPrice, "pool1-to-pool2");
        }
    }
    /**
     * Subscribe to gRPC streaming
     */
    async subscribeToStreams() {
        console.log("\n[gRPC] Connecting to real-time price feeds...");
        if (!this.config.grpcToken) {
            throw new Error("GRPC token not configured");
        }
        // Initialize gRPC client
        this.grpcClient = new yellowstone_grpc_1.default(this.config.grpcEndpoint, this.config.grpcToken, {
            grpcMaxDecodingMessageSize: 64 * 1024 * 1024,
            grpcMaxEncodingMessageSize: 64 * 1024 * 1024,
        });
        await this.grpcClient.connect();
        console.log("[gRPC] ✅ Connected");
        // Build account list
        const accountsToWatch = [];
        const raydiumVaultStates = new Map();
        for (const pool of constants_1.PREDEFINED_POOLS) {
            if (pool.type === "orca") {
                accountsToWatch.push(pool.address);
            }
            else if (pool.type === "raydium" && pool.vault_a && pool.vault_b) {
                accountsToWatch.push(pool.vault_a);
                accountsToWatch.push(pool.vault_b);
                raydiumVaultStates.set(pool.address, {
                    vaultA: null,
                    vaultB: null,
                    poolName: pool.name,
                    poolAddress: pool.address
                });
            }
        }
        // Subscribe
        const request = {
            accounts: {
                client: {
                    account: accountsToWatch,
                    owner: [],
                    filters: [],
                },
            },
            commitment: yellowstone_grpc_1.CommitmentLevel.PROCESSED,
        };
        this.grpcStream = await this.grpcClient.subscribe();
        // Handle updates
        this.grpcStream.on("data", async (data) => {
            try {
                if (!data?.account?.account)
                    return;
                const update = data.account;
                const { PublicKey } = await Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
                const accountPubkey = new PublicKey(update.account.pubkey);
                const accountKey = accountPubkey.toBase58();
                const accountData = Buffer.from(update.account.data);
                // Check if Orca pool
                const orcaPool = constants_1.PREDEFINED_POOLS.find(p => p.type === "orca" && p.address === accountKey);
                if (orcaPool) {
                    const sqrtPrice = this.decodeSqrtPrice(accountData);
                    const price = this.sqrtPriceToPrice(sqrtPrice);
                    await this.processPriceUpdate(orcaPool.address, orcaPool.name, price);
                    return;
                }
                // Check if Raydium vault
                for (const pool of constants_1.PREDEFINED_POOLS) {
                    if (pool.type === "raydium" && pool.vault_a && pool.vault_b) {
                        const state = raydiumVaultStates.get(pool.address);
                        if (accountKey === pool.vault_a) {
                            state.vaultA = accountData.readBigUInt64LE(64);
                            if (state.vaultB !== null) {
                                const solBalance = new decimal_js_1.default(state.vaultA.toString()).div(1e9);
                                const usdcBalance = new decimal_js_1.default(state.vaultB.toString()).div(1e6);
                                if (!solBalance.isZero()) {
                                    const price = usdcBalance.div(solBalance);
                                    await this.processPriceUpdate(pool.address, pool.name, price);
                                }
                            }
                        }
                        else if (accountKey === pool.vault_b) {
                            state.vaultB = accountData.readBigUInt64LE(64);
                            if (state.vaultA !== null) {
                                const solBalance = new decimal_js_1.default(state.vaultA.toString()).div(1e9);
                                const usdcBalance = new decimal_js_1.default(state.vaultB.toString()).div(1e6);
                                if (!solBalance.isZero()) {
                                    const price = usdcBalance.div(solBalance);
                                    await this.processPriceUpdate(pool.address, pool.name, price);
                                }
                            }
                        }
                    }
                }
            }
            catch (error) {
                // Suppress errors
            }
        });
        this.grpcStream.on("error", (error) => {
            console.error(`[gRPC] Error: ${error.message}`);
        });
        await this.grpcStream.write(request);
        console.log(`[gRPC] ✅ Subscribed to ${accountsToWatch.length} accounts`);
        // Fetch initial prices
        await this.fetchInitialPrices();
    }
    /**
     * Fetch initial prices
     */
    async fetchInitialPrices() {
        console.log("\n[INIT] Fetching initial pool prices...");
        for (const pool of constants_1.PREDEFINED_POOLS) {
            if (pool.type === "orca") {
                try {
                    const { PublicKey } = await Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
                    const poolPubkey = new PublicKey(pool.address);
                    const accountInfo = await this.connection.getAccountInfo(poolPubkey, "processed");
                    if (accountInfo?.data) {
                        const sqrtPrice = this.decodeSqrtPrice(accountInfo.data);
                        const price = this.sqrtPriceToPrice(sqrtPrice);
                        this.poolPrices.set(pool.address, price);
                        console.log(`[INIT] ${pool.name}: $${price.toFixed(6)}`);
                    }
                }
                catch (error) {
                    console.error(`[INIT] ${pool.name} error: ${error.message}`);
                }
            }
            else if (pool.type === "raydium" && pool.vault_a && pool.vault_b) {
                const price = await this.fetchRaydiumPrice(pool.vault_a, pool.vault_b);
                if (price) {
                    this.poolPrices.set(pool.address, price);
                    console.log(`[INIT] ${pool.name}: $${price.toFixed(6)}`);
                }
            }
        }
    }
    /**
     * Start bot
     */
    async start() {
        if (this.isRunning) {
            console.log("[BOT] Already running");
            return;
        }
        this.isRunning = true;
        console.log("\n" + "=".repeat(80));
        console.log("🚀 STARTING HFT ARBITRAGE BOT");
        console.log("=".repeat(80));
        // Subscribe to streams
        await this.subscribeToStreams();
        console.log("\n[BOT] 🔥 LIVE - Monitoring for profitable opportunities");
        console.log("[BOT] Press Ctrl+C to stop\n");
        // Keep running
        return new Promise((resolve) => {
            process.on("SIGINT", () => {
                console.log("\n\n[BOT] Shutdown signal received");
                this.stop();
                resolve();
            });
        });
    }
    /**
     * Stop bot
     */
    stop() {
        this.isRunning = false;
        if (this.grpcStream) {
            try {
                this.grpcStream.end();
            }
            catch { }
        }
        console.log("\n" + "=".repeat(80));
        console.log("🛑 BOT STOPPED");
        console.log("=".repeat(80));
        const stats = this.engine.getStats();
        console.log(`Total Trades: ${stats.totalTrades}`);
        console.log(`Successful: ${stats.successfulTrades} (${stats.successRate.toFixed(2)}%)`);
        console.log(`Failed: ${stats.failedTrades}`);
        console.log(`Total Profit: $${stats.totalProfitUSDC.toFixed(4)} USDC`);
        console.log("=".repeat(80));
    }
}
exports.HFTArbitrageBot = HFTArbitrageBot;
/* =========================
   MAIN ENTRY POINT
========================= */
async function main() {
    const config = {
        rpcUrl: process.env.RPC_URL || "",
        walletPath: process.env.WALLET_PATH || "",
        dryRun: process.env.DRY_RUN?.toLowerCase() === "true",
        minNetProfitUSDC: parseFloat(process.env.MIN_NET_PROFIT_USDC || "0.10"),
        tradeAmountUSDC: parseFloat(process.env.TRADE_USD || "100"),
        maxSlippagePercent: parseFloat(process.env.MAX_SLIPPAGE_PCT || "0.5"),
        basePriorityFee: parseInt(process.env.BASE_PRIORITY_FEE_LAMPORTS || "50000"),
        maxPriorityFee: parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || "200000"),
        grpcEndpoint: process.env.QUICKNODE_GRPC_ENDPOINT || "",
        grpcToken: process.env.QUICKNODE_GRPC_TOKEN || "",
        useJito: process.env.USE_JITO?.toLowerCase() !== "false", // Default true
        jitoTipLamports: parseInt(process.env.JITO_TIP_LAMPORTS || "10000"),
        maxConsecutiveFailures: parseInt(process.env.MAX_CONSECUTIVE_FAILURES || "5"),
        minSOLBalance: parseFloat(process.env.MIN_SOL_BALANCE_CRITICAL || "0.05"),
    };
    // Validate config
    if (!config.rpcUrl)
        throw new Error("RPC_URL not set");
    if (!config.walletPath)
        throw new Error("WALLET_PATH not set");
    if (!config.grpcEndpoint)
        throw new Error("QUICKNODE_GRPC_ENDPOINT not set");
    if (!config.grpcToken)
        throw new Error("QUICKNODE_GRPC_TOKEN not set");
    // Create and start bot
    const bot = new HFTArbitrageBot(config);
    await bot.start();
}
// Run
if (require.main === module) {
    main().catch((error) => {
        console.error("❌ Fatal error:", error);
        process.exit(1);
    });
}
