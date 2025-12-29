# ⚡ Quick Start Guide

## 3 Steps to Run the Bot

### Step 1: Choose Your Speed Mode

| Mode | Speed | Command |
|------|-------|---------|
| **gRPC Stream (FASTEST)** | 400-800ms | `npm run grpc-fast` |
| Python + Fast Executor | 100-200ms | See below |
| Standard | 2-5s | `npm run executor` |

### Step 2: Start the Bot

#### FASTEST MODE (Recommended):
**One Terminal:**
```bash
npm run grpc-fast
```

**OR Two Terminals:**
```bash
# Terminal 1
npm run scanner:grpc-stream

# Terminal 2
npm run executor:fast
```

#### FAST MODE (Python):
```bash
# Terminal 1
npm run scanner

# Terminal 2
npm run executor:fast
```

### Step 3: Monitor Output

Look for profitable opportunities:
```
======================================================================
🚨 PROFITABLE OPPORTUNITY DETECTED!
======================================================================
Direction: SOL/USDC 0.05% -> SOL/USDC 0.01%
Profit: 0.0152%
Time: 2:30:45 PM
======================================================================
```

## Mode Comparison

| Mode | Latency | CPU | Best For |
|------|---------|-----|----------|
| gRPC Stream | 400-800ms | 15-25% | **Production** |
| Python Fast | 100-200ms | 10-15% | Testing |
| Standard | 2-5s | 5-10% | Learning |

## Safety First

Before trading real money:

1. **Test in DRY_RUN mode** (already enabled in .env)
2. **Run for 24 hours** to verify stability
3. **Check CSV logs** in `./logs/scanner/`
4. **Start small** (50-100 USDC first trades)
5. **Set DRY_RUN=False** only when confident

## Quick Commands

```bash
# Fastest mode
npm run grpc-fast

# Check wallet balance
npm run check-wallet

# Build TypeScript
npm run build

# Test scanner only
npm run scanner:grpc-stream

# Test executor only
npm run executor:fast
```

## Troubleshooting

**No updates?**
- Check .env has correct RPC_URL and HELIUS_API_KEY
- Verify internet connection

**Executor not executing?**
- Make sure both scanner and executor are running
- Check if signal.json exists
- Verify DRY_RUN=True in .env (for testing)

**TypeScript errors?**
```bash
npm run build
```

## What Success Looks Like

### Scanner Output:
```
[⚡12] SOL/USDC 0.05%: $242.125678 (+0.0009%)
[⚡13] SOL/USDC 0.01%: $242.100987 (+0.0009%)

[CHECK 2] [7.4s] [1.2 updates/s]
  Spread: 0.0102%
  Profit: -0.0034%
```

### Executor Output:
```
[⚡] EXECUTOR READY - Watching for signals...
[⚡0] Processing signal...
[⚡] ✓ DRY RUN completed in 145ms
```

## Next Steps

1. **Run in DRY_RUN mode** for 24 hours
2. **Monitor CSV logs** for opportunities
3. **Verify profit calculations** match expectations
4. **Fund wallet** with SOL + USDC
5. **Set DRY_RUN=False** when ready
6. **Start with small amounts** (test with 50 USDC)
7. **Scale up gradually** as confidence builds

## Important Files

- `.env` - Configuration settings
- `signal.json` - Current arbitrage signal
- `./logs/scanner/` - CSV logs with all trades
- `GRPC_STREAMING_GUIDE.md` - Detailed documentation

Good luck! ⚡🚀
