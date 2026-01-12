# CSV Format Specification

## File Format
**Filename:** `logs/Ultrascanner_YYYY-MM-DD.csv`

## Headers (Exact Format)
```
Sl No.,Timestamp,Radiyum Prc,Orca prc,Spread_USD,Spread_PCT,Net Profit,Trade Possible,Failure Reason
```

## Column Descriptions

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| **Sl No.** | Integer | Sequential scan number | 1, 2, 3... |
| **Timestamp** | ISO 8601 | Date and time of scan | 2026-01-12T10:30:45.123Z |
| **Radiyum Prc** | Float (6 decimals) | Raydium pool price in USD | 124.650000 |
| **Orca prc** | Float (6 decimals) | Orca pool price in USD | 124.523456 |
| **Spread_USD** | Float (6 decimals) | Price difference in USD | 0.126544 |
| **Spread_PCT** | Float (4 decimals) | Price spread as % | 0.1015 |
| **Net Profit** | Float (4 decimals) | Best profit % after fees | 0.1234 |
| **Trade Possible** | YES/NO | Whether trade is profitable | YES or NO |
| **Failure Reason** | String | Why trade failed (empty if YES) | Profit 0.1234% below threshold 0.35% |

## Sample Data

```csv
Sl No.,Timestamp,Radiyum Prc,Orca prc,Spread_USD,Spread_PCT,Net Profit,Trade Possible,Failure Reason
1,2026-01-12T10:30:45.123Z,124.650000,124.523456,0.126544,0.1015,0.1234,NO,Profit 0.1234% below threshold 0.35%
2,2026-01-12T10:30:45.234Z,124.655000,124.530000,0.125000,0.1004,0.1150,NO,Profit 0.1150% below threshold 0.35%
3,2026-01-12T10:30:45.345Z,124.900000,124.540000,0.360000,0.2891,0.4567,YES,
4,2026-01-12T10:30:45.456Z,124.895000,124.545000,0.350000,0.2810,0.4123,YES,
5,2026-01-12T10:30:45.567Z,124.600000,124.550000,0.050000,0.0401,0.0234,NO,Profit 0.0234% below threshold 0.35%
```

## Notes

1. **Timestamp Format:** ISO 8601 with milliseconds (YYYY-MM-DDTHH:mm:ss.sssZ)
2. **Decimal Precision:**
   - Prices: 6 decimal places
   - Percentages: 4 decimal places
3. **Trade Possible:** Always "YES" or "NO" (no other values)
4. **Failure Reason:** Empty string when Trade Possible = YES
5. **Net Profit:** Always the BEST profit between both directions (Orca→Raydium or Raydium→Orca)

## Calculation Details

### Spread_USD
```
Spread_USD = |Raydium Price - Orca Price|
```

### Spread_PCT
```
Spread_PCT = (Spread_USD / MIN(Raydium Price, Orca Price)) × 100
```

### Net Profit
```
Direction 1 (Orca → Raydium):
  Cost = Orca Price × (1 + 0.0004)  [0.04% fee]
  Revenue = Raydium Price × (1 - 0.0025)  [0.25% fee]
  Profit_1 = ((Revenue - Cost) / Cost) × 100

Direction 2 (Raydium → Orca):
  Cost = Raydium Price × (1 + 0.0025)
  Revenue = Orca Price × (1 - 0.0004)
  Profit_2 = ((Revenue - Cost) / Cost) × 100

Net Profit = MAX(Profit_1, Profit_2)
```

### Trade Possible
```
Trade Possible = "YES" if Net Profit > 0.35%
Trade Possible = "NO" if Net Profit ≤ 0.35%
```

## Import Examples

### Python (Pandas)
```python
import pandas as pd

df = pd.read_csv('logs/Ultrascanner_2026-01-12.csv')
print(df.head())

# Filter tradable opportunities
tradable = df[df['Trade Possible'] == 'YES']
print(f"Tradable scans: {len(tradable)}")
```

### Excel
1. Open Excel
2. Data → Get Data → From File → From Text/CSV
3. Select the CSV file
4. Click "Load"

### Google Sheets
1. File → Import
2. Upload the CSV file
3. Select "Replace spreadsheet"
4. Click "Import data"

## File Rotation
- New file created at midnight (00:00) each day
- Files are never deleted automatically
- Previous days' files are preserved with their dates
