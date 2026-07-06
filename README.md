# Mag 7 Stock Desk

Mag 7 Stock Desk is a local web dashboard for monitoring the Magnificent 7 stocks:

- Apple (`AAPL`)
- Microsoft (`MSFT`)
- Alphabet (`GOOGL`)
- Amazon (`AMZN`)
- NVIDIA (`NVDA`)
- Meta (`META`)
- Tesla (`TSLA`)

The app combines market data, technical indicators, candlestick pattern checks, analyst target context, and scoped news headlines. It is designed as a decision-support dashboard, not as automated financial advice.

## Main Views

### Entry Analysis

Entry Analysis is the first tab and is intended to summarize whether the selected stock has a constructive setup.

It includes:

- A synced stock selector for the Mag 7 symbols.
- A `Setup Quality` score from `0` to `100`.
- Bias: bullish, neutral, bearish, or unavailable.
- Setup type, such as pullback, continuation, confirmation needed, or wait for repair.
- Entry zone.
- Invalidation level.
- Target price.
- Estimated risk/reward.
- Sentiment summary from news and analyst review text.
- A short explanation list showing the signals that affected the score.

The scoring is rule-based and uses:

- Price versus SMA 20 and SMA 50.
- SMA 20 versus SMA 50 trend structure.
- RSI 14.
- Volume ratio.
- 4-hour candlestick pattern confirmation.
- Analyst target upside/downside.
- News and analyst sentiment keywords.

### Technicals

Technicals contains the charting and indicator workspace for the selected stock.

It includes:

- Live price strip.
- Candlestick chart.
- Historical price chart.
- Candle interval controls: `5m`, `15m`, `30m`, and `4h`.
- Candle period controls: `1D`, `1W`, `3M`, `6M`, `1Y`, and `All`.
- Chart zoom and pan controls.
- Company profile fields.
- Market statistics.
- Technical indicators:
  - SMA 20
  - SMA 50
  - RSI 14
  - Volume ratio
  - Bullish/neutral/bearish signal
- Candlestick pattern analysis across multiple periods and intervals.

### News

News is scoped to the selected stock so it is clear which symbol is being reviewed.

It includes:

- Synced stock selector.
- Scope heading such as `Looking for GOOGL news and analyst reviews`.
- Analyst review cards.
- Analyst consensus target, low target, and high target where available.
- Firm/source review notes from analyst-related headlines.
- Google News headline feed for the selected stock.

## Data Sources

The app uses several data sources with fallback behavior:

- Alpaca market data, when `ALPACA_API_KEY` and `ALPACA_API_SECRET` are configured.
- Nasdaq public endpoints for market snapshot, historical data, and analyst target information.
- Yahoo Finance chart endpoints as a fallback for quote/history/candle data.
- Google News RSS for headlines and analyst-related news.

For market snapshots, the app prefers Alpaca when credentials are available. If Alpaca is not configured or temporarily unavailable, it tries Nasdaq and Yahoo public endpoints. If public providers rate-limit the request, the app preserves the last good snapshot where possible and can use cached candle data as a fallback instead of showing blank rows.

## Running Locally

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

If port `3000` is already in use, run on another port:

```bash
PORT=3001 npm start
```

## Optional Alpaca Configuration

Alpaca credentials are recommended because public finance endpoints can rate-limit.

Set these environment variables before starting the app:

```bash
export ALPACA_API_KEY="your_key"
export ALPACA_API_SECRET="your_secret"
npm start
```

Or run inline:

```bash
ALPACA_API_KEY="your_key" ALPACA_API_SECRET="your_secret" npm start
```

When configured, Alpaca is used first for market snapshots and detailed candle data. The `4h` candle interval maps to Alpaca `4Hour` bars.

## Refresh Behavior

Default refresh intervals:

- Market snapshot: every 60 seconds.
- News and analyst review data: every 10 minutes.

Override intervals:

```bash
REFRESH_MS=15000 NEWS_REFRESH_MS=600000 npm start
```

Other environment variables:

```bash
PORT=3000
FETCH_TIMEOUT_MS=12000
ALPACA_API_KEY=...
ALPACA_API_SECRET=...
```

## API Endpoints

### Health Check

```text
GET /health
```

Returns basic server status.

### Snapshot

```text
GET /api/snapshot
```

Returns:

- Loading state.
- Refresh timestamps.
- Errors, if any.
- Stock rows.
- News items.
- Analyst review items.
- Refresh interval metadata.

### Manual Refresh

```text
POST /api/refresh
```

Forces a fresh market snapshot and news refresh.

### Detailed Candles

```text
GET /api/candles?symbol=GOOGL&period=week&interval=4h
```

Supported periods:

- `day`
- `week`
- `threeMonth`
- `sixMonth`
- `oneYear`
- `all`

Supported intervals:

- `5m`
- `15m`
- `30m`
- `4h`

When Alpaca is configured, detailed candles use Alpaca first. Without Alpaca, Yahoo is used where possible. For `4h` Yahoo fallback, the app fetches `1h` candles and aggregates them into 4-hour candles.

## Interpreting Entry Analysis

Entry Analysis is a structured setup review. It is not a guarantee and should not be treated as a buy or sell instruction.

The `Setup Quality` score is a transparent rule-based score, not a z-score and not a machine-learning prediction. It starts at `50`, applies weighted adjustments, and clamps the final value between `0` and `100`.

Current scoring rules:

| Signal | Rule | Score impact |
| --- | --- | --- |
| Price vs SMA 20 | Price above SMA 20 | `+8` |
| Price vs SMA 20 | Price below SMA 20 | `-8` |
| Price vs SMA 50 | Price above SMA 50 | `+8` |
| Price vs SMA 50 | Price below SMA 50 | `-8` |
| Trend structure | SMA 20 above SMA 50 | `+7` |
| Trend structure | SMA 20 not above SMA 50 | `-7` |
| RSI 14 | RSI between 45 and 65 | `+8` |
| RSI 14 | RSI above 72 | `-8` |
| RSI 14 | RSI below 35 | `-4` |
| Volume | Volume ratio at or above 1.1x | `+5` |
| 4-hour candle pattern | Bullish pattern | `+10` |
| 4-hour candle pattern | Bearish pattern | `-10` |
| Sentiment | Positive news/analyst sentiment | `+8` |
| Sentiment | Negative news/analyst sentiment | `-8` |
| Analyst target | Target implies at least 8% upside | `+8` |
| Analyst target | Target implies 3% or more downside | `-8` |

The model uses these inputs:

- Trend confirmation.
- Momentum quality.
- Volume participation.
- 4-hour candle behavior.
- Analyst target upside/downside.
- News and analyst sentiment.

Score labels:

- `75-100`: `Strong`
- `60-74`: `Moderate`
- `45-59`: `Watch`
- `0-44`: `Avoid`

Bias labels:

- `Bullish`: score is `65` or higher.
- `Neutral`: score is between `41` and `64`.
- `Bearish`: score is `40` or lower.

`Invalidation` is the level where the setup should be considered weakened by the model. It is not a personalized stop-loss recommendation.

The rule-based model is used first because it is explainable, easy to debug, and does not require a large labeled training dataset. A future machine-learning model could be added later if the app stores historical setups and can validate that an ML model outperforms this rule-based baseline.

## Troubleshooting

### I see `429 Too Many Requests`

Public providers can rate-limit requests. Configure Alpaca credentials for more reliable market data. The app also caches recent data and preserves prior snapshots where possible.

### I see blank prices or `--`

This usually means no provider returned usable market snapshot data yet. Try:

1. Refreshing after a minute.
2. Confirming Alpaca environment variables are set.
3. Restarting the server after setting environment variables.
4. Checking `/health`.

### The 4-hour chart is empty locally

If Alpaca is not configured, the app uses public fallback providers. These can rate-limit. In an Alpaca-configured environment, the 4-hour chart should use Alpaca `4Hour` bars.

### News loads but technical data does not

News comes from Google News RSS and is independent from market-data providers. If news works but prices do not, the issue is likely with Alpaca/Nasdaq/Yahoo data access.

## Deployment

### Render

1. Push this project to GitHub.
2. Create a new Render Web Service.
3. Connect the GitHub repository.
4. Use the included `render.yaml` or configure:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

5. Add environment variables in Render:

```text
ALPACA_API_KEY
ALPACA_API_SECRET
```

6. Deploy and open the Render URL.

### Docker

Build:

```bash
docker build -t mag7-stock-desk .
```

Run:

```bash
docker run -p 3000:3000 \
  -e ALPACA_API_KEY="your_key" \
  -e ALPACA_API_SECRET="your_secret" \
  mag7-stock-desk
```

Open:

```text
http://localhost:3000
```

## Production Notes

- Keep the Node server running; the frontend depends on backend API routes.
- Static hosting alone is not enough because `/api/snapshot`, `/api/candles`, and `/api/refresh` require the Node server.
- Public finance endpoints may change, rate-limit, or block traffic.
- Alpaca credentials are strongly recommended for consistent candle and snapshot behavior.
- This app is for research and monitoring. It does not provide personalized financial advice.
