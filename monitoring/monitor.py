"""
Monitoring module for the retail demand forecasting platform.

Responsibilities:
  - Compute rolling MAPE against actuals
  - Detect data/feature drift (Evidently AI)
  - Push metrics to Prometheus
  - Fire Slack / PagerDuty alerts when thresholds breached

Usage:
    python -m monitoring.monitor
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta
from typing import Dict

import numpy as np
import pandas as pd

# ─── Thresholds ─────────────────────────────────────────────────────────────

MAPE_ALERT_THRESHOLD  = 0.15   # 15%
MAPE_WARN_THRESHOLD   = 0.10   # 10%
DRIFT_PSI_THRESHOLD   = 0.2    # Population Stability Index
ROLLING_WINDOW_DAYS   = 7


# ─── Accuracy monitoring ─────────────────────────────────────────────────────

def compute_rolling_mape(
    actuals_path:   str = "data/sample/sales.csv",
    forecasts_path: str = "data/sample/forecasts.parquet",
    window:         int = ROLLING_WINDOW_DAYS,
) -> Dict:
    """
    Join forecasts with actuals and compute MAPE per store, per SKU,
    and overall for the last `window` days.
    """
    actuals   = pd.read_csv(actuals_path,   parse_dates=["date"])
    forecasts = pd.read_parquet(forecasts_path)

    actuals["date"]           = actuals["date"].dt.date
    forecasts["forecast_date"] = pd.to_datetime(forecasts["forecast_date"]).dt.date

    cutoff = date.today() - timedelta(days=window)
    recent_actuals = actuals[actuals["date"] >= cutoff]

    merged = recent_actuals.merge(
        forecasts,
        left_on=["store_id", "sku_id", "date"],
        right_on=["store_id", "sku_id", "forecast_date"],
        how="inner",
    )

    if merged.empty:
        return {"status": "no_overlap", "mape_overall": None}

    # Clip actuals to 1 to avoid division by zero in MAPE
    merged["mape_row"] = (
        np.abs(merged["sales_qty"] - merged["predicted_qty"])
        / merged["sales_qty"].clip(lower=1)
    )

    mape_overall = merged["mape_row"].mean()
    mape_by_store = merged.groupby("store_id")["mape_row"].mean().to_dict()
    mape_by_sku   = (
        merged.groupby("sku_id")["mape_row"]
        .mean()
        .sort_values(ascending=False)
        .head(10)
        .to_dict()
    )

    result = {
        "window_days":    window,
        "mape_overall":   round(mape_overall, 6),
        "mape_by_store":  {k: round(v, 4) for k, v in mape_by_store.items()},
        "top10_worst_sku": {k: round(v, 4) for k, v in mape_by_sku.items()},
        "n_matched_rows": len(merged),
        "alert":          mape_overall > MAPE_ALERT_THRESHOLD,
        "warn":           mape_overall > MAPE_WARN_THRESHOLD,
    }

    return result


# ─── Data drift (PSI) ────────────────────────────────────────────────────────

def compute_psi(expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
    """Population Stability Index — measures distribution shift."""
    eps = 1e-6
    breakpoints = np.percentile(expected, np.linspace(0, 100, bins + 1))
    breakpoints  = np.unique(breakpoints)

    expected_pct = np.histogram(expected, bins=breakpoints)[0] / len(expected) + eps
    actual_pct   = np.histogram(actual,   bins=breakpoints)[0] / len(actual)   + eps

    psi = np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct))
    return float(psi)


def detect_feature_drift(
    reference_path: str = "data/sample/features.parquet",
    current_path:   str = "data/sample/features.parquet",
    window_days:    int = 7,
) -> Dict:
    """
    Compute PSI for key numeric features comparing a historical
    reference window vs the most recent window.
    """
    df = pd.read_parquet(reference_path)
    df["date"] = pd.to_datetime(df["date"])
    max_date   = df["date"].max()

    reference = df[df["date"] <= max_date - timedelta(days=window_days)]
    current   = df[df["date"] >  max_date - timedelta(days=window_days)]

    monitor_features = [
        "lag_7d", "lag_14d", "rolling_mean_7d",
        "rolling_mean_28d", "price", "is_promo",
    ]

    psi_scores = {}
    for feat in monitor_features:
        if feat in df.columns and len(reference) > 0 and len(current) > 0:
            psi = compute_psi(
                reference[feat].dropna().values,
                current[feat].dropna().values,
            )
            psi_scores[feat] = round(psi, 4)

    drifted = {k: v for k, v in psi_scores.items() if v > DRIFT_PSI_THRESHOLD}

    return {
        "psi_scores":     psi_scores,
        "drifted_features": drifted,
        "drift_detected": len(drifted) > 0,
        "threshold":      DRIFT_PSI_THRESHOLD,
    }


# ─── Prometheus push (optional) ──────────────────────────────────────────────

def push_metrics_to_prometheus(metrics: Dict, job: str = "demand_forecast"):
    """
    Push MAPE and PSI metrics to Prometheus Pushgateway.
    Requires: pip install prometheus-client
    """
    try:
        from prometheus_client import CollectorRegistry, Gauge, push_to_gateway
        PUSHGATEWAY = os.getenv("PROMETHEUS_PUSHGATEWAY", "localhost:9091")

        registry = CollectorRegistry()
        g_mape   = Gauge("forecast_mape_overall",
                         "Rolling MAPE of demand forecasts", registry=registry)
        g_drift  = Gauge("feature_drift_count",
                         "Number of drifted features", registry=registry)

        g_mape.set(metrics.get("mape_overall") or 0)
        g_drift.set(len(metrics.get("drifted_features", {})))

        push_to_gateway(PUSHGATEWAY, job=job, registry=registry)
        print(f"Metrics pushed to Prometheus Pushgateway at {PUSHGATEWAY}")
    except ImportError:
        print("prometheus-client not installed — skipping push")
    except Exception as e:
        print(f"Prometheus push failed: {e}")


# ─── Alerting ─────────────────────────────────────────────────────────────────

def send_slack_alert(message: str):
    """Send a Slack alert via webhook. Set SLACK_WEBHOOK_URL env var."""
    import urllib.request
    webhook = os.getenv("SLACK_WEBHOOK_URL")
    if not webhook:
        print(f"[ALERT — no Slack webhook set] {message}")
        return
    payload = json.dumps({"text": f":warning: *Demand Forecast Alert*\n{message}"})
    req = urllib.request.Request(
        webhook,
        data=payload.encode(),
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req, timeout=10)


# ─── Main run ─────────────────────────────────────────────────────────────────

def run_monitoring():
    print("=" * 60)
    print("DEMAND FORECAST MONITORING RUN")
    print("=" * 60)

    # 1. Accuracy
    print("\n[1/2] Computing rolling MAPE …")
    try:
        acc = compute_rolling_mape()
        print(json.dumps(acc, indent=2))
        if acc.get("alert"):
            msg = (f"MAPE {acc['mape_overall']:.2%} exceeds threshold "
                   f"{MAPE_ALERT_THRESHOLD:.0%}. "
                   f"Top worst SKUs: {list(acc['top10_worst_sku'].keys())[:3]}")
            send_slack_alert(msg)
    except Exception as e:
        print(f"Accuracy monitoring failed: {e}")
        acc = {}

    # 2. Drift
    print("\n[2/2] Detecting feature drift …")
    try:
        drift = detect_feature_drift()
        print(json.dumps(drift, indent=2))
        if drift["drift_detected"]:
            msg = (f"Data drift detected in: {list(drift['drifted_features'].keys())}. "
                   f"Consider retraining.")
            send_slack_alert(msg)
    except Exception as e:
        print(f"Drift monitoring failed: {e}")
        drift = {}

    # 3. Push metrics
    push_metrics_to_prometheus({**acc, **drift})
    print("\nMonitoring run complete.")


if __name__ == "__main__":
    run_monitoring()