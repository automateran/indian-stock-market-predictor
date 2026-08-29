const basePath = document.body.dataset.basePath ?? "/api";
const activePage = document.body.dataset.activePage || "dashboard";
const state = { stocks: [], selected: null, filter: "all", search: "" };

const money = (value) => value == null ? "—" : `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedPercent = (value) => value == null ? "—" : `${value >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`;
const toneClass = (tone) => tone === "positive" ? "positive" : tone === "negative" ? "negative" : "neutral";
const initials = (value) => (value || "?").slice(0, 2).toUpperCase();
const apiUrl = (path) => `${basePath}${path}`;

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 3500);
}

function setActiveNav() {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === activePage || (activePage === "" && link.dataset.nav === "dashboard"));
  });
  const title = document.getElementById("page-title");
  if (title) title.textContent = activePage === "learn" ? "How it works" : activePage === "stocks" ? "Stock screener" : "Market overview";
  document.getElementById("live-view")?.classList.toggle("hidden", activePage === "learn");
  document.getElementById("learn-view")?.classList.toggle("hidden", activePage !== "learn");
}

function filteredStocks() {
  return state.stocks.filter((stock) => {
    const matchesSearch = !state.search || `${stock.name} ${stock.short_name} ${stock.symbol}`.toLowerCase().includes(state.search.toLowerCase());
    const matchesFilter = state.filter === "all" || stock.consensus.tone === state.filter;
    return matchesSearch && matchesFilter;
  });
}

function renderIndex(payload) {
  const index = payload.index || {};
  document.getElementById("index-price").textContent = money(index.price);
  const change = document.getElementById("index-change");
  change.textContent = `${index.change >= 0 ? "+" : ""}${Number(index.change || 0).toFixed(2)}  (${signedPercent(index.change_percent)})`;
  change.className = index.change_percent >= 0 ? "positive" : "negative";
  document.getElementById("index-session").textContent = isSessionOpen() ? "OPEN" : "CLOSED";
  const positive = state.stocks.filter((stock) => stock.consensus.tone === "positive").length;
  const negative = state.stocks.filter((stock) => stock.consensus.tone === "negative").length;
  document.getElementById("signal-count").textContent = `${positive} / ${negative}`;
  document.getElementById("data-source").textContent = payload.data_source === "yahoo_finance" ? "LIVE" : "DEMO";
  document.getElementById("data-source").className = payload.data_source === "yahoo_finance" ? "positive" : "neutral";
  document.getElementById("sidebar-feed-status").textContent = payload.data_source === "yahoo_finance" ? "Live via Yahoo Finance" : "Demo data · provider offline";
  document.getElementById("last-updated").textContent = `Updated ${new Date(payload.updated_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
  if (payload.warning) showToast(payload.warning);
}

function renderSignals() {
  const target = document.getElementById("signal-grid");
  if (!target) return;
  const selected = [...state.stocks].sort((a, b) => b.consensus.score - a.consensus.score).slice(0, 3);
  target.innerHTML = selected.map((stock) => {
    const consensus = stock.consensus;
    const heights = stock.history.slice(-10).map((point) => Math.max(4, Math.min(19, Math.round((point.close / Math.max(...stock.history.slice(-10).map((item) => item.close))) * 19))));
    return `<article class="signal-card" style="--signal: var(--${consensus.tone === "positive" ? "green" : consensus.tone === "negative" ? "red" : "muted"})">
      <div class="signal-top"><div class="signal-stock"><span class="stock-initial">${initials(stock.short_name)}</span><div><strong>${stock.short_name}</strong><span>${stock.sector}</span></div></div><span class="signal-badge ${toneClass(consensus.tone)}">${consensus.status}</span></div>
      <div class="signal-price"><strong>${money(stock.price)}</strong><span class="${toneClass(consensus.tone)}">${signedPercent(stock.change_percent)}</span></div>
      <div class="signal-footer"><span>${consensus.score}% confidence</span><span class="mini-bars">${heights.map((height) => `<i style="height:${height}px"></i>`).join("")}</span></div>
    </article>`;
  }).join("");
}

function renderTable() {
  const target = document.getElementById("stock-table");
  if (!target) return;
  const stocks = filteredStocks();
  target.innerHTML = stocks.length ? stocks.map((stock) => {
    const consensus = stock.consensus;
    const volumePercent = Math.min(100, Math.max(8, Math.round((consensus.volume_ratio || 1) * 45)));
    return `<tr data-symbol="${stock.symbol}">
      <td><div class="company-cell"><span class="ticker-avatar">${initials(stock.short_name)}</span><div><strong>${stock.name}</strong><span>${stock.short_name} · ${stock.sector}</span></div></div></td>
      <td>${money(stock.price)}</td>
      <td class="${toneClass(consensus.tone)}">${signedPercent(stock.change_percent)}</td>
      <td class="trend-cell ${stock.consensus.trend_percent < 0 ? "negative" : ""}">${signedPercent(consensus.trend_percent)}</td>
      <td><span class="volume-cell"><span class="volume-bar"><i style="width:${volumePercent}%"></i></span>${Number(consensus.volume_ratio || 1).toFixed(2)}x</span></td>
      <td><span class="signal-badge ${toneClass(consensus.tone)}">${consensus.status}</span></td>
      <td><button class="row-link" data-detail="${stock.symbol}" aria-label="Open ${stock.name} detail"><span class="row-arrow">→</span></button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="7"><span class="neutral">No stocks match this filter.</span></td></tr>`;
  document.getElementById("table-count").textContent = `Showing ${stocks.length} of ${state.stocks.length} stocks`;
}

function renderDetail(stock) {
  if (!stock) return;
  state.selected = stock;
  document.getElementById("live-view").classList.add("hidden");
  document.getElementById("detail-view").classList.remove("hidden");
  document.getElementById("detail-title").textContent = stock.name;
  document.getElementById("detail-subhead").textContent = `${stock.short_name} · ${stock.symbol} · ${stock.sector}`;
  document.getElementById("detail-price").textContent = money(stock.price);
  const change = document.getElementById("detail-change");
  change.textContent = `${signedPercent(stock.change_percent)} today`;
  change.className = `change-value ${toneClass(stock.consensus.tone)}`;
  const badge = document.getElementById("detail-badge");
  badge.textContent = stock.consensus.status;
  badge.className = `signal-badge ${toneClass(stock.consensus.tone)}`;
  document.getElementById("detail-score").textContent = `${stock.consensus.score}%`;
  document.getElementById("detail-reason").textContent = stock.consensus.reason;
  document.getElementById("detail-trend").textContent = signedPercent(stock.consensus.trend_percent);
  document.getElementById("detail-trend").className = toneClass(stock.consensus.tone);
  document.getElementById("detail-volume").textContent = `${Number(stock.consensus.volume_ratio || 1).toFixed(2)}x`;
  document.getElementById("detail-source").textContent = stock.data_source === "yahoo_finance" ? "Yahoo Finance" : "Demo fallback";
  drawChart(stock.history);
}

function drawChart(history) {
  const svg = document.getElementById("price-chart");
  if (!svg || !history.length) return;
  const width = 800, height = 280, padX = 5, padY = 16;
  const values = history.map((point) => Number(point.close));
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const points = values.map((value, index) => `${padX + index * ((width - padX * 2) / (values.length - 1))},${height - padY - ((value - min) / range) * (height - padY * 2)}`).join(" ");
  const area = `${padX},${height - padY} ${points} ${width - padX},${height - padY}`;
  svg.innerHTML = `<defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#31d17a" stop-opacity=".24"/><stop offset="100%" stop-color="#31d17a" stop-opacity="0"/></linearGradient></defs>
    <line class="grid-line" x1="0" y1="50" x2="${width}" y2="50"/><line class="grid-line" x1="0" y1="140" x2="${width}" y2="140"/><line class="grid-line" x1="0" y1="230" x2="${width}" y2="230"/>
    <polygon class="price-area" points="${area}"/><polyline class="price-line" points="${points}"/>`;
}

function isSessionOpen() {
  const parts = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const minutes = hour * 60 + minute;
  return new Date().getDay() >= 1 && new Date().getDay() <= 5 && minutes >= 555 && minutes <= 930;
}

async function loadMarket(forceRefresh = false) {
  const button = document.getElementById("refresh-button");
  button?.classList.toggle("loading", true);
  try {
    const response = await fetch(apiUrl(`/api/market${forceRefresh ? "?refresh=1" : ""}`));
    if (!response.ok) throw new Error("Market feed returned an error.");
    const payload = await response.json();
    state.stocks = payload.stocks || [];
    renderIndex(payload);
    renderSignals();
    renderTable();
    if (state.selected) renderDetail(state.stocks.find((stock) => stock.symbol === state.selected.symbol));
  } catch (error) {
    showToast(error.message || "Unable to load market feed.");
    document.getElementById("sidebar-feed-status").textContent = "Feed unavailable";
  } finally {
    button?.classList.toggle("loading", false);
  }
}

document.addEventListener("click", (event) => {
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    state.filter = filter.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("active", button === filter));
    renderTable();
    return;
  }
  const detailButton = event.target.closest("[data-detail]");
  if (detailButton) {
    const stock = state.stocks.find((item) => item.symbol === detailButton.dataset.detail);
    renderDetail(stock);
    return;
  }
  if (event.target.closest("#refresh-button")) loadMarket(true);
  if (event.target.closest(".back-link")) {
    event.preventDefault();
    document.getElementById("detail-view").classList.add("hidden");
    document.getElementById("live-view").classList.remove("hidden");
  }
});

document.getElementById("stock-search")?.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderTable();
});

setActiveNav();
if (activePage !== "learn") loadMarket();