const API_BASE_URL = (typeof window !== "undefined" && window.API_BASE_URL_OVERRIDE)
  ? window.API_BASE_URL_OVERRIDE
  : "http://127.0.0.1:8000";
const storeIdInput = document.getElementById("storeId");
const skuIdInput = document.getElementById("skuId");
const horizonInput = document.getElementById("horizon");
const fetchForecastBtn = document.getElementById("fetchForecast");
const fetchTopMoversBtn = document.getElementById("fetchTopMovers");
const statusMessage = document.getElementById("statusMessage");
const topMoversPanel = document.getElementById("topMoversPanel");
const forecastSummary = document.getElementById("forecastSummary");
const topMoversSummary = document.getElementById("topMoversSummary");
const forecastTable = document.getElementById("forecastTable");
const forecastTableBody = forecastTable.querySelector("tbody");
const topMoversTable = document.getElementById("topMoversTable").querySelector("tbody");
const forecastPlaceholder = document.getElementById("forecastPlaceholder");
const chartCanvas = document.getElementById("forecastChart");
let chartInstance = null;
let apiConnected = false;

async function checkApiConnection() {
  setStatus("Checking local API connection...");
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) {
      throw new Error("API health endpoint returned an error");
    }
    apiConnected = true;
    setStatus("Connected to local API.");
    return true;
  } catch (error) {
    apiConnected = false;
    setStatus("Local API unavailable at http://127.0.0.1:8000. Start the backend and retry.", true);
    return false;
  }
}

function getApiUrl() {
  return API_BASE_URL;
}

function setStatus(text, error = false) {
  statusMessage.textContent = text;
  statusMessage.classList.toggle("status--error", error);
}

function ensurePanel(panel, visible) {
  panel.hidden = !visible;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderForecastChart(labels, values, lower, upper) {
  ensurePanel(forecastTable.closest(".panel"), true);
  forecastTable.hidden = false;
  forecastPlaceholder.hidden = true;

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Predicted quantity",
          data: values,
          borderColor: "#111111",
          backgroundColor: "rgba(17, 17, 17, 0.08)",
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: "#111111",
          fill: true,
        },
        {
          label: "Lower 95%",
          data: lower,
          borderColor: "#4b5563",
          borderDash: [6, 4],
          tension: 0.3,
          pointRadius: 0,
          fill: false,
        },
        {
          label: "Upper 95%",
          data: upper,
          borderColor: "#6b7280",
          borderDash: [6, 4],
          tension: 0.3,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450 },
      scales: {
        x: {
          ticks: { color: "#111111" },
          grid: { color: "rgba(17,24,39,0.08)" },
        },
        y: {
          ticks: { color: "#111111" },
          grid: { color: "rgba(17,24,39,0.08)" },
        },
      },
      plugins: {
        legend: { labels: { color: "#111111" }, position: "top" },
        tooltip: { mode: "index", intersect: false },
      },
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
    },
  });
}

function renderForecastTable(rows) {
  forecastTableBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(row.forecast_date)}</td>
      <td>${row.predicted_qty}</td>
      <td>${row.lower_95}</td>
      <td>${row.upper_95}</td>
    `;
    forecastTableBody.appendChild(tr);
  });
}

function renderTopMoversTable(rows, storeId) {
  topMoversTable.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.sku_id}</td>
      <td>${row.total_7d_qty ?? row.total_30d_qty ?? row.predicted_qty ?? "-"}</td>
    `;
    topMoversTable.appendChild(tr);
  });
  topMoversSummary.textContent = `Top movers for ${storeId}`;
  ensurePanel(topMoversPanel, true);
}

async function fetchForecast() {
  const storeId = storeIdInput.value.trim();
  const skuId = skuIdInput.value.trim();
  const horizon = Number(horizonInput.value) || 14;
  const apiUrl = getApiUrl();

  if (!storeId || !skuId) {
    setStatus("Store ID and SKU ID are required.", true);
    return;
  }

  if (!apiConnected && !(await checkApiConnection())) {
    return;
  }

  setStatus("Requesting forecast...");
  ensurePanel(topMoversPanel, false);
  forecastTable.hidden = true;
  forecastPlaceholder.hidden = false;

  try {
    const response = await fetch(`${apiUrl}/forecast/${encodeURIComponent(storeId)}/${encodeURIComponent(skuId)}?horizon=${horizon}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || response.statusText || "Unable to fetch forecast.");
    }

    const payload = await response.json();
    const labels = payload.forecasts.map((item) => formatDate(item.forecast_date));
    const values = payload.forecasts.map((item) => item.predicted_qty);
    const lower = payload.forecasts.map((item) => item.lower_95);
    const upper = payload.forecasts.map((item) => item.upper_95);

    renderForecastTable(payload.forecasts);
    renderForecastChart(labels, values, lower, upper);
    forecastSummary.textContent = `${payload.store_id} / ${payload.sku_id} forecasted over ${payload.horizon} days`;
    setStatus(`Forecast loaded successfully. Cached: ${payload.cached ? "yes" : "no"}.`);
  } catch (error) {
    setStatus(`Failed to load forecast: ${error.message}`, true);
    forecastTable.hidden = true;
    forecastPlaceholder.hidden = false;
  }
}

async function fetchTopMovers() {
  const storeId = storeIdInput.value.trim();
  const apiUrl = getApiUrl();

  if (!storeId) {
    setStatus("Store ID is required for top movers.", true);
    return;
  }

  if (!apiConnected && !(await checkApiConnection())) {
    return;
  }

  setStatus("Requesting top movers...");
  ensurePanel(forecastTable.closest(".panel"), false);

  try {
    const response = await fetch(`${apiUrl}/forecast/top-movers/${encodeURIComponent(storeId)}?days=7`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || response.statusText || "Unable to fetch top movers.");
    }
    const payload = await response.json();
    renderTopMoversTable(payload, storeId);
    setStatus("Top movers loaded successfully.");
  } catch (error) {
    setStatus(`Failed to load top movers: ${error.message}`, true);
    topMoversPanel.hidden = true;
  }
}

document.addEventListener("DOMContentLoaded", checkApiConnection);
fetchForecastBtn.addEventListener("click", fetchForecast);
fetchTopMoversBtn.addEventListener("click", fetchTopMovers);
