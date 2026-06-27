# Retail Demand Forecasting Platform

Production-grade demand forecasting system for retail SKUs, inspired by Amazon Seller Analytics.

## Live API
https://retail-demand-forecast.onrender.com/docs

## Tech Stack
- LightGBM, Prophet (ML models)
- FastAPI (REST API)
- Airflow (pipeline orchestration)
- Redis (caching)
- MLflow (experiment tracking)
- Evidently AI (drift monitoring)

## Features
- 14-28 day demand forecasts per store and SKU
- 95% confidence intervals
- Batch forecasting for multiple SKUs
- Top movers by store
- Auto-retraining trigger

## Project Structure
- `data/` — synthetic data generator
- `data_pipeline/` — feature engineering + Airflow DAG
- `model_training/` — LightGBM training + batch predictor
- `serving/` — FastAPI REST service
- `monitoring/` — MAPE tracking + drift detection
- `docker/` — Docker Compose for full stack

## Run Locally
pip install -r requirements.txt
python data/generate_sample_data.py
python data_pipeline/features/engineer.py
python model_training/trainer.py
python model_training/predictor.py
uvicorn serving.api.main:app --reload
