# Scanner Real-Time CSV Logging

## What Changed

The **scanner** now logs **EVERY price check** to CSV in real-time, not just profitable opportunities.

## How It Works

Every 2 seconds, when the scanner checks pool prices, it:

1. Fetches prices from both pools (0.01% and 0.05%)
2. Calculates spread and expected profit
3. **Logs the data to CSV immediately**
4. Displays on console
5. If profitable → writes signal.json for executor

## CSV Files Created

### Scanner Logs
**Location**: `./logs/scanner/trades_YYYY-MM-DD.csv`

This file contains **every price check**, including:
- Timestamp
- Current prices of both pools
- Spread (absolute and percentage)
- Expected profit percentage
- Whether it met the profit threshold
- Failure reason if not profitable

### Executor Logs
**Location**: `./logs/trades_YYYY-MM-DD.csv`

This file contains **only executed trades** (or attempted trades when signal.json is created).

## Example Scanner CSV Output

Every 2 seconds you'll see a new row:

```csv
Timestamp,DateTime,Signal Direction,Price 0.01% Pool,Price 0.05% Pool,Spread,Spread %,Expected Profit %,Trade Amount USDC,Safety Passed,Safety Errors,Safety Warnings,SOL Balance,USDC Balance,Executed,Dry Run,Swap1 Pool,Swap1 Success,Swap1 Amount In,Swap1 Amount Out,Swap1 Signature,Swap1 Error,Swap2 Pool,Swap2 Success,Swap2 Amount In,Swap2 Amount Out,Swap2 Signature,Swap2 Error,Actual Profit USDC,Actual Profit %,Failure Reason,Failure Stage
1735488245123,2025-12-29T12:30:45.123Z,SOL/USDC 0.05% [VERIFIED] -> SOL/USDC 0.01% [VERIFIED],242.123456,242.098765,0.024691,0.0102,-0.0089,480,false,,,0,0,false,true,,false,0,0,,,,,false,0,0,,,0,0,Below profit threshold,scanner
1735488247123,2025-12-29T12:30:47.123Z,SOL/USDC 0.05% [VERIFIED] -> SOL/USDC 0.01% [VERIFIED],242.134567,242.109876,0.024691,0.0102,-0.0087,480,false,,,0,0,false,true,,false,0,0,,,,,false,0,0,,,0,0,Below profit threshold,scanner
1735488249123,2025-12-29T12:30:49.123Z,SOL/USDC 0.01% [VERIFIED] -> SOL/USDC 0.05% [VERIFIED],242.145678,242.120987,0.024691,0.0102,0.0152,480,false,,,0,0,false,true,,false,0,0,,,,,false,0,0,,,0,0,,
```

## Console Output

The scanner will now show:

```
[gRPC] Price Update:
  SOL/USDC 0.05% [VERIFIED]: $242.123456
  SOL/USDC 0.01% [VERIFIED]: $242.098765
  Spread: 0.0102%
  Net Profit: -0.0089%
  [×] Not profitable (threshold: 0.0010%)
[CSV] Logged trade: FAILED - Below profit threshold
```

When profitable:

```
[gRPC] Price Update:
  SOL/USDC 0.05% [VERIFIED]: $242.123456
  SOL/USDC 0.01% [VERIFIED]: $242.098765
  Spread: 0.0102%
  Net Profit: 0.0152%
  [✓] PROFITABLE OPPORTUNITY DETECTED!
[CSV] Logged trade: FAILED -
[✓] Signal written to signal.json
```

## Understanding the Data

### When NOT Profitable
- `Expected Profit %`: Negative or below threshold
- `Failure Reason`: "Below profit threshold"
- `Failure Stage`: "scanner"
- `Executed`: false

### When Profitable
- `Expected Profit %`: Above threshold (0.0010%)
- `Failure Reason`: Empty (no failure)
- `Failure Stage`: Empty
- `Executed`: false (scanner doesn't execute, just signals)

## How to Use

1. **Start the scanner**: `npm run scanner:grpc`
2. **Watch the CSV file**: `./logs/scanner/trades_YYYY-MM-DD.csv`
3. **Analyze the data**: Import into Excel/Google Sheets

The CSV updates **every 2 seconds** with fresh market data!

## Data Analysis Ideas

With this real-time logging, you can:

1. **Track spread patterns** over time
2. **Identify peak trading hours** with best spreads
3. **Calculate average spreads** throughout the day
4. **Monitor pool price movements** and volatility
5. **Backtest** profit thresholds (what if threshold was lower?)
6. **Detect market anomalies** or unusual price movements

## File Size Management

At one entry every 2 seconds:
- **Per hour**: ~1,800 rows
- **Per day**: ~43,200 rows
- **File size**: ~5-10 MB per day

Files are created daily with date in filename, so they won't grow infinitely.

## Important Notes

- Scanner logs to: `./logs/scanner/`
- Executor logs to: `./logs/`
- Both use the same CSV format for consistency
- Old logs are never deleted automatically (manual cleanup needed)
- The scanner never executes trades, it only monitors and logs
