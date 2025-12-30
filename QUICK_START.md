# ⚡ QUICK START GUIDE

## 🚀 Launch Commands

### Option 1: Ultra-Fast Mode (Recommended - Uses Helius gRPC)
```bash
# Terminal 1: gRPC Scanner (fastest)
npm run scanner:grpc-stream

# Terminal 2: Fast Executor (atomic + MEV protected)
npm run executor:fast
```

### Option 2: Fast Mode (Uses WebSocket)
```bash
# Terminal 1: WebSocket Scanner
npm run scanner:fast

# Terminal 2: Fast Executor
npm run executor:fast
```

### Option 3: Standard Mode
```bash
# Terminal 1: Standard Scanner
npm run scanner

# Terminal 2: Standard Executor
npm run executor
```

---

## 📋 Pre-Flight Checklist

Before starting the bot:

```bash
# 1. Check wallet balance
solana balance C:\solana\my_wallet.json

# 2. Verify compilation
npm run build

# 3. Test configuration
npm run verify
```

**Required Balances:**
- ✅ SOL: >0.1 (for gas fees)
- ✅ USDC: >$150 (for trades)

---

## ⚙️ Configuration Quick Reference

### Phase 1: DRY RUN (48 hours testing)
```bash
# In .env file:
DRY_RUN=true
TRADE_USD=100
MIN_SPREAD_PCT=0.002
```

### Phase 2: LIVE TRADING (Start small!)
```bash
# In .env file:
DRY_RUN=false          # ⚠️ GOING LIVE!
TRADE_USD=50           # Start with $50
MIN_SPREAD_PCT=0.002   # 0.2% minimum profit
```

### Phase 3: SCALE UP (After 7 days success)
```bash
# In .env file:
DRY_RUN=false
TRADE_USD=200-500      # Gradually increase
MIN_SPREAD_PCT=0.001   # Can lower for more opportunities
```

---

## 🔥 Key Features ENABLED

✅ **Atomic Execution** - Both swaps in single transaction (no partial fills)
✅ **MEV Protection** - Helius private transactions (anti-front-running)
✅ **Retry Logic** - 3 attempts with exponential backoff
✅ **Safety Checks** - 80% balance limit, slippage protection
✅ **Real-time Pricing** - Fixed price fetching in FastExecutor
✅ **gRPC Streaming** - Ultra-fast signal generation
✅ **Transaction Deadlines** - 30-second timeout

---

## 📊 Monitoring

### Check Today's Trades
```bash
cat logs/trades_$(date +%Y-%m-%d).csv
```

### Count Successful Trades
```bash
grep "true.*true" logs/trades_*.csv | wc -l
```

### Calculate Profit
```bash
# Open CSV and sum the 'actual_profit_usdc' column
# Subtract: (number_of_trades × $0.03 gas per trade)
```

---

## 🚨 Emergency Stop

**To stop the bot immediately:**
1. Press `Ctrl+C` in both terminals
2. Bot will gracefully shutdown
3. Check logs before restarting

**Auto-stop triggers:**
- 3 consecutive failures
- SOL balance < 0.01
- USDC balance < 5
- RPC timeout

---

## 🎯 Expected Performance

**Execution Speed:** 500-2000ms per trade
**Daily Trades:** 5-50 (depends on market)
**Success Rate:** 60-80%
**Profit per Trade:** $0.10 - $2.00
**Daily Profit:** $2-$20 (conservative)

---

## 🔧 Troubleshooting

### "Insufficient SOL" Error
```bash
# Add more SOL to wallet
# Need >0.1 SOL minimum
```

### "Trade exceeds 80% limit" Error
```bash
# Reduce TRADE_USD in .env
TRADE_USD=50
```

### "Safety check failed" (frequent)
```bash
# Check logs:
grep "safety_errors" logs/trades_*.csv | tail -10

# Solutions:
# - Add more SOL (>0.05)
# - Add more USDC (>$200)
# - Reduce TRADE_USD
```

### No Signals Generated
```bash
# Check scanner is running
# Lower MIN_SPREAD_PCT for more opportunities
MIN_SPREAD_PCT=0.001
```

---

## 📁 Important Files

| File | Purpose |
|------|---------|
| `.env` | Configuration (CRITICAL) |
| `logs/trades_*.csv` | Trade history |
| `signal.json` | Current arbitrage signal |
| `DEPLOYMENT_GUIDE.md` | Full deployment guide |

---

## ✅ Ready to Launch!

**For DRY RUN testing:**
```bash
# 1. Ensure DRY_RUN=true in .env
# 2. Terminal 1: npm run scanner:grpc-stream
# 3. Terminal 2: npm run executor:fast
# 4. Run for 48 hours
```

**For LIVE trading:**
```bash
# 1. Change DRY_RUN=false in .env
# 2. Set TRADE_USD=50 (start small!)
# 3. Terminal 1: npm run scanner:grpc-stream
# 4. Terminal 2: npm run executor:fast
# 5. Monitor every 2-4 hours
```

---

## 🔗 Resources

- Full Guide: `DEPLOYMENT_GUIDE.md`
- Helius Status: https://status.helius.dev/
- Solscan (TX Explorer): https://solscan.io/
- Your Wallet: https://solscan.io/account/6s58AbynyDGYrtqF5h1wnoiyicwZK1VHPYeLrx1pCU2p

---

**Good luck! 🚀**

*Last updated: 2025-12-30*
