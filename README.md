# Retail Demand Forecasting Platform

Production-grade demand forecasting system for retail SKUs.
Inspired by Amazon Seller Analytics.
Live API link - https://retail-demand-forecast.onrender.com/docs
---

## Architecture

```
Data Sources → Ingestion → Feature Engineering → Model Training → Serving → Monitoring
   (POS, ERP)   (Kafka/S3)    (Lag, Calendar)     (LightGBM+    (FastAPI   (MAPE +
                                                    Ensemble)     + Redis)    Drift)
```

## Project Structure

```
retail-demand-forecasting/
├── data/
│   ├── generate_sample_data.py     # Synthetic data generator
│   └── sample/                     # Generated CSVs and parquet files
├── data_pipeline/
│   ├── dags/
│   │   └── forecast_dag.py         # Airflow nightly pipeline
│   └── features/
│       └── engineer.py             # Feature engineering module
├── model_training/
│   ├── trainer.py                  # LightGBM + ensemble training
│   └── predictor.py                # Batch forecast generation
├── serving/
│   └── api/
│       └── main.py                 # FastAPI REST service
├── monitoring/
│   └── monitor.py                  # MAPE tracking + drift detection
├── docker/
│   ├── docker-compose.yml          # Full stack (API, Redis, MLflow, Airflow)
│   └── Dockerfile.api              # API container
└── requirements.txt
```

---

## Quick Start (5 minutes)

### 1. Install dependencies
```bash
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Generate sample data
```bash
python data/generate_sample_data.py
# → data/sample/sales.csv       (10 stores × 50 SKUs × 3 years)
# → data/sample/external.csv    (weather + holiday signals)
```

### 3. Build feature matrix
```bash
python -m data_pipeline.features.engineer
# → data/sample/features.parquet
```

### 4. Train models
```bash
python -m model_training.trainer
# → models/lgbm_model.pkl
# → models/meta.json
# → MLflow UI: http://localhost:5000
```

### 5. Generate forecasts
```bash
python -m model_training.predictor
# → data/sample/forecasts.parquet
```

### 6. Start the API
```bash
uvicorn serving.api.main:app --reload --port 8000
# → http://localhost:8000/docs
```

### 7. Test the API
```bash
# Single SKU forecast
curl "http://localhost:8000/forecast/STORE_001/SKU_0001?horizon=14"

# Health check
curl "http://localhost:8000/health"

# Top movers
curl "http://localhost:8000/forecast/top-movers/STORE_001"
```

---

## Full Stack with Docker

```bash
cd docker
docker compose up -d

# Services:
#   Forecast API  → http://localhost:8000/docs
#   Airflow       → http://localhost:8080  (admin/admin)
#   MLflow        → http://localhost:5000
#   Grafana       → http://localhost:3000  (admin/admin)
#   Prometheus    → http://localhost:9090
```

---

## Run Monitoring

```bash
python -m monitoring.monitor
# Outputs: rolling MAPE, feature drift PSI, Slack alert if threshold breached
```

Set `SLACK_WEBHOOK_URL` env var to receive real alerts.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Liveness + readiness check |
| GET | `/forecast/{store}/{sku}?horizon=14` | Point forecast with 95% CI |
| POST | `/forecast/batch` | Multi-SKU batch forecast |
| GET | `/forecast/top-movers/{store}` | Top 10 SKUs by demand |
| POST | `/retrain` | Trigger async retraining |
| POST | `/cache/invalidate` | Flush Redis cache |

---

## Model Details

| Model | Use case | MAPE (typical) |
|-------|----------|----------------|
| LightGBM | Tabular features, fast inference | 8–14% |
| Prophet | Strong weekly/yearly seasonality | 10–18% |
| Ensemble | Weighted blend (60/40) | 7–12% |

**Features used (30+):**
- Lag sales: 7d, 14d, 21d, 28d, 35d, 42d
- Rolling mean/std: 7d, 14d, 28d
- Calendar: day of week, week of year, month, Fourier terms
- Price + price deviation from rolling mean
- Promotions flag
- Days of cover (inventory)
- External: temperature, holiday, event score

---

## Production Checklist

- [ ] Replace CSV sources with Kafka consumer / ERP API
- [ ] Point Airflow to real DAG S3 bucket
- [ ] Configure Redshift/BigQuery connection in feature store
- [ ] Set `POSTGRES_DSN` for forecast output
- [ ] Set `SLACK_WEBHOOK_URL` for alerts
- [ ] Enable MLflow remote tracking (S3 artifact store)
- [ ] Add Kubernetes HPA on the FastAPI deployment
- [ ] Set up Grafana dashboard importing `docker/grafana_dashboard.json`
- [ ] Configure AWS Secrets Manager / GCP Secret Manager for credentials

---

## Portfolio Notes

Each layer maps to a standalone GitHub project or notebook:

1. **Data pipeline** → `retail-forecasting-pipeline` repo (Airflow + feature engineering)
2. **Model training** → `demand-forecast-models` repo (LightGBM + Prophet + MLflow)
3. **Serving** → `forecast-api` repo (FastAPI + Docker + Redis)
4. **Monitoring** → notebook: "How to detect ML model drift in production"

Skills demonstrated: time-series ML, feature engineering, MLOps, REST APIs,
Redis caching, containerisation, monitoring, data drift detection.
