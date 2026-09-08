# Frontend control audit

Verified 2026-09-08 against the React source and the local Chromium end-to-end flow.

| Surface | Control | Status | Behavior |
|---|---|---|---|
| Public entry | Open Operations Workspace | WORKS | Opens a blank CrewOps analysis and focuses the command input. |
| Public entry | View Architecture | WORKS | Opens the responsive architecture dialog; close and Escape are handled by the shared modal. |
| Global header | Product mark | WORKS | Returns to the dashboard without clearing the analysis session. |
| Global header | Refresh | REMOVED | A fixed snapshot has no meaningful refresh action, so the cosmetic control was removed. |
| Global header | Notifications | WORKS | Opens/closes the notification panel; review actions route through the shared scenario action. |
| Global header | Language | DISABLED INTENTIONALLY | English is the only interface language; the one-option selector is explicitly disabled. |
| Global header | Compact display / profile | WORKS | Toggles density or opens the operator-context dialog. |
| Navigation rail | Dashboard / Operations / Recovery / CrewOps | WORKS | Changes workspace without destroying current analysis state. |
| Navigation rail | Help / Settings / Profile | WORKS | Opens meaningful dialogs with close/Escape behavior. |
| Workspace | Dashboard / Timeline / Day Brief / CrewOps tabs | WORKS | Changes workspace and preserves session state. |
| Workspace | Date switching controls | REMOVED | The portfolio has one fixed operational snapshot, now presented as a static date rather than a misleading selector. |
| Dashboard | Metric cards, review actions, CrewOps actions | WORKS | Supported disruptions call the live query path. The non-executable duty-limit watchlist opens a blank analysis with a clear informational notice. |
| Dashboard | Crew tabs and search | WORKS | Filter the displayed synthetic watchlist locally. |
| Timeline | Search, block, direction, risk and view filters | WORKS | Filter or change the existing timeline presentation. |
| Timeline | Flight rows / network / delay action | WORKS | Select a flight, open the schematic network, or run the supported delay scenario. |
| Day Brief | Priority and recommended actions | WORKS | Route supported disruptions through the same live scenario action. |
| CrewOps | New Analysis | WORKS | Opens Blank plus five live scenario choices; scenarios execute immediately. |
| CrewOps | Blank Analysis | WORKS | Clears active analysis, preserves history, focuses input, and makes no request. |
| CrewOps | Sidebar, central and compact scenario controls | WORKS | All use the same scenario executor and the same backend query function. |
| CrewOps | Session history | WORKS | Restores completed and failed analyses without issuing another API request. |
| CrewOps | Command textarea, Enter, Shift+Enter and Send | WORKS | All submissions share one guarded API path; Shift+Enter remains a newline. |
| CrewOps | Network view | WORKS | Opens the existing schematic; closure analysis uses the live API. |
| Result | Evidence buttons | WORKS | Open deterministic decision evidence separately from the agent trace. |
| Public workspace bar | Overview / Architecture | WORKS | Returns to the entry experience or opens architecture without losing the in-memory session. |

No visible major control remains click-styled without a behavior.
