"""
Feature engineering pipeline for retail demand forecasting.
Produces a feature matrix ready for model training.

Usage:
    from data_pipeline.features.engineer import build_features
    df = build_features("data/sample/sales.csv", "data/sample/external.csv")
"""
import pandas as pd
import numpy as np
from typing import List


# ─── Lag & Rolling Features ────────────────────────────────────────────────

LAG_DAYS      = [7, 14, 21, 28, 35, 42]
ROLLING_WINS  = [7, 14, 28]


def add_lag_features(df: pd.DataFrame, target: str = "sales_qty") -> pd.DataFrame:
    """Lag sales by N days per store+SKU group."""
    grp = df.groupby(["store_id", "sku_id"])[target]
    for lag in LAG_DAYS:
        df[f"lag_{lag}d"] = grp.shift(lag)
    return df


def add_rolling_features(df: pd.DataFrame, target: str = "sales_qty") -> pd.DataFrame:
    """Rolling mean & std per store+SKU (leak-safe: shift(1) before rolling)."""
    grp = df.groupby(["store_id", "sku_id"])[target]
    for win in ROLLING_WINS:
        shifted = grp.shift(1)
        df[f"rolling_mean_{win}d"] = (
            shifted.transform(lambda x: x.rolling(win, min_periods=1).mean())
        )
        df[f"rolling_std_{win}d"] = (
            shifted.transform(lambda x: x.rolling(win, min_periods=1).std())
        )
    return df


# ─── Calendar Features ─────────────────────────────────────────────────────

def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    """Derive date-based features."""
    dt = pd.to_datetime(df["date"])
    df["dayofweek"]   = dt.dt.dayofweek          # 0=Mon
    df["dayofmonth"]  = dt.dt.day
    df["weekofyear"]  = dt.dt.isocalendar().week.astype(int)
    df["month"]       = dt.dt.month
    df["quarter"]     = dt.dt.quarter
    df["year"]        = dt.dt.year
    df["is_weekend"]  = (dt.dt.dayofweek >= 5).astype(int)
    df["is_month_end"]   = dt.dt.is_month_end.astype(int)
    df["is_month_start"] = dt.dt.is_month_start.astype(int)
    # Fourier terms for weekly + annual seasonality
    df["sin_week"]  = np.sin(2 * np.pi * df["dayofweek"] / 7)
    df["cos_week"]  = np.cos(2 * np.pi * df["dayofweek"] / 7)
    df["sin_year"]  = np.sin(2 * np.pi * dt.dt.dayofyear / 365)
    df["cos_year"]  = np.cos(2 * np.pi * dt.dt.dayofyear / 365)
    return df


# ─── Price Elasticity Feature ──────────────────────────────────────────────

def add_price_features(df: pd.DataFrame) -> pd.DataFrame:
    """Rolling mean price and deviation from it (proxy for price shock)."""
    grp = df.groupby(["store_id", "sku_id"])["price"]
    df["price_rolling_mean_28d"] = grp.transform(
        lambda x: x.shift(1).rolling(28, min_periods=1).mean()
    )
    df["price_deviation"] = df["price"] - df["price_rolling_mean_28d"]
    return df


# ─── Inventory Feature ─────────────────────────────────────────────────────

def add_inventory_features(df: pd.DataFrame) -> pd.DataFrame:
    """Days of cover = on_hand / rolling_mean_sales."""
    safe_mean = df["rolling_mean_7d"].replace(0, np.nan)
    df["days_of_cover"] = (df["on_hand"] / safe_mean).clip(upper=90)
    return df


# ─── External Signal Join ──────────────────────────────────────────────────

def join_external(df: pd.DataFrame, ext_path: str) -> pd.DataFrame:
    ext = pd.read_csv(ext_path, parse_dates=["date"])
    ext["date"] = ext["date"].dt.date
    return df.merge(ext, on="date", how="left")


# ─── Master Builder ────────────────────────────────────────────────────────

def build_features(
    sales_path: str,
    external_path: str | None = None,
    drop_na: bool = True,
) -> pd.DataFrame:
    print("Loading sales data …")
    df = pd.read_csv(sales_path, parse_dates=["date"])
    df["date"] = df["date"].dt.date
    df = df.sort_values(["store_id", "sku_id", "date"]).reset_index(drop=True)

    print("Adding calendar features …")
    df = add_calendar_features(df)

    print("Adding lag features …")
    df = add_lag_features(df)

    print("Adding rolling features …")
    df = add_rolling_features(df)

    print("Adding price features …")
    df = add_price_features(df)

    print("Adding inventory features …")
    df = add_inventory_features(df)

    if external_path:
        print("Joining external signals …")
        df = join_external(df, external_path)

    if drop_na:
        before = len(df)
        df = df.dropna()
        print(f"Dropped {before - len(df):,} rows with NaN (lag warmup) → {len(df):,} rows remain")

    print(f"Feature matrix shape: {df.shape}")
    return df


FEATURE_COLS: List[str] = (
    [f"lag_{d}d" for d in LAG_DAYS]
    + [f"rolling_mean_{w}d" for w in ROLLING_WINS]
    + [f"rolling_std_{w}d"  for w in ROLLING_WINS]
    + ["dayofweek", "dayofmonth", "weekofyear", "month", "quarter",
       "is_weekend", "is_month_end", "is_month_start",
       "sin_week", "cos_week", "sin_year", "cos_year",
       "price", "price_deviation", "is_promo", "days_of_cover",
       "temperature", "is_holiday", "event_score"]
)

TARGET_COL = "sales_qty"


if __name__ == "__main__":
    df = build_features("data/sample/sales.csv", "data/sample/external.csv")
    df.to_parquet("data/sample/features.parquet", index=False)
    print("Saved → data/sample/features.parquet")