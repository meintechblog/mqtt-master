---
phase: 04-plugin-system
plan: "02"
subsystem: ui
tags: [preact, htm, signals, json-schema, fetch-api, hash-routing]

# Dependency graph
requires:
  - phase: 04-01
    provides: Plugin REST API endpoints (GET /api/plugins, POST /api/plugins/:id/start|stop|reload, GET/PUT /api/plugins/:id/config)
provides:
  - Dynamic sidebar plugin list with status dots and 5-second polling
  - Plugin config page with auto-generated form from JSON Schema
  - Start/Stop/Reload lifecycle control buttons
  - Hash routing for /#/plugins/:id pattern
  - api-client.js with fetch wrappers for all plugin REST endpoints
affects: [05-loxone-bridge, 06-final]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - JSON Schema property iteration for auto-generating form fields (string/number/boolean types)
    - Polling with setInterval inside useEffect + cleanup on unmount
    - Dynamic hash route matching with startsWith prefix pattern before static route map lookup
    - useState for local component state (not signal() which creates new signals on each render)

key-files:
  created:
    - webapp/js/lib/api-client.js
    - webapp/js/pages/plugin-config.js
  modified:
    - webapp/js/components/sidebar.js
    - webapp/js/app.js
    - webapp/css/theme.css

key-decisions:
  - "useState for PluginConfig local state — signal() inside component body creates new signals on each render, breaking reactivity"
  - "5-second polling interval in sidebar useEffect for plugin status refresh (no WebSocket push for plugin state)"
  - "Dynamic route matching: check #/plugins/ prefix after static routes map, extract plugin ID as substring"
  - "Auto-generated form iterates schema.properties — string->text, number->number, boolean->checkbox with title as label"

patterns-established:
  - "Pattern: api-client.js as thin fetch wrapper layer — all REST calls go through named functions, never raw fetch in components"
  - "Pattern: auto-generated forms from JSON Schema properties with type-driven input selection"

requirements-completed: [PLUG-01, PLUG-02, PLUG-03, PLUG-04]

# Metrics
duration: 15min
completed: 2026-03-22
---

# Phase 4 Plan 02: Plugin Management UI Summary

**Preact sidebar with live plugin status dots and JSON-Schema-driven config form with Start/Stop/Reload controls, completing the plugin management UX**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-22T07:36:00Z
- **Completed:** 2026-03-22T08:40:00Z
- **Tasks:** 2 (1 auto + 1 human-verify, approved)
- **Files modified:** 5

## Accomplishments

- Created api-client.js with six named fetch wrappers covering all plugin REST endpoints
- Updated sidebar to dynamically load plugin list from /api/plugins on mount with 5-second polling and inline status dots
- Built PluginConfig page that auto-generates a form from any plugin's JSON Schema (string/number/boolean inputs), pre-populates from current config, and saves via PUT
- Added Start/Stop/Reload lifecycle buttons with disabled state based on current plugin status
- Extended hash router in app.js to handle the /#/plugins/:id wildcard pattern
- Added .status-dot--stopped CSS class and .sidebar-plugin-status layout helper to theme

## Task Commits

Each task was committed atomically:

1. **Task 1: API client + sidebar plugin list + plugin config page + routing** - `39a18fa` (feat)
2. **Fix: use useState instead of signal() in PluginConfig component** - `d32fe32` (fix)

**Plan metadata:** _(to be committed with this SUMMARY)_

## Files Created/Modified

- `webapp/js/lib/api-client.js` - Fetch wrappers for all six plugin REST endpoints
- `webapp/js/pages/plugin-config.js` - Plugin detail/config page with auto-generated form and lifecycle buttons
- `webapp/js/components/sidebar.js` - Extended with dynamic plugin list, status dots, and 5s polling
- `webapp/js/app.js` - Added #/plugins/:id dynamic route matching and PluginConfig import
- `webapp/css/theme.css` - Added .status-dot--stopped and .sidebar-plugin-status classes

## Decisions Made

- useState over signal() for PluginConfig local state: `signal()` called inside a component body creates a new signal instance on every render, so updates to `.value` never trigger a re-render. `useState` is the correct Preact hook for mutable local state.
- 5-second polling in sidebar rather than a dedicated WebSocket channel — plugin state changes are infrequent and the REST API is already available.
- Dynamic route resolution checks the static routes map first, then falls back to the `#/plugins/` prefix check, then NotFound. This keeps the existing route table clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed signal() usage inside PluginConfig component body**
- **Found during:** Task 2 (human-verify checkpoint — bug caught during browser testing)
- **Issue:** `signal()` called inside the component body creates new signal instances on each render. State changes to `.value` do not trigger re-renders because the component is always holding a brand-new signal reference.
- **Fix:** Replaced all per-field `signal()` calls with a single `useState` holding the config object; replaced `pluginInfo` and `saveStatus` signals with `useState` as well.
- **Files modified:** `webapp/js/pages/plugin-config.js`
- **Verification:** Plugin config page rendered correctly in browser — status dot updated, form fields populated, Save feedback appeared
- **Committed in:** `d32fe32` (separate fix commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Fix was essential for correct component behavior. No scope creep.

## Issues Encountered

None beyond the signal() bug documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All four PLUG requirements (PLUG-01 through PLUG-04) are satisfied
- Plugin sidebar and config page are live at http://mqtt-master.local:3000
- Phase 5 (Loxone Bridge) can now build on the complete plugin infrastructure — the example plugin demonstrates the full contract: start/stop/reload/config lifecycle
- Blocker noted: real LoxAPP3.json file needed before finalizing topic schema in Phase 5

---
*Phase: 04-plugin-system*
*Completed: 2026-03-22*

## Self-Check: PASSED

- FOUND: .planning/phases/04-plugin-system/04-02-SUMMARY.md
- FOUND commit: 39a18fa (feat: plugin management UI)
- FOUND commit: d32fe32 (fix: useState instead of signal())
