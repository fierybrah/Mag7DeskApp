const state = {
  data: null,
  view: "overview",
  query: "",
  signal: "all",
  technicalSymbol: "GOOGL",
  candleRange: "fiveMinute",
  historyRange: "day",
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
  historyChart: document.querySelector("#historyChart"),
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

function chartScale(values, height, pad) {
  const valid = values.filter(Number.isFinite);
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  return (value) => height - pad - ((value - min) / range) * (height - pad * 2);
}

function drawCandles(canvas, candles) {
  if (!candles?.length) {
    drawEmptyChart(canvas, "Candles will appear after the next live quote snapshot.");
    return;
  }

  const { ctx, scale, width, height } = setupCanvas(canvas);
  const pad = 18 * scale;
  const values = candles.flatMap((candle) => [candle.open, candle.high, candle.low, candle.close]);
  const yFor = chartScale(values, height, pad);
  const candleWidth = Math.max(4 * scale, (width - pad * 2) / candles.length * 0.56);

  ctx.strokeStyle = "#d9dfd5";
  ctx.lineWidth = scale;
  for (let index = 0; index < 4; index += 1) {
    const y = pad + ((height - pad * 2) / 3) * index;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  candles.forEach((candle, index) => {
    const x = pad + (index / Math.max(candles.length - 1, 1)) * (width - pad * 2);
    const openY = yFor(candle.open);
    const closeY = yFor(candle.close);
    const highY = yFor(candle.high);
    const lowY = yFor(candle.low);
    const positive = candle.close >= candle.open;
    ctx.strokeStyle = positive ? "#147a54" : "#b33a3a";
    ctx.fillStyle = positive ? "rgba(20, 122, 84, 0.18)" : "rgba(179, 58, 58, 0.16)";

    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    ctx.fillRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(2 * scale, Math.abs(closeY - openY)));
    ctx.strokeRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(2 * scale, Math.abs(closeY - openY)));
  });
}

function drawLineChart(canvas, rows) {
  if (!rows?.length) {
    drawEmptyChart(canvas, "Historical prices will appear after the next data snapshot.");
    return;
  }

  const { ctx, scale, width, height } = setupCanvas(canvas);
  const pad = 18 * scale;
  const values = rows.map((row) => row.close).filter(Number.isFinite);
  const yFor = chartScale(values, height, pad);

  ctx.strokeStyle = "#d9dfd5";
  ctx.lineWidth = scale;
  for (let index = 0; index < 4; index += 1) {
    const y = pad + ((height - pad * 2) / 3) * index;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  const gradient = ctx.createLinearGradient(0, pad, 0, height - pad);
  gradient.addColorStop(0, "rgba(35, 106, 150, 0.2)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = pad + (index / Math.max(rows.length - 1, 1)) * (width - pad * 2);
    const y = yFor(row.close);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(width - pad, height - pad);
  ctx.lineTo(pad, height - pad);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = pad + (index / Math.max(rows.length - 1, 1)) * (width - pad * 2);
    const y = yFor(row.close);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#236a96";
  ctx.lineWidth = 2.5 * scale;
  ctx.lineCap = "round";
  ctx.stroke();
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

function renderTechnicalWorkspace() {
  const stocks = state.data?.stocks || [];
  renderTechnicalSelector(stocks);
  const stock = selectedTechnicalStock();

  if (!stock) {
    drawEmptyChart(els.candleChart, "Waiting for market data.");
    drawEmptyChart(els.historyChart, "Waiting for historical data.");
    renderStats(null);
    return;
  }

  const candleLabels = {
    fiveMinute: "5 minute",
    fifteenMinute: "15 minute",
    thirtyMinute: "30 minute"
  };
  const historyLabels = {
    day: "Day",
    week: "Week",
    threeMonth: "3 months",
    sixMonth: "6 months",
    oneYear: "1 year",
    all: "All available"
  };

  els.candleTitle.textContent = `${stock.symbol} · ${candleLabels[state.candleRange]}`;
  els.historyTitle.textContent = `${stock.symbol} · ${historyLabels[state.historyRange]}`;
  els.statsTitle.textContent = `${money(stock.price)} ${stock.symbol}`;
  drawCandles(els.candleChart, stock.candles?.[state.candleRange] || []);
  drawLineChart(els.historyChart, stock.history?.[state.historyRange] || []);
  renderStats(stock);
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
  render();
});

document.querySelectorAll("[data-candle-range]").forEach((button) => {
  button.addEventListener("click", () => {
    state.candleRange = button.dataset.candleRange;
    document.querySelectorAll("[data-candle-range]").forEach((item) => {
      item.classList.toggle("active", item.dataset.candleRange === state.candleRange);
    });
    renderTechnicalWorkspace();
  });
});

document.querySelectorAll("[data-history-range]").forEach((button) => {
  button.addEventListener("click", () => {
    state.historyRange = button.dataset.historyRange;
    document.querySelectorAll("[data-history-range]").forEach((item) => {
      item.classList.toggle("active", item.dataset.historyRange === state.historyRange);
    });
    renderTechnicalWorkspace();
  });
});

els.refreshBtn.addEventListener("click", () => loadSnapshot(true));
window.addEventListener("resize", () => {
  renderOverview(filteredStocks());
  renderTechnicalWorkspace();
});

loadSnapshot();
