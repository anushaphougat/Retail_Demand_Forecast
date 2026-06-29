"""
Retail Demand Forecasting Dashboard
"""
import streamlit as st
import requests
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px

API_URL = "https://retail-demand-forecast.onrender.com"

STORES = [f"STORE_{i:03d}" for i in range(1, 11)]
SKUS   = [f"SKU_{i:04d}"   for i in range(1, 51)]

st.set_page_config(page_title="Retail Demand Forecast", page_icon="📦", layout="wide")
st.title("📦 Retail Demand Forecasting Platform")
st.caption("Production ML forecasting system — inspired by Amazon Seller Analytics")

# Health check
try:
    r = requests.get(f"{API_URL}/health", timeout=10)
    health = r.json()
    status = "🟢 Live"
except:
    health = {}
    status = "🔴 Offline"

c1, c2, c3 = st.columns(3)
c1.metric("API Status", status)
c2.metric("Forecast Rows", health.get("forecast_rows", 0))
c3.metric("Model Loaded", "✅ Yes" if health.get("model_loaded") else "❌ No")

st.divider()

# Sidebar
with st.sidebar:
    st.header("⚙️ Settings")
    selected_store = st.selectbox("Select Store", STORES)
    selected_sku   = st.selectbox("Select SKU", SKUS)
    horizon        = st.slider("Forecast Horizon (days)", 7, 28, 14)
    st.divider()
    st.caption("Built with FastAPI + LightGBM + Streamlit")

tab1, tab2, tab3 = st.tabs(["📈 Forecast", "🏆 Top Movers", "📦 Batch"])

# Tab 1
with tab1:
    st.subheader(f"Demand Forecast — {selected_store} / {selected_sku}")
    try:
        r = requests.get(
            f"{API_URL}/forecast/{selected_store}/{selected_sku}",
            params={"horizon": horizon}, timeout=15
        )
        if r.status_code == 200:
            data = r.json()
            df = pd.DataFrame(data["forecasts"])
            df["forecast_date"] = pd.to_datetime(df["forecast_date"])

            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=pd.concat([df["forecast_date"], df["forecast_date"][::-1]]),
                y=pd.concat([df["upper_95"], df["lower_95"][::-1]]),
                fill="toself", fillcolor="rgba(99,110,250,0.15)",
                line=dict(color="rgba(255,255,255,0)"), name="95% CI"
            ))
            fig.add_trace(go.Scatter(
                x=df["forecast_date"], y=df["predicted_qty"],
                mode="lines+markers", name="Predicted Demand",
                line=dict(color="#636EFA", width=2)
            ))
            fig.update_layout(height=400, hovermode="x unified",
                              xaxis_title="Date", yaxis_title="Quantity")
            st.plotly_chart(fig, use_container_width=True)

            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Avg Daily", f"{df['predicted_qty'].mean():.0f} units")
            c2.metric("Peak", f"{df['predicted_qty'].max()} units")
            c3.metric("Total", f"{df['predicted_qty'].sum():,} units")
            c4.metric("Days", f"{len(df)}")
        else:
            st.warning("No forecast data found for this store/SKU.")
    except Exception as e:
        st.error(f"Could not connect to API: {e}")

# Tab 2
with tab2:
    st.subheader(f"🏆 Top 10 SKUs — {selected_store}")
    days = st.radio("Period", [7, 14, 28], horizontal=True)
    try:
        r = requests.get(
            f"{API_URL}/forecast/top-movers/{selected_store}",
            params={"days": days}, timeout=15
        )
        if r.status_code == 200:
            movers = r.json()
            df_m = pd.DataFrame(movers)
            qty_col = [c for c in df_m.columns if "qty" in c][0]
            fig2 = px.bar(df_m, x=qty_col, y="sku_id", orientation="h",
                          color=qty_col, color_continuous_scale="Blues",
                          labels={qty_col: "Total Qty", "sku_id": "SKU"})
            fig2.update_layout(height=400, yaxis=dict(autorange="reversed"),
                               coloraxis_showscale=False)
            st.plotly_chart(fig2, use_container_width=True)
        else:
            st.warning("No top movers data found.")
    except Exception as e:
        st.error(f"Could not connect to API: {e}")

# Tab 3
with tab3:
    st.subheader("📦 Batch Forecast — Compare SKUs")
    selected_skus = st.multiselect("Select SKUs", SKUS,
                                    default=["SKU_0001", "SKU_0002", "SKU_0003"])
    batch_horizon = st.slider("Horizon", 7, 28, 14, key="batch")

    if st.button("Run Batch Forecast", type="primary"):
        with st.spinner("Fetching..."):
            try:
                r = requests.post(
                    f"{API_URL}/forecast/batch",
                    json={"store_id": selected_store,
                          "sku_ids": selected_skus,
                          "horizon": batch_horizon},
                    timeout=20
                )
                batch = r.json()
                if batch.get("results"):
                    fig3 = go.Figure()
                    for item in batch["results"]:
                        df_b = pd.DataFrame(item["forecasts"])
                        df_b["forecast_date"] = pd.to_datetime(df_b["forecast_date"])
                        fig3.add_trace(go.Scatter(
                            x=df_b["forecast_date"], y=df_b["predicted_qty"],
                            mode="lines+markers", name=item["sku_id"]
                        ))
                    fig3.update_layout(height=400, hovermode="x unified")
                    st.plotly_chart(fig3, use_container_width=True)
                else:
                    st.warning("No results returned.")
            except Exception as e:
                st.error(f"Error: {e}")