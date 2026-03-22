# Project Research Summary

**Project:** MQTT Master -- MQTT Broker Dashboard & Smart Home Bridge
**Domain:** IoT dashboard + protocol bridge (MQTT, Loxone WebSocket)
**Researched:** 2026-03-22
**Confidence:** HIGH

## Executive Summary

MQTT Master is a self-hosted, single-port web application that serves two purposes: monitoring a Mosquitto MQTT broker via a real-time dashboard, and bridging Loxone smart home devices to MQTT via a plugin-based architecture. Experts build this type of system as a lightweight Node.js process connecting outward to existing infrastructure (Mosquitto on port 1883, Loxone Miniserver via WebSocket) and serving a browser dashboard on a single HTTP/WebSocket port. The recommended stack is Fastify 5 for the backend with mqtt.js as the MQTT client, and Preact + HTM with no build step for the frontend -- all deployable via a one-command installer on Debian 13 with systemd. This is a proven pattern for appliance-style IoT tools.

The primary technical challenge is the Loxone integration, not the dashboard. Loxone uses a custom binary WebSocket protocol with 8-byte message headers, token-based JWT authentication requiring HMAC-SHA1 key exchange and AES-256-CBC encryption, and a structure file (LoxAPP3.json) that maps opaque UUIDs to human-readable control names. The protocol has hard operational constraints: a mandatory text-based keepalive every 5 minutes, a 31-client cap on live event slots, and token expiration requiring proactive refresh. These are well-documented but easy to get wrong, and failures manifest as silent data staleness rather than visible errors.

The key risk mitigation strategy is phased delivery: build the dashboard and message viewer first (validating the full backend-to-frontend stack with zero external dependencies beyond Mosquitto), then layer the plugin system and Loxone bridge on proven infrastructure. The plugin system should be kept minimal for v1 -- the Loxone plugin IS the plugin system's validation, and over-engineering the framework before a second plugin exists is a documented anti-pattern. Topic structure design must happen early and be validated against a real LoxAPP3.json file before any MQTT publishing code is written.

## Key Findings

### Recommended Stack

The stack is deliberately minimal and avoids build tooling entirely. Backend runs on Node.js 20.x (Debian 13 default) with Fastify 5 serving HTTP, REST API, and WebSocket on a single port. Frontend uses Preact 10.x + HTM via import maps -- no bundler, no transpiler, files served as-is by @fastify/static. The Loxone WebSocket connection uses raw `ws` instead of abandoned community libraries (lxcommunicator last updated 5 years ago, node-lox-ws-api 6 years ago). All data storage is JSON files and in-memory state -- no database.

**Core technologies:**
- **Fastify 5.8.x**: HTTP + WebSocket server on single port -- 2-3x faster than Express, built-in schema validation, plugin architecture aligns with our own
- **mqtt.js 5.15.x**: MQTT client for broker monitoring and plugin message bus -- de facto standard, 35M+ weekly downloads, MQTT 3.1.1/5.0 support
- **Preact 10.x + HTM 3.1.x**: No-build frontend with component model -- 4KB total, Signals for fine-grained reactivity on high-frequency MQTT streams
- **ws 8.19.x**: Raw WebSocket client for Loxone Miniserver -- full control over binary protocol, token auth, and keepalive without depending on dead libraries
- **systemd**: Process management -- already on Debian 13, no extra dependency (PM2 unnecessary)

### Expected Features

**Must have (table stakes):**
- Broker status dashboard (clients, messages, subscriptions, uptime from $SYS topics)
- Live MQTT message viewer with topic filtering and JSON pretty-print
- Loxone bidirectional bridge with auto-discovery from LoxAPP3.json
- Human-readable MQTT topic structure (room/control, not raw UUIDs)
- Plugin configuration UI (no SSH required for setup)
- Dark theme matching Venus OS design system
- One-command Debian installer with systemd service
- Reconnection with exponential backoff on all WebSocket connections

**Should have (differentiators):**
- Plugin architecture enabling future bridges (KNX, etc.) -- the core competitive advantage over single-purpose tools
- Unified dashboard + bridge in one application (replaces MQTT Explorer + loxone2mqtt + separate Mosquitto monitoring)
- Home Assistant MQTT Discovery output for auto-appearing devices
- Topic tree visualization (MQTT Explorer's signature feature)
- Per-plugin visual health status and log viewer

**Defer (v2+):**
- KNX IP Gateway plugin (explicitly out of scope per PROJECT.md)
- Historical data / time-series (use InfluxDB + Grafana instead)
- Multi-broker support, rule engine, cloud access, drag-and-drop dashboard
- Mobile native app (responsive web is sufficient)

### Architecture Approach

The system is a single Node.js process with three connection layers: inbound browser WebSocket/HTTP, outbound MQTT client to Mosquitto, and outbound WebSocket to Loxone Miniserver. Components communicate through an EventEmitter-based bus, with the MQTT Service as a shared singleton. Plugins implement a simple contract (start/stop/getStatus/getConfigSchema) and receive a context object with MQTT publish/subscribe, config access, and scoped logging. The frontend is a static SPA with client-side routing, served from a `webapp/` directory.

**Major components:**
1. **HTTP/WS Server (Fastify)** -- serves static webapp, REST API for config CRUD, WebSocket relay for live data
2. **MQTT Service** -- singleton mqtt.js client connecting to Mosquitto, subscribes to $SYS/#, relays messages via EventEmitter, shared by all plugins
3. **Plugin Manager** -- discovers, loads, starts, stops plugins via dynamic import(); provides context injection
4. **Config Service** -- reads/writes JSON files for plugin and system configuration
5. **Loxone Plugin** -- WebSocket connection, token auth, LoxAPP3.json parser, binary event table decoder, UUID-to-topic mapper, bidirectional bridge

### Critical Pitfalls

1. **Loxone WebSocket keepalive neglect** -- Miniserver silently drops connections after 5 minutes. Must send literal `"keepalive"` text every 60-90 seconds and monitor for 0x06 acknowledgment response. Standard WebSocket ping/pong does NOT work.
2. **Loxone token expiration without refresh** -- Tokens expire after hours/days. Must track lifespan and refresh at 50-75% of remaining lifetime. Use JWT tokens (firmware 10.2+), not legacy tokens. Hash values must preserve case.
3. **Binary message header misparse** -- Loxone sends header and payload as SEPARATE WebSocket frames. Must implement a state machine (AWAITING_HEADER -> AWAITING_PAYLOAD -> process -> repeat). Value events are 24-byte chunks (16-byte UUID + 8-byte double).
4. **MQTT topic redesign mid-project** -- Topic structure must handle edge cases (duplicate names, special characters, controls with no room, sub-controls). Parse a real LoxAPP3.json BEFORE finalizing the schema. Separate status and command topics.
5. **WebSocket connection leak in browser** -- Manage WebSocket as application-level singleton, not per-component. Implement proper cleanup on component unmount and page unload. Cap reconnection attempts with exponential backoff.
6. **Plugin system over-engineering** -- Do NOT build sandboxing, hot-reloading, or complex DI before the second plugin exists. Build Loxone as a clean module; extract patterns after KNX validates the abstraction.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Core Foundation
**Rationale:** Everything depends on the HTTP server, MQTT client, config service, and webapp shell. These are the lowest-risk, highest-dependency components. Building them first validates the full stack end-to-end with zero external dependencies beyond Mosquitto.
**Delivers:** Running Fastify server serving a static Preact SPA with Venus OS dark theme, sidebar navigation, MQTT Service connected to Mosquitto and receiving $SYS topics, Config Service reading/writing JSON files.
**Addresses:** systemd service, dark theme UI, responsive layout skeleton
**Avoids:** No external system integration yet -- isolates risk

### Phase 2: Broker Dashboard
**Rationale:** Simplest feature that validates the complete data flow (Mosquitto -> MQTT Service -> REST API/WebSocket -> Browser -> rendered widgets). Read-only, no protocol complexity. Provides immediate standalone value.
**Delivers:** Dashboard page with metric cards (clients, messages/sec, subscriptions, uptime, broker version), auto-refreshing via WebSocket push, "last updated" timestamps on all metrics.
**Addresses:** Broker status dashboard, auto-refresh/real-time updates
**Avoids:** $SYS interval mismatch (Pitfall 7) -- show timestamps, subscribe don't poll

### Phase 3: Live MQTT Message Viewer
**Rationale:** Builds on Phase 2's WebSocket infrastructure. Still no plugin system needed. This feature is useful standalone AND serves as a verification tool for the Loxone bridge in later phases.
**Delivers:** Message viewer page with topic filter input, scrolling message list (ring buffer, max 1000), JSON payload formatting, pause button.
**Addresses:** Live message viewer, topic filter/search, JSON payload formatting
**Avoids:** Message flooding (Pitfall 8, 15) -- ring buffer + require user to set filter before subscribing, no default `#` subscription

### Phase 4: Plugin System
**Rationale:** Must exist before the Loxone plugin, but should be minimal. The architecture research explicitly warns against over-engineering this before a second plugin validates the API. Keep it to: plugin interface contract, plugin manager (discover/load/start/stop), config API routes, dynamic config UI from schema.
**Delivers:** Plugin lifecycle management, REST API for plugin config CRUD, dynamic form rendering from JSON Schema in the webapp.
**Addresses:** Plugin architecture, configuration UI for plugins, visual connection status per plugin
**Avoids:** Plugin over-engineering (Pitfall 9) -- simple interface only (start/stop/getStatus/getConfigSchema)

### Phase 5: Loxone Bridge Plugin
**Rationale:** Most complex component. Depends on all prior phases being stable. The Loxone WebSocket protocol involves binary parsing, encryption, token lifecycle, and structure file management -- enough complexity for a dedicated phase. This is the primary differentiator.
**Delivers:** Bidirectional Loxone-MQTT bridge with auto-discovery, human-readable topics, token auth, keepalive management, reconnection with backoff, generic fallback handler for unknown control types.
**Addresses:** Bidirectional communication, auto-discovery, human-readable topics, JSON payloads, connection status, reconnection with backoff
**Avoids:** Keepalive neglect (P1), token expiry (P2), binary misparse (P3), topic redesign (P4), unhandled control types (P11), reconnection cascade (P10), retained message ghosts (P13)

### Phase 6: Installer and Deployment
**Rationale:** Comes last because the installer needs to install a working system. Building it earlier means constant updates as the application changes. The installer is the user's first experience -- it must be polished.
**Delivers:** `wget | bash` one-command installer, systemd service with proper restart limits, idempotent re-run support, port conflict detection, vendored frontend dependencies for offline/LAN operation.
**Addresses:** One-command install, systemd service
**Avoids:** Restart loops (P12), installer conflicts (P14)

### Phase Ordering Rationale

- **Phases 1-3 validate the stack with zero external risk.** If Fastify + Preact + mqtt.js work well together, the foundation is solid. If not, we discover this before investing in complex protocol work.
- **Phase 4 before Phase 5 because the plugin system is a dependency,** but it should be built concurrently with the Loxone plugin design to ensure the interface matches real needs. The architecture research recommends "build the Loxone plugin as a normal module first, then extract the plugin API."
- **Phase 5 is isolated because Loxone protocol work is the highest-risk item.** Binary parsing, encryption, and token lifecycle are where most projects struggle. Isolating it means failures here do not destabilize the dashboard.
- **Phase 6 is last because installer quality depends on a stable application.** A premature installer becomes a maintenance burden during active development.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (Loxone Bridge):** Complex binary protocol, token auth flow with HMAC-SHA1 + AES-256-CBC, LoxAPP3.json structure parsing. Need to study reference implementations (node-lox-mqtt-gateway, lxcommunicator source). Obtain a real LoxAPP3.json to validate topic design before implementation.
- **Phase 4 (Plugin System):** Design the interface contract carefully -- it must be simple enough for v1 but extensible enough for KNX later. Review Fastify's own plugin pattern as a model.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Core Foundation):** Fastify setup, static file serving, mqtt.js client -- all extremely well-documented with official guides.
- **Phase 2 (Broker Dashboard):** $SYS topic parsing is straightforward. Mosquitto man page documents every topic.
- **Phase 3 (Message Viewer):** Standard WebSocket relay pattern. Ring buffer and topic filtering are solved problems.
- **Phase 6 (Installer):** Shell scripting for systemd services is well-established.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies are mature, well-documented, and widely adopted. Version choices are justified with specific rationale. No exotic dependencies. |
| Features | HIGH | Competitive analysis covers 6+ comparable tools. Feature priorities are grounded in what existing MQTT dashboards and Loxone bridges actually ship. |
| Architecture | HIGH | Component boundaries and data flows are clear. Build order follows true technical dependencies. Patterns (event bus, plugin contract, UUID mapper) are proven in similar systems. |
| Pitfalls | HIGH | Pitfalls are sourced from official Loxone documentation, community issue trackers (openHAB, node-red-contrib-loxone), and real CVE data (vm2). Each includes specific prevention strategies. |

**Overall confidence:** HIGH

### Gaps to Address

- **Real LoxAPP3.json validation:** Topic structure design assumes a standard structure file. Must test with an actual complex installation (many rooms, special characters, sub-controls) before finalizing the topic schema. Obtain a sample during Phase 5 planning.
- **Loxone token auth implementation complexity:** The auth flow (RSA key exchange -> AES session -> HMAC password hash -> JWT request) is well-documented but intricate. The fallback plan is to use lxcommunicator source as a reference implementation. Allocate extra time in Phase 5.
- **Preact 10.x to 11 migration path:** Preact 11 was in beta as of late 2025. If it ships stable before we reach frontend development, evaluate migration. Not blocking.
- **Mosquitto WebSocket listener assumption:** The architecture assumes Mosquitto is configured with `listener 9001` + `protocol websockets`. The installer should verify this or configure it.
- **Node.js 20.x LTS end-of-life:** LTS support ends April 2026. If the project timeline extends beyond that, plan for Node.js 22.x migration. Debian 13 may update its default package.

## Sources

### Primary (HIGH confidence)
- [Loxone: Communicating with the Miniserver v16.0](https://www.loxone.com/wp-content/uploads/datasheets/CommunicatingWithMiniserver.pdf) -- WebSocket protocol, token auth, binary events, LoxAPP3.json
- [Mosquitto man page](https://mosquitto.org/man/mosquitto-8.html) -- $SYS topic reference, broker configuration
- [mqtt.js on npm](https://www.npmjs.com/package/mqtt) -- v5.15.0, MQTT client API
- [Fastify documentation](https://fastify.dev/docs/latest/) -- Server setup, plugin system, WebSocket support
- [Preact no-build workflows](https://preactjs.com/guide/v10/no-build-workflows/) -- Import maps, HTM integration
- [@preact/signals](https://preactjs.com/guide/v10/signals/) -- Reactive state management

### Secondary (MEDIUM confidence)
- [node-lox-mqtt-gateway](https://github.com/alladdin/node-lox-mqtt-gateway) -- Architectural reference for Loxone-MQTT bridge
- [hobbyquaker/loxone2mqtt](https://github.com/hobbyquaker/loxone2mqtt) -- Topic structure conventions
- [BunkerM](https://github.com/bunkeriot/BunkerM) -- Mosquitto dashboard feature reference
- [mqtt-smarthome Architecture](https://github.com/mqtt-smarthome/mqtt-smarthome/blob/master/Architecture.md) -- Topic design conventions
- [HiveMQ MQTT Topics Best Practices](https://www.hivemq.com/blog/mqtt-essentials-part-5-mqtt-topics-best-practices/) -- Topic naming patterns
- [Fastify vs Express benchmarks](https://betterstack.com/community/guides/scaling-nodejs/fastify-express/) -- Performance comparison

### Tertiary (needs validation)
- [Preact 11 beta status](https://www.infoq.com/news/2025/09/preact-11-beta/) -- Migration timing uncertain
- [vm2 sandbox escape CVE](https://semgrep.dev/blog/2026/calling-back-to-vm2-and-escaping-sandbox/) -- Confirms decision to avoid in-process sandboxing

---
*Research completed: 2026-03-22*
*Ready for roadmap: yes*
