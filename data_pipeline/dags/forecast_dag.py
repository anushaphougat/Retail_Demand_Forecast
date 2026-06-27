"""
Airflow DAG: nightly retail demand forecast pipeline.

Schedule: daily at 02:00 UTC
Steps:
  1. ingest        — pull/validate raw sales + external data
  2. feature_eng   — build feature matrix
  3. train_models  — retrain if accuracy threshold breached
  4. batch_forecast— score all store×SKU combos
  5. write_output  — push forecasts to Postgres / S3
  6. monitor       — compute rolling MAPE, alert if > threshold
"""
from __future__ import annotations

from datetime import datetime, timedelta

from airflow.sdk import DAG
from airflow.providers.standard.operators.python import PythonOperator, BranchPythonOperator
from airflow.providers.standard.operators.empty import EmptyOperator
from airflow.sdk import TriggerRule

# ── Default args ────────────────────────────────────────────────────────────
DEFAULT_ARGS = {
    "owner":            "data-science",
    "depends_on_past":  False,
    "retries":          2,
    "retry_delay":      timedelta(minutes=5),
    "email_on_failure": True,
    "email":            ["ds-alerts@yourcompany.com"],
}

MAPE_THRESHOLD = 0.15   # retrain if rolling MAPE > 15 %
FORECAST_HORIZON = 28   # days ahead to forecast


# ── Task functions ──────────────────────────────────────────────────────────

def ingest_data(**ctx):
    """Pull yesterday's sales from ERP and write to data lake."""
    import pandas as pd, os
    ds = ctx["ds"]                         # YYYY-MM-DD execution date
    print(f"[ingest] Pulling sales for {ds}")

    # In production: replace with your ERP API / Kafka consumer / S3 sync
    # Example: df = erp_client.get_daily_sales(date=ds)
    # Here we simulate by filtering the sample CSV
    df = pd.read_csv("data/sample/sales.csv")
    daily = df[df["date"] == ds]
    os.makedirs(f"data/lake/{ds}", exist_ok=True)
    daily.to_parquet(f"data/lake/{ds}/sales.parquet", index=False)
    print(f"[ingest] Saved {len(daily):,} rows")


def run_feature_engineering(**ctx):
    """Rebuild full feature matrix including today's data."""
    from data_pipeline.features.engineer import build_features
    df = build_features(
        sales_path="data/sample/sales.csv",
        external_path="data/sample/external.csv",
    )
    df.to_parquet("data/sample/features.parquet", index=False)
    print(f"[features] Matrix: {df.shape}")


def check_accuracy_drift(**ctx):
    """Branch: retrain if rolling MAPE has degraded."""
    import numpy as np
    # In production: load from monitoring DB
    # Simulate: random MAPE between 10-20%
    current_mape = np.random.uniform(0.10, 0.20)
    print(f"[drift] Current MAPE = {current_mape:.3f}, threshold = {MAPE_THRESHOLD}")
    ctx["ti"].xcom_push(key="current_mape", value=current_mape)
    return "train_models" if current_mape > MAPE_THRESHOLD else "skip_training"


def train_models(**ctx):
    """Retrain LightGBM + ensemble. Registers new champion in MLflow."""
    print("[train] Starting model training …")
    # Imports here to avoid DAG parse-time overhead
    import mlflow
    from model_training.trainer import train_and_register

    run_id = train_and_register(
        features_path="data/sample/features.parquet",
        experiment_name="retail-demand-forecast",
    )
    print(f"[train] Registered run {run_id}")
    ctx["ti"].xcom_push(key="mlflow_run_id", value=run_id)


def batch_forecast(**ctx):
    """Score all store×SKU combos for next FORECAST_HORIZON days."""
    import pandas as pd
    from model_training.predictor import load_champion_and_predict

    df_features = pd.read_parquet("data/sample/features.parquet")
    forecasts = load_champion_and_predict(df_features, horizon=FORECAST_HORIZON)
    forecasts.to_parquet("data/sample/forecasts.parquet", index=False)
    print(f"[forecast] Generated {len(forecasts):,} forecast rows")


def write_output(**ctx):
    """Push forecasts to Postgres and S3."""
    import pandas as pd
    forecasts = pd.read_parquet("data/sample/forecasts.parquet")

    # ── Postgres ──────────────────────────────────────────────────────────
    # from sqlalchemy import create_engine
    # engine = create_engine(os.environ["POSTGRES_DSN"])
    # forecasts.to_sql("forecasts", engine, if_exists="append", index=False)

    # ── S3 ────────────────────────────────────────────────────────────────
    # import boto3, io
    # buf = io.BytesIO(); forecasts.to_parquet(buf)
    # boto3.client("s3").put_object(Bucket="my-forecasts", Key=f"{ctx['ds']}/forecasts.parquet", Body=buf.getvalue())

    print(f"[output] Would write {len(forecasts):,} rows to Postgres + S3")


def monitor_accuracy(**ctx):
    """Compute rolling MAPE vs actuals and push to Prometheus/Grafana."""
    import pandas as pd, numpy as np
    forecasts = pd.read_parquet("data/sample/forecasts.parquet")

    # In production: join with actuals from warehouse, compute real MAPE
    simulated_mape = np.random.uniform(0.08, 0.18)
    print(f"[monitor] Rolling MAPE = {simulated_mape:.3f}")

    if simulated_mape > MAPE_THRESHOLD:
        # In production: fire PagerDuty / Slack alert
        print(f"[monitor] ALERT: MAPE {simulated_mape:.3f} > threshold {MAPE_THRESHOLD}")

    # Push metric to Prometheus pushgateway (production)
    # from prometheus_client import CollectorRegistry, Gauge, push_to_gateway
    # ...


# ── DAG definition ──────────────────────────────────────────────────────────

with DAG(
    dag_id="retail_demand_forecast",
    description="Nightly retail demand forecasting pipeline",
    default_args=DEFAULT_ARGS,
    start_date=datetime(2024, 1, 1),
    schedule_interval="0 2 * * *",   # 02:00 UTC daily
    catchup=False,
    tags=["ml", "forecasting", "retail"],
    doc_md=__doc__,
) as dag:

    t_ingest = PythonOperator(
        task_id="ingest_data",
        python_callable=ingest_data,
    )

    t_features = PythonOperator(
        task_id="feature_engineering",
        python_callable=run_feature_engineering,
    )

    t_drift_check = BranchPythonOperator(
        task_id="check_accuracy_drift",
        python_callable=check_accuracy_drift,
    )

    t_train = PythonOperator(
        task_id="train_models",
        python_callable=train_models,
    )

    t_skip = EmptyOperator(task_id="skip_training")

    t_forecast = PythonOperator(
        task_id="batch_forecast",
        python_callable=batch_forecast,
        trigger_rule=TriggerRule.NONE_FAILED_MIN_ONE_SUCCESS,
    )

    t_write = PythonOperator(
        task_id="write_output",
        python_callable=write_output,
    )

    t_monitor = PythonOperator(
        task_id="monitor_accuracy",
        python_callable=monitor_accuracy,
    )

    # ── DAG edges ───────────────────────────────────────────────────────────
    t_ingest >> t_features >> t_drift_check
    t_drift_check >> [t_train, t_skip]
    [t_train, t_skip] >> t_forecast >> t_write >> t_monitor