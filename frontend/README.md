# CrewOps Recovery Copilot frontend

The React/Vite interface presents a synthetic airline operations workspace and sends every operational analysis to the same-origin `POST /api/crewops/query` endpoint. It contains no operational-result mock fallback and no provider credentials.

From the repository root, start the API with `npm run api`. In another terminal:

```bash
npm install --prefix frontend
npm run dev --prefix frontend
```

Vite proxies `/api` and `/health` to `http://127.0.0.1:8080` by default. Override the development target with `CREWOPS_API_PROXY_TARGET` when needed.

Use `npm run build --prefix frontend` for the production bundle and `npm run lint --prefix frontend` for static checks. The application exposes five guided disruption analyses, typed command submission, in-memory session history, decision evidence, and an architecture view.

The operational snapshot is synthetic and fixed to 14 September 2026. The project is independent, is not connected to an airline, and is not intended for operational aviation use.
