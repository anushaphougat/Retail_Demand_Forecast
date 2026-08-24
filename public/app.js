/* ──────────────────────────────────────────────────────────────────────────
   Retail Demand Forecast Dashboard · app.js
   Full rewrite: sidebar nav, health panel, SKU forecast, top movers, batch
────────────────────────────────────────────────────────────────────────── */

// ── API base URL ────────────────────────────────────────────────────────────
let API_BASE = (typeof window !== "undefined" && window.API_BASE_URL_OVERRIDE)
  ? window.API_BASE_URL_OVERRIDE
  : "http://127.0.0.1:8000";

// ── Chart instances ─────────────────────────────────────────────────────────
let forecastChartInstance = null;
let topMoversChartInstance = null;
let batchChartInstance = null;

// ── Batch state ─────────────────────────────────────────────────────────────
let batchResults = [];
let batchCsvData = [];
let currentBatchSkuIdx = 0;

// ── Chart palette ───────────────────────────────────────────────────────────
const PALETTE = [
  "#6c63ff", "#22c55e", "#f59e0b", "#ef4444",
  "#06b6d4", "#ec4899", "#a78bfa", "#34d399",
];

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  plugins: {
    legend: {
      labels: { color: "#7b8199", font: { size: 12 }, boxWidth: 14 },
      position: "top",
    },
    tooltip: { mode: "index", intersect: false, backgroundColor: "#181c27",
      titleColor: "#e8eaf0", bodyColor: "#7b8199", borderColor: "#ffffff14",
      borderWidth: 1, padding: 10 },
  },
  scales: {
    x: {
      ticks: { color: "#7b8199", font: { size: 11 } },
      grid: { color: "rgba(255,255,255,0.05)" },
    },
    y: {
      ticks: { color: "#7b8199", font: { size: 11 } },
      grid: { color: "rgba(255,255,255,0.05)" },
    },
  },
  interaction: { mode: "nearest", axis: "x", intersect: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar / Tab navigation
// ─────────────────────────────────────────────────────────────────────────────

function initNav() {
  document.querySelectorAll(".nav-item").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      switchTab(link.dataset.tab);
    });
  });

  document.querySelectorAll("[data-tab]").forEach(el => {
    if (el.tagName !== "A") {
      el.addEventListener("click", () => switchTab(el.dataset.tab));
    }
  });

  const hamburger = document.getElementById("hamburger");
  const sidebar   = document.getElementById("sidebar");
  hamburger?.addEventListener("click", () => sidebar.classList.toggle("open"));
  document.addEventListener("click", e => {
    if (sidebar.classList.contains("open") &&
        !sidebar.contains(e.target) && e.target !== hamburger) {
      sidebar.classList.remove("open");
    }
  });
}

function switchTab(tabId) {
  document.querySelectorAll(".nav-item").forEach(l =>
    l.classList.toggle("active", l.dataset.tab === tabId)
  );
  document.querySelectorAll(".tab-panel").forEach(p =>
    p.classList.toggle("active", p.id === `tab-${tabId}`)
  );
  const titles = { overview: "Overview", forecast: "SKU Forecast",
                   topmovers: "Top Movers", batch: "Batch Forecast" };
  document.getElementById("topbarTitle").textContent = titles[tabId] ?? tabId;
  document.getElementById("sidebar")?.classList.remove("open");
}

// ─────────────────────────────────────────────────────────────────────────────
// Health / connection
// ─────────────────────────────────────────────────────────────────────────────

async function checkHealth() {
  setStatusBox("overviewStatus", "Connecting to API…", "loading");
  updateBadge(null);

  try {
    const r = await fetch(`${API_BASE}/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    onHealthSuccess(data);
    return true;
  } catch (err) {
    onHealthError(err);
    return false;
  }
}

function onHealthSuccess(data) {
  const msg = `Connected · ${data.forecast_rows?.toLocaleString() ?? "?"} forecast rows`;
  setStatusBox("overviewStatus", "✓ " + msg, "ok");
  updateBadge(true);

  // KPI cards
  setEl("kpiApiStatus", "Online");
  setEl("kpiModel",     data.model_loaded ? "Loaded ✓" : "Missing ✗");
  setEl("kpiForecastRows", (data.forecast_rows ?? 0).toLocaleString());
  setEl("kpiRedis",     data.redis_ok ? "Active" : "Offline");

  // Health details card
  const card = document.getElementById("healthCard");
  card.style.display = "block";
  document.getElementById("healthTimestamp").textContent =
    new Date(data.timestamp).toLocaleString();

  const items = [
    ["Status",         data.status, data.status === "ok" ? "ok" : "error"],
    ["Model Loaded",   data.model_loaded ? "Yes" : "No", data.model_loaded ? "ok" : "error"],
    ["Redis Cache",    data.redis_ok    ? "Active" : "Offline", data.redis_ok ? "ok" : "error"],
    ["Forecast Rows",  (data.forecast_rows ?? 0).toLocaleString(), ""],
  ];

  document.getElementById("healthDetails").innerHTML = items.map(([k,v,cls]) => `
    <div class="health-item">
      <div class="health-item-key">${k}</div>
      <div class="health-item-val ${cls}">${v}</div>
    </div>`).join("");
}

function onHealthError(err) {
  setStatusBox("overviewStatus",
    `✗ Cannot reach API at ${API_BASE} — ${err.message || "connection refused"}\n\nStart the backend: uvicorn serving.api.main:app --reload --port 8000`,
    "error");
  updateBadge(false);
  setEl("kpiApiStatus", "Offline");
  setEl("kpiModel", "—");
  setEl("kpiForecastRows", "—");
  setEl("kpiRedis", "—");
  document.getElementById("healthCard").style.display = "none";
}

function updateBadge(ok) {
  const dot  = document.getElementById("badgeDot");
  const lbl  = document.getElementById("badgeLabel");
  const sdot = document.getElementById("sidebarDot");
  const stxt = document.getElementById("sidebarStatusText");

  if (ok === true) {
    dot.className = "badge-dot ok"; lbl.textContent = "API Online";
    sdot.className = "api-status-dot ok"; stxt.textContent = "API Online";
  } else if (ok === false) {
    dot.className = "badge-dot error"; lbl.textContent = "API Offline";
    sdot.className = "api-status-dot error"; stxt.textContent = "API Offline";
  } else {
    dot.className = "badge-dot"; lbl.textContent = "Checking…";
    sdot.className = "api-status-dot"; stxt.textContent = "Connecting…";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SKU Forecast
// ─────────────────────────────────────────────────────────────────────────────

async function fetchForecast() {
  const storeId = document.getElementById("storeId").value.trim();
  const skuId   = document.getElementById("skuId").value.trim();
  const horizon = Number(document.getElementById("horizon").value) || 14;

  if (!storeId || !skuId) {
    showStatus("forecastStatus", "Store ID and SKU ID are required.", "error");
    return;
  }

  showStatus("forecastStatus", "Fetching forecast…", "loading");
  hide("forecastChartCard");
  hide("forecastTableCard");

  try {
    const r = await fetch(`${API_BASE}/forecast/${enc(storeId)}/${enc(skuId)}?horizon=${horizon}`);
    if (!r.ok) {
      const payload = await r.json().catch(() => ({}));
      throw new Error(payload.detail || r.statusText);
    }
    const payload = await r.json();
    renderForecast(payload);
    showStatus("forecastStatus",
      `✓ Loaded ${payload.forecasts.length} forecast points · Cached: ${payload.cached ? "yes" : "no"}`,
      "ok");
  } catch (err) {
    showStatus("forecastStatus", `✗ ${err.message}`, "error");
  }
}

function renderForecast(payload) {
  const forecasts = payload.forecasts;
  const labels  = forecasts.map(f => fmtDate(f.forecast_date));
  const vals    = forecasts.map(f => f.predicted_qty);
  const lower   = forecasts.map(f => f.lower_95);
  const upper   = forecasts.map(f => f.upper_95);

  // Summary badge
  setEl("forecastSummaryBadge",
    `${payload.store_id} / ${payload.sku_id} · ${payload.horizon}d horizon`);

  // Meta row
  const avgQty   = Math.round(vals.reduce((a,b) => a+b, 0) / vals.length);
  const maxQty   = Math.max(...vals);
  const totalQty = vals.reduce((a,b) => a+b, 0);
  document.getElementById("forecastMeta").innerHTML = `
    <span class="meta-item">Total Qty: <strong>${totalQty.toLocaleString()}</strong></span>
    <span class="meta-item">Avg/day: <strong>${avgQty.toLocaleString()}</strong></span>
    <span class="meta-item">Peak: <strong>${maxQty.toLocaleString()}</strong></span>
    <span class="meta-item">Store: <strong>${payload.store_id}</strong></span>
    <span class="meta-item">SKU: <strong>${payload.sku_id}</strong></span>
  `;

  // Chart
  show("forecastChartCard");
  if (forecastChartInstance) forecastChartInstance.destroy();
  const ctx = document.getElementById("forecastChart").getContext("2d");

  forecastChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Upper 95%",
          data: upper,
          borderColor: "transparent",
          backgroundColor: "rgba(108,99,255,0.10)",
          fill: "+1",
          pointRadius: 0,
          tension: 0.3,
        },
        {
          label: "Predicted Qty",
          data: vals,
          borderColor: "#6c63ff",
          backgroundColor: "rgba(108,99,255,0.18)",
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: "#6c63ff",
          borderWidth: 2.5,
          fill: false,
        },
        {
          label: "Lower 95%",
          data: lower,
          borderColor: "transparent",
          backgroundColor: "rgba(108,99,255,0.10)",
          fill: "-1",
          pointRadius: 0,
          tension: 0.3,
        },
      ],
    },
    options: { ...CHART_DEFAULTS },
  });

  // Table
  show("forecastTableCard");
  document.getElementById("forecastTableBody").innerHTML = forecasts.map(f => {
    const range = f.upper_95 - f.lower_95;
    return `<tr>
      <td>${fmtDate(f.forecast_date)}</td>
      <td><strong>${f.predicted_qty.toLocaleString()}</strong></td>
      <td>${f.lower_95.toLocaleString()}</td>
      <td>${f.upper_95.toLocaleString()}</td>
      <td><span class="uncertainty-pill">± ${range.toLocaleString()}</span></td>
    </tr>`;
  }).join("");

  // CSV download
  window._forecastCsvData = [
    ["date","predicted_qty","lower_95","upper_95"],
    ...forecasts.map(f => [f.forecast_date, f.predicted_qty, f.lower_95, f.upper_95])
  ];
}

function clearForecast() {
  hide("forecastChartCard");
  hide("forecastTableCard");
  hide("forecastStatus");
}

// CSV download helper
function downloadCsv(rows, filename) {
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Top Movers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTopMovers() {
  const storeId = document.getElementById("tmStoreId").value.trim();
  const days    = Number(document.getElementById("tmDays").value) || 7;

  if (!storeId) {
    showStatus("topMoversStatus", "Store ID is required.", "error");
    return;
  }

  showStatus("topMoversStatus", "Fetching top movers…", "loading");
  hide("topMoversResults");

  try {
    const r = await fetch(`${API_BASE}/forecast/top-movers/${enc(storeId)}?days=${days}`);
    if (!r.ok) {
      const payload = await r.json().catch(() => ({}));
      throw new Error(payload.detail || r.statusText);
    }
    const rows = await r.json();
    renderTopMovers(rows, storeId, days);
    showStatus("topMoversStatus", `✓ Loaded ${rows.length} top-moving SKUs`, "ok");
  } catch (err) {
    showStatus("topMoversStatus", `✗ ${err.message}`, "error");
  }
}

function renderTopMovers(rows, storeId, days) {
  const qtyKey = Object.keys(rows[0] || {}).find(k => k.startsWith("total_")) ?? "predicted_qty";

  setEl("tmStoreBadge", `${storeId} · ${days}d window`);
  show("topMoversResults");

  // Bar chart
  if (topMoversChartInstance) topMoversChartInstance.destroy();
  const ctx = document.getElementById("topMoversChart").getContext("2d");
  topMoversChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map(r => r.sku_id),
      datasets: [{
        label: `Total Forecasted Qty (${days}d)`,
        data: rows.map(r => r[qtyKey] ?? r.predicted_qty),
        backgroundColor: PALETTE[0],
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: "y",
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
      },
    },
  });

  // Table
  document.getElementById("topMoversTableBody").innerHTML = rows.map((row, i) => {
    const qty = row[qtyKey] ?? row.predicted_qty ?? "—";
    const isTop = i < 3;
    return `<tr>
      <td><span class="rank-badge ${isTop ? "top" : ""}">${i + 1}</span></td>
      <td><strong>${row.sku_id}</strong></td>
      <td>${Number(qty).toLocaleString()}</td>
      <td><button class="link-btn" onclick="jumpToSku('${storeId}','${row.sku_id}')">View →</button></td>
    </tr>`;
  }).join("");
}

function jumpToSku(storeId, skuId) {
  document.getElementById("storeId").value = storeId;
  document.getElementById("skuId").value   = skuId;
  switchTab("forecast");
  fetchForecast();
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Forecast
// ─────────────────────────────────────────────────────────────────────────────

async function runBatchForecast() {
  const storeId = document.getElementById("batchStoreId").value.trim();
  const horizon = Number(document.getElementById("batchHorizon").value) || 14;
  const raw     = document.getElementById("batchSkuIds").value;
  const skuIds  = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, 100);

  if (!storeId || !skuIds.length) {
    showStatus("batchStatus", "Store ID and at least one SKU ID are required.", "error");
    return;
  }

  showStatus("batchStatus", `Fetching batch forecast for ${skuIds.length} SKUs…`, "loading");
  hide("batchResultsCard");

  try {
    const r = await fetch(`${API_BASE}/forecast/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_id: storeId, sku_ids: skuIds, horizon }),
    });
    if (!r.ok) {
      const payload = await r.json().catch(() => ({}));
      throw new Error(payload.detail || r.statusText);
    }
    const payload = await r.json();
    batchResults = payload.results;
    renderBatchResults(payload, skuIds.length);
    showStatus("batchStatus",
      `✓ Batch complete: ${payload.results.length}/${skuIds.length} SKUs returned`, "ok");
    show("downloadBatchCsv");
  } catch (err) {
    showStatus("batchStatus", `✗ ${err.message}`, "error");
  }
}

function renderBatchResults(payload, requestedCount) {
  if (!payload.results?.length) {
    showStatus("batchStatus", "No results returned for the given SKUs.", "error");
    return;
  }

  setEl("batchSummaryBadge",
    `${payload.store_id} · ${payload.results.length} of ${requestedCount} SKUs`);
  show("batchResultsCard");

  // SKU selector tabs
  const tabsEl = document.getElementById("batchSkuTabs");
  tabsEl.innerHTML = payload.results.map((res, i) => `
    <button class="sku-tab-btn ${i === 0 ? "active" : ""}"
            onclick="selectBatchSku(${i})">${res.sku_id}</button>
  `).join("");

  // Build CSV data for all SKUs
  batchCsvData = [["store_id","sku_id","date","predicted_qty","lower_95","upper_95"]];
  for (const res of payload.results) {
    for (const f of res.forecasts) {
      batchCsvData.push([payload.store_id, res.sku_id, f.forecast_date,
        f.predicted_qty, f.lower_95, f.upper_95]);
    }
  }

  selectBatchSku(0);
}

function selectBatchSku(idx) {
  currentBatchSkuIdx = idx;
  document.querySelectorAll(".sku-tab-btn").forEach((btn, i) =>
    btn.classList.toggle("active", i === idx)
  );

  const res = batchResults[idx];
  if (!res) return;

  const labels = res.forecasts.map(f => fmtDate(f.forecast_date));
  const vals   = res.forecasts.map(f => f.predicted_qty);
  const lower  = res.forecasts.map(f => f.lower_95);
  const upper  = res.forecasts.map(f => f.upper_95);
  const color  = PALETTE[idx % PALETTE.length];

  // Chart
  show("batchChartWrap");
  if (batchChartInstance) batchChartInstance.destroy();
  const ctx = document.getElementById("batchChart").getContext("2d");
  batchChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Upper 95%", data: upper, borderColor: "transparent",
          backgroundColor: hexAlpha(color, 0.12), fill: "+1", pointRadius: 0, tension: 0.3 },
        { label: res.sku_id, data: vals, borderColor: color,
          backgroundColor: hexAlpha(color, 0.18), tension: 0.3, pointRadius: 3,
          pointBackgroundColor: color, borderWidth: 2.5, fill: false },
        { label: "Lower 95%", data: lower, borderColor: "transparent",
          backgroundColor: hexAlpha(color, 0.12), fill: "-1", pointRadius: 0, tension: 0.3 },
      ],
    },
    options: { ...CHART_DEFAULTS },
  });

  // Table
  show("batchTableWrap");
  document.getElementById("batchTableBody").innerHTML = res.forecasts.map(f => `<tr>
    <td>${fmtDate(f.forecast_date)}</td>
    <td><strong>${f.predicted_qty.toLocaleString()}</strong></td>
    <td>${f.lower_95.toLocaleString()}</td>
    <td>${f.upper_95.toLocaleString()}</td>
  </tr>`).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Ops actions
// ─────────────────────────────────────────────────────────────────────────────

async function triggerRetrain() {
  const btn = document.getElementById("triggerRetrain");
  btn.textContent = "🔄 Retraining…";
  btn.disabled = true;
  try {
    const r = await fetch(`${API_BASE}/retrain`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setStatusBox("overviewStatus", `✓ Retraining triggered at ${new Date(d.timestamp).toLocaleString()}`, "ok");
  } catch (err) {
    setStatusBox("overviewStatus", `✗ Retrain failed: ${err.message}`, "error");
  } finally {
    btn.textContent = "🔄 Trigger Retrain";
    btn.disabled = false;
  }
}

async function invalidateCache() {
  const btn = document.getElementById("invalidateCache");
  btn.textContent = "🗑️ Invalidating…";
  btn.disabled = true;
  try {
    const r = await fetch(`${API_BASE}/cache/invalidate`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setStatusBox("overviewStatus",
      d.status === "no_cache"
        ? "ℹ Redis not connected — no cache to invalidate."
        : `✓ Cache invalidated — ${d.keys_deleted ?? 0} keys deleted.`,
      "ok");
  } catch (err) {
    setStatusBox("overviewStatus", `✗ Invalidate failed: ${err.message}`, "error");
  } finally {
    btn.textContent = "🗑️ Invalidate Cache";
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(str) {
  const d = new Date(str);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function enc(s) { return encodeURIComponent(s); }
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function show(id) { const el = document.getElementById(id); if (el) el.style.display = ""; }
function hide(id) { const el = document.getElementById(id); if (el) el.style.display = "none"; }

function showStatus(id, msg, type = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = "";
  el.textContent = msg;
  el.className = "status-box" + (type ? ` ${type}` : "");
}

function setStatusBox(id, msg, type = "") {
  showStatus(id, msg, type);
}

function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  initNav();

  // Pre-fill API URL input
  const apiInput = document.getElementById("apiBaseUrlInput");
  if (apiInput) apiInput.value = API_BASE;

  // Connect button
  document.getElementById("applyApiUrl")?.addEventListener("click", () => {
    const val = document.getElementById("apiBaseUrlInput").value.trim();
    if (val) { API_BASE = val.replace(/\/$/, ""); checkHealth(); }
  });

  // Refresh health
  document.getElementById("refreshHealth")?.addEventListener("click", checkHealth);

  // Forecast
  document.getElementById("fetchForecast")?.addEventListener("click", fetchForecast);
  document.getElementById("clearForecast")?.addEventListener("click", clearForecast);
  document.getElementById("downloadCsv")?.addEventListener("click", () => {
    if (window._forecastCsvData) downloadCsv(window._forecastCsvData, "forecast.csv");
  });

  // Top movers
  document.getElementById("fetchTopMovers")?.addEventListener("click", fetchTopMovers);

  // Batch
  document.getElementById("runBatchForecast")?.addEventListener("click", runBatchForecast);
  document.getElementById("downloadBatchCsv")?.addEventListener("click", () => {
    if (batchCsvData.length) downloadCsv(batchCsvData, "batch_forecast.csv");
  });

  // Ops
  document.getElementById("triggerRetrain")?.addEventListener("click", triggerRetrain);
  document.getElementById("invalidateCache")?.addEventListener("click", invalidateCache);

  // Auto-connect
  checkHealth();
});

// expose for inline handlers
window.selectBatchSku = selectBatchSku;
window.jumpToSku      = jumpToSku;
