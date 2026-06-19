const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const REFRESH_MS = Number(process.env.REFRESH_MS || 60 * 1000);
const NEWS_REFRESH_MS = Number(process.env.NEWS_REFRESH_MS || 10 * 60 * 1000);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_API_SECRET = process.env.ALPACA_API_SECRET;
const MAX_ALPACA_PAGES = 25;
const PUBLIC_DIR = path.join(__dirname, "public");

const STOCKS = [
  { symbol: "AAPL", name: "Apple", sector: "Consumer Hardware", ceo: "Tim Cook", founded: "1976", headquarters: "Cupertino, California", employees: 164000 },
  { symbol: "MSFT", name: "Microsoft", sector: "Cloud & Software", ceo: "Satya Nadella", founded: "1975", headquarters: "Redmond, Washington", employees: 228000 },
  { symbol: "GOOGL", name: "Alphabet", sector: "Search & AI", ceo: "Sundar Pichai", founded: "2015", headquarters: "Mountain View, California", employees: 190820 },
  { symbol: "AMZN", name: "Amazon", sector: "Commerce & Cloud", ceo: "Andy Jassy", founded: "1994", headquarters: "Seattle, Washington", employees: 1551000 },
  { symbol: "NVDA", name: "NVIDIA", sector: "AI Semiconductors", ceo: "Jensen Huang", founded: "1993", headquarters: "Santa Clara, California", employees: 29600 },
  { symbol: "META", name: "Meta", sector: "Social & Ads", ceo: "Mark Zuckerberg", founded: "2004", headquarters: "Menlo Park, California", employees: 69329 },
  { symbol: "TSLA", name: "Tesla", sector: "EVs & Energy", ceo: "Elon Musk", founded: "2003", headquarters: "Austin, Texas", employees: 140473 }
];

const state = {
  loading: false,
  newsLoading: false,
  lastUpdated: null,
  lastNewsUpdated: null,
  nextRefresh: null,
  nextNewsRefresh: null,
  errors: [],
  candleCache: new Map(),
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

async function fetchYahooJson(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const finish = (error, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimeout);
      if (error) reject(error);
      else {
        try {
          resolve(JSON.parse(body));
        } catch (parseError) {
          reject(parseError);
        }
      }
    };
    const overallTimeout = setTimeout(() => {
      if (request) request.destroy();
      finish(new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`));
    }, FETCH_TIMEOUT_MS);

    request = https.request(new URL(url), {
      method: "GET",
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        "accept": "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          finish(new Error(`${response.statusCode} ${response.statusMessage}`));
          return;
        }
        finish(null, body);
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`));
    });
    request.on("error", finish);
    request.end();
  });
}

async function fetchAlpacaJson(url) {
  if (!ALPACA_API_KEY || !ALPACA_API_SECRET) {
    throw new Error("Alpaca credentials are not configured on this server");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const finish = (error, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimeout);
      if (error) reject(error);
      else {
        try {
          resolve(JSON.parse(body));
        } catch (parseError) {
          reject(parseError);
        }
      }
    };
    const overallTimeout = setTimeout(() => {
      if (request) request.destroy();
      finish(new Error(`Alpaca request timed out after ${FETCH_TIMEOUT_MS}ms`));
    }, FETCH_TIMEOUT_MS);

    request = https.request(new URL(url), {
      method: "GET",
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        "accept": "application/json",
        "APCA-API-KEY-ID": ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": ALPACA_API_SECRET
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          finish(new Error(`Alpaca ${response.statusCode} ${response.statusMessage}`));
          return;
        }
        finish(null, body);
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Alpaca request timed out after ${FETCH_TIMEOUT_MS}ms`));
    });
    request.on("error", finish);
    request.end();
  });
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

function compactHistory(rows, maxPoints = 260) {
  if (rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((row, index) => index % step === 0 || index === rows.length - 1);
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

function chartPoints(chartPayload) {
  return (chartPayload?.data?.chart || []).map((point, index) => {
    const price = parseNumber(point.y);
    if (!Number.isFinite(price)) return null;
    const rawTime = point.x || point.z || point.time || point.label || "";
    const parsedTime = Date.parse(rawTime);
    return {
      time: Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : rawTime || String(index + 1),
      price
    };
  }).filter(Boolean);
}

function buildCandles(points, bucketSize) {
  const candles = [];
  for (let index = 0; index < points.length; index += bucketSize) {
    const bucket = points.slice(index, index + bucketSize);
    if (!bucket.length) continue;
    const prices = bucket.map((point) => point.price);
    candles.push({
      time: bucket.at(-1).time,
      open: formatNumber(prices[0]),
      high: formatNumber(Math.max(...prices)),
      low: formatNumber(Math.min(...prices)),
      close: formatNumber(prices.at(-1))
    });
  }
  return candles.slice(-90);
}

function buildHistoricalRanges(historyRows) {
  const take = (count) => compactHistory(historyRows.slice(-count));
  return {
    day: take(2),
    week: take(7),
    threeMonth: take(63),
    sixMonth: take(126),
    oneYear: take(252),
    all: compactHistory(historyRows)
  };
}

function yahooRangeForPeriod(period) {
  const ranges = {
    week: "7d",
    threeMonth: "60d",
    sixMonth: "60d",
    oneYear: "60d",
    all: "60d"
  };
  return ranges[period] || "7d";
}

function alpacaStartForPeriod(period) {
  const days = {
    week: 7,
    threeMonth: 92,
    sixMonth: 184,
    oneYear: 366,
    all: 3650
  }[period] || 7;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function alpacaTimeframe(interval) {
  return {
    "5m": "5Min",
    "15m": "15Min",
    "30m": "30Min"
  }[interval];
}

function candleLimitNote(period, interval) {
  if (period === "week") return "";
  return `The requested ${periodLabel(period)} view is limited to the most recent 60 days for ${interval} candles by the public market data provider.`;
}

function periodLabel(period) {
  return {
    week: "1 week",
    threeMonth: "3 months",
    sixMonth: "6 months",
    oneYear: "1 year",
    all: "all time"
  }[period] || period;
}

function parseYahooCandles(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};

  return timestamps.map((timestamp, index) => ({
    time: new Date(timestamp * 1000).toISOString(),
    open: formatNumber(parseNumber(quote.open?.[index])),
    high: formatNumber(parseNumber(quote.high?.[index])),
    low: formatNumber(parseNumber(quote.low?.[index])),
    close: formatNumber(parseNumber(quote.close?.[index])),
    volume: parseNumber(quote.volume?.[index])
  })).filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
}

function parseAlpacaCandles(payload) {
  return (payload?.bars || []).map((bar) => ({
    time: bar.t,
    open: formatNumber(bar.o),
    high: formatNumber(bar.h),
    low: formatNumber(bar.l),
    close: formatNumber(bar.c),
    volume: parseNumber(bar.v)
  })).filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
}

function compactCandles(candles, maxPoints = 1600) {
  if (candles.length <= maxPoints) return candles;
  const groupSize = Math.ceil(candles.length / maxPoints);
  const compacted = [];
  for (let index = 0; index < candles.length; index += groupSize) {
    const group = candles.slice(index, index + groupSize);
    compacted.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((candle) => candle.high)),
      low: Math.min(...group.map((candle) => candle.low)),
      close: group.at(-1).close,
      volume: group.reduce((total, candle) => total + (candle.volume || 0), 0)
    });
  }
  return compacted;
}

async function fetchAlpacaCandles(symbol, period, interval) {
  const start = alpacaStartForPeriod(period);
  const end = new Date().toISOString();
  const timeframe = alpacaTimeframe(interval);
  const params = new URLSearchParams({
    timeframe,
    start,
    end,
    adjustment: "all",
    feed: "iex",
    limit: "10000",
    sort: "asc"
  });
  const candles = [];
  let pageToken;
  let pagesFetched = 0;

  do {
    if (pageToken) params.set("page_token", pageToken);
    const payload = await fetchAlpacaJson(`https://data.alpaca.markets/v2/stocks/${symbol}/bars?${params}`);
    candles.push(...parseAlpacaCandles(payload));
    pageToken = payload?.next_page_token;
    pagesFetched += 1;
  } while (pageToken && pagesFetched < MAX_ALPACA_PAGES);

  if (!candles.length) throw new Error("Alpaca returned no bars for this selection");

  const displayCandles = compactCandles(candles);
  const compacted = displayCandles.length !== candles.length;
  const notes = [];
  if (compacted) notes.push(`Displaying ${displayCandles.length.toLocaleString()} visual candles aggregated from ${candles.length.toLocaleString()} ${interval} bars.`);
  if (pageToken) notes.push(`The ${periodLabel(period)} request reached the ${MAX_ALPACA_PAGES}-page safety limit; choose a shorter period for every available bar.`);
  return {
    symbol,
    period,
    interval,
    effectiveRange: period,
    source: "Alpaca Market Data",
    note: notes.join(" "),
    candles: displayCandles
  };
}

async function fetchDetailedCandles(symbol, period, interval) {
  const stock = STOCKS.find((item) => item.symbol === symbol);
  if (!stock) throw new Error("Unsupported symbol");
  if (!["week", "threeMonth", "sixMonth", "oneYear", "all"].includes(period)) throw new Error("Unsupported period");
  if (!["5m", "15m", "30m"].includes(interval)) throw new Error("Unsupported interval");

  const range = yahooRangeForPeriod(period);
  const provider = ALPACA_API_KEY && ALPACA_API_SECRET ? "alpaca" : "yahoo";
  const cacheKey = `${provider}:${symbol}:${period}:${interval}:${range}`;
  const cached = state.candleCache.get(cacheKey);
  // Keep each request briefly cached so changing chart controls does not trip the free provider's rate limit.
  if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) {
    return cached.payload;
  }

  const response = provider === "alpaca"
    ? await fetchAlpacaCandles(symbol, period, interval)
    : await (async () => {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;
      const payload = await fetchYahooJson(url);
      const providerError = payload?.chart?.error?.description;
      if (providerError) throw new Error(providerError);
      return {
        symbol,
        period,
        interval,
        effectiveRange: range,
        source: "Yahoo Finance",
        note: candleLimitNote(period, interval),
        candles: parseYahooCandles(payload)
      };
    })();
  state.candleCache.set(cacheKey, { cachedAt: Date.now(), payload: response });
  return response;
}

function fallbackDetailedCandles(symbol, period, interval, reason) {
  const alpacaConfigured = Boolean(ALPACA_API_KEY && ALPACA_API_SECRET);
  const setupNote = alpacaConfigured
    ? "Alpaca could not return this selection right now."
    : "This local server does not have the Alpaca environment variables; it is using the public fallback source instead. The Render deployment will use Alpaca after the updated code is deployed.";
  return {
    symbol,
    period,
    interval,
    effectiveRange: null,
    note: `${periodLabel(period)} ${interval} candles are temporarily unavailable (${reason}). ${setupNote} The chart is left empty rather than showing data from a different time period.`,
    candles: []
  };
}

function sparkline(chartPayload, historyRows) {
  const values = chartPoints(chartPayload).map((point) => point.price);
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
  const start = new Date("1980-01-01T00:00:00Z");
  const [chartData, summaryData, historicalData] = await Promise.all([
    fetchJson(nasdaqUrl(stock.symbol, "chart")),
    fetchJson(nasdaqUrl(stock.symbol, "summary")),
    fetchJson(nasdaqUrl(stock.symbol, "historical", `fromdate=${dateForUrl(start)}&todate=${dateForUrl(today)}&limit=9999`))
  ]);

  const chart = chartData.data || {};
  const summary = summaryData.data?.summaryData || {};
  const historyRows = parseHistoricalRows(historicalData);
  const intradayPoints = chartPoints(chartData);
  const [dayHigh, dayLow] = parseRange(summary.TodayHighLow?.value);
  const [fiftyTwoWeekHigh, fiftyTwoWeekLow] = parseRange(summary.FiftTwoWeekHighLow?.value);
  const price = parseNumber(chart.lastSalePrice);
  const previousClose = parseNumber(chart.previousClose);
  const change = parseNumber(chart.netChange);
  const changePercent = parseNumber(chart.percentageChange);
  const open = parseNumber(summary.OpenPrice?.value || summary.Open?.value || historyRows.at(-1)?.open);
  const bid = parseNumber(summary.Bid?.value || summary.BidPrice?.value);
  const ask = parseNumber(summary.Ask?.value || summary.AskPrice?.value);
  const pe = parseNumber(summary.PERatio?.value || summary.PeRatio?.value || summary.PERatio?.value);
  const eps = parseNumber(summary.EPS?.value || summary.EarningsPerShare?.value);
  const dividendYield = parseNumber(summary.Yield?.value || summary.DividendYield?.value);
  const volume = parseNumber(chart.volume || summary.ShareVolume?.value);
  const averageVolume = parseNumber(summary.AverageVolume?.value);

  return {
    ...stock,
    price: formatNumber(price),
    change: formatNumber(change),
    changePercent: formatNumber(changePercent),
    marketCap: parseNumber(summary.MarketCap?.value),
    pe: formatNumber(pe),
    eps: formatNumber(eps),
    dividendYield: formatNumber(dividendYield),
    open: formatNumber(open),
    bid: formatNumber(bid),
    ask: formatNumber(ask),
    dayLow: formatNumber(dayLow),
    dayHigh: formatNumber(dayHigh),
    fiftyTwoWeekLow: formatNumber(fiftyTwoWeekLow),
    fiftyTwoWeekHigh: formatNumber(fiftyTwoWeekHigh),
    volume,
    averageVolume,
    exchange: summary.Exchange?.value || chart.exchange || "",
    marketState: chart.marketStatus || "",
    previousClose: formatNumber(previousClose),
    technicals: calculateTechnicals(historyRows),
    candles: {
      fiveMinute: buildCandles(intradayPoints, 5),
      fifteenMinute: buildCandles(intradayPoints, 15),
      thirtyMinute: buildCandles(intradayPoints, 30)
    },
    history: buildHistoricalRanges(historyRows),
    stats: {
      bid: formatNumber(bid),
      ask: formatNumber(ask),
      volume,
      averageVolume,
      open: formatNumber(open),
      dayHigh: formatNumber(dayHigh),
      dayLow: formatNumber(dayLow),
      marketCap: parseNumber(summary.MarketCap?.value),
      fiftyTwoWeekHigh: formatNumber(fiftyTwoWeekHigh),
      fiftyTwoWeekLow: formatNumber(fiftyTwoWeekLow),
      pe: formatNumber(pe),
      eps: formatNumber(eps),
      dividendYield: formatNumber(dividendYield),
      previousClose: formatNumber(previousClose)
    },
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
    const previousStockMap = new Map(state.stocks.map((stock) => [stock.symbol, stock]));
    const stockResults = await Promise.allSettled(STOCKS.map(fetchNasdaqStock));
    const stockRows = stockResults.map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      state.errors.push(`${STOCKS[index].symbol} market data: ${result.reason.message}`);
      return previousStockMap.get(STOCKS[index].symbol) || fallbackStock(STOCKS[index]);
    });

    state.stocks = stockRows;
    state.lastUpdated = new Date().toISOString();
    state.nextRefresh = new Date(Date.now() + REFRESH_MS).toISOString();
    await collectNews(false);
  } catch (error) {
    state.errors.push(`snapshot: ${error.message}`);
    if (!state.lastUpdated) {
      state.stocks = fallbackStocks();
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

async function collectNews(force = false) {
  if (state.newsLoading) return state.news;
  const shouldRefresh = force || !state.lastNewsUpdated || Date.now() >= Date.parse(state.nextNewsRefresh || 0);
  if (!shouldRefresh) return state.news;

  state.newsLoading = true;
  const previousNews = state.news;

  try {
    const newsResults = await Promise.allSettled(STOCKS.map(async (stock) => {
      const query = encodeURIComponent(`${stock.symbol} ${stock.name} stock when:7d`);
      const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
      const xml = await fetchText(url);
      return parseRss(xml, stock.symbol);
    }));

    let newsFailureCount = 0;
    const news = newsResults.flatMap((result, index) => {
      if (result.status === "rejected") {
        newsFailureCount += 1;
        state.errors.push(`${STOCKS[index].symbol} news: ${result.reason.message}`);
        return [];
      }
      return result.value;
    });

    const seen = new Set();
    const freshNews = news.filter((item) => {
      const key = `${item.title}:${item.link}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0)).slice(0, 40);
    state.news = newsFailureCount && previousNews.length ? previousNews : freshNews;
    state.lastNewsUpdated = new Date().toISOString();
    state.nextNewsRefresh = new Date(Date.now() + NEWS_REFRESH_MS).toISOString();
  } catch (error) {
    state.errors.push(`news: ${error.message}`);
    state.news = previousNews;
    if (!state.lastNewsUpdated) {
      state.lastNewsUpdated = new Date().toISOString();
    }
    state.nextNewsRefresh = new Date(Date.now() + NEWS_REFRESH_MS).toISOString();
  } finally {
    state.newsLoading = false;
  }

  return state.news;
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
    dividendYield: null,
    open: null,
    bid: null,
    ask: null,
    exchange: "",
    marketState: "",
    technicals: { sma20: null, sma50: null, rsi14: null, volumeRatio: null, signal: "Unavailable" },
    candles: { fiveMinute: [], fifteenMinute: [], thirtyMinute: [] },
    history: { day: [], week: [], threeMonth: [], sixMonth: [], oneYear: [], all: [] },
    stats: {},
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
    newsLoading: state.newsLoading,
    lastUpdated: state.lastUpdated,
    lastNewsUpdated: state.lastNewsUpdated,
    nextRefresh: state.nextRefresh,
    nextNewsRefresh: state.nextNewsRefresh,
    errors: state.errors,
    refreshIntervalMs: REFRESH_MS,
    newsRefreshIntervalMs: NEWS_REFRESH_MS,
    stocks: state.stocks,
    news: state.news
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/health") {
      json(res, 200, {
        ok: true,
        loading: state.loading,
        lastUpdated: state.lastUpdated
      });
      return;
    }

    if (requestUrl.pathname === "/api/snapshot") {
      if (!state.lastUpdated && !state.loading) {
        collectSnapshot().catch((error) => state.errors.push(error.message));
      }
      json(res, 200, serializableState());
      return;
    }

    if (requestUrl.pathname === "/api/candles") {
      const symbol = String(requestUrl.searchParams.get("symbol") || "").toUpperCase();
      const period = requestUrl.searchParams.get("period") || "week";
      const interval = requestUrl.searchParams.get("interval") || "5m";
      try {
        json(res, 200, await fetchDetailedCandles(symbol, period, interval));
      } catch (error) {
        json(res, 200, fallbackDetailedCandles(symbol, period, interval, error.message));
      }
      return;
    }

    if (requestUrl.pathname === "/api/refresh" && req.method === "POST") {
      await collectSnapshot();
      await collectNews(true);
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
  setInterval(() => collectNews(false), NEWS_REFRESH_MS);
});
