# CME Gold Futures Data Sources

This document catalogs available data endpoints for Gold futures (Product ID: 437) from CME Group.

## Core Data Endpoints

### 1. Volume & Open Interest (Daily)
**Endpoint:** `/CmeWS/mvc/Volume/Details/F/437/{YYYYMMDD}/P`
**Parameters:**
- `tradeDate={YYYYMMDD}`
- `pageSize=500`
- `isProtected`
- `_t={timestamp}`

**Usage:** Same as Silver (458). This is the primary data source for the Sankey diagram.
**Data:** Contract-level OI, volume, high/low OI for each trading day.

### 2. Settlements (Daily Prices)
**Endpoint:** `/CmeWS/mvc/Settlements/Futures/Settlements/437/FUT`
**Parameters:**
- `strategy=DEFAULT`
- `tradeDate={MM/DD/YYYY}` (note: different date format!)
- `pageSize=500`
- `isProtected`
- `_t={timestamp}`

**Usage:** Daily settlement prices, open, high, low, last, change, prior settle.
**Potential Use:** Price charts, settlement price overlays, price change indicators.

### 3. Available Trade Dates
**Endpoint:** `/CmeWS/mvc/Volume/TradeDates`
**Parameters:**
- `exchange=CBOT`
- `isProtected`
- `_t={timestamp}`

**Usage:** Get list of valid trading dates (excludes weekends/holidays).
**Potential Use:** Validate dates before fetching, build date picker.

### 4. Last 30 Days Totals
**Endpoint:** `/CmeWS/mvc/Volume/LastTotals/437`
**Parameters:**
- `days=30`
- `isProtected`
- `_t={timestamp}`

**Usage:** Aggregate totals for last N days.
**Potential Use:** Quick summary stats, trend indicators.

### 5. Real-time Quotes
**Endpoint:** `/CmeWS/mvc/quotes/v2/contracts-by-number`
**Method:** POST
**Body:** `{"productIds":["437"],"contractsNumber":[1],"type":"VOLUME","showQuarterly":[0]}`

**Usage:** Current/live price data.
**Potential Use:** Live price ticker, current market status.

### 6. Contract Specifications
**Endpoint:** `/CmeWS/mvc/ContractSpecs/List/productId/437`
**Parameters:**
- `isProtected`
- `_t={timestamp}`

**Usage:** Contract details (size, tick size, trading hours, etc.).
**Potential Use:** Reference information panel, contract details tooltip.

### 7. Margin Requirements
**Endpoint 1:** `/CmeWS/mvc/Margins/MarginsExchanges/OUTRIGHT`
**Endpoint 2:** `/CmeWS/mvc/Margins/OUTRIGHT`
**Parameters:**
- `clearingCode=GC`
- `sector=METALS`
- `exchange=CMX`
- `pageSize=12`
- `pageNumber=1`
- `sortField=exchange`
- `sortAsc=true`

**Usage:** Initial and maintenance margin requirements per contract.
**Potential Use:** Margin requirement chart/table, cost calculator.

### 8. Product Calendar
**Endpoint:** `/CmeWS/mvc/ProductCalendar/Future/437`
**Parameters:**
- `isProtected`
- `_t={timestamp}`

**Usage:** Contract expiration dates, first notice dates, last trading days.
**Potential Use:** Calendar view, expiration timeline, rollover alerts.

### 9. Volatility Index (CVOL)
**Endpoint:** `/services/cvol`
**Parameters:**
- `symbol=GCVL` (Gold) or `SIVL` (Silver)
- `isProtected`
- `_t={timestamp}`

**Usage:** Implied volatility index for Gold futures.
**Potential Use:** Volatility chart overlay, market sentiment indicator, risk gauge.
**Note:** Shows market's expectation of future price volatility.

## Long vs Short Positions

**Important:** CME Open Interest data does NOT distinguish between long and short positions.

- OI always represents matched pairs (1 long = 1 short)
- CME only publishes total open contracts
- For directional data, see CFTC Commitments of Traders (COT) reports:
  - Published weekly (Fridays, 3-day delay)
  - Breaks down by trader type (commercial, non-commercial, non-reportable)
  - Available at: https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm
  - Separate data source, would require different fetching infrastructure

## Implementation Priority

### Phase 1: Gold Sankey (Same as Silver)
- Use endpoint #1 (Volume & Open Interest)
- Reuse existing fetch/deploy infrastructure
- Create `./gold/` directory parallel to `./comex/`

### Phase 2: Enhanced Visualizations
**High Value Additions:**

1. **Settlement Price Chart**
   - Line chart showing daily settlement prices per contract
   - Overlay on Sankey or separate panel
   - Data: Endpoint #2

2. **Margin Requirements Timeline**
   - Show how margin requirements change over time
   - Useful for traders planning positions
   - Data: Endpoint #7

3. **Contract Expiration Calendar**
   - Visual timeline of upcoming expirations
   - Highlight rollover periods
   - Data: Endpoint #8

4. **Price vs OI Correlation**
   - Scatter plot or dual-axis chart
   - Show relationship between price movement and OI changes
   - Data: Endpoints #1 + #2

5. **Live Price Ticker**
   - Real-time price updates in header
   - Show current front-month contract price
   - Data: Endpoint #5

### Phase 3: Advanced Features

1. **Multi-Commodity Comparison**
   - Side-by-side Silver (458) vs Gold (437)
   - Ratio charts (Gold/Silver ratio)
   - Correlation analysis

2. **Historical Analysis**
   - Fetch and store longer history
   - Year-over-year comparisons
   - Seasonal patterns

## Technical Notes

### Key Differences from Silver
- Product ID: 437 (vs 458 for Silver)
- Exchange: CMX (vs COMEX for Silver, though they're the same)
- Clearing Code: GC (vs SI for Silver)
- Settlement endpoint uses different date format (MM/DD/YYYY vs YYYYMMDD)

### Cookie Requirements
All endpoints require browser cookies (same as Silver).
Server-side automation needs periodic cookie refresh.

### Data Freshness
- Volume/OI: Updated after market close (~5:00 PM CT)
- Settlements: Updated after settlement (~2:00 PM CT)
- Real-time quotes: Live during trading hours

## Recommended Next Steps

1. Create `./gold/` directory structure
2. Adapt fetch scripts for Gold (change product ID to 437)
3. Test data fetching for recent dates
4. Deploy Gold Sankey alongside Silver
5. Add settlement price mini-chart to both Silver and Gold pages
6. Implement margin requirements table
7. Add contract calendar view

## File Structure Proposal

```
./gold/
├── sankey.html          # Main Gold Sankey visualization
├── manifest.json        # List of data files
├── YYYY-MM-DD-data.json # Daily OI/Volume data
├── fetch.sh             # Fetch script (product ID 437)
├── deploy.sh            # Deploy to kesor.net/gold/
└── cleanup_empty.sh     # Remove non-trading days

./comex/                 # Keep existing Silver
./shared/                # Shared components (optional)
├── mini-charts.js       # Reusable chart components
└── styles.css           # Shared styles
```

## Data Schema Comparison

Both Silver and Gold use the same schema for Volume/OI endpoint:
```json
{
  "tradeDate": "YYYYMMDD",
  "monthData": [
    {
      "monthID": "MMM-YY",
      "atClose": "123456",
      "totalVolume": "78901",
      "highOI": "125000",
      "lowOI": "122000"
    }
  ]
}
```

This means the Sankey visualization code can be reused with minimal changes.
