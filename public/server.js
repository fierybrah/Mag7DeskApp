const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const REFRESH_MS = Number(process.env.REFRESH_MS || 60 * 60 * 1000);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
const PUBLIC_DIR = path.join(__dirname, "public");

const STOCKS = [
  { symbol: "AAPL", name: "Apple", sector: "Consumer Hardware" },
  { symbol: "MSFT", name: "Microsoft", sector: "Cloud & Software" },
  { symbol: "GOOGL", name: "Alphabet", sector: "Search & AI" },
  { symbol: "AMZN", name: "Amazon", sector: "Commerce & Cloud" },
  { symbol: "NVDA", name: "NVIDIA", sector: "AI Semiconductors" },
  { symbol: "META", name: "Meta", sector: "Social & Ads" },
  { symbol: "TSLA", name: "Tesla", sector: "EVs & Energy" }
];

const state = {
  loading: false,
  lastUpdated: null,
  nextRefresh: null,
  errors: [],
  stocks: [],
  news: []
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function serveFile(req, res) {
  const requested = req.url === "/" ? "/index.html" : decodeURIComponent(req.url);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";

    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
}

async function timedFetchText(url, accept) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimeout);
      reject(error);
    };
    const succeed = (body) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimeout);
      resolve(body);
    };
    const overallTimeout = setTimeout(() => {
      if (request) {
        request.destroy();
      }
      fail(new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`));
    }, FETCH_TIMEOUT_MS);

    request = https.request(new URL(url), {
      method: "GET",
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        "accept": accept,
        "origin": "https://www.nasdaq.com",
        "referer": "https://www.nasdaq.com/",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
      }
    }, (response) => {
      const chunks = [];

      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          fail(new Error(`${response.statusCode} ${response.statusMessage}`));
          return;
        }
        succeed(body);
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`));
    });
    request.on("error", fail);
    request.end();
  });
}

async function fetchJson(url) {
  const text = await timedFetchText(url, "application/json,text/plain,*/*");
  return JSON.parse(text);
}

async function fetchText(url) {
  return timedFetchText(url, "application/rss+xml,text/xml,text/plain,*/*");
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value || value === "N/A") return null;
  const normalized = String(value).replace(/[$,%]/g, "").replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateRsi(closes, period = 14) {
  const clean = closes.filter((value) => Number.isFinite(value));
  if (clean.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = clean.length - period; i < clean.length; i += 1) {
    const change = clean[i] - clean[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return formatNumber(100 - 100 / (1 + rs));
}

function calculateTechnicals(rows) {
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  const current = closes.filter(Number.isFinite).at(-1) ?? null;
  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));
  const volAvg = average(volumes.slice(-20));
  const latestVolume = volumes.filter(Number.isFinite).at(-1) ?? null;

  let signal = "Neutral";
  if (current && sma20 && sma50 && current > sma20 && sma20 > sma50) signal = "Bullish";
  if (current && sma20 && sma50 && current < sma20 && sma20 < sma50) signal = "Bearish";

  return {
    sma20: formatNumber(sma20),
    sma50: formatNumber(sma50),
    rsi14: calculateRsi(closes),
    volumeRatio: volAvg ? formatNumber(latestVolume / volAvg) : null,
    signal
  };
}

function parseRange(value) {
  const matches = String(value || "").match(/\$?([\d,.]+)\s*[-/]\s*\$?([\d,.]+)/);
  if (!matches) return [null, null];
  return [parseNumber(matches[1]), parseNumber(matches[2])];
}

function parseHistoricalRows(payload) {
  const rows = payload?.data?.tradesTable?.rows || [];
  return rows.map((row) => ({
    date: row.date,
    close: parseNumber(row.close),
    volume: parseNumber(row.volume),
    open: parseNumber(row.open),
    high: parseNumber(row.high),
    low: parseNumber(row.low)
  })).filter((row) => Number.isFinite(row.close)).reverse();
}

function sparkline(chartPayload, historyRows) {
  const intraday = chartPayload?.data?.chart || [];
  const values = intraday.map((point) => parseNumber(point.y)).filter(Number.isFinite);
  if (values.length) {
    return values.slice(-80).map((value) => formatNumber(value));
  }
  return historyRows.map((row) => row.close).filter(Number.isFinite).slice(-48).map((value) => formatNumber(value));
}

function parseRss(xml, symbol) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8);
  return items.map((match) => {
    const item = match[1];
    const get = (tag) => {
      const value = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "";
      return value
        .replace(/<!\[CDATA\[/g, "")
        .replace(/\]\]>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/<[^>]+>/g, "")
        .trim();
    };

    return {
      symbol,
      title: get("title"),
      link: get("link"),
      source: get("source") || "Google News",
      published: get("pubDate")
    };
  }).filter((item) => item.title && item.link);
}

function dateForUrl(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nasdaqUrl(symbol, endpoint, params = "") {
  const suffix = params ? `&${params}` : "";
  return `https://api.nasdaq.com/api/quote/${symbol}/${endpoint}?assetclass=stocks${suffix}`;
}

async function fetchNasdaqStock(stock) {
  const today = new Date();
  const start = new Date(Date.now() - 110 * 24 * 60 * 60 * 1000);
  const [chartData, summaryData, historicalData] = await Promise.all([
    fetchJson(nasdaqUrl(stock.symbol, "chart")),
    fetchJson(nasdaqUrl(stock.symbol, "summary")),
    fetchJson(nasdaqUrl(stock.symbol, "historical", `fromdate=${dateForUrl(start)}&todate=${dateForUrl(today)}&limit=9999`))
  ]);

  const chart = chartData.data || {};
  const summary = summaryData.data?.summaryData || {};
  const historyRows = parseHistoricalRows(historicalData);
  const [dayHigh, dayLow] = parseRange(summary.TodayHighLow?.value);
  const [fiftyTwoWeekHigh, fiftyTwoWeekLow] = parseRange(summary.FiftTwoWeekHighLow?.value);
  const price = parseNumber(chart.lastSalePrice);
  const previousClose = parseNumber(chart.previousClose);
  const change = parseNumber(chart.netChange);
  const changePercent = parseNumber(chart.percentageChange);

  return {
    ...stock,
    price: formatNumber(price),
    change: formatNumber(change),
    changePercent: formatNumber(changePercent),
    marketCap: parseNumber(summary.MarketCap?.value),
    pe: null,
    eps: null,
    dayLow: formatNumber(dayLow),
    dayHigh: formatNumber(dayHigh),
    fiftyTwoWeekLow: formatNumber(fiftyTwoWeekLow),
    fiftyTwoWeekHigh: formatNumber(fiftyTwoWeekHigh),
    volume: parseNumber(chart.volume || summary.ShareVolume?.value),
    averageVolume: parseNumber(summary.AverageVolume?.value),
    exchange: summary.Exchange?.value || chart.exchange || "",
    marketState: chart.marketStatus || "",
    previousClose: formatNumber(previousClose),
    technicals: calculateTechnicals(historyRows),
    series: sparkline(chartData, historyRows),
    source: "Nasdaq"
  };
}

async function collectSnapshot() {
  if (state.loading) return state;

  state.loading = true;
  const refreshId = Date.now();
  state.refreshId = refreshId;
  const watchdog = setTimeout(() => {
    if (state.loading && state.refreshId === refreshId) {
      state.errors.push(`refresh: timed out after ${FETCH_TIMEOUT_MS + 3000}ms`);
      if (!state.lastUpdated) {
        state.stocks = fallbackStocks();
        state.news = [];
      }
      state.loading = false;
      state.lastUpdated = new Date().toISOString();
      state.nextRefresh = new Date(Date.now() + REFRESH_MS).toISOString();
    }
  }, FETCH_TIMEOUT_MS + 3000);
  state.errors = [];

  try {
    const stockResults = await Promise.allSettled(STOCKS.map(fetchNasdaqStock));
    const stockRows = stockResults.map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      state.errors.push(`${STOCKS[index].symbol} market data: ${result.reason.message}`);
      return fallbackStock(STOCKS[index]);
    });

    const newsResults = await Promise.allSettled(STOCKS.map(async (stock) => {
      const query = encodeURIComponent(`${stock.symbol} ${stock.name} stock when:7d`);
      const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
      const xml = await fetchText(url);
      return parseRss(xml, stock.symbol);
    }));

    const news = newsResults.flatMap((result, index) => {
      if (result.status === "rejected") {
        state.errors.push(`${STOCKS[index].symbol} news: ${result.reason.message}`);
        return [];
      }
      return result.value;
    });

    const seen = new Set();
    state.stocks = stockRows;
    state.news = news.filter((item) => {
      const key = `${item.title}:${item.link}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0)).slice(0, 40);
    state.lastUpdated = new Date().toISOString();
    state.nextRefresh = new Date(Date.now() + REFRESH_MS).toISOString();
  } catch (error) {
    state.errors.push(`snapshot: ${error.message}`);
    if (!state.lastUpdated) {
      state.stocks = fallbackStocks();
      state.news = [];
    }
    state.lastUpdated = new Date().toISOString();
    state.nextRefresh = new Date(Date.now() + REFRESH_MS).toISOString();
  } finally {
    clearTimeout(watchdog);
    if (state.refreshId === refreshId) {
      state.loading = false;
    }
  }

  return state;
}

function fallbackStocks() {
  return STOCKS.map(fallbackStock);
}

function fallbackStock(stock) {
  return {
    ...stock,
    price: null,
    change: null,
    changePercent: null,
    marketCap: null,
    pe: null,
    eps: null,
    dayLow: null,
    dayHigh: null,
    fiftyTwoWeekLow: null,
    fiftyTwoWeekHigh: null,
    volume: null,
    averageVolume: null,
    exchange: "",
    marketState: "",
    technicals: { sma20: null, sma50: null, rsi14: null, volumeRatio: null, signal: "Unavailable" },
    series: []
  };
}

function serializableState() {
  if (state.loading && (!state.refreshId || Date.now() - state.refreshId > FETCH_TIMEOUT_MS + 3000)) {
    state.errors.push(`refresh: timed out after ${FETCH_TIMEOUT_MS + 3000}ms`);
    if (!state.lastUpdated) {
      state.stocks = fallbackStocks();
      state.news = [];
    }
    state.loading = false;
    state.lastUpdated = new Date().toISOString();
    state.nextRefresh = new Date(Date.now() + REFRESH_MS).toISOString();
  }

  return {
    loading: state.loading,
    lastUpdated: state.lastUpdated,
    nextRefresh: state.nextRefresh,
    errors: state.errors,
    refreshIntervalMs: REFRESH_MS,
    stocks: state.stocks,
    news: state.news
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      json(res, 200, {
        ok: true,
        loading: state.loading,
        lastUpdated: state.lastUpdated
      });
      return;
    }

    if (req.url === "/api/snapshot") {
      if (!state.lastUpdated && !state.loading) {
        collectSnapshot().catch((error) => state.errors.push(error.message));
      }
      json(res, 200, serializableState());
      return;
    }

    if (req.url === "/api/refresh" && req.method === "POST") {
      await collectSnapshot();
      json(res, 200, serializableState());
      return;
    }

    serveFile(req, res);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Mag 7 monitor running at http://localhost:${PORT}`);
  collectSnapshot();
  setInterval(collectSnapshot, REFRESH_MS);
});
