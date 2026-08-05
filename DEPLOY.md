# Deploy to Vercel

This project serves a static UI from the `public/` directory and expects a FastAPI backend.

Quick steps (UI + automated GitHub Action):

1. Vercel project setup (UI)
   - Go to Vercel and import the GitHub repository `anushaphougat/Retail_Demand_Forecast`.
   - In Project Settings → General, set the Build Command to:

```
npm run build
```

   - Output Directory: `public` (or leave blank; `vercel.json` already maps `/public`).
   - Add Environment Variable `BACKEND_URL` (Preview/Production) pointing to your deployed FastAPI URL.

2. Add Vercel and project secrets for GitHub Actions (optional automated deploy)
   - In your GitHub repo, go to Settings → Secrets → Actions and add:
     - `VERCEL_TOKEN` — your Vercel personal token
     - `VERCEL_ORG_ID` — team/org id from Vercel
     - `VERCEL_PROJECT_ID` — project id in Vercel
     - `BACKEND_URL` — the backend URL to inject during build

3. Deploy using GitHub Actions
   - The included workflow `.github/workflows/vercel-deploy.yml` runs on `push` to `main`.
   - It runs `npm run generate-runtime-config` to create `public/runtime-config.js` from `BACKEND_URL`, then calls the Vercel action.

4. Manual CLI deploy (one-off)
```
npm i -g vercel
vercel login
# generate runtime config locally
BACKEND_URL="https://your-backend.example" npm run generate-runtime-config
git add public/runtime-config.js
git commit -m "Add runtime config for Vercel"
git push
vercel --prod
```

Backend deployment (recommended: Render or Railway)
 - Deploy the FastAPI app to Render/Railway and copy the HTTPS URL.
 - Use that HTTPS URL as `BACKEND_URL` in Vercel (or in GitHub Secrets).
