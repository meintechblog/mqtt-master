# Domain Pitfalls

**Domain:** MQTT dashboard and smart home bridge (Loxone-to-MQTT)
**Researched:** 2026-03-22

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or persistent instability.

### Pitfall 1: Loxone WebSocket Keepalive Neglect

**What goes wrong:** The Loxone Miniserver silently closes WebSocket connections after 5 minutes of client inactivity. The bridge stops receiving state updates but does not realize the connection is dead -- MQTT topics go stale with no error raised.

**Why it happens:** Developers treat the Loxone WebSocket like a standard long-lived connection and assume the server will maintain it. The 5-minute timeout is not obvious from a quick API skim. Standard WebSocket ping/pong frames do NOT satisfy Loxone's requirement -- you must send the literal `"keepalive"` text command.

**Consequences:** Silent data staleness. MQTT topics retain old values with no indication they are outdated. Automations downstream act on stale state. Users lose trust in the system.

**Prevention:**
- Send `"keepalive"` command every 60-90 seconds (well under the 5-minute limit)
- Monitor for the 0x06 Message Header response to confirm the Miniserver acknowledged the keepalive
- Implement a watchdog: if no keepalive response within 10 seconds, treat connection as dead and trigger reconnection
- Log keepalive round-trip times to detect Miniserver slowdowns early

**Detection:** MQTT topic timestamps stop advancing while the bridge process reports no errors. Dashboard shows "connected" but values are frozen.

**Phase relevance:** Must be solved in the Loxone plugin foundation phase. Non-negotiable for any WebSocket connection to Loxone.

---

### Pitfall 2: Loxone Token Expiration Without Refresh Logic

**What goes wrong:** Loxone Token-Auth tokens have a limited lifespan. When the token expires, the bridge loses authentication and cannot send commands or receive updates. Without a refresh mechanism, the only recovery is manual restart or re-entering credentials.

**Why it happens:** The initial token acquisition works fine during development (tokens last hours to days). Developers forget to implement the refresh flow because the failure only manifests after prolonged uptime -- exactly the scenario a bridge must handle.

**Consequences:** Bridge goes offline after token expiry. All Loxone MQTT topics become stale. Manual intervention required. Defeats the purpose of an always-on bridge.

**Prevention:**
- Implement token refresh well before expiration (track token lifespan, refresh at 50-75% of remaining lifetime)
- Legacy tokens are deprecated -- use JWT tokens from the start (Loxone firmware 10.2+)
- Store token persistently so the bridge can resume after process restart without re-prompting for credentials
- Fall back to full re-authentication if token refresh fails
- Hash values during authentication: do NOT convert to upper or lower case (Loxone-specific gotcha that causes silent auth failures)

**Detection:** Auth errors in logs after days/weeks of stable operation. Bridge connects but immediately disconnects.

**Phase relevance:** Must be built into the Loxone plugin authentication module from day one.

---

### Pitfall 3: Loxone Binary Message Header Misparse

**What goes wrong:** Loxone sends binary data preceded by an 8-byte Message Header. The header and payload arrive as separate WebSocket frames. Developers either treat them as a single message, misinterpret the header structure, or fail to handle the "estimated size" flag -- causing payload corruption or deserialization failures.

**Why it happens:** The Loxone protocol is unusual: the header is a separate binary WebSocket message, followed by the payload in another message. Most WebSocket APIs do not natively correlate consecutive frames this way. The 8-byte header format (0x03 marker, identifier byte, info flags, reserved byte, 4-byte unsigned int payload size) requires manual parsing.

**Consequences:** State update events are silently dropped or misinterpreted. UUID-to-value mappings become corrupted. Specific control types (e.g., complex controls with sub-states) break while simple ones work, making debugging extremely difficult.

**Prevention:**
- Implement a state machine for message reception: `AWAITING_HEADER` -> `AWAITING_PAYLOAD` -> process -> `AWAITING_HEADER`
- Parse the identifier byte (second byte) to determine payload type: text (0x00), binary file (0x01), event table of value states (0x02), event table of text states (0x03), etc.
- Check the info flags (third byte) for "estimated size" flag -- when set, the actual payload size may differ from the header
- Text messages (JSON responses) do NOT require header parsing -- only binary messages do
- Study existing implementations: `node-red-contrib-loxone` and `lxcommunicator` (Loxone's official JS library) handle this correctly

**Detection:** Intermittent "parse error" or "unexpected data" logs. Some controls update while others do not. Binary event tables return nonsensical values.

**Phase relevance:** Core of the Loxone WebSocket protocol layer. Must be rock-solid before any control mapping is built on top.

---

### Pitfall 4: MQTT Topic Redesign Mid-Project

**What goes wrong:** The MQTT topic structure (`loxone/{room}/{control}`) is chosen early but needs to change when edge cases emerge (controls with duplicate names across rooms, sub-controls, special characters in Loxone room/control names). Changing topics after other systems have subscribed breaks all downstream integrations.

**Why it happens:** Topic structure is designed around the happy path (simple controls with unique names in distinct rooms). Loxone structures can contain forward slashes in names, percentage signs, Unicode characters, and controls that belong to no room. The LoxAPP3.json structure file reveals complexities not apparent from a few test controls.

**Consequences:** Breaking change for all MQTT subscribers. Home Assistant, Node-RED, or other consumers must be reconfigured. Retained messages on old topics linger and cause confusion.

**Prevention:**
- Parse a real LoxAPP3.json structure file BEFORE finalizing topic design
- Sanitize control and room names: replace `/` with `_`, strip or encode special characters, handle empty room assignments
- Use a topic structure that accommodates sub-controls: `loxone/{room}/{control}/{subcontrol}` or `loxone/{room}/{control}/state` and `loxone/{room}/{control}/cmd`
- Separate status topics from command topics (e.g., `/status` suffix for reads, `/cmd` or `/set` for writes) -- this is an mqtt-smarthome convention
- Map UUIDs internally, never expose them in topics
- Publish a topic map (`loxone/$topic-map`) so downstream consumers can discover available topics programmatically
- Define the topic contract as a documented API before implementing

**Detection:** Users report "topic not found" after Loxone config changes. Controls with special characters silently fail to publish.

**Phase relevance:** Must be finalized during architecture/design phase, before any MQTT publishing code is written.

---

### Pitfall 5: WebSocket Connection Leak in Browser Dashboard

**What goes wrong:** The dashboard's live MQTT message viewer opens WebSocket connections to the broker (port 9001) that are never properly closed. Page navigation, component re-renders, or tab refreshes create orphaned connections. The broker's client count climbs; the browser accumulates memory.

**Why it happens:** Frontend frameworks (React, Vue, Svelte) re-render components frequently. If WebSocket setup lives inside a component lifecycle without proper teardown, each render opens a new connection. The browser does not automatically close WebSockets on component unmount.

**Consequences:** Mosquitto connection limit exhaustion. Browser memory leaks causing tab crashes. Broker logs flooded with connect/disconnect events. Dashboard becomes sluggish over hours of use.

**Prevention:**
- Manage WebSocket connections at the application level (singleton), not per-component
- Implement proper cleanup in component teardown (React `useEffect` return, Vue `onUnmounted`, Svelte `onDestroy`)
- Use `beforeunload` event to gracefully close WebSocket before page refresh/close
- Cap maximum reconnection attempts and implement exponential backoff with jitter (1s, 2s, 4s... capped at 30s)
- Monitor active connection count on both client and broker side
- Consider using a shared Web Worker for WebSocket management to isolate connection state from UI lifecycle

**Detection:** `$SYS/broker/clients/connected` count grows over time without new actual clients. Browser DevTools shows multiple WebSocket connections in Network tab.

**Phase relevance:** Dashboard architecture phase. Must be designed as a connection management pattern before building any real-time UI features.

---

### Pitfall 6: Loxone Structure File (LoxAPP3.json) Staleness

**What goes wrong:** The bridge caches LoxAPP3.json at startup but does not detect when the user reconfigures their Loxone system. New controls are invisible to the bridge. Renamed controls publish to wrong topics. Deleted controls continue to appear.

**Why it happens:** LoxAPP3.json can be large (hundreds of KB for complex installations) and downloading it on every reconnection wastes bandwidth and Miniserver resources. Developers cache it once and forget to implement the staleness check.

**Consequences:** New Loxone devices/controls added by the user never appear as MQTT topics. Users think the bridge is broken. Only a manual restart "fixes" it, eroding trust.

**Prevention:**
- On every WebSocket connection, send `jdev/sps/LoxAPPversion3` and compare the `lastModified` timestamp against the cached version
- Only re-download the full structure file if the timestamp differs
- After re-download, diff the old and new structure to detect added/removed/renamed controls
- Publish MQTT discovery messages for new controls and clean up retained messages for removed controls
- Log structure file changes clearly so the user knows the bridge detected their Loxone config update

**Detection:** User adds a new room/control in Loxone Config, saves to Miniserver, but it never appears as an MQTT topic.

**Phase relevance:** Loxone plugin initialization and reconnection logic.

---

## Moderate Pitfalls

### Pitfall 7: $SYS Topic Update Interval Mismatch

**What goes wrong:** Mosquitto publishes `$SYS` topics every 10 seconds by default (configurable via `sys_interval`). The dashboard polls or subscribes and either misses updates or displays stale data without indicating the refresh cadence to the user.

**Why it happens:** Developers assume `$SYS` topics update in real-time like regular MQTT messages. They don't -- they are periodic snapshots. The dashboard shows "5 connected clients" and the user sees it as live truth, when it may be up to 10 seconds old.

**Prevention:**
- Display "last updated" timestamp on all `$SYS`-derived metrics
- Subscribe to `$SYS/#` rather than polling -- Mosquitto publishes updates at `sys_interval`
- Do NOT show decimal-precision rates (messages/sec) from `$SYS` -- the resolution does not support it
- Parse `$SYS` values as strings first, then convert -- some are integers, some are floats, some are version strings
- `$SYS/broker/load/messages/received/+` uses time-window averages (1min, 5min, 15min) -- display these as averages, not instantaneous rates
- Security note: `$SYS` exposes broker version, which is useful to attackers on shared networks. Since this is LAN-only with no auth, this is acceptable but worth documenting.

**Detection:** Dashboard values visibly lag behind `mosquitto_sub -t '$SYS/#'` output. Users report "wrong" client counts.

**Phase relevance:** Dashboard monitoring implementation phase.

---

### Pitfall 8: MQTT Message Flooding From Loxone Bridge

**What goes wrong:** The Loxone Miniserver can generate hundreds of state change events per second during certain operations (startup, scene activation, bulk dimmer changes). The bridge faithfully converts each into an MQTT publish, overwhelming the Mosquitto broker, subscribers, and the dashboard's message viewer.

**Why it happens:** No rate limiting or batching between the Loxone WebSocket stream and MQTT publishing. The bridge treats every state change as equally urgent.

**Consequences:** Mosquitto CPU spikes. Dashboard message viewer becomes unusable (thousands of messages per second). Downstream automations queue up and execute with lag. On resource-constrained systems (Debian VM with limited RAM), the broker may drop messages or crash.

**Prevention:**
- Implement per-topic throttling: for rapidly changing values (e.g., analog sensors), publish at most once per N seconds (configurable, default 1s)
- Use MQTT QoS 0 for high-frequency sensor data (temperature, light level) -- it is fire-and-forget with no broker overhead
- Use QoS 1 only for command acknowledgments and discrete state changes (on/off, open/closed)
- Dashboard message viewer: ring buffer with configurable max size (e.g., last 500 messages), not unbounded list
- Add a "pause" button to the message viewer so users can inspect messages without the list scrolling away
- Consider deduplication: do not republish if the value has not changed

**Detection:** `$SYS/broker/load/messages/received/1min` spikes. Dashboard UI freezes. Node.js process memory grows unboundedly.

**Phase relevance:** Loxone plugin publishing logic and dashboard message viewer.

---

### Pitfall 9: Plugin System Over-Engineering

**What goes wrong:** Developers build a complex plugin API with sandboxing, IPC, hot-reloading, dependency injection, and version negotiation before shipping the first plugin. The abstraction does not match real plugin needs because no real plugins exist yet to validate the design.

**Why it happens:** "Extensibility" sounds important, and the project description mentions future KNX support. The natural impulse is to build a generic, robust plugin system. But Node.js sandboxing (vm2, isolated-vm) has a terrible security track record -- vm2 alone had 8 CVEs in a single year, including a 9.8 CVSS sandbox escape.

**Consequences:** Months spent on plugin infrastructure that does not match the KNX plugin's actual needs. Over-complex API that is hard to document and maintain. Security vulnerabilities if sandboxing is attempted.

**Prevention:**
- Build the Loxone plugin as a "normal" module first, with a clean internal interface but no plugin framework
- After building the KNX plugin (plugin #2), extract the common patterns into a plugin API -- the API emerges from real use cases, not speculation
- Do NOT attempt in-process sandboxing (vm2, Node.js vm module) -- it is fundamentally broken for security
- If plugin isolation is needed later, use process-level isolation (child processes) or container-level isolation (Docker)
- For v1, a "plugin" is just a module that exports `init()`, `start()`, `stop()`, and `getConfig()` -- nothing more
- Trust the LAN: since there is no auth and the system runs on a trusted local network, plugin sandboxing provides no meaningful security boundary

**Detection:** Plugin API has more code than the actual plugin. The plugin interface is designed before the second plugin exists.

**Phase relevance:** Architecture/design phase. Resist the urge to build infrastructure for hypothetical future plugins.

---

### Pitfall 10: Reconnection Cascade Between Loxone and MQTT

**What goes wrong:** The Loxone WebSocket reconnects, triggering a full state re-sync, which floods MQTT with hundreds of publishes, which overwhelms the broker, which causes the dashboard WebSocket to disconnect, which triggers dashboard reconnection, which subscribes to `#`, which causes more broker load. A single network hiccup cascades into system instability.

**Why it happens:** Each subsystem (Loxone WS, MQTT client, browser WS) has its own reconnection logic, but they are not coordinated. Reconnection in one causes load that triggers disconnection in another.

**Consequences:** System takes minutes to stabilize after a brief network event. Users see the dashboard flicker between connected/disconnected states. Logs are flooded with connect/disconnect entries, obscuring the root cause.

**Prevention:**
- Stagger reconnection: Loxone reconnects first, then waits for stable state before republishing to MQTT
- After Loxone reconnection, do a controlled state sync: query all controls but publish to MQTT over a 5-10 second window, not all at once
- Dashboard WebSocket should use independent reconnection with exponential backoff -- do NOT tie its health to broker responsiveness
- Implement circuit breaker pattern: if reconnection fails N times, back off for longer and alert the user rather than hammering the endpoint
- Use MQTT client `clean: false` (persistent session) so the broker retains subscriptions across brief disconnects, avoiding resubscription storms

**Detection:** Logs show rapid alternating connect/disconnect events across multiple subsystems within the same time window.

**Phase relevance:** Integration phase when all three connection layers (Loxone WS, MQTT, browser WS) operate simultaneously.

---

### Pitfall 11: Unhandled Loxone Control Types

**What goes wrong:** The Loxone Miniserver has 50+ control types (Switch, Dimmer, Jalousie, IRoomController, Daytimer, TextState, ColorPicker, etc.). Developers implement handling for the common ones (Switch, Dimmer) and discover in production that unhandled types either crash the bridge, publish raw UUIDs, or are silently ignored.

**Why it happens:** LoxAPP3.json contains a `type` field for each control, but there is no single comprehensive list of all types. New firmware versions add new control types. Sub-controls (states within a control) vary by type and are not always documented.

**Consequences:** Users with complex Loxone installations find that some controls "don't work." Bug reports for each missing type. If unhandled types crash the parser, the entire bridge goes down.

**Prevention:**
- Implement a generic fallback handler: any unrecognized control type gets published with its raw state values and a flag indicating "unknown type"
- Log unhandled control types at `warn` level so they are visible but do not crash the bridge
- Start with the most common types: Switch, Dimmer, Jalousie/Blind, InfoOnlyAnalog, InfoOnlyDigital, TextState, Pushbutton
- Design the control handler as a registry pattern: each type has a handler, unknown types use the default handler
- Publish the control's `type` field in the MQTT JSON payload so downstream consumers can handle type-specific logic themselves

**Detection:** Users report missing controls. Logs show "unknown control type" warnings for specific Loxone types.

**Phase relevance:** Loxone plugin control mapping phase. Must have the fallback handler from the start.

---

## Minor Pitfalls

### Pitfall 12: systemd Service Restart Loops

**What goes wrong:** The systemd service is configured with `Restart=always` but the application crashes on startup due to a configuration error (wrong Miniserver IP, broker not running). systemd restarts it every few seconds, filling logs and consuming resources.

**Prevention:**
- Use `Restart=on-failure` with `RestartSec=10` and `StartLimitBurst=5` / `StartLimitIntervalSec=300`
- Validate configuration at startup and exit with a distinct exit code for "configuration error" vs "runtime crash"
- Only auto-restart on runtime crashes, not configuration errors

**Phase relevance:** Deployment/installer phase.

---

### Pitfall 13: Retained Message Ghosts

**What goes wrong:** When a Loxone control is removed from the Miniserver, the MQTT topic retains its last value forever. New subscribers see a control that no longer exists.

**Prevention:**
- When structure file diff detects a removed control, publish an empty (null) retained message to clear the topic
- Document the retained message cleanup behavior so users understand how to manually clear stale topics if needed (`mosquitto_pub -t 'topic' -r -n`)

**Phase relevance:** Loxone plugin structure file sync logic.

---

### Pitfall 14: Installer Assumes Clean System

**What goes wrong:** The one-command installer (`wget | bash`) assumes no prior Node.js, no conflicting ports, no existing systemd service. On systems with existing Node.js installations (different version) or occupied ports (9001 already used by another service), it fails or creates conflicts.

**Prevention:**
- Check for existing Node.js and verify minimum version compatibility rather than blindly installing
- Check if ports 1883 and 9001 are already in use before configuring Mosquitto
- Make the installer idempotent: running it twice should update, not break
- Use `set -e` in the installer script and provide clear error messages for each failure point

**Phase relevance:** Installer/deployment phase.

---

### Pitfall 15: Dashboard Renders All MQTT Messages

**What goes wrong:** The live message viewer subscribes to `#` (all topics) and renders every message. On an active broker with many devices, this creates thousands of DOM elements per minute, crashing the browser tab.

**Prevention:**
- Default to NO subscription -- require the user to enter a topic filter before messages appear
- Use virtual scrolling (only render visible rows) for the message list
- Hard limit: maximum 1000 messages in the viewer buffer, FIFO eviction
- Provide quick-filter buttons for common patterns: `$SYS/#`, `loxone/#`, custom prefix

**Phase relevance:** Dashboard message viewer implementation.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Loxone WebSocket connection | Keepalive timeout (P1), Token expiry (P2) | Keepalive timer + token refresh loop from day one |
| Loxone protocol parsing | Binary header misparse (P3), Unhandled control types (P11) | State machine parser + generic fallback handler |
| MQTT topic design | Topic redesign (P4), Retained ghosts (P13) | Parse real LoxAPP3.json before finalizing topics; implement cleanup |
| Dashboard real-time UI | WebSocket leak (P5), Message flooding (P8, P15) | Singleton connection manager + virtual scrolling + ring buffer |
| Broker monitoring | $SYS interval mismatch (P7) | Show "last updated" timestamps; subscribe don't poll |
| Plugin architecture | Over-engineering (P9) | Build Loxone as a module first; extract patterns after plugin #2 |
| Integration testing | Reconnection cascade (P10) | Staggered reconnection + circuit breaker + persistent MQTT sessions |
| Deployment | Restart loops (P12), Installer conflicts (P14) | Restart limits + idempotent installer with pre-flight checks |

## Sources

- [Loxone Communicating with Miniserver (official PDF)](https://www.loxone.com/wp-content/uploads/datasheets/CommunicatingWithMiniserver.pdf)
- [openHAB: Loxone idle timeout closes connection](https://community.openhab.org/t/idle-timeout-from-loxone-miniserver-closes-connection-to-binding-keep-alive-not-working/96343)
- [node-red-contrib-loxone keepalive issue](https://github.com/codmpm/node-red-contrib-loxone/issues/16)
- [HiveMQ: Why you shouldn't use $SYS Topics for Monitoring](https://www.hivemq.com/blog/why-you-shouldnt-use-sys-topics-for-monitoring/)
- [HiveMQ: MQTT Topics Best Practices](https://www.hivemq.com/blog/mqtt-essentials-part-5-mqtt-topics-best-practices/)
- [mqtt-smarthome Architecture](https://github.com/mqtt-smarthome/mqtt-smarthome/blob/master/Architecture.md)
- [EMQ: MQTT Client Auto-Reconnect Best Practices](https://www.emqx.com/en/blog/mqtt-client-auto-reconnect-best-practices)
- [EMQ: Improve Reliability with Rate Limiting](https://www.emqx.com/en/blog/improve-the-reliability-and-security-of-mqtt-broker-with-rate-limit)
- [vm2 sandbox escape CVE (9.8 CVSS)](https://semgrep.dev/blog/2026/calling-back-to-vm2-and-escaping-sandbox/)
- [hobbyquaker/loxone2mqtt](https://github.com/hobbyquaker/loxone2mqtt)
- [nufke/LoxBerry-Plugin-Lox2MQTT](https://github.com/nufke/LoxBerry-Plugin-Lox2MQTT)
- [Loxone lxcommunicator WebSocket.js](https://github.com/Loxone/lxcommunicator/blob/d2664a0d0531cd6c85aefb93a037dbb97f2e7391/modules/WebSocket.js)
- [DrDroid: MQTT Client Flooding](https://drdroid.io/stack-diagnosis/mqtt-client-flooding)
