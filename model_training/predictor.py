"""
Batch forecast predictor.

Loads the champion LightGBM model and scores every store×SKU
for the next N days.

Usage:
    python -m model_training.predictor
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta

import joblib
import numpy as np
import pandas as pd

from data_pipeline.features.engineer import FEATURE_COLS, build_features

MODEL_DIR = "models"


def load_champion() -> tuple:
    """Load the latest trained model and its metadata."""
    model_path = f"{MODEL_DIR}/lgbm_model.pkl"
    meta_path  = f"{MODEL_DIR}/meta.json"

    if not os.path.exists(model_path):
        raise FileNotFoundError(
            "No trained model found. Run model_training/trainer.py first."
        )

    model = joblib.load(model_path)
    with open(meta_path) as f:
        meta = json.load(f)

    print(f"Loaded model from run {meta['run_id']} | CV MAPE={meta['cv_mape']:.4f}")
    return model, meta


def build_future_frame(
    df_hist: pd.DataFrame,
    horizon: int = 28,
) -> pd.DataFrame:
    """
    Create a future feature frame for horizon days.
    Strategy: copy the last known row for each store×SKU,
    update the date, then recompute calendar features.
    Lag values are carried forward (last observed).
    """
    from data_pipeline.features.engineer import (
        add_calendar_features, add_price_features,
    )

    last_rows = (
        df_hist
        .sort_values("date")
        .groupby(["store_id", "sku_id"])
        .last()
        .reset_index()
    )

    future_rows = []
    for _, row in last_rows.iterrows():
        for d in range(1, horizon + 1):
            new_row = row.copy()
            new_row["date"] = pd.to_datetime(row["date"]) + timedelta(days=d)
            new_row["sales_qty"] = np.nan   # unknown future
            future_rows.append(new_row)

    future = pd.DataFrame(future_rows)
    future = add_calendar_features(future)
    future = add_price_features(future)
    return future


def load_champion_and_predict(
    df_features: pd.DataFrame,
    horizon: int = 28,
) -> pd.DataFrame:
    """
    Generate horizon-day forecasts for all store×SKU pairs.

    Returns a DataFrame with columns:
        store_id, sku_id, forecast_date, predicted_qty, lower_95, upper_95
    """
    model, meta = load_champion()
    available   = [c for c in meta["features"] if c in df_features.columns]

    future_df = build_future_frame(df_features, horizon=horizon)

    # Fill any missing feature columns with 0
    for col in available:
        if col not in future_df.columns:
            future_df[col] = 0

    X_future   = future_df[available].fillna(0)
    point_pred = model.predict(X_future).clip(0)

    # Approximate 95% PI via ±1.96 × rolling std of recent residuals
    # In production, use quantile regression or conformal prediction
    sigma = point_pred * 0.15   # naive 15% std assumption
    lower = (point_pred - 1.96 * sigma).clip(0)
    upper = (point_pred + 1.96 * sigma).clip(0)

    output = pd.DataFrame({
        "store_id":      future_df["store_id"].values,
        "sku_id":        future_df["sku_id"].values,
        "forecast_date": pd.to_datetime(future_df["date"]).dt.date.values,
        "predicted_qty": np.round(point_pred).astype(int),
        "lower_95":      np.round(lower).astype(int),
        "upper_95":      np.round(upper).astype(int),
    })

    print(f"Forecast shape: {output.shape}")
    print(output.head())
    return output


if __name__ == "__main__":
    print("Loading feature matrix …")
    df = pd.read_parquet("data/sample/features.parquet")
    forecasts = load_champion_and_predict(df, horizon=28)
    forecasts.to_parquet("data/sample/forecasts.parquet", index=False)
    print(f"\nSaved {len(forecasts):,} rows → data/sample/forecasts.parquet")
    print(forecasts.groupby("forecast_date")["predicted_qty"].sum().head(7))