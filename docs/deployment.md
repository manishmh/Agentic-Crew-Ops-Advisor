# Deployment: Railway API + Vercel frontend

CrewOps Recovery Copilot deploys as two services. Browser requests go to the public Railway API; provider credentials remain only in Railway environment variables.

## Railway backend

Create a Railway service from this repository with the repository root as its root directory. Railway detects the included [railway.json](../railway.json).

- Build command: `npm run build`
- Start command: `npm run start`
- Health check: `/health`
- Runtime: Node `>=22.12.0`

The backend build emits `dist/src/api/server.js`. At runtime it uses Railway's `PORT` and binds `0.0.0.0`; do not set `CREWOPS_PORT` in Railway.

Set these Railway variables:

```text
CREWOPS_LLM_PROVIDER=openai
CREWOPS_LLM_MODEL=openai/gpt-oss-20b
CREWOPS_LLM_API_KEY=...               # secret; Railway only
CREWOPS_LLM_BASE_URL=https://api.groq.com/openai/v1
CREWOPS_LLM_TIMEOUT_MS=12000
CREWOPS_ALLOWED_ORIGIN=https://your-project.vercel.app
CREWOPS_RATE_LIMIT=20
CREWOPS_RATE_WINDOW_MS=600000
CREWOPS_MAX_BODY_BYTES=4096
CREWOPS_TRUST_PROXY=false
```

For OpenAI, use `https://api.openai.com/v1` and an available OpenAI model instead. `CREWOPS_LLM_PROVIDER=disabled` is valid for deterministic fallback-only deployment.

`CREWOPS_ALLOWED_ORIGIN` must exactly match the Vercel production origin, with no path or trailing slash. It intentionally permits one origin. Update it explicitly if you use a custom domain. Leave `CREWOPS_TRUST_PROXY=false` unless Railway's proxy behavior has been verified to provide one sanitized client IP in `X-Forwarded-For`.

Verify after deployment:

```bash
curl https://your-railway-service.up.railway.app/health
```

Expected response:

```json
{"status":"ok","service":"crewops-recovery-copilot"}
```

## Vercel frontend

Create a Vercel project from the same repository and set its **Root Directory** to `frontend`. The included [frontend/vercel.json](../frontend/vercel.json) builds Vite into `dist`.

Set this Vercel environment variable for Production (and each preview environment that should call the API):

```text
VITE_CREWOPS_API_BASE_URL=https://your-railway-service.up.railway.app
```

This is a public API URL, not a secret. Never put `CREWOPS_LLM_API_KEY`, `OPENAI_API_KEY`, or any provider credential in Vercel variables with a `VITE_` prefix.

Deploy Railway first, then set the Vercel variable and deploy the frontend. If preview deployments must call Railway, add their exact origin to Railway deliberately; the backend does not use wildcard CORS.

## Local production check

```bash
npm install
npm run build
npm run start

npm install --prefix frontend
npm run build --prefix frontend
```

For local frontend development, leave `VITE_CREWOPS_API_BASE_URL` unset. Vite proxies `/api` and `/health` to `http://127.0.0.1:8080`.
