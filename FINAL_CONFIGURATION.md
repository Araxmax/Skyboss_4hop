# Final Configuration: Raydium-Orca Arbitrage Bot

## ✅ Configuration Complete

Your bot is now configured for **Raydium ↔ Orca arbitrage** with exactly 2 pools as requested.

## Active Pools

### Pool 1: Orca Whirlpool
- **Name:** SOL/USDC 0.04% Orca
- **Pool ID:** `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`
- **Fee:** 0.04% (0.0004)
- **Type:** Orca Whirlpool
- **Vault A (SOL):** `EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9`
- **Vault B (USDC):** `2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP`

### Raydium Pool
2. **SOL/USDC Raydium** - Pool ID: `58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2`
   - Fee: 0.25% (0.0025)
   - Vault A (SOL/WSOL): `DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz`
   - Vault B (USDC): `HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz`

## Configuration Summary

### Final Setup:
- **2 Pools Total**: 1 Orca + 1 Raydium
- **2 Arbitrage Directions**: Orca ↔ Raydium (both ways)
- **Total Fees**: 0.04% (Orca) + 0.25% (Raydium) = 0.29%
- **Min Profit Threshold**: 0.35% (adjusted for higher fees)

### Pool Configuration:

**Pool 1: Orca Whirlpool**
- Pool ID: `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`
- Fee: 0.04%
- Vault A (SOL): `EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9`
- Vault B (USDC): `2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP`

**Raydium Pool:**
- Pool ID: `58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2`
- Fee: 0.25% (0.0025)
- Vault A (SOL): `DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz`
- Vault B (USDC): `HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz`

## ✅ Configuration Complete!

Your bot is now configured for **Raydium-to-Orca arbitrage** with only 2 pools:

### Pools Configured
1. **Orca SOL/USDC 0.04%** - `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`
2. **Raydium SOL/USDC 0.25%** - `58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2`

### Configuration Summary:
- **2 pools** (1 Orca + 1 Raydium)
- **2 arbitrage directions** (Orca → Raydium and Raydium → Orca)
- **Total fees:** 0.29% (0.04% Orca + 0.25% Raydium)
- **Minimum profit threshold:** 0.35% (adjusted for higher fees)

### To Run:
```bash
npm run hft
```

This will start both the HFT scanner and the fast executor in parallel!

The bot will now monitor only:
- **Orca Pool**: `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE` (0.04% fee)
- **Raydium Pool**: `58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2` (0.25% fee)

And check arbitrage in both directions:
1. Orca → Raydium
2. Raydium → Orca

Ready to run with `npm run hft`! 🚀