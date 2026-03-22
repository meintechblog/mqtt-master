---
phase: 05-loxone-bridge-plugin
plan: "03"
subsystem: ui
tags: [preact, htmpreact, fastify, mqtt, loxone, topic-routing]

# Dependency graph
requires:
  - phase: 05-loxone-bridge-plugin plan 02
    provides: LoxonePlugin with bidirectional MQTT bridge, getStatus(), structure.getAll()
  - phase: 04-plugin-system plan 02
    provides: Plugin config API (GET/PUT /api/plugins/:id/config), api-client.js fetch layer
provides:
  - Loxone controls table page with per-control enable/disable toggles
  - Topic routes configuration page with add/delete/direction management
  - Backend: GET/PUT /api/plugins/loxone/controls and /api/plugins/loxone/routes endpoints
  - Plugin-level topic route forwarding (inbound/outbound, subscription lifecycle)
  - Sidebar sub-navigation (Controls, Topic Routes) shown only when Loxone plugin is running
affects: [06-deployment, future-loxone-features]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Plugin-specific sub-navigation: sidebar inspects plugin id and status to conditionally render child links
    - Plugin-level CRUD endpoints: route handlers access plugin instance via app.pluginManager.getInstance()
    - Topic route subscription lifecycle: routes subscribed on start(), all cleaned up in routeSubscriptions Map on stop()
    - Inbound/outbound route forwarding: direction field determines whether external->Loxone or Loxone->external bridging

key-files:
  created:
    - webapp/js/pages/loxone-controls.js
    - webapp/js/pages/topic-routes.js
  modified:
    - plugins/loxone/plugin.js
    - server/routes/api-plugins.js
    - webapp/js/app.js
    - webapp/js/components/sidebar.js
    - webapp/js/lib/api-client.js

key-decisions:
  - "Plugin instance accessed in route handlers via app.pluginManager.getInstance('loxone') to avoid coupling plugin logic into route file"
  - "Topic route subscriptions stored in Map<routeId, handler> on plugin instance for clean per-route unsubscribe on stop/reload"
  - "Controls page fetches live from /api/plugins/loxone/controls — no client-side cache, always reflects running plugin state"
  - "disabledControls persisted to plugin config JSON so toggles survive plugin restarts"

patterns-established:
  - "Plugin sub-nav pattern: sidebar.js checks plugin.id === 'loxone' && plugin.status === 'running' to show child links indented under plugin entry"
  - "Loxone-specific API helpers in api-client.js: fetchLoxoneControls, toggleLoxoneControl, fetchTopicRoutes, saveTopicRoutes"

requirements-completed: [LOX-07, LOX-10, LOX-11, LOX-12, LOX-13]

# Metrics
duration: 30min
completed: 2026-03-22
---

# Phase 5 Plan 03: Loxone Controls Table, Topic Routes UI, and Bidirectional Forwarding Backend Summary

**Loxone controls table with per-UUID enable/disable toggles and topic routes page with inbound/outbound MQTT forwarding, backed by new plugin-instance REST endpoints**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-03-22T08:15:00Z
- **Completed:** 2026-03-22T09:14:42Z
- **Tasks:** 2 (1 auto + 1 human-verify)
- **Files modified:** 7

## Accomplishments

- Controls table page fetches all discovered Loxone controls and renders Name, Room, Type, Topic, and Enabled toggle columns
- Topic routes page allows creating, toggling, and deleting forwarding rules with source topic, target topic, and inbound/outbound direction
- Backend adds `getControls()`, `setControlEnabled()`, `getTopicRoutes()`, `setTopicRoutes()` to LoxonePlugin and wires up four new REST endpoints
- Sidebar shows "Controls" and "Topic Routes" sub-navigation links indented under the Loxone plugin entry only when the plugin is running
- Human verification confirmed controls table shows live data (Helligkeit/Zentral/InfoOnlyAnalog) and topic routes UI renders correctly with Venus OS dark theme

## Task Commits

Each task was committed atomically:

1. **Task 1: Controls API, topic routes backend, and Loxone UI pages** - `26b3d3c` (feat)
2. **Task 2: Verify controls table and topic routes UI** - human-verify checkpoint, APPROVED

**Plan metadata:** (docs commit — this summary)

## Files Created/Modified

- `webapp/js/pages/loxone-controls.js` - Preact page: fetches and renders controls table with enable/disable toggles
- `webapp/js/pages/topic-routes.js` - Preact page: lists existing routes, add-route form, direction dropdown, delete/toggle per route
- `plugins/loxone/plugin.js` - Added getControls(), setControlEnabled(), getTopicRoutes(), setTopicRoutes(), topic route subscription lifecycle
- `server/routes/api-plugins.js` - Added GET/PUT /api/plugins/loxone/controls and GET/PUT /api/plugins/loxone/routes endpoints
- `webapp/js/app.js` - Added hash routes #/loxone/controls and #/loxone/routes
- `webapp/js/components/sidebar.js` - Conditional Loxone sub-navigation when plugin is running
- `webapp/js/lib/api-client.js` - Added fetchLoxoneControls, toggleLoxoneControl, fetchTopicRoutes, saveTopicRoutes helpers

## Decisions Made

- Plugin instance accessed in route handlers via `app.pluginManager.getInstance('loxone')` — keeps plugin business logic self-contained and route file thin
- Topic route subscriptions stored in a `Map<routeId, handler>` on the plugin instance so each route can be individually unsubscribed without iterating all MQTT subscriptions
- `disabledControls` array persisted to plugin config JSON so toggling a control survives plugin restart or server reboot
- Controls page always fetches live from the API rather than caching — ensures display matches the running bridge state

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation followed the plan specification without unexpected errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All Loxone Bridge Plugin functionality is complete (phases 05-01 through 05-03)
- Phase 6 (deployment/packaging) can proceed: plugin system, UI, and bridge are fully operational
- No blockers identified

---
*Phase: 05-loxone-bridge-plugin*
*Completed: 2026-03-22*
