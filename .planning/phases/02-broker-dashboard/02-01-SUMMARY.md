---
phase: 02-broker-dashboard
plan: 01
subsystem: api
tags: [websocket, mqtt, sys-topics, fastify, real-time]

requires:
  - phase: 01-webapp-shell-and-core-services
    provides: MqttService with subscribe/message events, Fastify with @fastify/websocket

provides:
  - SysBrokerService aggregating $SYS/# metrics into flat data + hierarchical topics
  - WebSocket /ws/dashboard route pushing real-time sys_state and connection_status
  - Server wiring with app.sysBrokerService decoration

affects: [02-broker-dashboard, 03-live-message-viewer]

tech-stack:
  added: []
  patterns: [EventEmitter service with debounced event emission, WebSocket broadcast with safe send and client tracking]

key-files:
  created:
    - server/services/sys-broker-service.js
    - server/routes/ws-dashboard.js
    - tests/sys-broker-service.test.js
    - tests/ws-dashboard.test.js
  modified:
    - server/index.js

key-decisions:
  - "structuredClone for deep-copying hierarchical topics state to prevent mutation"
  - "500ms debounce via clearTimeout/setTimeout pattern for batching $SYS updates"
  - "Uptime parsing extracts leading integer from 'N seconds' format string"

patterns-established:
  - "WebSocket route pattern: Fastify plugin with client Set, safeSend helper, broadcast function"
  - "Service event forwarding: SysBrokerService wraps MqttService events with domain-specific semantics"

requirements-completed: [DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07]

duration: 6min
completed: 2026-03-22
---

# Phase 2 Plan 1: Broker Dashboard Backend Summary

**SysBrokerService subscribing to $SYS/# with 500ms debounced updates, WebSocket /ws/dashboard pushing real-time sys_state and connection_status to clients**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-22T06:55:42Z
- **Completed:** 2026-03-22T07:01:18Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- SysBrokerService aggregates 13 $SYS metrics into flat data object with numeric parsing and hierarchical topic tree
- WebSocket route at /ws/dashboard sends full state on connect and broadcasts updates to all clients
- 500ms debounce batches rapid $SYS arrivals before pushing to WebSocket clients
- Connection status forwarded from MqttService to WebSocket clients
- 21 new tests (15 unit + 6 integration) all passing alongside existing 14 tests

## Task Commits

Each task was committed atomically:

1. **Task 1: SysBrokerService with $SYS aggregation and debounced updates** - `14da5a5` (feat)
2. **Task 2: WebSocket /ws/dashboard route and server wiring** - `7a4a60b` (feat)

_Note: TDD tasks -- tests written first (RED), then implementation (GREEN)_

## Files Created/Modified
- `server/services/sys-broker-service.js` - SysBrokerService class: subscribes to $SYS/#, parses metrics, debounces update events
- `server/routes/ws-dashboard.js` - Fastify WebSocket plugin: /ws/dashboard with client tracking and broadcast
- `server/index.js` - Wires SysBrokerService creation and ws-dashboard route registration
- `tests/sys-broker-service.test.js` - 15 unit tests with mock MqttService
- `tests/ws-dashboard.test.js` - 6 integration tests with real WebSocket connections

## Decisions Made
- Used structuredClone for deep-copying hierarchical topics state in getState() to prevent external mutation
- Uptime parsing extracts leading integer from Mosquitto's "N seconds" format string
- WebSocket test helper buffers messages from connection start to avoid race conditions with async message listeners

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Initial WebSocket integration tests timed out due to race condition: messages arrived before test listener was attached after awaiting connection open. Fixed by redesigning test client to buffer messages from construction time.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Backend data pipeline complete, ready for Plan 02-02 (frontend dashboard)
- SysBrokerService decorated on app as app.sysBrokerService for frontend WebSocket consumption
- WebSocket message format matches CONTEXT.md specification exactly

---
*Phase: 02-broker-dashboard*
*Completed: 2026-03-22*
