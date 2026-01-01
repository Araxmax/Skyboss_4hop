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
const web3_js_1 = require("@solana/web3.js");
const dotenv = __importStar(require("dotenv"));
const constants_1 = require("./constants");
dotenv.config();
/**
 * Test WebSocket connection and monitor pool activity
 */
async function testConnection() {
    console.log('\n' + '='.repeat(70));
    console.log('🔍 TESTING HELIUS WEBSOCKET CONNECTION');
    console.log('='.repeat(70));
    const RPC_URL = process.env.RPC_URL || '';
    console.log(`\nRPC URL: ${RPC_URL}`);
    const connection = new web3_js_1.Connection(RPC_URL, {
        commitment: 'processed',
        wsEndpoint: RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://'),
    });
    console.log('\n✅ Connection created');
    console.log('⏳ Testing account subscriptions...\n');
    // Track updates
    let updateCount = 0;
    let lastUpdateTime = Date.now();
    const startTime = Date.now();
    // Subscribe to both pools
    for (const pool of constants_1.PREDEFINED_POOLS) {
        const poolPubkey = new web3_js_1.PublicKey(pool.address);
        const subId = connection.onAccountChange(poolPubkey, (accountInfo, context) => {
            updateCount++;
            const now = Date.now();
            const timeSinceLastUpdate = ((now - lastUpdateTime) / 1000).toFixed(1);
            const totalRuntime = ((now - startTime) / 1000).toFixed(1);
            lastUpdateTime = now;
            console.log(`\n[${{ updateCount }}] 🔔 PRICE UPDATE RECEIVED!`);
            console.log(`Pool: ${pool.name}`);
            console.log(`Slot: ${context.slot}`);
            console.log(`Data size: ${accountInfo.data.length} bytes`);
            console.log(`Time since last update: ${timeSinceLastUpdate}s`);
            console.log(`Total runtime: ${totalRuntime}s`);
            console.log(`Updates/minute: ${(updateCount / (parseFloat(totalRuntime) / 60)).toFixed(2)}`);
        }, 'processed');
        console.log(`✓ Subscribed to ${pool.name} (ID: ${subId})`);
    }
    console.log('\n' + '='.repeat(70));
    console.log('✅ ALL SUBSCRIPTIONS ACTIVE');
    console.log('='.repeat(70));
    console.log('\n⏳ Waiting for price updates...');
    console.log('(This will show updates as they happen on the blockchain)');
    console.log('\nℹ️  If you see no updates after 2-3 minutes:');
    console.log('   • The pools are quiet (no trades happening)');
    console.log('   • This is NORMAL during low-volatility periods');
    console.log('   • Your bot is still working - just waiting for activity');
    console.log('\n💡 To test if connection works:');
    console.log('   1. Make a small swap on Orca yourself');
    console.log('   2. Wait for high market activity');
    console.log('   3. Check during volatile periods\n');
    console.log('Press Ctrl+C to stop\n');
    // Periodic status updates
    setInterval(() => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const updatesPerMin = updateCount > 0 ? (updateCount / (parseFloat(elapsed) / 60)).toFixed(2) : '0.00';
        if (updateCount === 0) {
            console.log(`[${elapsed}s] ⏳ Still waiting... (${updateCount} updates so far)`);
        }
        else {
            console.log(`[${elapsed}s] ✅ Active - ${updateCount} updates (${updatesPerMin}/min)`);
        }
    }, 30000); // Every 30 seconds
    // Keep running
    await new Promise(() => { });
}
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n✅ Test completed');
    process.exit(0);
});
testConnection().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
});
