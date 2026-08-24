# Retail Demand Forecast

Retail Demand Forecast is a retail demand forecasting repository for SKU-level demand prediction across stores.
Live deployed link- https://retail-demand-forecast-eight.vercel.app/

It includes:

- FastAPI API in `serving/api/main.py`
- Static dashboard in `public/`
- Docker runtime config in `docker/Dockerfile.api`
- Render deployment manifest in `render.yaml`
- Vercel static-site config in `vercel.json`
- GitHub Actions deployment workflow in `.github/workflows/deploy.yml`

## Project Overview

### API
The API serves forecast data from a precomputed Parquet file and supports caching via Redis.
Main endpoints:

- `GET /health` — health check, model status, Redis status, and forecast row count
- `GET /forecast/{store_id}/{sku_id}` — single SKU forecast with horizon support
- `GET /forecast/top-movers/{store_id}` — top 10 SKUs by forecasted demand
- `POST /forecast/batch` — batch forecast for up to 100 SKUs
- `POST /retrain` — placeholder retraining trigger
- `POST /cache/invalidate` — flush forecast cache

### Dashboard
The dashboard is a static client in `public/` that calls the API to display:

- SKU forecast time series
- 95% forecast interval
- Top movers by predicted quantity

## Local setup

### 1. Install Python dependencies

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Run the API locally

```powershell
uvicorn serving.api.main:app --reload --port 8000
```

Browse API docs at:

- `http://localhost:8000/docs`
- `http://localhost:8000/health`

### 3. Serve the dashboard locally

```powershell
python -m http.server 8080 --directory public
```

Then open:

- `http://localhost:8080`

and set the dashboard backend URL to your local API:

- `http://localhost:8000`

## Training and forecast generation

### Train models

Run the trainer to train a LightGBM model and log metrics to MLflow:

```powershell
python -m model_training.trainer
```

### Generate forecasts

Build a feature matrix and predict future SKU demand:

```powershell
python -m model_training.predictor
```

The predictor outputs forecasts to:

- `data/sample/forecasts.parquet`

## Deployment

### Render API

Use `render.yaml` to deploy the FastAPI service:

- service type: `web_service`
- environment: `docker`
- Dockerfile: `docker/Dockerfile.api`
- start command: `uvicorn serving.api.main:app --host 0.0.0.0 --port $PORT`

### Vercel dashboard

Use `vercel.json` to deploy the static dashboard from the `public/` directory.

- Live demo: https://retail-demand-forecast-w1zk.vercel.app/

### GitHub Actions deployment

A GitHub Actions workflow is included at `.github/workflows/deploy.yml`.
It deploys the dashboard to Vercel and the API to Render on `main` branch pushes.

### Required GitHub secrets

Set these repository secrets in GitHub:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `RENDER_API_KEY`
- `RENDER_SERVICE_ID`

## File structure

- `data/` — data and sample datasets
- `data_pipeline/` — feature engineering and Airflow DAGs
- `model_training/` — model training and batch prediction
- `serving/` — FastAPI service
- `public/` — static dashboard site
- `docker/` — Docker runtime and compose config
- `.github/workflows/deploy.yml` — CI/CD deployment workflow
- `render.yaml` — Render service manifest
- `vercel.json` — Vercel static site config

## Notes

- The current API loads precomputed forecasts from `data/sample/forecasts.parquet`.
- Redis caching is optional; the API will still work if Redis is unavailable.
- The dashboard is designed to work with the API base URL configured by the user.

## File structure

- `data/` — data and sample datasets
- `data_pipeline/` — feature engineering and Airflow DAGs
- `model_training/` — model training and batch prediction
- `serving/` — FastAPI service
- `public/` — static dashboard site
- `docker/` — Docker runtime and compose config
- `.github/workflows/deploy.yml` — CI/CD deployment workflow
- `render.yaml` — Render service manifest
- `vercel.json` — Vercel static site config

## Notes

- The current API loads precomputed forecasts from `data/sample/forecasts.parquet`.
- Redis caching is optional; the API will still work if Redis is unavailable.
- The dashboard is designed to work with the API base URL configured by the user.
