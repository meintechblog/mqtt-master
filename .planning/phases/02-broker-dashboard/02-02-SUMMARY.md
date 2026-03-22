---
phase: 02-broker-dashboard
plan: "02"
subsystem: ui
tags: [preact, htm, websocket, signals, dashboard, mqtt, venus-os]

# Dependency graph
requires:
  - phase: 02-01
    provides: WebSocket /ws/dashboard endpoint broadcasting sys_state and connection_status messages
  - phase: 01-02
    provides: SPA shell with Preact/HTM, hash router, sidebar component, Venus OS theme CSS

provides:
  - WebSocket client module (ws-client.js) with Preact signals and exponential backoff reconnect
  - StatCard component for metric display
  - TopicTree component for collapsible $SYS hierarchy
  - Dashboard page with live stat cards, broker info panel, and topic tree
  - Sidebar StatusDot wired to real broker connection state via brokerConnected signal

affects: [03-message-explorer, 04-plugin-system, 05-loxone-bridge]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - WebSocket client with Preact signals for reactive UI updates without build tools
    - Exponential backoff reconnect (1s -> 2s -> ... -> 30s, reset on success)
    - Auto-connect on module import pattern for shared WebSocket singleton
    - Hierarchical object rendering via recursive TreeNode component
    - formatBytes/formatUptime helpers for human-readable metric display

key-files:
  created:
    - webapp/js/lib/ws-client.js
    - webapp/js/components/stat-card.js
    - webapp/js/components/topic-tree.js
    - webapp/js/pages/dashboard.js
  modified:
    - webapp/js/components/sidebar.js
    - webapp/css/theme.css

key-decisions:
  - "ws-client auto-connects on module import as a singleton — no connect/disconnect lifecycle management needed in Dashboard useEffect"
  - "brokerConnected signal imported into sidebar for StatusDot wiring — avoids prop-drilling through app shell"
  - "TopicTree depth=0 nodes expand by default, deeper levels collapsed — balances discoverability vs noise"

patterns-established:
  - "Shared WebSocket singleton via module-level auto-connect, signals for reactive propagation"
  - "Recursive TreeNode component pattern for arbitrary-depth hierarchical data"
  - "formatBytes/formatUptime helpers colocated in page component that uses them"

requirements-completed: [DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08]

# Metrics
duration: ~15min
completed: 2026-03-22
---

# Phase 2 Plan 02: Broker Dashboard Frontend Summary

**Preact/HTM dashboard with WebSocket signals, live Mosquitto $SYS stat cards, collapsible topic tree, and Venus OS dark theme**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-22T07:03:45Z
- **Completed:** 2026-03-22T07:04:48Z (+ human verification)
- **Tasks:** 2 auto + 1 human-verify checkpoint
- **Files modified:** 6

## Accomplishments

- WebSocket client module with Preact signals (dashboardState, brokerConnected, wsConnected) and exponential backoff auto-reconnect (1s to 30s)
- Dashboard page with 6 stat cards (clients, msgs in/out, subscriptions, heap usage, load averages), broker info panel (version, uptime, message totals), and collapsible $SYS topic tree
- Sidebar StatusDot wired to real brokerConnected signal -- green on connection, red on disconnect
- Human verification confirmed all components working live on mqtt-master.local:3000 with Mosquitto 2.0.21

## Task Commits

Each task was committed atomically:

1. **Task 1: WebSocket client module and StatCard component** - `4f72568` (feat)
2. **Task 2: Dashboard page, topic tree, sidebar wiring, and dashboard CSS** - `23a06ad` (feat)
3. **Task 3: Visual verification** - Human-approved (no code changes)

## Files Created/Modified

- `webapp/js/lib/ws-client.js` - WebSocket client with Preact signals, exponential backoff reconnect, auto-connect on import
- `webapp/js/components/stat-card.js` - Reusable metric card with value, unit, and label slots
- `webapp/js/components/topic-tree.js` - Collapsible recursive TreeNode component for $SYS hierarchy
- `webapp/js/pages/dashboard.js` - Full dashboard page wiring stat cards, broker info panel, and topic tree to dashboardState signal
- `webapp/js/components/sidebar.js` - Added brokerConnected import and wired StatusDot
- `webapp/css/theme.css` - Added stat-card, broker-info-grid, and topic-tree CSS classes

## Decisions Made

- ws-client auto-connects on module import as a singleton; Dashboard useEffect not needed for lifecycle management
- brokerConnected signal imported directly into sidebar to avoid prop drilling through app shell
- TopicTree depth=0 nodes open by default, all deeper nodes collapsed for usable initial view

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Complete broker monitoring dashboard is live and reactive
- ws-client.js singleton pattern established for reuse in future phases (message explorer, plugin status)
- All 8 DASH requirements satisfied (DASH-01 through DASH-08)
- Ready for Phase 3: Message Explorer

---
*Phase: 02-broker-dashboard*
*Completed: 2026-03-22*
