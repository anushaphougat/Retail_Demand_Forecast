const apiUrlInput = document.getElementById("apiUrl");
const storeIdInput = document.getElementById("storeId");
const skuIdInput = document.getElementById("skuId");
const horizonInput = document.getElementById("horizon");
const fetchForecastBtn = document.getElementById("fetchForecast");
const fetchTopMoversBtn = document.getElementById("fetchTopMovers");
const statusMessage = document.getElementById("statusMessage");
const forecastPanel = document.getElementById("forecastPanel");
const topMoversPanel = document.getElementById("topMoversPanel");
const forecastSummary = document.getElementById("forecastSummary");
const topMoversSummary = document.getElementById("topMoversSummary");
const forecastTable = document.getElementById("forecastTable");
const forecastTableBody = forecastTable.querySelector("tbody");
const topMoversTable = document.getElementById("topMoversTable").querySelector("tbody");

const chartCanvas = document.getElementById("forecastChart");
let chartInstance = null;

const savedApiUrl = localStorage.getItem("forecastApiUrl");
if (savedApiUrl) {
  apiUrlInput.value = savedApiUrl;
}

function getApiUrl() {
  const value = apiUrlInput.value.trim();
  if (value) {
    return value.replace(/\/+$/, "");
  }
  return window.location.origin;
}

function setStatus(text, error = false) {
  statusMessage.textContent = text;
  statusMessage.style.color = error ? "#fda4af" : "#cbd5e1";
}

function ensurePanel(panel, visible) {
  panel.hidden = !visible;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderForecastChart(labels, values, lower, upper) {
  ensurePanel(forecastPanel, true);
  forecastTable.hidden = false;

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
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.18)",
          tension: 0.25,
          pointRadius: 3,
          fill: true,
        },
        {
          label: "Lower 95%",
          data: lower,
          borderColor: "#60a5fa",
          borderDash: [6, 4],
          tension: 0.25,
          pointRadius: 0,
          fill: false,
        },
        {
          label: "Upper 95%",
          data: upper,
          borderColor: "#818cf8",
          borderDash: [6, 4],
          tension: 0.25,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: "#cbd5e1" },
          grid: { color: "rgba(148,163,184,0.12)" },
        },
        y: {
          ticks: { color: "#cbd5e1" },
          grid: { color: "rgba(148,163,184,0.12)" },
        },
      },
      plugins: {
        legend: { labels: { color: "#e2e8f0" } },
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
  topMoversSummary.textContent = `Top movers for store ${storeId}`;
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

  localStorage.setItem("forecastApiUrl", apiUrl);
  setStatus("Requesting forecast...");
  ensurePanel(topMoversPanel, false);

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
    forecastSummary.textContent = `Forecast for ${payload.store_id} / ${payload.sku_id} (${payload.horizon} days)`;
    setStatus(`Forecast loaded successfully. Cached: ${payload.cached ? "yes" : "no"}.`);
  } catch (error) {
    setStatus(`Failed to load forecast: ${error.message}` , true);
    forecastPanel.hidden = true;
  }
}

async function fetchTopMovers() {
  const storeId = storeIdInput.value.trim();
  const apiUrl = getApiUrl();

  if (!storeId) {
    setStatus("Store ID is required for top movers.", true);
    return;
  }

  localStorage.setItem("forecastApiUrl", apiUrl);
  setStatus("Requesting top movers...");
  ensurePanel(forecastPanel, false);

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

fetchForecastBtn.addEventListener("click", fetchForecast);
fetchTopMoversBtn.addEventListener("click", fetchTopMovers);
