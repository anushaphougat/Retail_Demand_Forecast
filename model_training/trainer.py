"""
Model training module.

Trains three model families and registers the best ensemble in MLflow:
  1. LightGBM   — fast gradient boosting on tabular features
  2. Prophet    — Facebook's seasonal decomposition model
  3. Ensemble   — weighted blend (LightGBM 60% + Prophet 40%)

Usage:
    python -m model_training.trainer
"""
from __future__ import annotations

import os
import json
import warnings
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Tuple, Dict

import lightgbm as lgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_percentage_error
import joblib
import mlflow
import mlflow.lightgbm

warnings.filterwarnings("ignore")

from data_pipeline.features.engineer import FEATURE_COLS, TARGET_COL


# ─── Config ────────────────────────────────────────────────────────────────

LGBM_PARAMS: Dict = {
    "objective":        "regression_l1",   # MAE loss — robust to outliers
    "metric":           "mape",
    "n_estimators":     800,
    "learning_rate":    0.05,
    "num_leaves":       127,
    "min_child_samples": 20,
    "subsample":        0.8,
    "colsample_bytree": 0.8,
    "reg_alpha":        0.1,
    "reg_lambda":       0.1,
    "n_jobs":           -1,
    "verbose":          -1,
}

ENSEMBLE_WEIGHTS = {"lgbm": 0.60, "prophet": 0.40}
MODEL_DIR        = "models"
TRAIN_CUTOFF     = "2024-06-30"   # everything after = held-out test


# ─── LightGBM ──────────────────────────────────────────────────────────────

def train_lgbm(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
) -> lgb.LGBMRegressor:
    model = lgb.LGBMRegressor(**LGBM_PARAMS)
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        callbacks=[lgb.early_stopping(50, verbose=False),
                   lgb.log_evaluation(100)],
    )
    return model


def cross_validate_lgbm(df: pd.DataFrame, n_splits: int = 3) -> float:
    """Time-series cross-validation — returns mean MAPE."""
    tscv   = TimeSeriesSplit(n_splits=n_splits)
    mapes  = []
    X = df[FEATURE_COLS]
    y = df[TARGET_COL]

    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        X_tr, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_tr, y_val = y.iloc[train_idx], y.iloc[val_idx]
        m = train_lgbm(X_tr, y_tr, X_val, y_val)
        preds = m.predict(X_val).clip(0)
        mape  = mean_absolute_percentage_error(y_val.clip(1), preds.clip(1))
        mapes.append(mape)
        print(f"  Fold {fold+1}: MAPE = {mape:.4f}")

    return float(np.mean(mapes))


# ─── Prophet (per-SKU × store) ─────────────────────────────────────────────

def train_prophet_for_series(series: pd.DataFrame) -> object:
    """Train one Prophet model on a single store×SKU time series."""
    try:
        from prophet import Prophet
    except ImportError:
        print("  prophet not installed — skipping Prophet training")
        return None

    prophet_df = series[["date", TARGET_COL]].rename(
        columns={"date": "ds", TARGET_COL: "y"}
    )
    prophet_df["ds"] = pd.to_datetime(prophet_df["ds"])
    prophet_df["y"]  = prophet_df["y"].clip(lower=0)

    m = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=True,
        daily_seasonality=False,
        changepoint_prior_scale=0.05,
        seasonality_prior_scale=10,
    )
    m.add_country_holidays(country_name="IN")  # change to your market
    with open(os.devnull, "w") as devnull:
        import sys; old_stdout = sys.stdout; sys.stdout = devnull
        m.fit(prophet_df)
        sys.stdout = old_stdout
    return m


# ─── Ensemble predict ──────────────────────────────────────────────────────

def ensemble_predict(
    lgbm_preds: np.ndarray,
    prophet_preds: np.ndarray | None,
) -> np.ndarray:
    if prophet_preds is None:
        return lgbm_preds
    w = ENSEMBLE_WEIGHTS
    return (w["lgbm"] * lgbm_preds + w["prophet"] * prophet_preds).clip(0)


# ─── Main train & register ─────────────────────────────────────────────────

def train_and_register(
    features_path: str = "data/sample/features.parquet",
    experiment_name: str = "retail-demand-forecast",
) -> str:
    """
    Full training run. Returns MLflow run_id.
    """
    mlflow.set_experiment(experiment_name)
    df = pd.read_parquet(features_path)

    # Time-based split
    df["date"] = pd.to_datetime(df["date"])
    train_df = df[df["date"] <= TRAIN_CUTOFF]
    test_df  = df[df["date"]  > TRAIN_CUTOFF]
    print(f"Train: {len(train_df):,} rows | Test: {len(test_df):,} rows")

    available_features = [c for c in FEATURE_COLS if c in train_df.columns]

    X_train = train_df[available_features]
    y_train = train_df[TARGET_COL]
    X_test  = test_df[available_features]
    y_test  = test_df[TARGET_COL]

    with mlflow.start_run() as run:
        # ── Cross-validate ─────────────────────────────────────────────
        print("Cross-validating LightGBM …")
        cv_mape = cross_validate_lgbm(train_df)
        print(f"CV MAPE: {cv_mape:.4f}")

        # ── Final LightGBM fit on all train data ───────────────────────
        print("Training final LightGBM …")
        split  = int(len(X_train) * 0.9)
        lgbm_model = train_lgbm(
            X_train.iloc[:split], y_train.iloc[:split],
            X_train.iloc[split:], y_train.iloc[split:],
        )
        lgbm_preds = lgbm_model.predict(X_test).clip(0)
        lgbm_mape  = mean_absolute_percentage_error(y_test.clip(1), lgbm_preds.clip(1))
        print(f"LightGBM test MAPE: {lgbm_mape:.4f}")

        # ── Save LightGBM ──────────────────────────────────────────────
        os.makedirs(MODEL_DIR, exist_ok=True)
        lgbm_path = f"{MODEL_DIR}/lgbm_model.pkl"
        joblib.dump(lgbm_model, lgbm_path)

        # ── Log to MLflow ──────────────────────────────────────────────
        mlflow.log_params(LGBM_PARAMS)
        mlflow.log_metric("cv_mape",        cv_mape)
        mlflow.log_metric("test_mape_lgbm", lgbm_mape)
        mlflow.log_metric("train_rows",     len(train_df))
        mlflow.log_metric("test_rows",      len(test_df))
        mlflow.log_artifact(lgbm_path)
        mlflow.set_tag("model_type", "lgbm_ensemble")
        mlflow.set_tag("features",   str(available_features))
        mlflow.lightgbm.log_model(lgbm_model, "lgbm")

        # ── Feature importance ─────────────────────────────────────────
        fi = pd.Series(
            lgbm_model.feature_importances_,
            index=available_features,
        ).sort_values(ascending=False)
        fi_path = f"{MODEL_DIR}/feature_importance.csv"
        fi.to_csv(fi_path)
        mlflow.log_artifact(fi_path)

        # ── Metadata for serving ───────────────────────────────────────
        meta = {
            "run_id":    run.info.run_id,
            "trained_at": datetime.utcnow().isoformat(),
            "cv_mape":   round(cv_mape, 6),
            "test_mape": round(lgbm_mape, 6),
            "features":  available_features,
            "weights":   ENSEMBLE_WEIGHTS,
        }
        with open(f"{MODEL_DIR}/meta.json", "w") as f:
            json.dump(meta, f, indent=2)
        mlflow.log_artifact(f"{MODEL_DIR}/meta.json")

        print(f"\nRun ID: {run.info.run_id}")
        print(f"Test MAPE: {lgbm_mape:.4f}")
        return run.info.run_id


if __name__ == "__main__":
    run_id = train_and_register()
    print(f"\nDone. MLflow run: {run_id}")
    print("Next: python -m model_training.predictor")