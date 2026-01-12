# Raydium-Orca Cross-DEX Arbitrage Bot

## Overview

This bot has been upgraded from Orca-to-Orca arbitrage to support **cross-DEX arbitrage** between **Raydium AMM** and **Orca Whirlpools**. It automatically detects profitable arbitrage opportunities across both DEXes and executes trades bidirectionally.

## Supported Pools

### Orca Whirlpools
1. **SOL/USDC 0.05% Orca** - Pool ID: `7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm`
   - Fee: 0.05% (0.0005)
   - Type: Orca Whirlpool

2. **SOL/USDC 0.01% Orca** - Pool ID: `83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d`
   - Fee: 0.01% (0.0001)
   - Type: Orca Whirlpool

### Raydium AMM
3. **SOL/USDC 0.04% Raydium** - Pool ID: `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`
   - Fee: 0.04% (0.0004)
   - Type: Raydium AMM
   - Vault A (SOL): `EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9`
   - Vault B (USDC): `2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP`

## Arbitrage Strategies

The bot now checks **6 possible arbitrage directions**:

### Orca-to-Orca (Original)
1. 0.05% Orca → 0.01% Orca (Total fees: 0.06%)
2. 0.01% Orca → 0.05% Orca (Total fees: 0.06%)

### Raydium-to-Orca (New)
3. Raydium → 0.05% Orca (Total fees: 0.09%)
4. Raydium → 0.01% Orca (Total fees: 0.05%)

### Orca-to-Raydium (New)
5. 0.05% Orca → Raydium (Total fees: 0.09%)
6. 0.01% Orca → Raydium (Total fees: 0.05%)

The scanner automatically selects the **most profitable direction** at any given time.

## Technical Changes

### New Files
- `RaydiumPriceFetcher.ts` - Fetches real-time prices from Raydium AMM vaults
- `RaydiumSwapExecutor.ts` - Handles Raydium swap execution (placeholder for full implementation)
- `RAYDIUM_INTEGRATION.md` - This documentation

### Modified Files

#### 1. `constants.ts`
- Added `PoolType` enum: `"orca" | "raydium"`
- Updated `PoolConfig` interface to include `type` field
- Added Raydium pool configuration with vault addresses
- Updated pool names to include DEX identifier (e.g., "SOL/USDC 0.05% Orca")

#### 2. `GrpcFastScanner.ts` (Main Scanner)
- **Pool Subscription Logic**: Now handles both Orca and Raydium pools
  - Orca: Subscribes to Whirlpool account directly
  - Raydium: Subscribes to both vault A (SOL) and vault B (USDC) separately
- **Price Fetching**: Different methods for each DEX type
  - Orca: Decodes sqrt price from Whirlpool account data
  - Raydium: Calculates price from vault balances (USDC/SOL)
- **Arbitrage Checking**: Now checks all possible pool pairs (3 pools = 6 directions)
- **Best Direction Selection**: Automatically picks most profitable opportunity across all DEXes

#### 3. `SignalManager.ts`
- Already dynamic - no changes needed
- Automatically maps pool names to addresses from `PREDEFINED_POOLS`
- Supports new Raydium pool names seamlessly

#### 4. `package.json`
- Updated name: `raydium-orca-arbitrage`
- Version bumped to 2.0.0
- Removed obsolete scanner scripts
- Simplified to single scanner + executor pattern

### Deleted Files (Cleanup)
Removed redundant/unused files to keep codebase clean:
- `Executor.ts` - Simple balance checker (superseded by SafetyChecker)
- `TestConnection.ts` - Test utility
- `TestRpcManager.ts` - Test utility
- `debug_quote.ts` - Debug script
- `Sky_O2O.py` - Legacy Python scanner
- `check-wallet-balance.ts` - Duplicate functionality
- `SimpleCsvLogger.ts` - Unused alternative logger
- `FastScanner.ts` - Legacy scanner
- `GrpcScanner.ts` - Legacy scanner
- `UltraFastGrpcScanner.ts` - Redundant HFT scanner
- `QuickNodeGrpcScanner.ts` - Redundant QuickNode scanner

## How It Works

### 1. Real-Time Price Monitoring

**Orca Pools:**
```typescript
// Subscribe to Whirlpool account
connection.onAccountChange(poolAddress, (accountInfo) => {
  const sqrtPriceX64 = decodeSqrtPrice(accountInfo.data);
  const price = sqrtPriceToPrice(sqrtPriceX64);
  // Check arbitrage opportunities
});
```

**Raydium Pools:**
```typescript
// Subscribe to both vaults
connection.onAccountChange(vaultA, (accountInfo) => {
  const solBalance = readTokenBalance(accountInfo.data);
  // Wait for USDC balance update
});

connection.onAccountChange(vaultB, (accountInfo) => {
  const usdcBalance = readTokenBalance(accountInfo.data);
  // Calculate price = USDC / SOL
  // Check arbitrage opportunities
});
```

### 2. Profit Calculation

For each pool pair, the bot calculates profit in both directions:

```
Direction: Buy on Pool A → Sell on Pool B
Cost per SOL = PriceA × (1 + FeeA)
Revenue per SOL = PriceB × (1 - FeeB)
Profit % = (Revenue - Cost) / Cost
```

Example:
- Raydium price: $124.50, fee: 0.04%
- Orca 0.01% price: $124.80, fee: 0.01%
- Buy cost: $124.50 × 1.0004 = $124.5498
- Sell revenue: $124.80 × 0.9999 = $124.7875
- Profit: $0.2377 / $124.5498 = **0.1908%** ✅

### 3. Signal Generation

When profit exceeds `MIN_PROFIT_THRESHOLD` (0.15%), the scanner writes a signal:

```json
{
  "base": "USDC",
  "direction": "SOL/USDC 0.04% Raydium -> SOL/USDC 0.01% Orca",
  "profit_pct": 0.1908,
  "trade_usdc": 100,
  "timestamp": 1736700000000
}
```

### 4. Execution (TODO)

The executor reads the signal and executes the arbitrage:

1. **Orca → Orca**: Uses existing `SwapExecutor.ts` (fully working)
2. **Raydium → Orca** or **Orca → Raydium**:
   - Orca swap: Uses `SwapExecutor.ts`
   - Raydium swap: Needs implementation in `RaydiumSwapExecutor.ts`

## Current Implementation Status

### ✅ Fully Implemented
- Pool configuration (Raydium + Orca)
- Real-time price monitoring for all 3 pools
- Cross-DEX profit calculation (all 6 directions)
- Signal generation with best direction selection
- Automatic pool type detection
- Clean codebase (removed 9 unused files)

### ⚠️ Partially Implemented
- `RaydiumSwapExecutor.ts` - Contains quote calculation but **swap execution is placeholder**
  - Quote calculation using constant product formula (x × y = k)
  - Price impact calculation
  - Actual transaction building needs Raydium SDK integration

### 🔨 TODO for Full Raydium Support
1. Implement actual Raydium swap transaction in `RaydiumSwapExecutor.ts`
2. Update `SwapExecutor.ts` to detect pool type and route to appropriate executor
3. Test Raydium swap execution on devnet
4. Add Raydium-specific safety checks
5. Update `DynamicProfitCalculator.ts` to handle Raydium fees correctly

## Installation & Setup

### Prerequisites
```bash
npm install
```

Dependencies automatically installed:
- `@raydium-io/raydium-sdk` (v1.3.1-beta.58)
- `@raydium-io/raydium-sdk-v2` (v0.2.32-alpha)

### Environment Variables

No changes needed to `.env` file. Existing configuration works.

### Running the Bot

```bash
# Start both scanner and executor
npm start

# Or run separately:
npm run scanner      # Price monitoring + signal generation
npm run executor:fast # Trade execution
```

## Monitoring

The scanner logs will now show all 3 pools:

```
[CHECK 42] [15.3s] [8.2 updates/s]
  SOL/USDC 0.05% Orca: $124.523456
  SOL/USDC 0.01% Orca: $124.801234
  SOL/USDC 0.04% Raydium: $124.650000
  Spread (Raydium vs Orca 0.01%): 0.1210%
  Best Direction: SOL/USDC 0.04% Raydium -> SOL/USDC 0.01% Orca (0.1908%)
```

## Safety Considerations

### Minimum Profit Thresholds
- `MIN_PROFIT_THRESHOLD`: 0.15% (accounts for fees + slippage)
- Cross-DEX trades have higher fees (up to 0.09%) vs Orca-Orca (0.06%)

### Slippage
- Raydium AMM may have different liquidity than Orca
- Monitor price impact carefully, especially for larger trades

### Gas Optimization
- Cross-DEX arbitrage requires 2 separate transactions (vs 1 atomic tx for Orca-Orca)
- Higher gas costs and execution risk

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    CROSS-DEX ARBITRAGE SYSTEM                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SCANNER (GrpcFastScanner.ts)                                  │
│  ├─ Orca 0.05% Pool ────► Whirlpool Account Subscription      │
│  ├─ Orca 0.01% Pool ────► Whirlpool Account Subscription      │
│  └─ Raydium 0.04% Pool ─► Vault A + Vault B Subscriptions     │
│                                                                 │
│  PRICE MONITORING                                              │
│  ├─ Orca: Decode sqrt price from account data                 │
│  └─ Raydium: Calculate USDC / SOL from vault balances         │
│                                                                 │
│  ARBITRAGE DETECTION (6 directions)                           │
│  ├─ Orca 0.05% ↔ Orca 0.01%                                   │
│  ├─ Orca 0.05% ↔ Raydium 0.04%                                │
│  └─ Orca 0.01% ↔ Raydium 0.04%                                │
│                                                                 │
│  SIGNAL GENERATION (signal.json)                              │
│  └─ Best direction with highest profit %                      │
│                                                                 │
│  EXECUTION (ArbitrageBot.ts / FastExecutor.ts)                │
│  ├─ Orca swaps: SwapExecutor.ts (✅ Working)                  │
│  └─ Raydium swaps: RaydiumSwapExecutor.ts (⚠️ TODO)          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Future Enhancements

1. **Full Raydium Execution**
   - Complete `RaydiumSwapExecutor.ts` transaction building
   - Integrate with Jito bundles for atomic cross-DEX execution

2. **More Pools**
   - Add more Raydium pools with different fee tiers
   - Support other DEXes (Jupiter, Meteora, etc.)

3. **Advanced Strategies**
   - Multi-hop arbitrage (3+ pools)
   - Flash loan integration for larger capital

4. **Performance**
   - Parallel price fetching
   - In-memory quote caching
   - Predictive profit calculation

## Troubleshooting

### "Raydium swap execution not yet implemented"
This is expected. The Raydium price monitoring works, but swap execution needs additional development.

### No Raydium prices appearing
1. Check vault addresses in `constants.ts`
2. Verify RPC connection has token account access
3. Check console for "Raydium vault A/B error" messages

### Lower profit than expected
Cross-DEX arbitrage has higher fees:
- Raydium fee: 0.04%
- Orca fee: 0.01% or 0.05%
- Total: 0.05% to 0.09% (vs 0.06% for Orca-Orca)

## Contact & Support

For issues or questions about the Raydium integration, check:
- Pool configurations in `constants.ts`
- Scanner logs for price updates
- Signal history in `signal_history.json`

## License

Same as original project.
