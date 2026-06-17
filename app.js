const state = {
  data: null,
  view: "overview",
  query: "",
  signal: "all"
};

const els = {
  refreshBtn: document.querySelector("#refreshBtn"),
  marketStatus: document.querySelector("#marketStatus"),
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

function renderNews() {
  const symbols = new Set(filteredStocks().map((stock) => stock.symbol));
  const query = state.query.trim().toLowerCase();
  const items = (state.data?.news || []).filter((item) => {
    const matchesSymbol = !symbols.size || symbols.has(item.symbol);
    const matchesQuery = !query || [item.symbol, item.title, item.source].some((value) => {
      return String(value || "").toLowerCase().includes(query);
    });
    return matchesSymbol && matchesQuery;
  });

  els.newsList.innerHTML = items.length
    ? items.map((item) => `
      <article class="news-item">
        <a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>
        <div class="news-meta">${item.symbol} · ${item.source || "Google News"} · ${dateTime(item.published)}</div>
      </article>
    `).join("")
    : `<div class="empty">No news is available for the current filters.</div>`;
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
  render();
});

els.signalFilter.addEventListener("change", (event) => {
  state.signal = event.target.value;
  render();
});

els.refreshBtn.addEventListener("click", () => loadSnapshot(true));
window.addEventListener("resize", () => renderOverview(filteredStocks()));

loadSnapshot();
setInterval(() => loadSnapshot(), 60 * 1000);
