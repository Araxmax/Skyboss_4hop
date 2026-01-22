# Remaining Issues

## Summary

The bot now connects to mainnet and attempts to find arbitrage opportunities, but there are critical issues that prevent it from working correctly.

## Issues Fixed ✅

1. **TESTNET vs MAINNET mismatch** - Fixed by updating `.env` to use mainnet RPC
2. **Missing decimals in price calculation** - Fixed by adding `decimalsA` and `decimalsB` to pool metadata
3. **Subscription cleanup errors** - Fixed by adding null checks
4. **Rate limiting** - Partially mitigated by slower batch processing

## Critical Issues Remaining ❌

### 1. Incorrect Price Calculation for CLMM Pools

**Problem**: The current price calculation uses vault balance ratios:
```typescript
price = balanceB / balanceA
```

This works for traditional AMM pools (constant product: x * y = k), but **NOT** for Concentrated Liquidity Market Makers (CLMM) like:
- Raydium CLMM
- Orca Whirlpool
- Meteora DLMM

**Why it fails**: CLMM pools concentrate liquidity in specific price ranges. The vault balances don't represent the actual trading price.

**Example**:
- Pool: Raydium CLMM SOL/USDC
- Vault A (SOL): 6,220.01 SOL
- Vault B (USDC): 98,441.51 USDC
- Calculated price: 98,441 / 6,220 = **15.8 USDC/SOL** ❌
- Actual SOL price: **~$200** ✅

**Impact**: Bot calculates completely wrong prices (off by 10-100x), leading to:
- False arbitrage opportunities
- Massive calculated spreads (6%+) that don't actually exist
- Trades would fail or lose money if executed

**Solution needed**:
- For Raydium CLMM: Read pool state and decode sqrtPriceX64
- For Orca Whirlpool: Use Orca SDK to fetch current price
- For Meteora DLMM: Read bin state to get active price

### 2. Swap Execution Only Supports Orca

**Problem**: `SwapExecutor.executeSwap()` only handles Orca Whirlpool pools. It tries to use Orca SDK for all pools, causing errors:

```
[TX] Error: Unable to fetch Whirlpool at address at CYbD9RaToYMtWKA7QZyoLahnHdWq553Vm62Lh6qWtuxq
```

**Reason**: Pool `CYbD9RaToYMtWKA7QZyoLahnHdWq553Vm62Lh6qWtuxq` is a Raydium CLMM pool, not an Orca Whirlpool.

**Current workaround**: Bot filters to only compare Orca pools:
```typescript
// TEMPORARY: Only use Orca Whirlpool pools
if (metadataA.dex !== 'ORCA' || metadataB.dex !== 'ORCA') continue;
```

**Solution needed**:
- Add routing logic to detect pool type from metadata
- Implement Raydium CLMM swap execution
- Implement Meteora DLMM swap execution
- Or use Jupiter Aggregator for all swaps

### 3. Free RPC Rate Limiting

**Problem**: The free Solana RPC has strict rate limits (50 requests/second). The bot needs:
- Initial price fetch: 16 pools × 2 vaults = 32 `getAccountInfo` calls
- Account subscriptions: 16 pools × 2 vaults = 32 `accountSubscribe` calls
- Total startup: ~64 requests

**Impact**: Slow startup (20-30 seconds) with many "429 Too Many Requests" errors.

**Solutions**:
1. **Get QuickNode MAINNET endpoint** (recommended for production)
2. Use alternative free RPC (Helius, Alchemy)
3. Further reduce batch size and increase delays (makes bot even slower)

## What Works Now ✅

- Bot connects to Solana mainnet
- Loads pool metadata correctly
- Subscribes to price updates (event-driven, no polling)
- Detects token decimals correctly
- Filters to only use Orca pools (temporarily)
- Finds "opportunities" (though prices are wrong)

## What Doesn't Work ❌

- **Price calculation is completely broken** for CLMM pools
- Calculated opportunities are false positives
- Cannot execute swaps on Raydium or Meteora pools
- Slow startup due to rate limits

## Next Steps to Fix

### Short Term (Quick Fixes)

1. **Use Orca SDK for price fetching**:
   ```typescript
   import { PriceMath } from '@orca-so/whirlpools-sdk';

   // For Orca pools:
   const whirlpool = await whirlpoolClient.getPool(poolAddress);
   const sqrtPrice = whirlpool.getData().sqrtPrice;
   const price = PriceMath.sqrtPriceX64ToPrice(sqrtPrice, decimalsA, decimalsB);
   ```

2. **Temporarily disable non-Orca pools** (already done)

3. **Get a paid RPC endpoint** for better performance

### Medium Term (Proper Solution)

1. **Implement proper CLMM price reading**:
   - Add pool state decoders for each DEX type
   - Read sqrtPrice from on-chain data
   - Convert to human-readable price

2. **Add swap routing**:
   - Detect DEX type from metadata
   - Route to appropriate executor (Orca/Raydium/Meteora)
   - Or integrate Jupiter Aggregator

3. **Optimize RPC usage**:
   - Cache prices longer
   - Use websocket subscriptions more efficiently
   - Batch requests where possible

### Long Term (Production Ready)

1. **Use Jupiter Aggregator** for all swaps
   - Handles all DEX types automatically
   - Finds best routes
   - Handles slippage properly

2. **Implement proper price oracles**
   - Use Pyth or Switchboard for reference prices
   - Validate calculated opportunities against oracle prices
   - Prevent false positives

3. **Add monitoring and alerts**
   - Track RPC usage and costs
   - Monitor profitability
   - Alert on errors or anomalies

## Test Commands

```bash
# Test price calculation (shows wrong prices):
npx ts-node test-price-calc.ts

# Check token mints in pool:
npx ts-node check-pool-tokens.ts

# Run bot (will find false opportunities):
npm run bot:optimized:live
```

## Conclusion

The bot's architecture is sound (event-driven, efficient, well-organized), but the core price calculation logic is fundamentally broken for CLMM pools. This must be fixed before the bot can trade profitably.

**Priority**: Fix price calculation FIRST, then worry about swap execution and RPC optimization.
