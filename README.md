# Retail Demand Forecast

This repository contains a retail demand forecasting API and a new static dashboard for forecast visualization.

## What was added

- `public/` — static dashboard site with forecast lookup and top movers views
- `vercel.json` — Vercel configuration for deploying the dashboard as a static site
- `render.yaml` — Render configuration for deploying the API service from `docker/Dockerfile.api`
- `README.md` — deployment and usage instructions

## Dashboard

The dashboard is a simple static site that calls your API backend.

1. Deploy the API on Render using `render.yaml`.
2. Deploy the dashboard on Vercel using `vercel.json`.
3. Enter the Render service URL in the dashboard's `Backend API URL` field.

## Deployment

### Render

The API service is configured in `render.yaml`:

- `type: web_service`
- `env: docker`
- `repo: https://github.com/anushaphougat/Retail_Demand_Forecast`
- `branch: main`
- `dockerfilePath: docker/Dockerfile.api`
- `startCommand: uvicorn serving.api.main:app --host 0.0.0.0 --port $PORT`

After connecting this repository on Render, the service should build and serve the API.

### Vercel

The dashboard is configured to deploy as a static site with `@vercel/static`.

If you connect this repository on Vercel, it will publish the site from the `public/` folder.

## API endpoints used by the dashboard

- `GET /forecast/{store_id}/{sku_id}?horizon={days}`
- `GET /forecast/top-movers/{store_id}?days=7`

## Usage

1. Deploy the API on Render.
2. Deploy the dashboard on Vercel.
3. Open the dashboard and paste your Render service URL into the `Backend API URL` field.

## Notes

- No hard-coded deployment links are kept in this repository.
- If you previously linked a GitHub Pages or repository deployment URL, remove it in GitHub repository settings.
