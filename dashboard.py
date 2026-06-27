"""
Retail Demand Forecasting Dashboard
Streamlit app that connects to the FastAPI and visualizes forecasts.

Run:
    streamlit run dashboard.py
"""

import streamlit as st
import requests
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from datetime import date

# ── Config ──────────────────────────────────────────────────────────────────

API_URL = "https://retail-demand-forecast.onrender.com/docs"

STORES = [f"STORE_{i:03d}" for i in range(1, 11)]
SKUS   = [f"SKU_{i:04d}"   for i in range(1, 51)]
st.set_page_config(
    page_title="Retail Demand Forecast",
    page_icon="📦",
    layout="wide",
)

# ── Header ───────────────────────────────────────────────────────────────────

st.title("📦 Retail Demand Forecasting Platform")
st.caption("Production ML forecasting system — inspired by Amazon Seller Analytics")

# ── API health check ─────────────────────────────────────────────────────────

@st.cache_data(ttl=30)
def check_health():
    try:
        r = requests.get(f"{API_URL}/health", timeout=5)
        return r.json()
    except:
        return None

health = check_health()
if health:
    col1, col2, col3 = st.columns(3)
    col1.metric("API Status",     "🟢 Live")
    col2.metric("Forecast Rows",  f"{health['forecast_rows']:,}")
    col3.metric("Model Loaded",   "✅ Yes" if health["model_loaded"] else "❌ No")
else:
    st.error("❌ API is not reachable. Make sure the FastAPI server is running.")
    st.stop()

st.divider()

# ── Sidebar ───────────────────────────────────────────────────────────────────

with st.sidebar:
    st.header("⚙️ Settings")
    selected_store = st.selectbox("Select Store", STORES)
    selected_sku   = st.selectbox("Select SKU",   SKUS)
    horizon        = st.slider("Forecast Horizon (days)", 7, 28, 14)
    st.divider()
    st.caption("Built with FastAPI + LightGBM + Streamlit")

# ── Tabs ──────────────────────────────────────────────────────────────────────

tab1, tab2, tab3 = st.tabs(["📈 Forecast", "🏆 Top Movers", "📦 Batch"])

# ── Tab 1: Single SKU Forecast ────────────────────────────────────────────────

with tab1:
    st.subheader(f"Demand Forecast — {selected_store} / {selected_sku}")

    @st.cache_data(ttl=300)
    def get_forecast(store, sku, h):
        try:
            r = requests.get(
                f"{API_URL}/forecast/{store}/{sku}",
                params={"horizon": h},
                timeout=10,
            )
            return r.json() if r.status_code == 200 else None
        except:
            return None

    data = get_forecast(selected_store, selected_sku, horizon)

    if data:
        df = pd.DataFrame(data["forecasts"])
        df["forecast_date"] = pd.to_datetime(df["forecast_date"])

        # ── Plotly chart ──────────────────────────────────────────────────
        fig = go.Figure()

        # Confidence interval band
        fig.add_trace(go.Scatter(
            x=pd.concat([df["forecast_date"], df["forecast_date"][::-1]]),
            y=pd.concat([df["upper_95"], df["lower_95"][::-1]]),
            fill="toself",
            fillcolor="rgba(99, 110, 250, 0.15)",
            line=dict(color="rgba(255,255,255,0)"),
            name="95% Confidence Interval",
        ))

        # Forecast line
        fig.add_trace(go.Scatter(
            x=df["forecast_date"],
            y=df["predicted_qty"],
            mode="lines+markers",
            name="Predicted Demand",
            line=dict(color="#636EFA", width=2),
            marker=dict(size=6),
        ))

        fig.update_layout(
            xaxis_title="Date",
            yaxis_title="Predicted Quantity",
            hovermode="x unified",
            legend=dict(orientation="h", yanchor="bottom", y=1.02),
            height=420,
            margin=dict(l=0, r=0, t=40, b=0),
        )

        st.plotly_chart(fig, use_container_width=True)

        # ── Metrics row ───────────────────────────────────────────────────
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Avg Daily Demand", f"{df['predicted_qty'].mean():.0f} units")
        c2.metric("Peak Demand",      f"{df['predicted_qty'].max()} units",
                  f"on {df.loc[df['predicted_qty'].idxmax(), 'forecast_date'].strftime('%b %d')}")
        c3.metric("Total Forecast",   f"{df['predicted_qty'].sum():,} units")
        c4.metric("Forecast Days",    f"{len(df)} days")

        # ── Raw data table ────────────────────────────────────────────────
        with st.expander("View raw forecast data"):
            st.dataframe(
                df.rename(columns={
                    "forecast_date": "Date",
                    "predicted_qty": "Predicted Qty",
                    "lower_95":      "Lower 95%",
                    "upper_95":      "Upper 95%",
                }),
                use_container_width=True,
                hide_index=True,
            )
    else:
        st.warning("No forecast data found for this store/SKU combination.")

# ── Tab 2: Top Movers ─────────────────────────────────────────────────────────

with tab2:
    st.subheader(f"🏆 Top 10 SKUs by Demand — {selected_store}")
    days = st.radio("Period", [7, 14, 28], horizontal=True, key="top_days")

    @st.cache_data(ttl=300)
    def get_top_movers(store, d):
        try:
            r = requests.get(
                f"{API_URL}/forecast/top-movers/{store}",
                params={"days": d},
                timeout=10,
            )
            return r.json() if r.status_code == 200 else None
        except:
            return None

    movers = get_top_movers(selected_store, days)

    if movers:
        df_movers = pd.DataFrame(movers)
        qty_col   = [c for c in df_movers.columns if "qty" in c][0]

        fig2 = px.bar(
            df_movers,
            x=qty_col,
            y="sku_id",
            orientation="h",
            color=qty_col,
            color_continuous_scale="Blues",
            labels={qty_col: "Total Forecasted Qty", "sku_id": "SKU"},
        )
        fig2.update_layout(
            height=420,
            yaxis=dict(autorange="reversed"),
            coloraxis_showscale=False,
            margin=dict(l=0, r=0, t=20, b=0),
        )
        st.plotly_chart(fig2, use_container_width=True)

        st.dataframe(df_movers, use_container_width=True, hide_index=True)
    else:
        st.warning("Could not load top movers data.")

# ── Tab 3: Batch Forecast ─────────────────────────────────────────────────────

with tab3:
    st.subheader("📦 Batch Forecast — Multiple SKUs")

    selected_skus = st.multiselect(
        "Select SKUs to compare",
        SKUS,
        default=["SKU_0001", "SKU_0002", "SKU_0003"],
    )
    batch_horizon = st.slider("Horizon", 7, 28, 14, key="batch_horizon")

    if st.button("Run Batch Forecast", type="primary"):
        with st.spinner("Fetching forecasts..."):
            try:
                r = requests.post(
                    f"{API_URL}/forecast/batch",
                    json={
                        "store_id": selected_store,
                        "sku_ids":  selected_skus,
                        "horizon":  batch_horizon,
                    },
                    timeout=15,
                )
                batch = r.json()

                if batch.get("results"):
                    fig3 = go.Figure()
                    for item in batch["results"]:
                        df_b = pd.DataFrame(item["forecasts"])
                        df_b["forecast_date"] = pd.to_datetime(df_b["forecast_date"])
                        fig3.add_trace(go.Scatter(
                            x=df_b["forecast_date"],
                            y=df_b["predicted_qty"],
                            mode="lines+markers",
                            name=item["sku_id"],
                        ))

                    fig3.update_layout(
                        xaxis_title="Date",
                        yaxis_title="Predicted Quantity",
                        hovermode="x unified",
                        height=420,
                        margin=dict(l=0, r=0, t=20, b=0),
                    )
                    st.plotly_chart(fig3, use_container_width=True)
                else:
                    st.warning("No results returned.")
            except Exception as e:
                st.error(f"Error: {e}")