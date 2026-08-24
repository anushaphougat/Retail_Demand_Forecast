/* ──────────────────────────────────────────────────────────────────────────
   Retail Demand Forecast Dashboard · app.js
────────────────────────────────────────────────────────────────────────── */

const API_BASE = (typeof window !== "undefined" && window.API_BASE_URL_OVERRIDE)
  ? window.API_BASE_URL_OVERRIDE.replace(/\/$/, "")
  : "http://127.0.0.1:8000";

// ── Chart instances ─────────────────────────────────────────────────────────
let forecastChartInstance = null;
let topMoversChartInstance = null;
let batchChartInstance = null;

// ── Batch state ─────────────────────────────────────────────────────────────
let batchResults = [];
let batchCsvData = [];

// ── Chart palette (blue family) ─────────────────────────────────────────────
const PALETTE = ["#2563eb","#3b82f6","#60a5fa","#93c5fd","#1d4ed8","#6366f1","#0284c7","#0ea5e9"];

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  plugins: {
    legend: {
      labels: { color: "#6b7280", font: { size: 12, family: "Inter" }, boxWidth: 14 },
      position: "top",
    },
    tooltip: {
      mode: "index",
      intersect: false,
      backgroundColor: "#1e2532",
      titleColor: "#f9fafb",
      bodyColor: "#9ca3af",
      borderColor: "#374151",
      borderWidth: 1,
      padding: 10,
      cornerRadius: 8,
    },
  },
  scales: {
    x: {
      ticks: { color: "#9ca3af", font: { size: 11, family: "Inter" } },
      grid:  { color: "rgba(0,0,0,0.04)" },
      border: { color: "#e8eaed" },
    },
    y: {
      ticks: { color: "#9ca3af", font: { size: 11, family: "Inter" } },
      grid:  { color: "rgba(0,0,0,0.04)" },
      border: { color: "#e8eaed" },
    },
  },
  interaction: { mode: "nearest", axis: "x", intersect: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

function initNav() {
  document.querySelectorAll(".nav-item").forEach(link => {
    link.addEventListener("click", e => { e.preventDefault(); switchTab(link.dataset.tab); });
  });

  document.querySelectorAll("[data-tab]").forEach(el => {
    if (el.tagName !== "A") el.addEventListener("click", () => switchTab(el.dataset.tab));
  });

  const hamburger = document.getElementById("hamburger");
  const sidebar   = document.getElementById("sidebar");
  hamburger?.addEventListener("click", () => sidebar.classList.toggle("open"));
  document.addEventListener("click", e => {
    if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target !== hamburger)
      sidebar.classList.remove("open");
  });
}

function switchTab(tabId) {
  document.querySelectorAll(".nav-item").forEach(l => l.classList.toggle("active", l.dataset.tab === tabId));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${tabId}`));
  const titles = { overview: "Overview", forecast: "SKU Forecast", topmovers: "Top Movers", batch: "Batch Forecast" };
  document.getElementById("topbarTitle").textContent = titles[tabId] ?? tabId;
  document.getElementById("sidebar")?.classList.remove("open");
}

// ─────────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────────

async function checkHealth() {
  updatePill(null);
  try {
    const r = await fetch(`${API_BASE}/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    onHealthSuccess(data);
  } catch (err) {
    onHealthError(err);
  }
}

function onHealthSuccess(data) {
  updatePill(true);

  setEl("kpiApiStatus", "Online");
  setEl("kpiModel",        data.model_loaded ? "Loaded ✓" : "Missing");
  setEl("kpiForecastRows", (data.forecast_rows ?? 0).toLocaleString());

  const card = document.getElementById("healthCard");
  card.style.display = "";
  document.getElementById("healthTimestamp").textContent =
    "Last checked " + new Date(data.timestamp).toLocaleTimeString();

  // Only show fields that matter — no Redis
  const items = [
    ["API Status",    data.status === "ok" ? "Online" : "Error",   data.status === "ok" ? "ok" : "error"],
    ["Model Loaded",  data.model_loaded ? "Yes" : "No",             data.model_loaded ? "ok" : "error"],
    ["Forecast Rows", (data.forecast_rows ?? 0).toLocaleString(), ""],
  ];

  document.getElementById("healthDetails").innerHTML = items.map(([k, v, cls]) => `
    <div class="health-item">
      <div class="health-item-key">${k}</div>
      <div class="health-item-val ${cls}">${v}</div>
    </div>`).join("");

  const banner = document.getElementById("overviewStatus");
  banner.style.display = "";
  banner.textContent   = `✓ Connected to API · ${(data.forecast_rows ?? 0).toLocaleString()} forecast rows loaded`;
  banner.className     = "status-banner ok";
}

function onHealthError(err) {
  updatePill(false);
  setEl("kpiApiStatus", "Offline");
  setEl("kpiModel", "—");
  setEl("kpiForecastRows", "—");
  document.getElementById("healthCard").style.display = "none";

  const banner = document.getElementById("overviewStatus");
  banner.style.display = "";
  banner.textContent   = `Cannot reach API at ${API_BASE}\n\nStart the backend: uvicorn serving.api.main:app --reload --port 8000`;
  banner.className     = "status-banner error";
}

function updatePill(ok) {
  const dot  = document.getElementById("pillDot");
  const lbl  = document.getElementById("pillLabel");
  const sdot = document.getElementById("sidebarDot");
  const stxt = document.getElementById("sidebarStatusText");

  if (ok === true) {
    dot.className  = "pill-dot ok";  lbl.textContent  = "API Online";
    sdot.className = "api-status-dot ok"; stxt.textContent = "API Online";
  } else if (ok === false) {
    dot.className  = "pill-dot error"; lbl.textContent  = "API Offline";
    sdot.className = "api-status-dot error"; stxt.textContent = "API Offline";
  } else {
    dot.className  = "pill-dot";      lbl.textContent  = "Checking…";
    sdot.className = "api-status-dot"; stxt.textContent = "Connecting…";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SKU Forecast
// ─────────────────────────────────────────────────────────────────────────────

async function fetchForecast() {
  const storeId = val("storeId");
  const skuId   = val("skuId");
  const horizon = Number(val("horizon")) || 14;

  if (!storeId || !skuId) {
    showBanner("forecastStatus", "Store ID and SKU ID are required.", "error");
    return;
  }

  showBanner("forecastStatus", "Fetching forecast…", "loading");
  hide("forecastChartCard"); hide("forecastTableCard");

  try {
    const r = await fetch(`${API_BASE}/forecast/${enc(storeId)}/${enc(skuId)}?horizon=${horizon}`);
    if (!r.ok) { const p = await r.json().catch(() => ({})); throw new Error(p.detail || r.statusText); }
    const payload = await r.json();
    renderForecast(payload);
    showBanner("forecastStatus",
      `✓ ${payload.forecasts.length} forecast points loaded · Cached: ${payload.cached ? "yes" : "no"}`,
      "ok");
  } catch (err) {
    showBanner("forecastStatus", `✗ ${err.message}`, "error");
  }
}

function renderForecast(payload) {
  const F      = payload.forecasts;
  const labels = F.map(f => fmtDate(f.forecast_date));
  const vals   = F.map(f => f.predicted_qty);
  const lower  = F.map(f => f.lower_95);
  const upper  = F.map(f => f.upper_95);

  setEl("forecastSummaryBadge", `${payload.store_id} / ${payload.sku_id} · ${payload.horizon}d`);

  const total = vals.reduce((a,b)=>a+b,0);
  const avg   = Math.round(total / vals.length);
  const peak  = Math.max(...vals);
  document.getElementById("forecastMeta").innerHTML = `
    <span class="meta-item">Total: <strong>${total.toLocaleString()}</strong></span>
    <span class="meta-item">Avg/day: <strong>${avg.toLocaleString()}</strong></span>
    <span class="meta-item">Peak: <strong>${peak.toLocaleString()}</strong></span>
    <span class="meta-item">Store: <strong>${payload.store_id}</strong></span>
    <span class="meta-item">SKU: <strong>${payload.sku_id}</strong></span>
  `;

  show("forecastChartCard");
  if (forecastChartInstance) forecastChartInstance.destroy();
  forecastChartInstance = new Chart(
    document.getElementById("forecastChart").getContext("2d"),
    {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Upper 95%", data: upper, borderColor: "transparent",
            backgroundColor: "rgba(37,99,235,0.07)", fill: "+1", pointRadius: 0, tension: 0.35 },
          { label: "Predicted Qty", data: vals, borderColor: "#2563eb",
            backgroundColor: "rgba(37,99,235,0.08)", tension: 0.35,
            pointRadius: 3, pointBackgroundColor: "#2563eb", borderWidth: 2, fill: false },
          { label: "Lower 95%", data: lower, borderColor: "transparent",
            backgroundColor: "rgba(37,99,235,0.07)", fill: "-1", pointRadius: 0, tension: 0.35 },
        ],
      },
      options: { ...CHART_DEFAULTS },
    }
  );

  show("forecastTableCard");
  document.getElementById("forecastTableBody").innerHTML = F.map(f => `
    <tr>
      <td>${fmtDate(f.forecast_date)}</td>
      <td><strong>${f.predicted_qty.toLocaleString()}</strong></td>
      <td>${f.lower_95.toLocaleString()}</td>
      <td>${f.upper_95.toLocaleString()}</td>
      <td><span class="uncertainty-pill">± ${(f.upper_95 - f.lower_95).toLocaleString()}</span></td>
    </tr>`).join("");

  window._forecastCsvData = [
    ["date","predicted_qty","lower_95","upper_95"],
    ...F.map(f => [f.forecast_date, f.predicted_qty, f.lower_95, f.upper_95]),
  ];
}

function clearForecast() {
  hide("forecastChartCard"); hide("forecastTableCard"); hide("forecastStatus");
}

// ─────────────────────────────────────────────────────────────────────────────
// Top Movers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTopMovers() {
  const storeId = val("tmStoreId");
  const days    = Number(val("tmDays")) || 7;

  if (!storeId) { showBanner("topMoversStatus", "Store ID is required.", "error"); return; }

  showBanner("topMoversStatus", "Fetching top movers…", "loading");
  hide("topMoversResults");

  try {
    const r = await fetch(`${API_BASE}/forecast/top-movers/${enc(storeId)}?days=${days}`);
    if (!r.ok) { const p = await r.json().catch(() => ({})); throw new Error(p.detail || r.statusText); }
    const rows = await r.json();
    renderTopMovers(rows, storeId, days);
    showBanner("topMoversStatus", `✓ Top ${rows.length} SKUs loaded for ${storeId}`, "ok");
  } catch (err) {
    showBanner("topMoversStatus", `✗ ${err.message}`, "error");
  }
}

function renderTopMovers(rows, storeId, days) {
  const qtyKey = Object.keys(rows[0] || {}).find(k => k.startsWith("total_")) ?? "predicted_qty";
  setEl("tmStoreBadge", `${storeId} · ${days}d`);
  show("topMoversResults");

  if (topMoversChartInstance) topMoversChartInstance.destroy();
  topMoversChartInstance = new Chart(
    document.getElementById("topMoversChart").getContext("2d"),
    {
      type: "bar",
      data: {
        labels: rows.map(r => r.sku_id),
        datasets: [{
          label: `Forecasted Qty`,
          data: rows.map(r => r[qtyKey] ?? r.predicted_qty),
          backgroundColor: rows.map((_, i) =>
            i === 0 ? "#1e40af" : i < 3 ? "#2563eb" : "#93c5fd"
          ),
          borderRadius: 5,
          borderSkipped: false,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        indexAxis: "y",
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
      },
    }
  );

  document.getElementById("topMoversTableBody").innerHTML = rows.map((row, i) => {
    const qty = row[qtyKey] ?? row.predicted_qty ?? "—";
    return `<tr>
      <td><span class="rank-num ${i < 3 ? "top-3" : ""}">${i + 1}</span></td>
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
  const storeId = val("batchStoreId");
  const horizon = Number(val("batchHorizon")) || 14;
  const skuIds  = document.getElementById("batchSkuIds").value
    .split(/[\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, 100);

  if (!storeId || !skuIds.length) {
    showBanner("batchStatus", "Store ID and at least one SKU ID are required.", "error");
    return;
  }

  showBanner("batchStatus", `Running batch forecast for ${skuIds.length} SKUs…`, "loading");
  hide("batchResultsCard");

  try {
    const r = await fetch(`${API_BASE}/forecast/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_id: storeId, sku_ids: skuIds, horizon }),
    });
    if (!r.ok) { const p = await r.json().catch(() => ({})); throw new Error(p.detail || r.statusText); }
    const payload = await r.json();
    batchResults  = payload.results;

    // Build CSV
    batchCsvData = [["store_id","sku_id","date","predicted_qty","lower_95","upper_95"]];
    for (const res of payload.results)
      for (const f of res.forecasts)
        batchCsvData.push([payload.store_id, res.sku_id, f.forecast_date, f.predicted_qty, f.lower_95, f.upper_95]);

    setEl("batchSummaryBadge", `${payload.results.length} of ${skuIds.length} SKUs`);
    show("batchResultsCard");
    show("downloadBatchCsv");

    document.getElementById("batchSkuTabs").innerHTML = payload.results.map((res, i) =>
      `<button class="sku-tab-btn ${i === 0 ? "active" : ""}" onclick="selectBatchSku(${i})">${res.sku_id}</button>`
    ).join("");

    selectBatchSku(0);
    showBanner("batchStatus", `✓ Batch complete — ${payload.results.length} SKUs returned`, "ok");
  } catch (err) {
    showBanner("batchStatus", `✗ ${err.message}`, "error");
  }
}

function selectBatchSku(idx) {
  document.querySelectorAll(".sku-tab-btn").forEach((b, i) => b.classList.toggle("active", i === idx));
  const res = batchResults[idx];
  if (!res) return;

  const labels = res.forecasts.map(f => fmtDate(f.forecast_date));
  const vals   = res.forecasts.map(f => f.predicted_qty);
  const lower  = res.forecasts.map(f => f.lower_95);
  const upper  = res.forecasts.map(f => f.upper_95);
  const color  = PALETTE[idx % PALETTE.length];

  show("batchChartWrap");
  if (batchChartInstance) batchChartInstance.destroy();
  batchChartInstance = new Chart(
    document.getElementById("batchChart").getContext("2d"),
    {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Upper 95%", data: upper, borderColor: "transparent",
            backgroundColor: "rgba(37,99,235,0.07)", fill: "+1", pointRadius: 0, tension: 0.35 },
          { label: res.sku_id, data: vals, borderColor: color,
            backgroundColor: "rgba(37,99,235,0.08)", tension: 0.35,
            pointRadius: 3, pointBackgroundColor: color, borderWidth: 2, fill: false },
          { label: "Lower 95%", data: lower, borderColor: "transparent",
            backgroundColor: "rgba(37,99,235,0.07)", fill: "-1", pointRadius: 0, tension: 0.35 },
        ],
      },
      options: { ...CHART_DEFAULTS },
    }
  );

  show("batchTableWrap");
  document.getElementById("batchTableBody").innerHTML = res.forecasts.map(f => `
    <tr>
      <td>${fmtDate(f.forecast_date)}</td>
      <td><strong>${f.predicted_qty.toLocaleString()}</strong></td>
      <td>${f.lower_95.toLocaleString()}</td>
      <td>${f.upper_95.toLocaleString()}</td>
    </tr>`).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Ops
// ─────────────────────────────────────────────────────────────────────────────

async function triggerRetrain() {
  const btn = document.getElementById("triggerRetrain");
  btn.textContent = "↺ Retraining…"; btn.disabled = true;
  try {
    const r = await fetch(`${API_BASE}/retrain`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    const banner = document.getElementById("overviewStatus");
    banner.style.display = ""; banner.className = "status-banner ok";
    banner.textContent = `✓ Retraining triggered at ${new Date(d.timestamp).toLocaleString()}`;
  } catch (err) {
    const banner = document.getElementById("overviewStatus");
    banner.style.display = ""; banner.className = "status-banner error";
    banner.textContent = `✗ Retrain failed: ${err.message}`;
  } finally {
    btn.textContent = "↺ Trigger Retrain"; btn.disabled = false;
  }
}

async function invalidateCache() {
  const btn = document.getElementById("invalidateCache");
  btn.textContent = "⊘ Clearing…"; btn.disabled = true;
  try {
    const r = await fetch(`${API_BASE}/cache/invalidate`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    const banner = document.getElementById("overviewStatus");
    banner.style.display = ""; banner.className = "status-banner ok";
    banner.textContent = d.status === "no_cache"
      ? "ℹ No cache active — nothing to clear."
      : `✓ Cache cleared — ${d.keys_deleted ?? 0} entries removed.`;
  } catch (err) {
    const banner = document.getElementById("overviewStatus");
    banner.style.display = ""; banner.className = "status-banner error";
    banner.textContent = `✗ Cache clear failed: ${err.message}`;
  } finally {
    btn.textContent = "⊘ Clear Cache"; btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(str) {
  return new Date(str).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function enc(s)    { return encodeURIComponent(s); }
function val(id)   { return (document.getElementById(id)?.value ?? "").trim(); }
function setEl(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function show(id)  { const el = document.getElementById(id); if (el) el.style.display = ""; }
function hide(id)  { const el = document.getElementById(id); if (el) el.style.display = "none"; }

function showBanner(id, msg, type = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = "";
  el.textContent   = msg;
  el.className     = "status-banner" + (type ? ` ${type}` : "");
}

function downloadCsv(rows, filename) {
  const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  initNav();

  document.getElementById("refreshHealth")?.addEventListener("click", checkHealth);
  document.getElementById("fetchForecast")?.addEventListener("click", fetchForecast);
  document.getElementById("clearForecast")?.addEventListener("click", clearForecast);
  document.getElementById("downloadCsv")?.addEventListener("click", () => {
    if (window._forecastCsvData) downloadCsv(window._forecastCsvData, "forecast.csv");
  });
  document.getElementById("fetchTopMovers")?.addEventListener("click", fetchTopMovers);
  document.getElementById("runBatchForecast")?.addEventListener("click", runBatchForecast);
  document.getElementById("downloadBatchCsv")?.addEventListener("click", () => {
    if (batchCsvData.length) downloadCsv(batchCsvData, "batch_forecast.csv");
  });
  document.getElementById("triggerRetrain")?.addEventListener("click", triggerRetrain);
  document.getElementById("invalidateCache")?.addEventListener("click", invalidateCache);

  checkHealth();
});

window.selectBatchSku = selectBatchSku;
window.jumpToSku      = jumpToSku;
