const state = {
  data: null,
  view: "entry",
  technicalSymbol: "GOOGL",
  candlePeriod: "week",
  candleInterval: "5m",
  candleZoom: 1,
  candlePan: 0,
  historyRange: "day",
  candleData: {},
  candleLoadingKeys: new Set(),
  chartMeta: {
    candle: [],
    history: []
  },
  refreshTimer: null
};

const els = {
  refreshBtn: document.querySelector("#refreshBtn"),
  marketStatus: document.querySelector("#marketStatus"),
  entryStockStrip: document.querySelector("#entryStockStrip"),
  entryAnalysis: document.querySelector("#entryAnalysis"),
  priceStrip: document.querySelector("#priceStrip"),
  newsStockStrip: document.querySelector("#newsStockStrip"),
  selectedSignalHint: document.querySelector("#selectedSignalHint"),
  candleTitle: document.querySelector("#candleTitle"),
  historyTitle: document.querySelector("#historyTitle"),
  statsTitle: document.querySelector("#statsTitle"),
  candleChart: document.querySelector("#candleChart"),
  candleZoomIn: document.querySelector("#candleZoomIn"),
  candleZoomOut: document.querySelector("#candleZoomOut"),
  candleZoomReset: document.querySelector("#candleZoomReset"),
  candlePanEarlier: document.querySelector("#candlePanEarlier"),
  candlePanLater: document.querySelector("#candlePanLater"),
  historyChart: document.querySelector("#historyChart"),
  candleReadout: document.querySelector("#candleReadout"),
  candleAnalysis: document.querySelector("#candleAnalysis"),
  historyReadout: document.querySelector("#historyReadout"),
  profileGrid: document.querySelector("#profileGrid"),
  statsGrid: document.querySelector("#statsGrid"),
  analystReviews: document.querySelector("#analystReviews"),
  newsList: document.querySelector("#newsList"),
  errorPanel: document.querySelector("#errorPanel"),
};

function money(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 1000 ? 0 : 2
  }).format(value);
}

function compact(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

function percent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function number(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function plainNumber(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function titleCase(value) {
  return String(value || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function dateTime(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function filteredStocks() {
  return state.data?.stocks || [];
}

function candleKey(symbol = state.technicalSymbol, period = state.candlePeriod, interval = state.candleInterval) {
  return `${symbol}:${period}:${interval}`;
}

async function loadDetailedCandles(symbol, period = state.candlePeriod, interval = state.candleInterval) {
  const key = candleKey(symbol, period, interval);
  if (state.candleData[key] || state.candleLoadingKeys.has(key)) return;

  state.candleLoadingKeys.add(key);
  try {
    const params = new URLSearchParams({
      symbol,
      period,
      interval
    });
    const response = await fetch(`/api/candles?${params}`);
    if (!response.ok) throw new Error(`Candles failed with ${response.status}`);
    state.candleData[key] = await response.json();
  } catch (error) {
    state.candleData[key] = {
      symbol,
      period,
      interval,
      note: error.message,
      candles: []
    };
  } finally {
    state.candleLoadingKeys.delete(key);
    if (symbol === state.technicalSymbol) {
      renderTechnicalWorkspace();
      renderEntryAnalysis();
    }
  }
}

function drawSparkline(canvas, values, positive) {
  const ctx = canvas.getContext("2d");
  const scale = window.devicePixelRatio || 1;
  const width = canvas.clientWidth * scale;
  const height = canvas.clientHeight * scale;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);

  if (!values.length) {
    ctx.fillStyle = "#eef1ee";
    ctx.fillRect(0, height / 2 - 1, width, 2);
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => ({
    x: (index / Math.max(values.length - 1, 1)) * width,
    y: height - ((value - min) / range) * (height - 8) - 4
  }));

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, positive ? "rgba(20, 122, 84, 0.22)" : "rgba(179, 58, 58, 0.2)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.beginPath();
  ctx.moveTo(points[0].x, height);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points.at(-1).x, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineWidth = 2.5 * scale;
  ctx.lineCap = "round";
  ctx.strokeStyle = positive ? "#147a54" : "#b33a3a";
  ctx.stroke();
}

function setupCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const scale = window.devicePixelRatio || 1;
  const width = canvas.clientWidth * scale;
  const height = canvas.clientHeight * scale;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  return { ctx, scale, width, height };
}

function drawEmptyChart(canvas, message) {
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.fillStyle = "#647174";
  ctx.font = "14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function chartScale(values, top, bottom) {
  const valid = values.filter(Number.isFinite);
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  return {
    min,
    max,
    yFor: (value) => bottom - ((value - min) / range) * (bottom - top)
  };
}

function shortPrice(value) {
  if (!Number.isFinite(value)) return "--";
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}`;
}

function parseChartDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const match = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  return new Date(year, Number(match[1]) - 1, Number(match[2]));
}

function formatChartTime(value, mode = "date") {
  const parsed = parseChartDate(value);
  if (!parsed) return String(value || "--");
  const options = mode === "time"
    ? { hour: "numeric", minute: "2-digit" }
    : mode === "dateTime"
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat("en-US", options).format(parsed);
}

function formatAxisDate(value, range) {
  const parsed = parseChartDate(value);
  if (!parsed) return String(value || "");
  const options = range === "intraday"
    ? { hour: "numeric", minute: "2-digit" }
    : range === "day"
    ? { month: "short", day: "numeric" }
    : range === "all" || range === "oneYear" || range === "sixMonth"
      ? { month: "short", year: "2-digit" }
      : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", options).format(parsed);
}

function drawAxes(ctx, scale, width, height, values, labels, range = "day") {
  const plot = {
    left: 58 * scale,
    right: width - 14 * scale,
    top: 16 * scale,
    bottom: height - 34 * scale
  };
  const yScale = chartScale(values, plot.top, plot.bottom);

  ctx.strokeStyle = "#d9dfd5";
  ctx.fillStyle = "#647174";
  ctx.lineWidth = scale;
  ctx.font = `${11 * scale}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";

  for (let index = 0; index < 4; index += 1) {
    const ratio = index / 3;
    const y = plot.top + (plot.bottom - plot.top) * ratio;
    const value = yScale.max - (yScale.max - yScale.min) * ratio;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
    ctx.fillText(shortPrice(value), plot.left - 8 * scale, y);
  }

  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  const labelIndexes = labels.length <= 2
    ? labels.map((_, index) => index)
    : [0, Math.floor((labels.length - 1) / 2), labels.length - 1];
  labelIndexes.forEach((index) => {
    const x = plot.left + (index / Math.max(labels.length - 1, 1)) * (plot.right - plot.left);
    ctx.fillText(formatAxisDate(labels[index], range), x, plot.bottom + 10 * scale);
  });

  ctx.save();
  ctx.translate(13 * scale, plot.top + (plot.bottom - plot.top) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Price", 0, 0);
  ctx.restore();

  return { plot, yScale };
}

function drawCandles(canvas, candles, range = "day", emptyMessage) {
  if (!candles?.length) {
    drawEmptyChart(canvas, emptyMessage || "No detailed candles are available for this selection.");
    state.chartMeta.candle = [];
    return;
  }

  const { ctx, scale, width, height } = setupCanvas(canvas);
  const values = candles.flatMap((candle) => [candle.open, candle.high, candle.low, candle.close]);
  const { plot, yScale } = drawAxes(ctx, scale, width, height, values, candles.map((candle) => candle.time || candle.date), range);
  const candleWidth = Math.max(4 * scale, (plot.right - plot.left) / candles.length * 0.56);
  const meta = [];

  candles.forEach((candle, index) => {
    const x = plot.left + (index / Math.max(candles.length - 1, 1)) * (plot.right - plot.left);
    const openY = yScale.yFor(candle.open);
    const closeY = yScale.yFor(candle.close);
    const highY = yScale.yFor(candle.high);
    const lowY = yScale.yFor(candle.low);
    const positive = candle.close >= candle.open;
    ctx.strokeStyle = positive ? "#147a54" : "#b33a3a";
    ctx.fillStyle = positive ? "rgba(20, 122, 84, 0.18)" : "rgba(179, 58, 58, 0.16)";

    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    ctx.fillRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(2 * scale, Math.abs(closeY - openY)));
    ctx.strokeRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(2 * scale, Math.abs(closeY - openY)));
    meta.push({ x: x / scale, y: closeY / scale, item: candle });
  });
  state.chartMeta.candle = meta;
}

function candleViewport(candles) {
  if (!candles?.length) return { candles: [], count: 0, pan: 0, maxPan: 0 };
  const count = Math.max(12, Math.ceil(candles.length / state.candleZoom));
  const maxPan = Math.max(0, candles.length - count);
  const pan = Math.min(Math.max(state.candlePan, 0), maxPan);
  state.candlePan = pan;
  const end = candles.length - pan;
  return {
    candles: candles.slice(Math.max(0, end - count), end),
    count,
    pan,
    maxPan
  };
}

function updateCandleZoomControls(candles) {
  const maxZoom = candles?.length > 24 ? 16 : 1;
  const viewport = candleViewport(candles);
  els.candleZoomIn.disabled = state.candleZoom >= maxZoom;
  els.candleZoomOut.disabled = state.candleZoom <= 1;
  els.candleZoomReset.disabled = state.candleZoom <= 1 && viewport.pan === 0;
  els.candlePanEarlier.disabled = viewport.pan >= viewport.maxPan;
  els.candlePanLater.disabled = viewport.pan <= 0;
}

function disableCandleZoomControls() {
  els.candleZoomIn.disabled = true;
  els.candleZoomOut.disabled = true;
  els.candleZoomReset.disabled = true;
  els.candlePanEarlier.disabled = true;
  els.candlePanLater.disabled = true;
}

function changeCandleZoom(direction) {
  const stock = selectedTechnicalStock();
  const candles = state.candleData[candleKey(stock?.symbol)]?.candles || [];
  const current = candleViewport(candles);
  const midpoint = candles.length - current.pan - current.count / 2;
  const nextZoom = direction === "in" ? state.candleZoom * 2 : state.candleZoom / 2;
  state.candleZoom = Math.max(1, Math.min(16, nextZoom));
  const nextCount = Math.max(12, Math.ceil(candles.length / state.candleZoom));
  state.candlePan = Math.max(0, Math.min(candles.length - nextCount, Math.round(candles.length - (midpoint + nextCount / 2))));
  renderTechnicalWorkspace();
}

function changeCandlePan(direction) {
  const stock = selectedTechnicalStock();
  const candles = state.candleData[candleKey(stock?.symbol)]?.candles || [];
  const viewport = candleViewport(candles);
  const step = Math.max(1, Math.floor(viewport.count * 0.7));
  state.candlePan = Math.max(0, Math.min(viewport.maxPan, viewport.pan + direction * step));
  renderTechnicalWorkspace();
}

function drawLineChart(canvas, rows) {
  if (!rows?.length) {
    drawEmptyChart(canvas, "Historical prices will appear after the next data snapshot.");
    state.chartMeta.history = [];
    return;
  }

  const { ctx, scale, width, height } = setupCanvas(canvas);
  const values = rows.map((row) => row.close).filter(Number.isFinite);
  const { plot, yScale } = drawAxes(ctx, scale, width, height, values, rows.map((row) => row.date), state.historyRange);
  const meta = [];

  const gradient = ctx.createLinearGradient(0, plot.top, 0, plot.bottom);
  gradient.addColorStop(0, "rgba(35, 106, 150, 0.2)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = plot.left + (index / Math.max(rows.length - 1, 1)) * (plot.right - plot.left);
    const y = yScale.yFor(row.close);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    meta.push({ x: x / scale, y: y / scale, item: row });
  });
  ctx.lineTo(plot.right, plot.bottom);
  ctx.lineTo(plot.left, plot.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = plot.left + (index / Math.max(rows.length - 1, 1)) * (plot.right - plot.left);
    const y = yScale.yFor(row.close);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#236a96";
  ctx.lineWidth = 2.5 * scale;
  ctx.lineCap = "round";
  ctx.stroke();
  state.chartMeta.history = meta;
}

function nearestChartPoint(kind, event) {
  const canvas = kind === "candle" ? els.candleChart : els.historyChart;
  const points = state.chartMeta[kind] || [];
  if (!canvas || !points.length) return null;

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  return points.reduce((nearest, point) => {
    const distance = Math.abs(point.x - x);
    return !nearest || distance < nearest.distance ? { ...point, distance } : nearest;
  }, null);
}

function updateChartReadout(kind, point) {
  if (!point) return;

  if (kind === "candle") {
    const candle = point.item;
    const labelMode = candle.time && !candle.date ? "dateTime" : "date";
    els.candleReadout.textContent = `${formatChartTime(candle.time || candle.date, labelMode)} · Open ${shortPrice(candle.open)} · High ${shortPrice(candle.high)} · Low ${shortPrice(candle.low)} · Close ${shortPrice(candle.close)}`;
    return;
  }

  const row = point.item;
  els.historyReadout.textContent = `${formatChartTime(row.date)} · Close ${shortPrice(row.close)} · Open ${shortPrice(row.open)} · High ${shortPrice(row.high)} · Low ${shortPrice(row.low)} · Volume ${compact(row.volume)}`;
}

function handleChartPointer(kind, event) {
  updateChartReadout(kind, nearestChartPoint(kind, event));
}

function renderSummary(stocks) {
  const marketState = stocks.find((stock) => stock.marketState)?.marketState;
  if (state.data?.loading) {
    els.marketStatus.textContent = "Updating";
    return;
  }
  els.marketStatus.textContent = marketState === "Rate-limited snapshot"
    ? `Updated ${dateTime(state.data?.lastUpdated)}`
    : (marketState || "Ready");
}

function signalRationale(stock) {
  const signal = stock.technicals?.signal || "Unavailable";
  const price = stock.price;
  const sma20 = stock.technicals?.sma20;
  const sma50 = stock.technicals?.sma50;
  if (signal === "Bullish") return "above 20D and 50D SMA";
  if (signal === "Bearish") return "below 20D and 50D SMA";
  if (Number.isFinite(price) && Number.isFinite(sma20) && Number.isFinite(sma50)) return "mixed 20D and 50D SMA";
  return "SMA trend unavailable";
}

function renderPriceStrip(stocks, target = els.priceStrip, scrollOnSelect = true) {
  if (!target) return;
  target.innerHTML = stocks.map((stock) => {
    const selected = stock.symbol === state.technicalSymbol;
    const direction = stock.changePercent >= 0 ? "up" : "down";
    return `<button class="price-strip-item ${selected ? "active" : ""}" data-stock-select="${stock.symbol}" type="button" aria-pressed="${selected}" aria-label="Select ${stock.name}"><span>${stock.symbol}</span><strong>${money(stock.price)}</strong><b class="${direction}">${percent(stock.changePercent)}</b></button>`;
  }).join("");
  target.querySelectorAll("[data-stock-select]").forEach((element) => {
    element.addEventListener("click", () => selectStock(element.dataset.stockSelect, scrollOnSelect));
  });
}

function selectStock(symbol, scrollToDetail = true) {
  if (!state.data?.stocks?.some((stock) => stock.symbol === symbol)) return;
  state.technicalSymbol = symbol;
  state.candleZoom = 1;
  state.candlePan = 0;
  renderPriceStrip(filteredStocks(), els.entryStockStrip, false);
  renderPriceStrip(filteredStocks());
  renderPriceStrip(filteredStocks(), els.newsStockStrip, false);
  renderEntryAnalysis();
  renderTechnicalWorkspace();
  renderNews();
  if (scrollToDetail) {
    window.requestAnimationFrame(() => document.querySelector(".technical-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

function selectedTechnicalStock() {
  const stocks = state.data?.stocks || [];
  return stocks.find((stock) => stock.symbol === state.technicalSymbol) || stocks[0] || null;
}

const POSITIVE_SENTIMENT = /\b(upgrades?|upgraded|raises?|raised|boosts?|beats?|bullish|buy|outperform|overweight|strong|rall(?:y|ies)|upside)\b/g;
const NEGATIVE_SENTIMENT = /\b(downgrades?|downgraded|lowers?|lowered|cuts?|miss(?:es|ed)?|bearish|sell|underperform|underweight|weak|lawsuits?|probes?|slumps?|plunges?)\b/g;

function sentimentForStock(symbol) {
  const textItems = [
    ...(state.data?.news || []).filter((item) => item.symbol === symbol),
    ...(state.data?.analystReviews || []).filter((item) => item.symbol === symbol)
  ];
  // Average per item (each capped at +/-1) so sheer coverage volume cannot
  // push a mega cap positive on routine "buy"/"strong" analyst boilerplate.
  let total = 0;
  textItems.forEach((item) => {
    const text = `${item.title || ""} ${item.action || ""} ${item.recommendation || ""}`.toLowerCase();
    const positives = (text.match(POSITIVE_SENTIMENT) || []).length;
    const negatives = (text.match(NEGATIVE_SENTIMENT) || []).length;
    total += clamp(positives - negatives, -1, 1);
  });
  const count = textItems.length;
  const value = count ? clamp((total / count) * 2, -1, 1) : 0;
  const label = count >= 3 && value >= 0.35 ? "Positive" : count >= 3 && value <= -0.35 ? "Negative" : "Mixed";
  return { value, label, count };
}

function analystTargetForStock(symbol) {
  const reviews = (state.data?.analystReviews || []).filter((item) => item.symbol === symbol);
  const consensus = reviews.find((item) => item.kind === "consensus" && Number.isFinite(item.targetMeanPrice));
  if (consensus) return consensus.targetMeanPrice;
  const targets = reviews.map((item) => item.targetMeanPrice).filter(Number.isFinite);
  return targets.length ? average(targets) : null;
}

function entryAnalysisForStock(stock) {
  const price = stock?.price;
  if (!stock || !Number.isFinite(price)) {
    return {
      score: 0,
      bias: "Unavailable",
      quality: "Unavailable",
      setup: "Waiting for market data",
      entryZone: "--",
      invalidation: "--",
      target: "--",
      riskReward: "--",
      sentiment: "Unavailable",
      reasons: ["Market data is not available for this symbol yet."]
    };
  }

  const sma20 = stock.technicals?.sma20;
  const sma50 = stock.technicals?.sma50;
  const rsi = stock.technicals?.rsi14;
  const volumeRatio = stock.technicals?.volumeRatio;
  const target = analystTargetForStock(stock.symbol);
  const sentiment = sentimentForStock(stock.symbol);
  const fourHourKey = candleKey(stock.symbol, "week", "4h");
  const fourHourData = state.candleData[fourHourKey];

  if (!fourHourData && !state.candleLoadingKeys.has(fourHourKey)) {
    loadDetailedCandles(stock.symbol, "week", "4h");
  }

  // Each factor scores -1..+1 and carries a weight. Missing factors are
  // excluded and the remaining weights renormalized, so absent data neither
  // fakes neutrality nor drags the score toward 50.
  const factors = [];
  const notes = [];

  // Trend: the three SMA relationships are graded by distance and averaged
  // into ONE factor, so the correlated checks cannot triple-count.
  const trendParts = [];
  if (Number.isFinite(sma20)) {
    trendParts.push({ value: clamp((price - sma20) / sma20 / 0.03, -1, 1), text: `${price >= sma20 ? "above" : "below"} the 20D SMA` });
  }
  if (Number.isFinite(sma50)) {
    trendParts.push({ value: clamp((price - sma50) / sma50 / 0.05, -1, 1), text: `${price >= sma50 ? "above" : "below"} the 50D SMA` });
  }
  if (Number.isFinite(sma20) && Number.isFinite(sma50)) {
    trendParts.push({ value: clamp((sma20 - sma50) / sma50 / 0.02, -1, 1), text: `20D SMA ${sma20 >= sma50 ? "above" : "below"} the 50D` });
  }
  if (trendParts.length) {
    factors.push({
      weight: 20,
      value: average(trendParts.map((part) => part.value)),
      reason: `Trend: price is ${trendParts.map((part) => part.text).join(", ")}.`
    });
  }

  // Momentum: peaks near RSI 55 and fades smoothly toward both extremes, so
  // overbought and oversold are penalized symmetrically with no cliffs.
  if (Number.isFinite(rsi)) {
    const value = clamp(1 - Math.abs(rsi - 55) / 20, -1, 1);
    const tone = value > 0.5 ? "constructive" : value >= 0 ? "acceptable" : rsi > 55 ? "extended" : "weak";
    factors.push({ weight: 12, value, reason: `RSI 14 is ${number(rsi)} (${tone}).` });
  }

  // Volume confirms direction: heavy volume on a down day is a warning, not
  // a bonus. Near-average volume says nothing.
  if (Number.isFinite(volumeRatio) && Number.isFinite(stock.changePercent)) {
    const heavy = volumeRatio >= 1.1;
    const direction = stock.changePercent >= 0 ? 1 : -1;
    const value = heavy ? clamp((volumeRatio - 1) / 0.5, 0, 1) * direction : 0;
    factors.push({
      weight: 6,
      value,
      reason: heavy
        ? `Above-average volume is confirming today's ${direction > 0 ? "advance" : "decline"}.`
        : "Volume is near its recent average, so it confirms nothing."
    });
  }

  const completedFourHour = (fourHourData?.candles || []).filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
  if (completedFourHour.length >= 8) {
    const candleSignal = analyseCandlestickPattern(fourHourData.candles);
    const value = candleSignal.signal === "Bullish" ? 1 : candleSignal.signal === "Bearish" ? -1 : 0;
    factors.push({ weight: 12, value, reason: `4h pattern: ${candleSignal.text}` });
  } else if (fourHourData) {
    notes.push("Too few completed 4h candles to score the pattern, so it is excluded.");
  } else {
    notes.push("4h pattern is still loading and is excluded from the score until it arrives.");
  }

  if (sentiment.count >= 3) {
    factors.push({ weight: 10, value: sentiment.value, reason: `${sentiment.label} news and analyst tone across ${sentiment.count} scoped items.` });
  } else {
    notes.push("Too few headlines and analyst notes to score sentiment yet.");
  }

  // Analyst targets for these names sit above price most of the time, so raw
  // upside is measured against a typical +8% consensus premium.
  if (Number.isFinite(target)) {
    const upside = ((target - price) / price) * 100;
    factors.push({
      weight: 10,
      value: clamp((upside - 8) / 10, -1, 1),
      reason: `Analyst target implies ${percent(upside)} vs the typical +8% consensus premium.`
    });
  }

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const weighted = factors.reduce((sum, factor) => sum + factor.weight * factor.value, 0);
  const score = totalWeight ? Math.round(clamp(50 + 50 * (weighted / totalWeight), 0, 100)) : 50;
  const reasons = [
    ...factors.map((factor) => {
      const points = Math.round((factor.weight * factor.value / totalWeight) * 50);
      return `${factor.reason} (${points >= 0 ? "+" : ""}${points} pts)`;
    }),
    ...notes
  ];

  const bias = score >= 62 ? "Bullish" : score <= 38 ? "Bearish" : "Neutral";
  const quality = score >= 75 ? "Strong" : score >= 60 ? "Moderate" : score >= 45 ? "Watch" : "Avoid";
  const setup = bias === "Bullish"
    ? (Number.isFinite(rsi) && rsi > 68 ? "Momentum watch" : "Pullback or continuation")
    : bias === "Bearish" ? "Wait for repair" : "Confirmation needed";
  const entryLow = Number.isFinite(sma20) && bias === "Bullish" ? Math.min(price, sma20 * 1.01) : price * 0.985;
  const entryHigh = bias === "Bullish" ? price * 1.005 : price * 1.01;
  // Nearest support below price, not the lowest of mixed timeframes.
  const supports = [stock.dayLow, sma20, sma50, price * 0.97].filter((level) => Number.isFinite(level) && level < price);
  const invalidation = supports.length ? Math.max(...supports) : price * 0.97;
  const targetPrice = Number.isFinite(target) && target > price ? target : (Number.isFinite(stock.fiftyTwoWeekHigh) ? stock.fiftyTwoWeekHigh : price * 1.05);
  const risk = price - invalidation;
  const reward = targetPrice - price;
  const riskReward = risk > 0 && reward > 0 ? `${number(reward / risk)}:1` : "--";

  return {
    score,
    bias,
    quality,
    setup,
    summary: `${quality} ${bias.toLowerCase()} setup: ${setup.toLowerCase()} with ${sentiment.label.toLowerCase()} sentiment.`,
    entryZone: bias === "Bearish" ? "Wait for confirmation" : `${money(entryLow)} - ${money(entryHigh)}`,
    invalidation: money(invalidation),
    target: money(targetPrice),
    riskReward,
    sentiment: sentiment.label,
    reasons: reasons.slice(0, 7)
  };
}

function renderEntryAnalysis() {
  if (!els.entryAnalysis) return;
  const stock = selectedTechnicalStock();
  const analysis = entryAnalysisForStock(stock);
  const scoreClass = analysis.bias.toLowerCase();
  els.entryAnalysis.innerHTML = `
    <article class="entry-panel">
      <div class="entry-score ${scoreClass}">
        <span>Setup Quality</span>
        <strong>${analysis.score}</strong>
        <b>${analysis.quality}</b>
      </div>
      <div class="entry-summary">
        <div class="panel-head">
          <div>
            <span class="panel-label">Entry Analysis</span>
            <strong>${stock?.symbol || "--"} · ${analysis.bias}</strong>
          </div>
          <span class="entry-sentiment">${analysis.sentiment} sentiment</span>
        </div>
        <p class="entry-one-line">${analysis.summary}</p>
        <div class="entry-grid">
          <div><span>Setup</span><strong>${analysis.setup}</strong></div>
          <div><span>Entry zone</span><strong>${analysis.entryZone}</strong></div>
          <div><span>Invalidation</span><strong>${analysis.invalidation}</strong></div>
          <div><span>Target</span><strong>${analysis.target}</strong></div>
          <div><span>Risk/reward</span><strong>${analysis.riskReward}</strong></div>
        </div>
        <ul class="entry-reasons">
          ${analysis.reasons.map((reason) => `<li>${reason}</li>`).join("")}
        </ul>
        <details class="entry-rules">
          <summary>Scoring rules</summary>
          <div class="entry-rules-table">
            <div><span>Trend composite</span><strong>weight 20</strong><p>Price vs the 20D and 50D SMAs plus their structure, graded by distance and averaged so the three correlated checks count as one signal instead of three.</p></div>
            <div><span>RSI 14</span><strong>weight 12</strong><p>Peaks near RSI 55 and fades smoothly toward both extremes, so overbought and oversold are penalized symmetrically with no threshold cliffs.</p></div>
            <div><span>Volume</span><strong>weight 6</strong><p>Above-average volume only confirms: it adds in the direction of the day's move, so heavy selling volume counts against the setup.</p></div>
            <div><span>4h candle pattern</span><strong>weight 12</strong><p>Bullish or bearish 4h structure. While candles are still loading the factor is excluded and the rest are reweighted, not silently scored as neutral.</p></div>
            <div><span>Sentiment</span><strong>weight 10</strong><p>Whole-word matches averaged per headline and analyst note, so a large volume of routine mega-cap coverage no longer reads as positive by default.</p></div>
            <div><span>Analyst target</span><strong>weight 10</strong><p>Upside measured against the typical +8% consensus premium, because mean targets for these names sit above the price most of the time.</p></div>
          </div>
          <p>Each factor scores -1 to +1, is weighted as shown, and the weighted average maps to 0-100 around a neutral 50. Bias reads bullish at 62+ and bearish at 38-, symmetric around neutral. Missing factors are excluded and the remaining weights renormalized. This is a transparent rule-based setup score, not a prediction.</p>
        </details>
      </div>
    </article>
  `;
}

function renderStats(stock) {
  if (!stock) {
    els.profileGrid.innerHTML = "";
    els.statsGrid.innerHTML = `<div class="empty">Select a stock to view technical stats.</div>`;
    return;
  }

  const profile = [
    ["CEO", stock.ceo || "--"],
    ["Founded", stock.founded || "--"],
    ["Employees", plainNumber(stock.employees)],
    ["Headquarters", stock.headquarters || "--"]
  ];
  const signal = stock.technicals?.signal || "Unavailable";
  const bidValue = stock.stats?.bid ?? stock.bid;
  const askValue = stock.stats?.ask ?? stock.ask;
  const quoteNote = "Appears during the next trading day";
  const stats = [
    ["Bid", money(bidValue), Number.isFinite(bidValue) ? "" : quoteNote],
    ["Ask", money(askValue), Number.isFinite(askValue) ? "" : quoteNote],
    ["Volume", compact(stock.stats?.volume ?? stock.volume)],
    ["Average vol", compact(stock.stats?.averageVolume ?? stock.averageVolume)],
    ["Open", money(stock.stats?.open ?? stock.open)],
    ["Today’s high", money(stock.stats?.dayHigh ?? stock.dayHigh)],
    ["Today’s low", money(stock.stats?.dayLow ?? stock.dayLow)],
    ["Market cap", compact(stock.stats?.marketCap ?? stock.marketCap)],
    ["52-week high", money(stock.stats?.fiftyTwoWeekHigh ?? stock.fiftyTwoWeekHigh)],
    ["52-week low", money(stock.stats?.fiftyTwoWeekLow ?? stock.fiftyTwoWeekLow)],
    ["P/E ratio", number(stock.stats?.pe ?? stock.pe)],
    ["EPS", money(stock.stats?.eps ?? stock.eps)],
    ["Dividend yield", Number.isFinite(stock.stats?.dividendYield ?? stock.dividendYield) ? `${number(stock.stats?.dividendYield ?? stock.dividendYield)}%` : "--"],
    ["Previous close", money(stock.stats?.previousClose ?? stock.previousClose)],
    ["SMA 20", money(stock.technicals?.sma20)],
    ["SMA 50", money(stock.technicals?.sma50)],
    ["RSI 14", number(stock.technicals?.rsi14)],
    ["Volume ratio", Number.isFinite(stock.technicals?.volumeRatio) ? `${number(stock.technicals.volumeRatio)}x` : "--"],
    ["Signal", `${signal} (${signalRationale(stock)})`]
  ];

  els.profileGrid.innerHTML = profile.map(([label, value]) => `
    <div class="profile-stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
  els.statsGrid.innerHTML = stats.map(([label, value, note]) => `
    <div class="stat-cell">
      <span>${label}</span>
      <strong>${value}</strong>
      ${note ? `<small>${note}</small>` : ""}
    </div>
  `).join("");
}

function analyseCandlestickPattern(candles) {
  const valid = (candles || []).filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
  if (valid.length < 8) {
    return { signal: "Neutral", text: "Not enough completed candles for a reliable pattern reading." };
  }

  const sample = valid.slice(-24);
  const last = sample.at(-1);
  const previous = sample.at(-2);
  const recentThree = sample.slice(-3);
  const candleRange = (candle) => Math.max(candle.high - candle.low, 0);
  const body = (candle) => Math.abs(candle.close - candle.open);
  const averageRange = sample.reduce((total, candle) => total + candleRange(candle), 0) / sample.length;
  const change = last.close - sample[0].close;
  const directionalMoves = sample.slice(1);
  const risingCloses = directionalMoves.filter((candle, index) => candle.close > sample[index].close).length;
  const fallingCloses = directionalMoves.filter((candle, index) => candle.close < sample[index].close).length;
  const higherHighs = directionalMoves.filter((candle, index) => candle.high > sample[index].high).length;
  const higherLows = directionalMoves.filter((candle, index) => candle.low > sample[index].low).length;
  const lowerHighs = directionalMoves.filter((candle, index) => candle.high < sample[index].high).length;
  const lowerLows = directionalMoves.filter((candle, index) => candle.low < sample[index].low).length;
  const largeBodies = recentThree.every((candle) => body(candle) >= candleRange(candle) * 0.45);
  const threeRising = recentThree.length === 3
    && recentThree.every((candle) => candle.close > candle.open)
    && recentThree[1].close > recentThree[0].close
    && recentThree[2].close > recentThree[1].close
    && largeBodies;
  const threeFalling = recentThree.length === 3
    && recentThree.every((candle) => candle.close < candle.open)
    && recentThree[1].close < recentThree[0].close
    && recentThree[2].close < recentThree[1].close
    && largeBodies;
  const bullishEngulfing = previous.close < previous.open
    && last.close > last.open
    && last.open <= previous.close
    && last.close >= previous.open
    && body(last) >= body(previous) * 1.2;
  const bearishEngulfing = previous.close > previous.open
    && last.close < last.open
    && last.open >= previous.close
    && last.close <= previous.open
    && body(last) >= body(previous) * 1.2;

  if (threeRising) return { signal: "Bullish", text: "Three consecutive strong rising candles are visible." };
  if (threeFalling) return { signal: "Bearish", text: "Three consecutive strong falling candles are visible." };
  if (bullishEngulfing) return { signal: "Bullish", text: "A bullish engulfing candle is visible at the latest bar." };
  if (bearishEngulfing) return { signal: "Bearish", text: "A bearish engulfing candle is visible at the latest bar." };

  const clearMove = averageRange > 0 && Math.abs(change) >= averageRange * 2.5;
  const enough = directionalMoves.length * 0.65;
  if (clearMove && change > 0 && risingCloses >= enough && higherHighs >= enough && higherLows >= enough) {
    return { signal: "Bullish", text: `Clear higher highs and higher lows across the latest ${sample.length} candles.` };
  }
  if (clearMove && change < 0 && fallingCloses >= enough && lowerHighs >= enough && lowerLows >= enough) {
    return { signal: "Bearish", text: `Clear lower highs and lower lows across the latest ${sample.length} candles.` };
  }
  return { signal: "Neutral", text: "No obvious candlestick trend or reversal pattern." };
}

function compactAnalysisPreviewCandles(candles, maxCandles = 72) {
  if (candles.length <= maxCandles) return candles;
  const groupSize = Math.ceil(candles.length / maxCandles);
  const compacted = [];
  for (let index = 0; index < candles.length; index += groupSize) {
    const group = candles.slice(index, index + groupSize);
    compacted.push({
      open: group[0].open,
      high: Math.max(...group.map((candle) => candle.high)),
      low: Math.min(...group.map((candle) => candle.low)),
      close: group.at(-1).close,
      time: group.at(-1).time,
      date: group.at(-1).date
    });
  }
  return compacted;
}

function drawAnalysisCandles(canvas, candles) {
  const source = (candles || []).filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
  const visible = compactAnalysisPreviewCandles(source);
  if (!visible.length) return;

  const { ctx, scale, width, height } = setupCanvas(canvas);
  const padding = { left: 52 * scale, right: 10 * scale, top: 10 * scale, bottom: 26 * scale };
  const values = visible.flatMap((candle) => [candle.open, candle.high, candle.low, candle.close]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const extra = (high - low || high * 0.01 || 1) * 0.08;
  const min = low - extra;
  const max = high + extra;
  const plotHeight = height - padding.top - padding.bottom;
  const yFor = (value) => height - padding.bottom - ((value - min) / (max - min || 1)) * plotHeight;
  const chartWidth = width - padding.left - padding.right;
  const candleWidth = Math.max(2 * scale, chartWidth / visible.length * 0.56);

  ctx.strokeStyle = "rgba(217, 223, 213, 0.85)";
  ctx.lineWidth = scale;
  ctx.fillStyle = "#647174";
  ctx.font = `${10 * scale}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  [0, 0.5, 1].forEach((ratio) => {
    const y = padding.top + plotHeight * ratio;
    const value = max - (max - min) * ratio;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(shortPrice(value), padding.left - 6 * scale, y);
  });

  const firstDate = parseChartDate(visible[0].time || visible[0].date);
  const lastDate = parseChartDate(visible.at(-1).time || visible.at(-1).date);
  const spansMultipleDays = firstDate && lastDate && firstDate.toDateString() !== lastDate.toDateString();
  const labelIndexes = [0, Math.floor((visible.length - 1) / 2), visible.length - 1];
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  labelIndexes.forEach((index) => {
    const candle = visible[index];
    const label = spansMultipleDays
      ? formatAxisDate(candle.time || candle.date, "day")
      : formatAxisDate(candle.time || candle.date, "intraday");
    const x = padding.left + (index + 0.5) / visible.length * chartWidth;
    ctx.fillText(label, x, height - padding.bottom + 7 * scale);
  });

  visible.forEach((candle, index) => {
    const x = padding.left + (index + 0.5) / visible.length * chartWidth;
    const openY = yFor(candle.open);
    const closeY = yFor(candle.close);
    const positive = candle.close >= candle.open;
    ctx.strokeStyle = positive ? "#147a54" : "#b33a3a";
    ctx.fillStyle = positive ? "rgba(20, 122, 84, 0.25)" : "rgba(179, 58, 58, 0.22)";
    ctx.beginPath();
    ctx.moveTo(x, yFor(candle.high));
    ctx.lineTo(x, yFor(candle.low));
    ctx.stroke();
    ctx.fillRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(2 * scale, Math.abs(closeY - openY)));
    ctx.strokeRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(2 * scale, Math.abs(closeY - openY)));
  });
}

function renderCandleAnalysis(stock) {
  if (!els.candleAnalysis) return;
  if (!stock) {
    els.candleAnalysis.innerHTML = `<div class="empty">Select a stock to view candlestick analysis.</div>`;
    return;
  }

  const periods = [["day", "1D"], ["week", "1W"], ["threeMonth", "3M"]];
  const intervals = ["5m", "15m", "30m", "4h"];
  const cards = periods.flatMap(([period, periodLabel]) => intervals.map((interval) => {
    const key = candleKey(stock.symbol, period, interval);
    const data = state.candleData[key];
    if (!data) {
      loadDetailedCandles(stock.symbol, period, interval);
      return `<article class="candle-analysis-card"><header><strong>${periodLabel} · ${interval}</strong><span class="candle-signal neutral">Loading</span></header><p>Fetching candles for pattern analysis.</p></article>`;
    }
    if (!data.candles?.length) {
      return `<article class="candle-analysis-card"><header><strong>${periodLabel} · ${interval}</strong><span class="candle-signal neutral">Unavailable</span></header><p>No candles are available for this reading.</p></article>`;
    }
    const analysis = analyseCandlestickPattern(data.candles);
    return `<article class="candle-analysis-card"><header><strong>${periodLabel} · ${interval}</strong><span class="candle-signal ${analysis.signal.toLowerCase()}">${analysis.signal}</span></header><p>${analysis.text}</p><canvas class="analysis-candle-chart" data-analysis-candle-key="${key}" aria-label="${periodLabel} ${interval} candlestick pattern preview"></canvas></article>`;
  }));
  els.candleAnalysis.innerHTML = cards.join("");
  els.candleAnalysis.querySelectorAll("[data-analysis-candle-key]").forEach((canvas) => {
    drawAnalysisCandles(canvas, state.candleData[canvas.dataset.analysisCandleKey]?.candles);
  });
}

function renderTechnicalWorkspace() {
  const stocks = state.data?.stocks || [];
  const stock = selectedTechnicalStock();

  if (!stock) {
    drawEmptyChart(els.candleChart, "Waiting for market data.");
    disableCandleZoomControls();
    drawEmptyChart(els.historyChart, "Waiting for historical data.");
    renderStats(null);
    renderCandleAnalysis(null);
    els.selectedSignalHint.textContent = "Select a stock from the live-price strip above.";
    return;
  }

  const periodLabels = {
    day: "1D",
    week: "1W",
    threeMonth: "3M",
    sixMonth: "6M",
    oneYear: "1Y",
    all: "All"
  };
  const historyLabels = {
    day: "Day",
    week: "Week",
    threeMonth: "3 months",
    sixMonth: "6 months",
    oneYear: "1 year",
    all: "All available"
  };

  const candleData = state.candleData[candleKey(stock.symbol)];
  const effectiveLabel = candleData?.effectiveRange && candleData.effectiveRange !== "7d" && candleData.effectiveRange !== state.candlePeriod
    ? `${candleData.effectiveRange} shown · ${periodLabels[state.candlePeriod]} requested`
    : periodLabels[state.candlePeriod];
  els.candleTitle.textContent = `${stock.symbol} · ${effectiveLabel} · ${state.candleInterval}`;
  els.historyTitle.textContent = `${stock.symbol} · ${historyLabels[state.historyRange]}`;
  els.selectedSignalHint.textContent = `${stock.symbol} · ${stock.technicals?.signal || "Unavailable"} (${signalRationale(stock)})`;
  els.statsTitle.textContent = `${money(stock.price)} ${stock.symbol}`;
  if (!candleData) {
    drawEmptyChart(els.candleChart, "Loading detailed candles...");
    state.chartMeta.candle = [];
    disableCandleZoomControls();
    els.candleReadout.textContent = "Fetching candle data for the selected period and interval.";
    loadDetailedCandles(stock.symbol);
  } else {
    const viewport = candleViewport(candleData.candles || []);
    const visibleCandles = viewport.candles;
    drawCandles(els.candleChart, visibleCandles, state.candlePeriod, "No detailed candles are available for this selection.");
    updateCandleZoomControls(candleData.candles || []);
    if (state.chartMeta.candle.length) {
      updateChartReadout("candle", state.chartMeta.candle.at(-1));
      if (state.candleZoom > 1 || viewport.pan > 0) {
        const start = visibleCandles[0];
        const end = visibleCandles.at(-1);
        els.candleReadout.textContent += ` · ${state.candleZoom}x zoom: ${formatChartTime(start.time || start.date, "dateTime")} to ${formatChartTime(end.time || end.date, "dateTime")}.`;
      }
    } else {
      els.candleReadout.textContent = "No candles are available for this selection.";
    }
    if (candleData.note) {
      els.candleReadout.textContent += ` · ${candleData.note}`;
    }
  }
  drawLineChart(els.historyChart, stock.history?.[state.historyRange] || []);
  updateChartReadout("history", state.chartMeta.history.at(-1));
  renderStats(stock);
  renderCandleAnalysis(stock);
}

function renderNews() {
  const stocks = filteredStocks();
  const selectedStock = selectedTechnicalStock();
  const selectedSymbol = selectedStock?.symbol;
  renderPriceStrip(stocks, els.newsStockStrip, false);

  const reviews = (state.data?.analystReviews || []).filter((item) => item.symbol === selectedSymbol);
  const items = (state.data?.news || []).filter((item) => item.symbol === selectedSymbol);

  els.analystReviews.innerHTML = reviews.length
    ? reviews.slice(0, 6).map((item) => {
      const recommendation = titleCase(item.recommendation || item.toGrade || item.action || "Analyst Review");
      const rating = Number.isFinite(item.meanRating) ? `${number(item.meanRating)} avg` : (item.toGrade || item.action || "Firm note");
      const target = Number.isFinite(item.targetMeanPrice) ? money(item.targetMeanPrice) : "--";
      const firm = item.firm || item.source || "Analyst";
      const latestAction = [item.action ? titleCase(item.action) : "", item.fromGrade && item.toGrade ? `${item.fromGrade} to ${item.toGrade}` : item.toGrade].filter(Boolean).join(" · ");
      const range = Number.isFinite(item.targetLowPrice) && Number.isFinite(item.targetHighPrice)
        ? `${money(item.targetLowPrice)}-${money(item.targetHighPrice)}`
        : "Target range unavailable";
      const reviewSummary = item.link
        ? `<a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>`
        : `<p>${latestAction || "No recent firm action reported"}${item.latestActionDate ? ` · ${dateTime(item.latestActionDate)}` : ""}</p>`;
      return `
        <article class="analyst-review-card">
          <header>
            <div>
              <span class="review-symbol">${firm}</span>
              <strong>${recommendation}</strong>
            </div>
            <span>${rating}</span>
          </header>
          <div class="review-target">
            <span>${item.kind === "consensus" ? "Mean target" : (item.targetType || "Price target")}</span>
            <strong>${target}</strong>
          </div>
          ${item.kind === "consensus" ? `
          <dl>
            <div><dt>Analysts</dt><dd>${plainNumber(item.analystCount)}</dd></div>
            <div><dt>Range</dt><dd>${range}</dd></div>
          </dl>
          ` : ""}
          ${reviewSummary}
          <div class="review-source">${item.source || "Market data"}${item.published ? ` · ${dateTime(item.published)}` : ""}</div>
        </article>
      `;
    }).join("")
    : `<div class="empty">Top analyst reviews for ${selectedSymbol || "this stock"} are still loading.</div>`;

  if (items.length) {
    els.newsList.innerHTML = items.map((item) => `
      <article class="news-item">
        <a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>
        <div class="news-meta">${item.symbol} · ${item.source || "Google News"} · ${dateTime(item.published)}</div>
      </article>
    `).join("");
    return;
  }

  els.newsList.innerHTML = selectedStock
    ? (() => {
      const searchUrl = `https://news.google.com/search?q=${encodeURIComponent(`${selectedStock.symbol} ${selectedStock.name} stock`)}`;
      return `
      <article class="news-item news-search-item">
        <a href="${searchUrl}" target="_blank" rel="noreferrer">${selectedStock.symbol} headline search</a>
        <div class="news-meta">Open current market headlines for ${selectedStock.name}</div>
      </article>
    `;
    })()
    : `<div class="empty">Live headlines are still loading. Try refreshing again in a moment.</div>`;
}

function renderErrors() {
  const errors = state.data?.errors || [];
  els.errorPanel.classList.toggle("hidden", !errors.length);
  els.errorPanel.textContent = errors.length
    ? `Some live data could not be loaded: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "..." : ""}`
    : "";
}

function render() {
  const stocks = filteredStocks();
  renderSummary(state.data?.stocks || []);
  renderErrors();
  renderPriceStrip(stocks, els.entryStockStrip, false);
  renderPriceStrip(stocks);
  renderPriceStrip(stocks, els.newsStockStrip, false);
  renderEntryAnalysis();
  renderTechnicalWorkspace();
  renderNews();
}

function activateView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((viewEl) => {
    viewEl.classList.toggle("active", viewEl.id === `${view}View`);
  });
  if (view === "technicals" && state.data) {
    window.requestAnimationFrame(renderTechnicalWorkspace);
  }
  if (view === "entry" && state.data) {
    window.requestAnimationFrame(renderEntryAnalysis);
  }
}

async function loadSnapshot(refresh = false) {
  els.refreshBtn.disabled = true;
  els.marketStatus.textContent = refresh ? "Updating" : "Loading";

  const response = await fetch(refresh ? "/api/refresh" : "/api/snapshot", {
    method: refresh ? "POST" : "GET"
  });
  state.data = await response.json();
  els.refreshBtn.disabled = false;
  render();
  scheduleNextSnapshot();
}

function scheduleNextSnapshot() {
  window.clearTimeout(state.refreshTimer);
  const interval = Math.max(state.data?.refreshIntervalMs || 60 * 1000, 15 * 1000);
  state.refreshTimer = window.setTimeout(() => loadSnapshot(), interval);
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activateView(tab.dataset.view);
  });
});

document.querySelectorAll("[data-candle-period]").forEach((button) => {
  button.addEventListener("click", () => {
    state.candlePeriod = button.dataset.candlePeriod;
    state.candleZoom = 1;
    state.candlePan = 0;
    document.querySelectorAll("[data-candle-period]").forEach((item) => {
      item.classList.toggle("active", item.dataset.candlePeriod === state.candlePeriod);
    });
    renderTechnicalWorkspace();
  });
});

document.querySelectorAll("[data-candle-interval]").forEach((button) => {
  button.addEventListener("click", () => {
    state.candleInterval = button.dataset.candleInterval;
    state.candleZoom = 1;
    state.candlePan = 0;
    document.querySelectorAll("[data-candle-interval]").forEach((item) => {
      item.classList.toggle("active", item.dataset.candleInterval === state.candleInterval);
    });
    renderTechnicalWorkspace();
  });
});

els.candleZoomIn.addEventListener("click", () => changeCandleZoom("in"));
els.candleZoomOut.addEventListener("click", () => changeCandleZoom("out"));
els.candleZoomReset.addEventListener("click", () => {
  state.candleZoom = 1;
  state.candlePan = 0;
  renderTechnicalWorkspace();
});
els.candlePanEarlier.addEventListener("click", () => changeCandlePan(1));
els.candlePanLater.addEventListener("click", () => changeCandlePan(-1));

document.querySelectorAll("[data-history-range]").forEach((button) => {
  button.addEventListener("click", () => {
    state.historyRange = button.dataset.historyRange;
    document.querySelectorAll("[data-history-range]").forEach((item) => {
      item.classList.toggle("active", item.dataset.historyRange === state.historyRange);
    });
    renderTechnicalWorkspace();
  });
});

["pointermove", "click"].forEach((eventName) => {
  els.candleChart.addEventListener(eventName, (event) => handleChartPointer("candle", event));
  els.historyChart.addEventListener(eventName, (event) => handleChartPointer("history", event));
});

els.candleChart.addEventListener("wheel", (event) => {
  event.preventDefault();
  changeCandleZoom(event.deltaY < 0 ? "in" : "out");
}, { passive: false });

els.refreshBtn.addEventListener("click", () => loadSnapshot(true));
window.addEventListener("resize", () => {
  renderTechnicalWorkspace();
});

loadSnapshot();
