"""
Retail Demand Forecast API
--------------------------
FastAPI application that serves demand forecasts with Redis caching.

Endpoints:
  GET  /health                              — liveness check
  GET  /forecast/{store_id}/{sku_id}        — point forecast + CI (cached)
  POST /forecast/batch                      — multi-SKU forecast
  GET  /forecast/top-movers/{store_id}      — top 10 SKUs by predicted demand
  POST /retrain                             — trigger async retraining

Run locally:
    uvicorn serving.api.main:app --reload --port 8000

Docker:
    docker build -t forecast-api .
    docker run -p 8000:8000 --env-file .env forecast-api
"""
from __future__ import annotations

import json
import os
import hashlib
import asyncio
import logging
from datetime import date, datetime
from typing import List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import redis.asyncio as aioredis
import joblib

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── App ────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Retail Demand Forecast API",
    description="Production demand forecasting service for retail SKUs.",
    version="1.0.0",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Redis ──────────────────────────────────────────────────────────────────

REDIS_URL   = os.getenv("REDIS_URL",   "redis://localhost:6379")
CACHE_TTL   = int(os.getenv("CACHE_TTL_SECONDS", 3600 * 6))  # 6 h
MODEL_DIR   = os.getenv("MODEL_DIR",   "models")
FORECAST_DB = os.getenv("FORECAST_PATH", "data/sample/forecasts.parquet")

redis_client: aioredis.Redis | None = None


@app.on_event("startup")
async def startup():
    global redis_client
    try:
        redis_client = await aioredis.from_url(REDIS_URL, decode_responses=True)
        await redis_client.ping()
        logger.info("Redis connected ✓")
    except Exception as e:
        logger.warning(f"Redis unavailable ({e}). Running without cache.")
        redis_client = None
    # Pre-load forecast table into memory
    app.state.forecasts = _load_forecasts()
    logger.info(f"Loaded {len(app.state.forecasts):,} forecast rows")


@app.on_event("shutdown")
async def shutdown():
    if redis_client:
        await redis_client.close()


def _load_forecasts() -> pd.DataFrame:
    if os.path.exists(FORECAST_DB):
        return pd.read_parquet(FORECAST_DB)
    logger.warning("No forecast file found — returning empty DataFrame")
    return pd.DataFrame(columns=["store_id","sku_id","forecast_date",
                                  "predicted_qty","lower_95","upper_95"])


async def get_cache(key: str) -> dict | None:
    if not redis_client:
        return None
    raw = await redis_client.get(key)
    return json.loads(raw) if raw else None


async def set_cache(key: str, value: dict, ttl: int = CACHE_TTL):
    if not redis_client:
        return
    await redis_client.setex(key, ttl, json.dumps(value, default=str))


# ─── Schemas ────────────────────────────────────────────────────────────────

class ForecastPoint(BaseModel):
    forecast_date: date
    predicted_qty: int
    lower_95:      int
    upper_95:      int


class ForecastResponse(BaseModel):
    store_id:    str
    sku_id:      str
    horizon:     int
    generated_at: datetime
    forecasts:   List[ForecastPoint]
    cached:      bool = False


class BatchRequest(BaseModel):
    store_id: str
    sku_ids:  List[str] = Field(..., max_items=100)
    horizon:  int       = Field(default=14, ge=1, le=90)


class BatchForecastItem(BaseModel):
    sku_id:   str
    forecasts: List[ForecastPoint]


class BatchResponse(BaseModel):
    store_id:    str
    generated_at: datetime
    results:     List[BatchForecastItem]


class HealthResponse(BaseModel):
    status:     str
    model_loaded: bool
    redis_ok:   bool
    forecast_rows: int
    timestamp:  datetime


# ─── Helpers ────────────────────────────────────────────────────────────────

def _get_forecast(store_id: str, sku_id: str, horizon: int) -> List[ForecastPoint]:
    df = app.state.forecasts
    mask = (df["store_id"] == store_id) & (df["sku_id"] == sku_id)
    rows = df[mask].sort_values("forecast_date").head(horizon)
    if rows.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No forecasts found for store={store_id}, sku={sku_id}",
        )
    return [
        ForecastPoint(
            forecast_date=r.forecast_date,
            predicted_qty=int(r.predicted_qty),
            lower_95=int(r.lower_95),
            upper_95=int(r.upper_95),
        )
        for r in rows.itertuples()
    ]


# ─── Endpoints ──────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["ops"])
async def health():
    redis_ok = False
    if redis_client:
        try:
            await redis_client.ping()
            redis_ok = True
        except Exception:
            pass

    model_loaded = os.path.exists(f"{MODEL_DIR}/lgbm_model.pkl")
    return HealthResponse(
        status="ok",
        model_loaded=model_loaded,
        redis_ok=redis_ok,
        forecast_rows=len(app.state.forecasts),
        timestamp=datetime.utcnow(),
    )

@app.get(
    "/forecast/top-movers/{store_id}",
    summary="Top 10 SKUs by forecasted demand",
    tags=["forecast"],
)
async def top_movers(
    store_id: str,
    days:     int = Query(default=7, ge=1, le=30),
):
    df  = app.state.forecasts
    mask = df["store_id"] == store_id
    agg = (
        df[mask]
        .groupby("sku_id")["predicted_qty"]
        .sum()
        .sort_values(ascending=False)
        .head(10)
        .reset_index()
        .rename(columns={"predicted_qty": f"total_{days}d_qty"})
    )
    return agg.to_dict(orient="records")


@app.get(
    "/forecast/{store_id}/{sku_id}",
    response_model=ForecastResponse,
    summary="Get demand forecast for one SKU",
    tags=["forecast"],
)
async def get_forecast(
    store_id: str,
    sku_id:   str,
    horizon:  int = Query(default=14, ge=1, le=90, description="Days ahead"),
):
    cache_key = f"forecast:{store_id}:{sku_id}:{horizon}"

    # Cache hit
    cached = await get_cache(cache_key)
    if cached:
        cached["cached"] = True
        return ForecastResponse(**cached)

    # Compute
    forecasts = _get_forecast(store_id, sku_id, horizon)
    response  = ForecastResponse(
        store_id=store_id,
        sku_id=sku_id,
        horizon=horizon,
        generated_at=datetime.utcnow(),
        forecasts=forecasts,
        cached=False,
    )

    # Cache
    await set_cache(cache_key, response.dict())
    return response


@app.post(
    "/forecast/batch",
    response_model=BatchResponse,
    summary="Batch forecast for multiple SKUs",
    tags=["forecast"],
)
async def batch_forecast(req: BatchRequest):
    results = []
    for sku_id in req.sku_ids:
        try:
            forecasts = _get_forecast(req.store_id, sku_id, req.horizon)
            results.append(BatchForecastItem(sku_id=sku_id, forecasts=forecasts))
        except HTTPException:
            logger.warning(f"No forecast for {req.store_id}/{sku_id}")

    return BatchResponse(
        store_id=req.store_id,
        generated_at=datetime.utcnow(),
        results=results,
    )


@app.post(
    "/retrain",
    summary="Trigger async model retraining",
    tags=["ops"],
)
async def trigger_retrain(background_tasks: BackgroundTasks):
    async def _retrain():
        logger.info("Async retraining started …")
        # In production: fire an Airflow DAG run or SageMaker Training Job
        # await trigger_airflow_dag("retail_demand_forecast")
        await asyncio.sleep(1)   # placeholder
        logger.info("Retraining complete (placeholder)")

    background_tasks.add_task(_retrain)
    return {"status": "retraining_triggered", "timestamp": datetime.utcnow()}


@app.post(
    "/cache/invalidate",
    summary="Invalidate all cached forecasts",
    tags=["ops"],
)
async def invalidate_cache():
    if not redis_client:
        return {"status": "no_cache"}
    keys = await redis_client.keys("forecast:*")
    if keys:
        await redis_client.delete(*keys)
    return {"status": "invalidated", "keys_deleted": len(keys)}