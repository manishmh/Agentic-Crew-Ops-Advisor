# Deployment: Vercel

CrewOps Recovery Copilot deploys from this repository's root as one Vercel project: a Vite frontend with same-origin Node API functions. Provider credentials remain server-side in Vercel environment variables.

## Vercel project

Import this repository and leave **Root Directory** set to the repository root. The included [vercel.json](../vercel.json) installs root and frontend dependencies, runs `npm run build:vercel`, publishes `frontend/dist`, and bundles `data/**` with the API functions.

- Build command: `npm run build:vercel`
- Output directory: `frontend/dist`
- Health check: `/health`
- Runtime: Node `>=22.12.0`

Do not set `VITE_CREWOPS_API_BASE_URL` for this topology. Browser requests use the same-origin `/api/crewops/query` and `/health` routes.

## Environment variables

Set these in Vercel for Production (and only the Preview environments that should have provider access):

```text
CREWOPS_LLM_PROVIDER=openai
CREWOPS_LLM_MODEL=openai/gpt-oss-20b
CREWOPS_LLM_API_KEY=...               # secret; server-side only
CREWOPS_LLM_BASE_URL=https://api.groq.com/openai/v1
CREWOPS_LLM_TIMEOUT_MS=12000
CREWOPS_RATE_LIMIT=20
CREWOPS_RATE_WINDOW_MS=600000
CREWOPS_MAX_BODY_BYTES=4096
CREWOPS_ALLOWED_ORIGIN=
CREWOPS_TRUST_PROXY=false
```

For OpenAI, use `https://api.openai.com/v1` and an available OpenAI model instead. `CREWOPS_LLM_PROVIDER=disabled` is valid for deterministic fallback-only deployment.

Provider keys must never use a `VITE_` prefix: only the API functions receive them. Same-origin deployments leave `CREWOPS_ALLOWED_ORIGIN` empty; set it to one exact origin only if an external browser application must call this API.

## Verify deployment

```bash
curl https://your-project.vercel.app/health
```

Expected response:

```json
{"status":"ok","service":"crewops-recovery-copilot"}
```

Then submit one guided scenario in the browser. A successful deterministic fallback is valid when a provider is unavailable; no provider secret is ever sent to the browser.

## Local production check

```bash
npm install
npm install --prefix frontend
npm run build:vercel
npm run start
```

For local frontend development, run `npm run api` and `npm run dev --prefix frontend`. Leave `VITE_CREWOPS_API_BASE_URL` unset so Vite proxies `/api` and `/health` to `http://127.0.0.1:8080`.
