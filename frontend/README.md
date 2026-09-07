# dCortex CrewOps Advisor

Interactive, mock-only OCC frontend built with the existing React, TypeScript, Vite and Oxlint stack. All files and dependencies are contained in `frontend/`.

## Run

```sh
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run build` runs TypeScript checking and creates `dist/`. `npm run lint` runs Oxlint. `npm run preview` serves the production build.

## Demo route

1. Start on Dashboard: inspect the seven operational metrics, switch the FTL crew tabs, and review the exception queue.
2. Open Timeline: filter by time block, base, direction or risk; switch between the time grid and table; inspect a flight.
3. Open Day Brief: launch a recommended action directly into CrewOps AI.
4. Open CrewOps AI and choose **What happens if C-1042 reports sick?**. Inspect the recommendation, expand alternatives, and open **View Decision Evidence**.
5. Use the scenario list to demonstrate delay, closure, certification expiry and joint recovery. The empty-state prompts also expose the duty-limit lookup.

Manual submission recognizes the prepared prompt text (case-insensitive, with either hyphens or en dashes). Other text receives an explicit demo explanation and a choice of supported scenarios; it is not presented as a calculated result. Enter submits; Shift+Enter inserts a newline. Ctrl/Cmd+K starts a new analysis while retaining session history. History is held in memory and resets on page reload.

## Display architecture

- `src/app/AppShell.tsx`: workspace, date, session, and overlay state.
- `src/components/layout/`: global rail, header, and schematic network view.
- `src/components/dashboard/`, `timeline/`, `daybrief/`: operational workspaces.
- `src/components/crewops/`: command workspace, shared scenario rendering, recovery cards, and evidence drawer.
- `src/components/ui.tsx`: status badges, panels, rule evidence, cost breakdowns and accessible native dialogs.
- `src/data/mocks.ts`: prepared display scenarios, flight timelines, FTL rows, exception and brief data.
- `src/types/operations.ts`: frontend display contracts, including explicit legal/rejected/warning/not-evaluated states.
- `src/index.css`: dark semantic color tokens, component styles and responsive layouts.

## Mock boundaries

The operational snapshot is fixed to **14 September 2026**. Other date selections explicitly show that no snapshot is available. Scenario examples can reference future duties. Timeline rows are a curated demonstration subset, not all 147 flights. Schematic network positions and timeline bar positions are display fixtures.

Legality, ranks, costs, comparisons and delays are supplied display values. The frontend does not calculate operational legality or recovery and does not import backend source, make API calls, or apply operational actions. Mock scenarios are illustrative and are not asserted to reproduce the root dataset's current answers.

## Verification

Build (including TypeScript) and Oxlint pass. Verified in local Chromium at 1440, 1280 and 1024 pixel widths: navigation, crew tabs, timeline filters and table toggle, all disruption scenarios, manual query submission, fallback response, history isolation, evidence open/close and scroll, date availability, display settings, notifications and network closure state. Native dialogs provide focus trapping and Escape dismissal; reduced-motion preferences are respected.
