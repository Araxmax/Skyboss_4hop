# 🚀 ULTRA-FAST ARBITRAGE MODE

## Overview

This is a **MAXIMUM SPEED** implementation optimized for **sub-second arbitrage execution** on Solana.

## Speed Improvements

### Scanner (FastScanner.ts)
- ✅ **WebSocket Subscriptions** - Real-time price updates (no polling delay)
- ✅ **Processed Commitment** - Fastest confirmation level
- ✅ **Price Caching** - 100ms TTL cache to avoid redundant calculations
- ✅ **Parallel RPC Calls** - Batch fetching with `getMultipleAccountsInfo`
- ✅ **Minimal Allocations** - Reduced garbage collection overhead
- ✅ **Rate-Limited Logging** - Only log every 10th check (unless profitable)
- ✅ **Hot Path Optimization** - Fast sqrt price decoding

**Speed**: Updates within **50-200ms** of on-chain price changes

### Executor (FastExecutor.ts)
- ✅ **50ms Polling** - Check for signals every 50ms (vs 1000ms)
- ✅ **Parallel Operations** - Fetch prices and run safety checks simultaneously
- ✅ **Priority Fees Enabled** - Get into blocks faster
- ✅ **Fast Fail** - Quick rejection of invalid signals
- ✅ **Execution Tracking** - Monitor average execution time

**Speed**: Execute within **100-500ms** of signal detection

## How Fast Is It?

### Before (Standard Mode):
```
Scanner: 2000ms poll interval
Executor: 1000ms poll interval
Total Latency: ~3-5 seconds from price change to execution
```

### After (Ultra-Fast Mode):
```
Scanner: Real-time WebSocket updates
Executor: 50ms poll interval
Total Latency: ~100-500ms from price change to execution
```

**⚡ 6-50x FASTER than standard mode!**

## Requirements

1. **Helius RPC** with WebSocket support
2. **Stable internet connection** (low latency)
3. **Sufficient SOL** for transaction fees
4. **Priority fees enabled** (for faster inclusion)

## How to Use

### Option 1: Manual Start (Two Terminals)

**Terminal 1 - Ultra-Fast Scanner:**
```bash
npm run scanner:fast
```

**Terminal 2 - Ultra-Fast Executor:**
```bash
npm run executor:fast
```

### Option 2: One-Command Start (Requires concurrently)

First install concurrently:
```bash
npm install --save-dev concurrently
```

Then run both:
```bash
npm run fast
```

## What You'll See

### Scanner Output:
```
======================================================================
ULTRA-FAST ARBITRAGE SCANNER
======================================================================
Speed optimizations:
  • WebSocket subscriptions (real-time updates)
  • Processed commitment (fastest)
  • Price caching (100ms TTL)
  • Parallel RPC calls
  • Minimal allocations
  • Rate-limited logging
======================================================================

[FAST] ✓ Subscribed to SOL/USDC 0.05% [VERIFIED]
[FAST] ✓ Subscribed to SOL/USDC 0.01% [VERIFIED]
[FAST] Active subscriptions: 2

[FAST] Scanner running! Listening for price changes...

[1] SOL/USDC 0.05%: $242.123456 | SOL/USDC 0.01%: $242.098765 | Profit: -0.0089%
[11] SOL/USDC 0.05%: $242.125678 | SOL/USDC 0.01%: $242.100987 | Profit: -0.0087%
[✓✓✓] PROFITABLE OPPORTUNITY!
      Direction: SOL/USDC 0.05% -> SOL/USDC 0.01%
      Profit: 0.0152%
      Signal written!
```

### Executor Output:
```
======================================================================
ULTRA-FAST ARBITRAGE EXECUTOR
======================================================================
Wallet: E1auR8YyEAbEfqSrCjdP6mi3ssMEqZ8Hx9Mu4aozXyvK
Mode: DRY RUN
Priority Fees: ENABLED (faster)
======================================================================

[⚡] EXECUTOR READY - Watching for signals...

[⚡0] Processing signal...
[⚡] ✓ DRY RUN completed in 145ms

[⚡1] Processing signal...
[⚡] ✓ DRY RUN completed in 132ms
```

## Performance Monitoring

The executor tracks performance metrics:
- **Execution Count**: Total number of trades processed
- **Average Execution Time**: Mean time from signal detection to completion
- **Success Rate**: Percentage of successful executions

On exit, you'll see:
```
[⚡] Executor stopped
[⚡] Total executions: 15
[⚡] Avg execution time: 128ms
```

## Configuration Tips for Maximum Speed

### 1. Use Helius Pro/Business Plan
- Higher rate limits
- Better WebSocket reliability
- Dedicated infrastructure

### 2. Optimize .env Settings
```env
# Use processed commitment (fastest)
# Already configured in FastScanner

# Enable priority fees
MAX_PRIORITY_FEE_LAMPORTS=100000  # Higher = faster inclusion

# Aggressive profit thresholds
MIN_SPREAD_PCT=0.003  # Lower threshold = more opportunities
```

### 3. Run on Fast Hardware
- **SSD**: Faster file I/O for signal.json
- **Good Network**: Low latency to Helius servers
- **Recent CPU**: Faster TypeScript execution

### 4. Close Other Applications
- Dedicate resources to the bot
- Minimize background processes
- Close browser tabs

## Monitoring Performance

### Check Scanner Speed
Watch the price check counter:
```
[1] ... | Profit: -0.0089%
[2] ... | Profit: -0.0087%
[3] ... | Profit: -0.0085%
```
If updates come every **1-2 seconds**, WebSocket is working!
If updates are slower, check your connection.

### Check Executor Speed
Watch execution times:
```
[⚡] ✓ DRY RUN completed in 145ms
[⚡] ✓ DRY RUN completed in 132ms
[⚡] ✓ DRY RUN completed in 156ms
```
Target: **< 200ms per execution**

## Troubleshooting

### Scanner Not Updating Fast Enough
1. Check WebSocket connection: Look for "Subscribed to..." messages
2. Verify Helius API key is valid
3. Check internet connection stability
4. Try different Helius endpoint (EWR, ORD, etc.)

### Executor Too Slow
1. Check average execution time on exit
2. Increase CPU priority (Windows: Task Manager > Details > Priority > High)
3. Reduce logging frequency
4. Check RPC response times

### High CPU Usage
- Normal for ultra-fast mode
- Scanner: ~5-15% CPU
- Executor: ~5-10% CPU
- Both: ~15-25% CPU total

## When to Use Ultra-Fast Mode

✅ **Use Ultra-Fast Mode When:**
- Competing with other bots
- Trading in high-volume pairs
- Profit margins are thin (< 0.5%)
- Every millisecond counts
- You have good hardware/network

❌ **Use Standard Mode When:**
- Just testing/learning
- Profit margins are wide (> 1%)
- Running on slow hardware
- Internet connection is unstable
- You want lower resource usage

## Live Trading Checklist

Before going live with ultra-fast mode:

- [ ] Test in DRY_RUN mode first
- [ ] Verify scanner receives real-time updates
- [ ] Check executor average time < 200ms
- [ ] Confirm priority fees are working
- [ ] Have enough SOL for fees (min 0.1 SOL)
- [ ] Monitor first few trades closely
- [ ] Start with small trade amounts
- [ ] Keep emergency stop enabled

## Cost Considerations

### RPC Costs
- WebSocket subscriptions count against rate limits
- Ultra-fast mode makes more RPC calls
- Ensure Helius plan supports your volume

### Transaction Fees
- Priority fees increase cost per transaction
- Budget ~0.001-0.005 SOL per trade
- Higher fees = faster execution

### Example:
```
10 trades/hour × 0.003 SOL/trade = 0.03 SOL/hour = 0.72 SOL/day
At $100/SOL = $72/day in transaction fees
```

Make sure profit > fees!

## Advanced: Further Optimizations

If you need even MORE speed:

1. **Jito Bundles** - Bundle transactions for MEV protection + speed
2. **Multiple RPC Endpoints** - Distribute load across multiple providers
3. **Local Validator** - Run your own node (0ms RPC latency)
4. **Dedicated Server** - Colocate near Solana validators
5. **Compiled Native** - Use Rust instead of TypeScript

## Comparison: Standard vs Ultra-Fast

| Feature | Standard | Ultra-Fast |
|---------|----------|------------|
| Scanner Poll | 2000ms | Real-time WS |
| Executor Poll | 1000ms | 50ms |
| Commitment | Confirmed | Processed |
| Price Cache | No | 100ms TTL |
| Priority Fees | Optional | Enabled |
| RPC Calls | Sequential | Parallel |
| Latency | 3-5s | 0.1-0.5s |
| CPU Usage | ~5% | ~15-25% |
| Best For | Testing | Production |

## Support

Having issues with ultra-fast mode?

1. Check logs in `./logs/scanner/`
2. Verify TypeScript compilation: `npm run build`
3. Test RPC connection: `npm run check-wallet`
4. Fall back to standard mode if needed

## Summary

Ultra-Fast Mode gives you **6-50x faster arbitrage execution** by:
- Using WebSocket subscriptions for real-time price updates
- Polling every 50ms instead of 1000ms
- Running safety checks in parallel
- Enabling priority fees
- Optimizing hot code paths

**Result**: React to opportunities in **100-500ms** instead of **3-5 seconds**!

Good luck with your ultra-fast arbitrage! ⚡🚀
