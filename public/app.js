const state = {
  data: null,
  view: "overview",
  query: "",
  signal: "all",
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
  toolbar: document.querySelector(".toolbar"),
  toolbarHome: document.querySelector("#toolbarHome"),
  signalsHead: document.querySelector("#signals"),
  totalCap: document.querySelector("#totalCap"),
  advancers: document.querySelector("#advancers"),
  avgMove: document.querySelector("#avgMove"),
  nextRefresh: document.querySelector("#nextRefresh"),
  marketTone: document.querySelector("#marketTone"),
  marketToneDetail: document.querySelector("#marketToneDetail"),
  topMover: document.querySelector("#topMover"),
  topMoverDetail: document.querySelector("#topMoverDetail"),
  signalMix: document.querySelector("#signalMix"),
  signalMixDetail: document.querySelector("#signalMixDetail"),
  leaderStrip: document.querySelector("#leaderStrip"),
  stockGrid: document.querySelector("#stockGrid"),
  technicalRows: document.querySelector("#technicalRows"),
  technicalSymbol: document.querySelector("#technicalSymbol"),
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
  newsList: document.querySelector("#newsList"),
  errorPanel: document.querySelector("#errorPanel"),
  searchInput: document.querySelector("#searchInput"),
  signalFilter: document.querySelector("#signalFilter")
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

function plainNumber(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
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
  const query = state.query.trim().toLowerCase();
  return (state.data?.stocks || []).filter((stock) => {
    const matchesQuery = !query || [stock.symbol, stock.name, stock.sector].some((value) => {
      return String(value || "").toLowerCase().includes(query);
    });
    const matchesSignal = state.signal === "all" || stock.technicals?.signal === state.signal;
    return matchesQuery && matchesSignal;
  });
}

function syncTechnicalSymbolToSearch() {
  const query = state.query.trim().toLowerCase();
  if (!query) return;

  const stocks = state.data?.stocks || [];
  const match = stocks.find((stock) => stock.symbol.toLowerCase() === query)
    || stocks.find((stock) => stock.symbol.toLowerCase().startsWith(query) && query.length >= 2)
    || stocks.find((stock) => stock.name.toLowerCase().startsWith(query) && query.length >= 2)
    || stocks.find((stock) => stock.name.toLowerCase().includes(query) && query.length >= 3);

  if (match) {
    state.technicalSymbol = match.symbol;
  }
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
  const cap = stocks.reduce((sum, stock) => sum + (stock.marketCap || 0), 0);
  const moves = stocks.map((stock) => stock.changePercent).filter(Number.isFinite);
  const avgMove = moves.length ? moves.reduce((sum, value) => sum + value, 0) / moves.length : null;
  const advancers = stocks.filter((stock) => stock.changePercent > 0).length;

  els.totalCap.textContent = compact(cap);
  els.advancers.textContent = `${advancers}/${stocks.length || 7}`;
  els.avgMove.textContent = Number.isFinite(avgMove) ? percent(avgMove) : "--";
  els.avgMove.className = Number.isFinite(avgMove) ? (avgMove >= 0 ? "up" : "down") : "";
  els.nextRefresh.textContent = dateTime(state.data?.nextRefresh);

  const marketState = stocks.find((stock) => stock.marketState)?.marketState;
  els.marketStatus.textContent = state.data?.loading ? "Updating" : (marketState || "Ready");
}

function strongestMove(stocks) {
  const moves = stocks.filter((stock) => Number.isFinite(stock.changePercent));
  if (!moves.length) return null;
  return moves.reduce((leader, stock) => {
    return Math.abs(stock.changePercent) > Math.abs(leader.changePercent) ? stock : leader;
  }, moves[0]);
}

function renderBrief(stocks) {
  const validMoves = stocks.filter((stock) => Number.isFinite(stock.changePercent));
  const advancers = validMoves.filter((stock) => stock.changePercent > 0).length;
  const decliners = validMoves.filter((stock) => stock.changePercent < 0).length;
  const bullish = stocks.filter((stock) => stock.technicals?.signal === "Bullish").length;
  const bearish = stocks.filter((stock) => stock.technicals?.signal === "Bearish").length;
  const neutral = stocks.filter((stock) => stock.technicals?.signal === "Neutral").length;
  const mover = strongestMove(stocks);

  let tone = "Balanced";
  if (advancers >= 5) tone = "Risk On";
  if (decliners >= 5) tone = "Risk Off";

  els.marketTone.textContent = validMoves.length ? tone : "--";
  els.marketToneDetail.textContent = validMoves.length
    ? `${advancers} advancing, ${decliners} declining across the Mag 7 basket.`
    : "Waiting for the latest market breadth snapshot.";

  els.topMover.textContent = mover ? mover.symbol : "--";
  els.topMoverDetail.textContent = mover
    ? `${mover.name} is moving ${percent(mover.changePercent)} with last sale at ${money(mover.price)}.`
    : "Waiting for a tradable price update.";

  els.signalMix.textContent = `${bullish}/${neutral}/${bearish}`;
  els.signalMixDetail.textContent = "Bullish, neutral, and bearish technical signals from SMA and RSI readings.";
}

function renderLeaders(stocks) {
  const valid = stocks.filter((stock) => Number.isFinite(stock.changePercent));
  if (!valid.length) {
    els.leaderStrip.innerHTML = `<div class="empty">Market leaders will appear after the next live quote snapshot.</div>`;
    return;
  }

  const best = valid.reduce((leader, stock) => stock.changePercent > leader.changePercent ? stock : leader, valid[0]);
  const worst = valid.reduce((leader, stock) => stock.changePercent < leader.changePercent ? stock : leader, valid[0]);
  const volume = stocks.filter((stock) => Number.isFinite(stock.volume)).reduce((leader, stock) => {
    if (!leader) return stock;
    return stock.volume > leader.volume ? stock : leader;
  }, null);

  const cards = [
    ["Best Tape", best, percent(best.changePercent)],
    ["Weakest Tape", worst, percent(worst.changePercent)],
    ["Most Active", volume, compact(volume?.volume)]
  ];

  els.leaderStrip.innerHTML = cards.map(([label, stock, value]) => `
    <article class="leader-card">
      <div>
        <span>${label}</span>
        <strong>${stock?.symbol || "--"}</strong>
      </div>
      <b class="${stock?.changePercent >= 0 ? "up" : "down"}">${value || "--"}</b>
    </article>
  `).join("");
}

function stockCard(stock) {
  const changeClass = stock.changePercent >= 0 ? "up" : "down";
  const signal = stock.technicals?.signal || "Unavailable";

  return `
    <article class="stock-card">
      <div class="card-head">
        <div>
          <div class="symbol">${stock.symbol}</div>
          <div class="company">${stock.name}</div>
        </div>
        <span class="signal ${signal}">${signal}</span>
      </div>
      <div>
        <div class="price">${money(stock.price)}</div>
        <div class="move ${changeClass}">${money(stock.change)} ${percent(stock.changePercent)}</div>
      </div>
      <canvas class="spark" data-symbol="${stock.symbol}" aria-label="${stock.symbol} price trend"></canvas>
      <div class="fact-grid">
        <div class="fact"><span>Market cap</span><b>${compact(stock.marketCap)}</b></div>
        <div class="fact"><span>P/E</span><b>${number(stock.pe)}</b></div>
        <div class="fact"><span>EPS</span><b>${number(stock.eps)}</b></div>
        <div class="fact"><span>Day range</span><b>${money(stock.dayLow)} - ${money(stock.dayHigh)}</b></div>
        <div class="fact"><span>Volume</span><b>${compact(stock.volume)}</b></div>
      </div>
    </article>
  `;
}

function renderOverview(stocks) {
  els.stockGrid.innerHTML = stocks.length
    ? stocks.map(stockCard).join("")
    : `<div class="empty">No stocks match the current filters.</div>`;

  stocks.forEach((stock) => {
    const canvas = els.stockGrid.querySelector(`canvas[data-symbol="${stock.symbol}"]`);
    if (canvas) drawSparkline(canvas, stock.series || [], stock.changePercent >= 0);
  });
}

function renderTechnicals(stocks) {
  els.technicalRows.innerHTML = stocks.map((stock) => {
    const signal = stock.technicals?.signal || "Unavailable";
    return `
      <tr>
        <td><strong>${stock.symbol}</strong><br><span class="company">${stock.name}</span></td>
        <td>${money(stock.price)}</td>
        <td>${money(stock.technicals?.sma20)}</td>
        <td>${money(stock.technicals?.sma50)}</td>
        <td>${number(stock.technicals?.rsi14)}</td>
        <td>${number(stock.technicals?.volumeRatio)}x</td>
        <td><span class="signal ${signal}">${signal}</span></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7">No stocks match the current filters.</td></tr>`;
}

function selectedTechnicalStock() {
  const stocks = state.data?.stocks || [];
  return stocks.find((stock) => stock.symbol === state.technicalSymbol) || stocks[0] || null;
}

function renderTechnicalSelector(stocks) {
  if (!els.technicalSymbol) return;
  if (!stocks.some((stock) => stock.symbol === state.technicalSymbol) && stocks[0]) {
    state.technicalSymbol = stocks[0].symbol;
  }
  els.technicalSymbol.innerHTML = stocks.map((stock) => `
    <option value="${stock.symbol}" ${stock.symbol === state.technicalSymbol ? "selected" : ""}>${stock.symbol} · ${stock.name}</option>
  `).join("");
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

  const stats = [
    ["Bid", money(stock.stats?.bid ?? stock.bid)],
    ["Ask", money(stock.stats?.ask ?? stock.ask)],
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
    ["Signal", stock.technicals?.signal || "Unavailable"]
  ];

  els.profileGrid.innerHTML = profile.map(([label, value]) => `
    <div class="profile-stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");

  els.statsGrid.innerHTML = stats.map(([label, value]) => `
    <div class="stat-cell">
      <span>${label}</span>
      <strong>${value}</strong>
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

function drawAnalysisCandles(canvas, candles) {
  const visible = (candles || []).filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)).slice(-24);
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
  const intervals = ["5m", "15m", "30m"];
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
  renderTechnicalSelector(stocks);
  const stock = selectedTechnicalStock();

  if (!stock) {
    drawEmptyChart(els.candleChart, "Waiting for market data.");
    disableCandleZoomControls();
    drawEmptyChart(els.historyChart, "Waiting for historical data.");
    renderStats(null);
    renderCandleAnalysis(null);
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
  const visibleStocks = filteredStocks();
  const symbols = new Set(visibleStocks.map((stock) => stock.symbol));
  const query = state.query.trim().toLowerCase();
  const items = (state.data?.news || []).filter((item) => {
    const matchesSymbol = !symbols.size || symbols.has(item.symbol);
    const matchesQuery = !query || [item.symbol, item.title, item.source].some((value) => {
      return String(value || "").toLowerCase().includes(query);
    });
    return matchesSymbol && matchesQuery;
  });

  if (items.length) {
    els.newsList.innerHTML = items.map((item) => `
      <article class="news-item">
        <a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>
        <div class="news-meta">${item.symbol} · ${item.source || "Google News"} · ${dateTime(item.published)}</div>
      </article>
    `).join("");
    return;
  }

  const fallbackStocks = visibleStocks.length ? visibleStocks : (state.data?.stocks || []);
  els.newsList.innerHTML = fallbackStocks.length
    ? fallbackStocks.map((stock) => {
      const searchUrl = `https://news.google.com/search?q=${encodeURIComponent(`${stock.symbol} ${stock.name} stock`)}`;
      return `
        <article class="news-item news-search-item">
          <a href="${searchUrl}" target="_blank" rel="noreferrer">${stock.symbol} headline search</a>
          <div class="news-meta">Open current market headlines for ${stock.name}</div>
        </article>
      `;
    }).join("")
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
  renderBrief(state.data?.stocks || []);
  renderErrors();
  renderLeaders(stocks);
  renderOverview(stocks);
  renderTechnicals(stocks);
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
  if (view === "technicals") {
    els.signalsHead.before(els.toolbar);
  } else {
    els.toolbarHome.after(els.toolbar);
  }
  if (view === "technicals" && state.data) {
    window.requestAnimationFrame(renderTechnicalWorkspace);
  }
}

async function loadSnapshot(refresh = false) {
  els.refreshBtn.disabled = true;
  els.marketStatus.textContent = refresh ? "Updating" : "Loading";

  const response = await fetch(refresh ? "/api/refresh" : "/api/snapshot", {
    method: refresh ? "POST" : "GET"
  });
  state.data = await response.json();
  syncTechnicalSymbolToSearch();

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

document.querySelectorAll("[data-nav-view]").forEach((link) => {
  link.addEventListener("click", () => {
    activateView(link.dataset.navView);
  });
});

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  syncTechnicalSymbolToSearch();
  render();
});

els.signalFilter.addEventListener("change", (event) => {
  state.signal = event.target.value;
  render();
});

els.technicalSymbol.addEventListener("change", (event) => {
  state.technicalSymbol = event.target.value;
  state.candleZoom = 1;
  state.candlePan = 0;
  render();
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
  renderOverview(filteredStocks());
  renderTechnicalWorkspace();
});

loadSnapshot();
