---
phase: 05-loxone-bridge-plugin
plan: 02
subsystem: plugin
tags: [loxone, mqtt, websocket, home-assistant, discovery, bridge]

# Dependency graph
requires:
  - phase: 05-01
    provides: LoxoneWs WebSocket client and LoxoneStructure UUID-to-topic parser
  - phase: 04-01
    provides: Plugin manager lifecycle contract (start/stop/getStatus/getConfigSchema)
provides:
  - LoxonePlugin class composing LoxoneWs + LoxoneStructure into full MQTT bridge
  - Bidirectional bridge: Loxone state events -> MQTT topics, MQTT /cmd -> Loxone WebSocket
  - Home Assistant MQTT Discovery configs for Switch, Dimmer, Jalousie, InfoOnlyAnalog, InfoOnlyDigital
  - Bridge availability topic (loxone/bridge/status online/offline retained)
affects: [06-packaging, future-ha-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Plugin composes lower-level clients (LoxoneWs, LoxoneStructure) rather than coupling directly to transport
    - MQTT cmd routing via topic.startsWith(prefix) && topic.endsWith('/cmd') pattern
    - HA Discovery node ID as loxone_{serial} with objectId as slugified control name

key-files:
  created:
    - plugins/loxone/plugin.js
    - tests/loxone-plugin.test.js
  modified:
    - plugins/loxone/loxone-ws.js
    - plugins/loxone/loxone-structure.js

key-decisions:
  - "Store _mqttHandler reference for clean removal on stop()"
  - "Re-fetch structure on WebSocket reconnect event to handle Miniserver config changes"
  - "HA Discovery node ID uses loxone_bridge fallback when serial unavailable"
  - "Fix: Authorization header instead of URL credentials (Node.js fetch/ws reject URL creds)"
  - "Fix: WebSocket subprotocol 'remotecontrol' passed as constructor arg, not as header"

patterns-established:
  - "Plugin pattern: compose transport + structure parser, wire events to MQTT, clean up in stop()"
  - "Authorization: always pass credentials via header, never URL-embedded in Node.js"

requirements-completed: [LOX-01, LOX-04, LOX-05, LOX-06, LOX-08, LOX-09]

# Metrics
duration: 25min
completed: 2026-03-22
---

# Phase 5 Plan 02: Loxone Bridge Plugin Summary

**Bidirectional Loxone-MQTT bridge plugin with HA Discovery, routing Miniserver value events to human-readable MQTT topics and forwarding /cmd messages back via WebSocket jdev/sps/io commands**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-22T08:59:00Z
- **Completed:** 2026-03-22T09:07:00Z
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint, approved)
- **Files modified:** 4

## Accomplishments

- LoxonePlugin wires LoxoneWs events to MQTT publishes with {prefix}/{room}/{control}/state topics
- MQTT /cmd topic listener reverse-lookups UUID and sends jdev/sps/io/{uuid}/{payload} via WebSocket
- HA Discovery publishes homeassistant/{component}/{nodeId}/{objectId}/config for each control type with correct component mapping (Switch->switch, Dimmer->light, Jalousie->cover, InfoOnlyAnalog->sensor, InfoOnlyDigital->binary_sensor)
- Two critical auth/protocol bugs fixed and verified against real Miniserver: Authorization header and WebSocket subprotocol negotiation

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing tests** - `9b6822a` (test)
2. **Task 1 GREEN: Implement LoxonePlugin** - `2fdce9f` (feat)
3. **Bug fix: Authorization header** - `8e7c9a5` (fix)
4. **Bug fix: WebSocket subprotocol** - `66588db` (fix)

## Files Created/Modified

- `plugins/loxone/plugin.js` - LoxonePlugin class: full plugin lifecycle, bidirectional MQTT bridge, HA Discovery (359 lines)
- `tests/loxone-plugin.test.js` - Integration tests for plugin lifecycle, event routing, HA Discovery, disabled controls (520 lines)
- `plugins/loxone/loxone-ws.js` - Fixed: Authorization header for WS auth, subprotocol as constructor arg
- `plugins/loxone/loxone-structure.js` - Fixed: Authorization header for HTTP fetch of LoxAPP3.json

## Decisions Made

- Re-fetch structure on WebSocket reconnect event to handle Miniserver config changes (ensures topic map stays current after reconnect)
- Store `this._mqttHandler` reference explicitly so `stop()` can call `mqttService.removeListener('message', ...)` without leaking handlers
- HA Discovery falls back to `loxone_bridge` node ID when Miniserver serial is not available in structure

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Authorization header instead of URL-embedded credentials**
- **Found during:** Task 2 checkpoint (real Miniserver verification)
- **Issue:** Node.js `fetch()` and the `ws` library both reject credentials embedded in URLs (`http://user:pass@host/`). HTTP 401 responses and WebSocket auth failures observed against real Miniserver.
- **Fix:** Changed both `loxone-structure.js` (HTTP fetch) and `loxone-ws.js` (WebSocket connect) to use `Authorization: Basic base64(user:pass)` headers instead of URL credentials.
- **Files modified:** `plugins/loxone/loxone-structure.js`, `plugins/loxone/loxone-ws.js`
- **Verification:** Real Miniserver connected, LoxAPP3.json fetched, structure loaded with 1 control
- **Committed in:** `8e7c9a5`

**2. [Rule 1 - Bug] WebSocket subprotocol as constructor arg, not header**
- **Found during:** Task 2 checkpoint (real Miniserver verification)
- **Issue:** Loxone Miniserver requires the `remotecontrol` WebSocket subprotocol. The `ws` library requires this as the second constructor argument, not as a header. Passing it as a header caused protocol negotiation failure.
- **Fix:** Changed `new WebSocket(url, { headers: { 'Sec-WebSocket-Protocol': 'remotecontrol' } })` to `new WebSocket(url, ['remotecontrol'], { headers: ... })`. Also added proper `reject()` calls in `close`/`error` handlers for failed initial connections.
- **Files modified:** `plugins/loxone/loxone-ws.js`
- **Verification:** WebSocket connected successfully, `loxone/bridge/status online` published and confirmed in Live Messages
- **Committed in:** `66588db`

---

**Total deviations:** 2 auto-fixed (both Rule 1 - bugs discovered during real hardware verification)
**Impact on plan:** Both fixes were necessary for correctness against real Miniserver. No scope creep.

## Issues Encountered

- Real Miniserver verification caught two authentication/protocol bugs that unit tests with mocks cannot detect. The fixes were straightforward once the actual Node.js behavior was understood.

## User Setup Required

None - plugin is configured via the webapp UI at http://mqtt-master.local:3000 (Loxone plugin config page).

## Next Phase Readiness

- Phase 5 Plan 03 (if exists) can rely on fully functional LoxonePlugin
- Phase 6 (Packaging/Deployment) has a working end-to-end system with Loxone bridge, MQTT broker integration, HA Discovery, and live-verified Miniserver connectivity
- No blockers

---
*Phase: 05-loxone-bridge-plugin*
*Completed: 2026-03-22*
