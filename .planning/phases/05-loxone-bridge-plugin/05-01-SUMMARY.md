---
phase: 05-loxone-bridge-plugin
plan: 01
subsystem: integration
tags: [loxone, websocket, binary-protocol, mqtt, uuid-mapping]

# Dependency graph
requires:
  - phase: 04-plugin-system
    provides: plugin lifecycle contract (start/stop/getStatus/getConfigSchema)
provides:
  - LoxoneStructure class for LoxAPP3.json parsing and UUID-to-topic mapping
  - LoxoneWs class for Miniserver WebSocket with binary protocol parser
affects: [05-02-loxone-plugin-integration, 05-03-loxone-webapp-ui]

# Tech tracking
tech-stack:
  added: [ws (WebSocket client, already transitive dep)]
  patterns: [binary state machine (HEADER/PAYLOAD), UUID endianness conversion, slug-based MQTT topics]

key-files:
  created:
    - plugins/loxone/loxone-structure.js
    - plugins/loxone/loxone-ws.js
    - tests/loxone-structure.test.js
    - tests/loxone-ws.test.js
  modified: []

key-decisions:
  - "Loxone UUID byte order: first 3 groups read as LE, last 2 as BE for correct string representation"
  - "Duplicate slug disambiguation via first 8 hex chars of UUID (hyphens stripped)"
  - "SubControls mapped under parent topic path as {parent}/{sub-slug} with their own state UUIDs"

patterns-established:
  - "Binary protocol state machine: HEADER state receives 8 bytes, transitions to PAYLOAD, processes, returns to HEADER"
  - "Slug-based topic hierarchy: {prefix}/{room-slug}/{control-slug}/{stateKey}"
  - "Exponential backoff with jitter: base * 2^attempt capped at 30s plus random 0-1000ms"

requirements-completed: [LOX-01, LOX-03]

# Metrics
duration: 5min
completed: 2026-03-22
---

# Phase 5 Plan 1: Loxone WebSocket Client and Structure Parser Summary

**Loxone binary protocol parser (value/text events with LE UUID conversion) and LoxAPP3.json auto-discovery mapper producing human-readable MQTT topic paths**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-22T07:51:11Z
- **Completed:** 2026-03-22T07:56:06Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- LoxoneStructure parses LoxAPP3.json into UUID-to-topic maps with {prefix}/{room}/{control} human-readable paths, including sub-controls and state UUIDs
- LoxoneWs connects via WebSocket with binary state machine parser for 8-byte headers, 24-byte value events, and text events with correct Loxone UUID endianness
- Both modules are standalone (no plugin system dependency) with 40 total tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: LoxAPP3.json structure parser with UUID-to-topic mapping** - `0a9a4e1` (feat)
2. **Task 2: Loxone WebSocket client with binary protocol parser and reconnection** - `202b926` (feat)

_Both tasks used TDD: tests written first (RED), then implementation (GREEN)._

## Files Created/Modified
- `plugins/loxone/loxone-structure.js` - LoxAPP3.json parser, UUID-to-topic mapper, slugify, fetchStructure (183 lines)
- `plugins/loxone/loxone-ws.js` - WebSocket client with binary protocol state machine, keepalive, reconnection (288 lines)
- `tests/loxone-structure.test.js` - 23 tests covering buildMap, slugify, lookups, duplicates, fetch
- `tests/loxone-ws.test.js` - 17 tests covering UUID parsing, headers, value/text events, state machine, backoff

## Decisions Made
- Loxone UUID binary format: first 3 groups little-endian (4+2+2 bytes), last 2 groups big-endian (2+6 bytes) -- critical for correct UUID string generation from binary buffers
- Duplicate slug disambiguation uses first 8 hex chars of UUID with hyphens stripped, appended to slug
- SubControls are nested under parent control topic path rather than getting their own room-level topic
- Text events include 4-byte padding (icon UUID reference) between UUID and text length that must be skipped

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both foundation modules ready for Plan 05-02 to compose into the full Loxone plugin
- LoxoneStructure provides the UUID-to-topic mapping table the plugin needs
- LoxoneWs provides the event stream (valueEvent, textEvent) the plugin will bridge to MQTT
- 40 tests passing, full test suite (112 tests) green

---
*Phase: 05-loxone-bridge-plugin*
*Completed: 2026-03-22*
