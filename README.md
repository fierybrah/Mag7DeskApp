# Mag 7 Stock Monitor

A local dashboard that monitors the Magnificent 7 stocks on a near real-time cadence:

- Apple (`AAPL`)
- Microsoft (`MSFT`)
- Alphabet (`GOOGL`)
- Amazon (`AMZN`)
- NVIDIA (`NVDA`)
- Meta (`META`)
- Tesla (`TSLA`)

It tracks live quote fields, market cap, day range, 52-week range, volume, Google News headlines, and technicals including SMA 20, SMA 50, RSI 14, volume ratio, and a simple bullish/neutral/bearish signal.

## Run

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

The server refreshes its snapshot every 60 seconds. You can override the port or interval:

```bash
PORT=4000 REFRESH_MS=15000 npm start
```

## Data Sources

The app fetches quote, chart, summary, and historical data from Nasdaq public endpoints. It fetches headline RSS data from Google News. These public endpoints can occasionally rate-limit or change behavior; the dashboard keeps running and shows a warning if any live feed cannot be loaded.

## Share Publicly

`localhost:3000` only works on your own computer. To share the app with other people, deploy this project to a public web host.

### Recommended: Render

1. Push this folder to a GitHub repository.
2. Go to [Render](https://render.com) and create a new Web Service.
3. Connect the GitHub repository.
4. Render can detect `render.yaml`; otherwise use:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

5. After deploy, Render gives you a public URL like:

```text
https://mag7-stock-monitor.onrender.com
```

That URL is what you can share.

### Docker Hosts

You can also deploy anywhere that runs Docker:

```bash
docker build -t mag7-stock-monitor .
docker run -p 3000:3000 mag7-stock-monitor
```

For a real public deployment, run the container on a cloud host such as Fly.io, Railway, Render, AWS, Google Cloud, or Azure.

## Production Notes

- Keep the Node server running publicly; the frontend depends on `/api/snapshot`.
- Static hosts like GitHub Pages alone are not enough because they cannot run the backend API.
- Public finance endpoints may rate-limit high traffic. For a large audience or true tick-by-tick real-time quotes, replace the public Nasdaq/Google News fetches with a paid streaming market data API and server-side caching.
