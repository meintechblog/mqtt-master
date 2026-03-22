---
phase: 01-webapp-shell-and-core-services
plan: 01
subsystem: infra
tags: [fastify, preact, mqtt, vitest, esm, vendoring]

# Dependency graph
requires: []
provides:
  - Fastify 5 HTTP server with static file serving and WebSocket support
  - ConfigService with defaults, deep merge, and graceful error handling
  - MqttService with connect/subscribe/publish and connection timeout
  - Vendored Preact/HTM/Signals frontend modules for offline LAN use
  - Vitest test infrastructure with 9 passing tests
affects: [01-02, 02-api-and-websocket-bridge, 03-dashboard-and-live-messages]

# Tech tracking
tech-stack:
  added: [fastify@5, "@fastify/static@9", "@fastify/websocket@11", mqtt@5, vitest@3, preact@10.29, htm@3.1, "@preact/signals@2.8"]
  patterns: [ESM modules, service classes with dependency injection via Fastify decorators, TDD red-green workflow]

key-files:
  created:
    - package.json
    - server/index.js
    - server/services/config-service.js
    - server/services/mqtt-service.js
    - config/default.json
    - webapp/index.html
    - vitest.config.js
    - scripts/vendor-frontend.sh
    - webapp/vendor/preact.mjs
    - webapp/vendor/preact-hooks.mjs
    - webapp/vendor/signals.mjs
    - webapp/vendor/htm-preact.mjs
    - tests/config-service.test.js
    - tests/mqtt-service.test.js
    - tests/server.test.js
  modified:
    - .gitignore

key-decisions:
  - "Safe error emission on MqttService: only emit 'error' if listeners exist to prevent unhandled EventEmitter throws"
  - "Vendor script resolves esm.sh X-ESM-Path header to download actual bundles instead of re-export stubs"
  - "Vitest config created in Task 1 (not Task 2) to enable TDD red-green flow"

patterns-established:
  - "Service classes exported from server/services/ and decorated onto Fastify app instance"
  - "ConfigService defaults baked in code, file config deep-merged over defaults"
  - "MqttService graceful timeout: resolves connect() after 5s even without broker"
  - "TDD: tests written before implementation, committed separately"

requirements-completed: [UI-04]

# Metrics
duration: 4min
completed: 2026-03-22
---

# Phase 1 Plan 1: Project Scaffold and Core Services Summary

**Fastify 5 server serving static webapp with ConfigService (defaults + deep merge) and MqttService (graceful timeout), vendored Preact/HTM/Signals, 9 passing Vitest tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T00:43:50Z
- **Completed:** 2026-03-22T00:47:59Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments
- Fastify 5 server starts and serves static files from webapp/ on any port
- ConfigService handles missing/invalid config gracefully, deep merges file over defaults
- MqttService connects to broker or gracefully times out without crashing
- Frontend vendor modules (Preact, Hooks, Signals, HTM) downloaded as real bundles for offline LAN use
- 9 tests across 3 suites all pass (config: 5, mqtt: 3, server: 1)

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests** - `860ce3f` (test)
2. **Task 1 (GREEN): Implement server, config, mqtt** - `a69d16a` (feat)
3. **Task 2: Vendor frontend and test infra** - `62d1f17` (feat)

_TDD workflow: tests committed before implementation._

## Files Created/Modified
- `package.json` - Node.js project with ESM, Fastify, mqtt, vitest
- `server/index.js` - Fastify entry point with static serving, WS, and SPA fallback
- `server/services/config-service.js` - Config loading with defaults and deep merge
- `server/services/mqtt-service.js` - MQTT client wrapper with event emission and timeout
- `config/default.json` - Default configuration template
- `webapp/index.html` - Minimal placeholder (replaced in Plan 02)
- `vitest.config.js` - Test framework configuration
- `scripts/vendor-frontend.sh` - Downloads frontend bundles from esm.sh
- `webapp/vendor/*.mjs` - Vendored Preact, Hooks, Signals, HTM bundles
- `tests/config-service.test.js` - 5 test cases for ConfigService
- `tests/mqtt-service.test.js` - 3 test cases for MqttService
- `tests/server.test.js` - 1 integration test for Fastify server
- `.gitignore` - Added node_modules/

## Decisions Made
- Safe error emission on MqttService: only emit 'error' event if listeners exist, preventing unhandled EventEmitter throws that would crash the process
- Vendor script resolves esm.sh X-ESM-Path header to download actual self-contained bundles rather than re-export stubs (which would not work offline)
- Created vitest.config.js in Task 1 instead of Task 2 to enable proper TDD red-green flow

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed MqttService unhandled error emission**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** EventEmitter throws on 'error' events with no listeners, causing test failures when MQTT broker is unreachable
- **Fix:** Added `listenerCount('error') > 0` guard before emitting error events
- **Files modified:** server/services/mqtt-service.js
- **Verification:** Tests pass without unhandled exception errors
- **Committed in:** a69d16a (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] Fixed vendor script downloading stubs instead of bundles**
- **Found during:** Task 2 (vendor download)
- **Issue:** esm.sh `?bundle` returns a re-export stub, not the actual bundled code
- **Fix:** Script now reads `X-ESM-Path` header and downloads from the resolved bundle URL
- **Files modified:** scripts/vendor-frontend.sh
- **Verification:** All 4 vendor files are 1KB-12KB of actual JavaScript, not 88-byte stubs
- **Committed in:** 62d1f17 (Task 2 commit)

**3. [Rule 3 - Blocking] Moved vitest.config.js creation to Task 1 for TDD**
- **Found during:** Task 1 (RED phase)
- **Issue:** Task 1 is TDD but vitest.config.js was planned for Task 2; tests cannot run without it
- **Fix:** Created vitest.config.js as part of Task 1 scaffold
- **Verification:** Tests run successfully in RED phase
- **Committed in:** 860ce3f (Task 1 RED commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All auto-fixes necessary for correctness and TDD workflow. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Server foundation complete, ready for Plan 02 (SPA shell with Venus OS theme, sidebar, hash routing)
- Vendor modules ready for import map consumption in webapp/index.html
- ConfigService and MqttService decorated on Fastify app, accessible by future route handlers

---
*Phase: 01-webapp-shell-and-core-services*
*Completed: 2026-03-22*
