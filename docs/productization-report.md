# Productization verification

Verdict: **PORTFOLIO READY** — ready for a public deployment; no deployment or push was performed.

## Files changed

- `.env.example`
- `.gitignore`
- `README.md`
- `frontend/README.md`
- `frontend/index.html`
- `frontend/package.json`
- `frontend/public/crewops.svg`
- `frontend/public/portfolio-overview.png`
- `frontend/src/api/crewops.ts`
- `frontend/src/app/AppShell.tsx`
- `frontend/src/components/ProjectOverview.tsx`
- `frontend/src/components/crewops/CrewOpsWorkspace.tsx`
- `frontend/src/components/crewops/EvidenceDrawer.tsx`
- `frontend/src/components/crewops/RecoveryOption.tsx`
- `frontend/src/components/crewops/ScenarioResult.tsx`
- `frontend/src/components/layout/TopBar.tsx`
- `frontend/src/data/project.ts`
- `frontend/src/data/projectFacts.json`
- `frontend/src/data/verification.json`
- `frontend/src/index.css`
- `frontend/src/types/operations.ts`
- `package-lock.json`
- `package.json`
- `scripts/audit-public.mjs`
- `scripts/browser-rate-smoke.mjs`
- `scripts/browser-smoke.mjs`
- `scripts/project-facts.mjs`
- `src/api/config.ts`
- `src/api/server.ts`
- `tests/server.test.ts`
- `docs/productization-report.md` (this report)

## Public product

- Independent **CrewOps Recovery Copilot** branding replaces the old product identity, logo and registration mark.
- Compact entry screen provides positioning, the deterministic/LLM principle, generated dataset totals, test evidence and Open Operations Workspace / View Architecture actions.
- A visible synthetic-data disclaimer and explicit operational-use limitations appear in the application and README.
- All five guided scenarios use the live agent API. Manual questions use the same path. No operational mock success is substituted.
- Static dashboard/timeline views are labeled illustrative. Small-screen scenario navigation remains available after results.
- Architecture dialog explains planner, validation, controller, engine, recovery, cost, grounding and parser fallback, with engineering evidence and limitations.
- Decision evidence is separated from an agent trace with planner/engine/explainer timings.
- Fixed duplicate React keys for repeated rules/candidates across duties, without changing evidence content.
- Added title, description and Open Graph metadata; an independent SVG icon and a real browser screenshot.
- LOOKUP intentionally deferred: existing primitives would still require a new public response/UI contract.

## Public HTTP boundary

- Configurable default **20 requests / 10 minutes / client** fixed-window limiter, isolated per server instance, bounded to 10,000 client records; 429 and Retry-After.
- **4,096-byte** complete JSON body limit, including chunked transfer; oversized requests return 413.
- Shape checks reject malformed/empty questions before model calls.
- Cheap GET /health returns only status and service identity.
- Same-origin deployment by default; optional single exact CORS origin. Proxy trust defaults off. Only explicitly trusted proxies that overwrite a single client-IP header should enable it.
- Validates numeric limits, provider identifier, provider endpoint format and allowed origin without echoing configuration values. Existing invalid provider timeout behavior safely uses its default.
- Generated X-Request-ID response header and JSON logs: ID, event/intent, status, duration, provider and fallback flags. No question text, prompts, headers or credentials logged.
- Safe public errors, clearer frontend clarification/unsupported/rate-limit/offline states.
- Node 22.12+ scripts automatically load backend .env; .env and its variants are ignored. No secrets use Vite variables.

## Verification

| Check | Result |
|---|---|
| Automated suite | 294 passed, 24 files; final Vitest completion observed |
| New HTTP tests | 13 passing (health, IDs, isolation/reset, limits, chunked input, malformed payloads, CORS, safe logs/config, provider fallback) |
| Typecheck | PASS |
| Frontend production build | PASS |
| Frontend lint | PASS |
| git diff --check | PASS |
| Offline agent eval | 46 cases; 100% tracked metrics; zero failures/fallbacks |
| Live planner smoke | One seven-case Groq eval; all tracked metrics 100%; zero failures/fallbacks; median 1,154.9 ms, p95 1,582.1 ms |
| Browser with no provider | All five real API scenario calls, expected deterministic fallback, evidence, entry, architecture, no console/runtime errors |
| Browser with provider | One sick-crew scenario through real API, AI planning, evidence, no console/runtime errors |
| Browser layout | Entry, workspace and architecture at 1440, 1280, 1024, 768 px; no page overflow; small-screen scenario controls present |
| Browser rate limit | Separate limit=1 API: 400 followed by structured 429, no provider calls |
| Secret audit | No configured credential or obvious key-pattern matches in tracked/new source or built frontend; .env ignored and untracked |
| Frozen files | No changes in rules, recovery, data, generator, validator or agent implementation |

The historical 35/35 live stability sample is labeled historical. The offline scripted corpus validates schema/harness behavior, not real model interpretation. The completed dataset sweep recorded 2,600 analyses; broader orchestration/API verification exceeds 2,700 calls.

## Documentation and local startup

The root README is an engineering case study with architecture Mermaid, responsibility table, five queries, modeled rules, recovery, dataset, verified metrics, environment variables, deployment and limitations. The frontend README now accurately describes the live API boundary.

```sh
npm ci
npm ci --prefix frontend
cp .env.example .env
npm run api
# Second terminal:
npm run dev --prefix frontend
```

Node 22.12+ required. The example starts in deterministic mode. Set backend provider configuration and restart to enable Groq. Dependency manifests/lockfiles and build commands were checked without deleting the existing node_modules.

Deployment recommendation: one HTTPS origin serving only frontend/dist, with /api and /health reverse-proxied to a Node service that has the compiled backend and data directory. Provider credentials stay on the Node host. README covers trusted proxy IP handling, timeouts and environment variables.

## Remaining limitations

Synthetic data and fixed operational period; no live airline integration; supplied-certification completeness limitation; bounded grounding guard; stochastic model behavior; in-memory rate limiting resets on restart and is per process. Generic lookup, aircraft swaps, rerouting, passenger optimization and prediction remain unsupported. No public deployment URL is claimed.

No commits or pushes were made. No provider secrets were added to source or the frontend bundle.
