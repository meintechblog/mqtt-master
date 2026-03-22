# Architecture Research

**Domain:** MQTT dashboard + smart home bridge system with plugin architecture
**Researched:** 2026-03-22
**Confidence:** HIGH

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Web Browser (Dashboard)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ Broker Stats │  │ MQTT Message │  │   Plugin Config Pages    │   │
│  │   Widgets    │  │   Viewer     │  │   (Loxone, KNX, ...)     │   │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘   │
│         │                 │                        │                 │
│         └─────────────────┴────────────────────────┘                 │
│                           │ WebSocket (ws://host:port)               │
├───────────────────────────┼─────────────────────────────────────────┤
│                    Backend (Node.js Process)                         │
│  ┌────────────────────────┴──────────────────────────────────────┐  │
│  │                     HTTP + WebSocket Server                    │  │
│  │                   (Fastify + @fastify/websocket)               │  │
│  └────────┬──────────────────┬───────────────────┬───────────────┘  │
│           │                  │                   │                   │
│  ┌────────┴────────┐  ┌─────┴──────────┐  ┌─────┴──────────────┐   │
│  │  MQTT Service   │  │  Plugin Manager │  │  Config Service    │   │
│  │ (mqtt.js client)│  │  (lifecycle,    │  │  (JSON file store) │   │
│  │                 │  │   registry)     │  │                    │   │
│  └────────┬────────┘  └─────┬──────────┘  └────────────────────┘   │
│           │                 │                                       │
│           │          ┌──────┴──────────────────────┐                │
│           │          │        Plugin Interface      │                │
│           │          │  ┌──────────┐ ┌──────────┐  │                │
│           │          │  │ Loxone   │ │  KNX     │  │                │
│           │          │  │ Plugin   │ │ Plugin   │  │                │
│           │          │  │ (v1)     │ │ (future) │  │                │
│           │          │  └────┬─────┘ └──────────┘  │                │
│           │          └──────┼──────────────────────┘                │
│           │                 │                                       │
├───────────┼─────────────────┼───────────────────────────────────────┤
│           │                 │       External Systems                 │
│  ┌────────┴────────┐  ┌────┴───────────────┐                       │
│  │   Mosquitto     │  │  Loxone Miniserver  │                       │
│  │   MQTT Broker   │  │  WebSocket API      │                       │
│  │  :1883 / :9001  │  │  ws://IP/ws/rfc6455 │                       │
│  │  ($SYS topics)  │  │  (LoxAPP3.json,     │                       │
│  │                 │  │   Event Tables,      │                       │
│  │                 │  │   Token Auth)        │                       │
│  └─────────────────┘  └────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **HTTP/WS Server** | Serves static webapp, REST API for config, WebSocket relay for live MQTT data to browser | Fastify with @fastify/static and @fastify/websocket |
| **MQTT Service** | Single shared MQTT client connecting to Mosquitto. Subscribes to $SYS/# for broker metrics, relays messages for the live viewer, and publishes/subscribes on behalf of plugins | mqtt.js client with auto-reconnect |
| **Plugin Manager** | Discovers, loads, starts, stops, and restarts plugins. Manages plugin lifecycle and provides them with an API context (MQTT publish/subscribe, config access, logging) | Custom loader using dynamic `import()` with a defined plugin interface |
| **Config Service** | Reads/writes plugin configuration and system settings. Persists to JSON files on disk | Simple file-based JSON store in `/etc/mqtt-master/` or `~/.mqtt-master/` |
| **Loxone Plugin** | Connects to Miniserver via WebSocket, authenticates with JWT tokens, downloads LoxAPP3.json structure file, maps UUIDs to human-readable topics, publishes state changes to MQTT, forwards MQTT commands back to Miniserver | Plugin implementing the standard interface, using `ws` library for Loxone WebSocket |
| **Web Dashboard** | SPA displaying broker metrics, live message stream, and plugin-specific configuration pages | Vanilla JS or lightweight framework, bundled as static files |

## Recommended Project Structure

```
mqtt-master/
├── server/
│   ├── index.js                 # Entry point: starts Fastify, loads plugins
│   ├── server.js                # Fastify setup (routes, static files, websocket)
│   ├── services/
│   │   ├── mqtt-service.js      # Shared MQTT client (connect, subscribe, publish)
│   │   └── config-service.js    # JSON file config read/write
│   ├── plugins/
│   │   ├── plugin-manager.js    # Plugin discovery, lifecycle, registry
│   │   ├── plugin-interface.js  # Base class / contract plugins must implement
│   │   └── loxone/
│   │       ├── index.js         # Plugin entry: exports init/start/stop/configure
│   │       ├── loxone-ws.js     # WebSocket connection to Miniserver
│   │       ├── loxone-auth.js   # Token acquisition, refresh, encryption
│   │       ├── loxone-struct.js # LoxAPP3.json parser, UUID-to-topic mapper
│   │       └── loxone-events.js # Binary event table parser (value, text, daytimer)
│   └── routes/
│       ├── api-broker.js        # GET /api/broker/stats (cached $SYS data)
│       ├── api-plugins.js       # GET/POST /api/plugins/:id/config
│       └── api-messages.js      # WebSocket upgrade for live MQTT stream
├── webapp/
│   ├── index.html               # SPA shell
│   ├── css/
│   │   └── theme.css            # Venus OS Dark Theme variables
│   ├── js/
│   │   ├── app.js               # Router, layout manager
│   │   ├── pages/
│   │   │   ├── dashboard.js     # Broker metrics cards
│   │   │   ├── messages.js      # Live MQTT message viewer
│   │   │   └── plugin-config.js # Dynamic plugin settings page
│   │   ├── components/
│   │   │   ├── sidebar.js       # Navigation sidebar
│   │   │   ├── metric-card.js   # Stat display widget
│   │   │   └── message-row.js   # Single MQTT message display
│   │   └── lib/
│   │       └── ws-client.js     # WebSocket client to backend
│   └── assets/
│       └── icons/               # SVG icons
├── config/
│   └── default.json             # Default configuration
├── install.sh                   # One-command installer
├── mqtt-master.service          # systemd unit file
└── package.json
```

### Structure Rationale

- **server/services/:** Core services (MQTT, config) are independent of any plugin or route. They are injected into plugins and routes as dependencies. This keeps the MQTT connection as a singleton.
- **server/plugins/:** Each plugin is a self-contained folder with its own entry point. The plugin manager dynamically loads them. New plugins (KNX, etc.) are added by dropping a folder here and registering in config.
- **server/plugins/loxone/:** Separated into discrete concerns (WebSocket connection, auth, structure parsing, event parsing) because the Loxone protocol is complex with binary message parsing, encryption, and token lifecycle management.
- **webapp/:** Static SPA served by Fastify. No build step required for vanilla JS; if using a framework, build output goes here. Separated from server code entirely.
- **config/:** External configuration directory, not inside server code. The installer creates `/etc/mqtt-master/config.json` and symlinks or copies defaults.

## Architectural Patterns

### Pattern 1: Plugin Contract via Interface

**What:** Every plugin exports a standard set of lifecycle methods. The Plugin Manager calls these methods at the right time, passing a context object with shared services.
**When to use:** Always -- this is the core extensibility mechanism.
**Trade-offs:** Slightly more structure upfront, but makes adding KNX or any future bridge trivial without touching core code.

**Example:**
```javascript
// plugin-interface.js -- The contract every plugin must satisfy
export class PluginInterface {
  constructor(context) {
    this.mqtt = context.mqtt;       // publish/subscribe functions
    this.config = context.config;   // plugin-specific config
    this.log = context.log;         // scoped logger
  }

  // Called by Plugin Manager
  async start() { throw new Error('start() not implemented'); }
  async stop() { throw new Error('stop() not implemented'); }

  // Plugin describes its config schema for the UI
  getConfigSchema() { return {}; }

  // Plugin reports its health/status
  getStatus() { return { connected: false }; }
}
```

```javascript
// loxone/index.js
import { PluginInterface } from '../plugin-interface.js';

export default class LoxonePlugin extends PluginInterface {
  async start() {
    this.ws = new LoxoneWebSocket(this.config);
    await this.ws.connect();
    await this.ws.authenticate();
    const structure = await this.ws.downloadStructureFile();
    this.mapper = new TopicMapper(structure);
    this.ws.on('valueEvent', (uuid, value) => {
      const topic = this.mapper.uuidToTopic(uuid);
      this.mqtt.publish(topic, JSON.stringify({ value, ...this.mapper.getMeta(uuid) }));
    });
  }

  async stop() {
    await this.ws.disconnect();
  }
}
```

### Pattern 2: Event Bus for Internal Communication

**What:** Components communicate through an EventEmitter-based bus rather than direct references. The MQTT Service emits events when messages arrive; the WebSocket relay and plugins subscribe to relevant events.
**When to use:** For decoupling the MQTT message flow from consumers (dashboard WebSocket, plugins needing to react to MQTT commands).
**Trade-offs:** Slightly harder to trace message flow during debugging, but eliminates circular dependencies and makes the system testable.

**Example:**
```javascript
// mqtt-service.js
import { EventEmitter } from 'node:events';
import mqtt from 'mqtt';

export class MqttService extends EventEmitter {
  connect(brokerUrl) {
    this.client = mqtt.connect(brokerUrl);
    this.client.on('message', (topic, payload) => {
      this.emit('message', { topic, payload: payload.toString(), timestamp: Date.now() });
    });
    this.client.subscribe('$SYS/#');
  }

  publish(topic, payload, opts) {
    this.client.publish(topic, payload, opts);
  }

  subscribe(topic) {
    this.client.subscribe(topic);
  }
}
```

### Pattern 3: UUID-to-Topic Mapping Layer

**What:** The Loxone Miniserver identifies everything by 128-bit UUIDs. The bridge maintains an in-memory map (built from LoxAPP3.json) that translates UUIDs to human-readable MQTT topics like `loxone/living-room/main-light/state`.
**When to use:** Specifically for the Loxone plugin, but the pattern of "translate external identifiers to meaningful MQTT topics" applies to any future bridge plugin.
**Trade-offs:** Requires downloading and caching the structure file. The map must be rebuilt when the Miniserver config changes (detectable via `lastModified` field).

**Example:**
```javascript
// loxone-struct.js
export class TopicMapper {
  constructor(loxApp3, topicPrefix = 'loxone') {
    this.map = new Map();       // UUID -> { topic, name, type, room, category }
    this.reverseMap = new Map(); // topic -> UUID (for commands)
    this.prefix = topicPrefix;
    this.buildMap(loxApp3);
  }

  buildMap(struct) {
    const rooms = struct.rooms || {};
    const cats = struct.cats || {};
    for (const [uuid, control] of Object.entries(struct.controls || {})) {
      const room = rooms[control.room]?.name || 'unknown';
      const slug = this.slugify;
      const topic = `${this.prefix}/${this.slugify(room)}/${this.slugify(control.name)}`;
      this.map.set(uuid, { topic, name: control.name, type: control.type, room, uuid });
      this.reverseMap.set(topic, uuid);
      // Also map sub-controls (states) with their own UUIDs
      for (const [stateKey, stateUuid] of Object.entries(control.states || {})) {
        this.map.set(stateUuid, { topic: `${topic}/${stateKey}`, name: control.name,
          type: control.type, room, uuid, stateKey });
      }
    }
  }

  uuidToTopic(uuid) { return this.map.get(uuid)?.topic; }
  topicToUuid(topic) { return this.reverseMap.get(topic); }
  getMeta(uuid) { return this.map.get(uuid); }
  slugify(str) { return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
}
```

## Data Flow

### Flow 1: Broker Monitoring ($SYS topics to Dashboard)

```
Mosquitto Broker
    │ publishes $SYS/# every ~10s
    ▼
MQTT Service (subscribed to $SYS/#)
    │ emits 'message' events, caches latest values in memory
    ▼
API Route GET /api/broker/stats
    │ returns cached $SYS values as JSON
    ▼
Dashboard (polls every 10s or receives via WebSocket push)
    │ updates metric cards
    ▼
Browser renders widgets (clients, messages/sec, memory, uptime)
```

### Flow 2: Live MQTT Message Viewer

```
Browser opens WebSocket to backend /ws/messages
    │ sends filter: { topics: ["#"] } or { topics: ["loxone/#"] }
    ▼
WebSocket Route (server-side)
    │ subscribes MqttService to requested topics
    │ pipes 'message' events to browser WebSocket
    ▼
MQTT Service receives messages from Mosquitto
    │ emits to WebSocket relay
    ▼
Browser receives JSON { topic, payload, timestamp }
    │ renders in scrolling message list
```

### Flow 3: Loxone State Change to MQTT (outbound)

```
Loxone Miniserver (sensor/actuator changes state)
    │ sends binary Event-Table via WebSocket
    │ (Value-Event: 16-byte UUID + 8-byte double = 24 bytes per event)
    ▼
Loxone Plugin: loxone-events.js
    │ parses binary buffer, extracts UUID + value pairs
    ▼
Loxone Plugin: TopicMapper
    │ UUID -> "loxone/living-room/main-light/value"
    ▼
Loxone Plugin calls this.mqtt.publish()
    │ payload: { "value": 1, "name": "Main Light", "type": "Switch",
    │            "uuid": "0f3c...", "room": "Living Room" }
    ▼
MQTT Service publishes to Mosquitto
    │ topic: loxone/living-room/main-light/value
    ▼
Any MQTT client can subscribe and react
```

### Flow 4: MQTT Command to Loxone (inbound)

```
External MQTT client publishes to loxone/living-room/main-light/cmd
    │ payload: "on" or "pulse" or "off"
    ▼
MQTT Service (subscribed to loxone/+/+/cmd)
    │ emits 'message' event
    ▼
Loxone Plugin receives event, checks topic prefix
    │ TopicMapper.topicToUuid("loxone/living-room/main-light") -> UUID
    ▼
Loxone Plugin sends command via WebSocket
    │ "jdev/sps/io/{uuid}/{command}"
    │ (encrypted with AES session key if required)
    ▼
Loxone Miniserver executes command
    │ state change propagated back via Event-Table (Flow 3)
```

### Flow 5: Loxone Token Lifecycle

```
On plugin start:
    1. Open WebSocket to ws://{ip}:{port}/ws/rfc6455
    2. Request public key: jdev/sys/getPublicKey
    3. Generate AES-256-CBC key + IV
    4. RSA-encrypt key+IV with public key -> session key exchange
    5. Request key2+salt+hashAlg: jdev/sys/getkey2/{user}
    6. Hash password with userSalt using hashAlg (SHA1 or SHA256)
    7. HMAC hash user:pwHash with key
    8. Request JWT: jdev/sys/getjwt/{hash}/{user}/{permission}/{uuid}/{info}
       (encrypted with AES session key -- REQUIRED)
    9. Store token + validUntil

    On token near expiry:
    - Refresh: jdev/sys/refreshjwt/{tokenHash}/{user}
    - Returns new token + validUntil

    On keepalive (every <5 min):
    - Send "keepalive" text message to prevent timeout
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 home (target) | Single Node.js process, single MQTT client, single Loxone WebSocket. This is the design point -- no scaling concerns. |
| 2-5 Miniservers | Multiple Loxone plugin instances, each with its own WebSocket. Plugin Manager supports multiple instances of the same plugin type with different configs. Topic prefix prevents collisions. |
| High message rate | The Miniserver limits to 31 concurrent WebSocket clients for live events. The bridge uses exactly 1 slot. If MQTT message volume is high, the browser WebSocket relay should implement backpressure (drop oldest messages in the viewer). |

### Scaling Priorities

1. **First bottleneck:** Loxone Miniserver WebSocket event slots. Only 31 concurrent clients can receive live status updates. The bridge should use exactly 1 persistent connection and never open multiple. This is a hard limit from the Miniserver hardware.
2. **Second bottleneck:** Browser WebSocket bandwidth for the live message viewer. A busy MQTT broker can produce thousands of messages per second. The viewer must throttle/sample or let the user filter by topic pattern.

## Anti-Patterns

### Anti-Pattern 1: Multiple MQTT Client Connections

**What people do:** Each plugin creates its own MQTT client connection to the broker.
**Why it's wrong:** Wastes broker resources, makes message routing inconsistent, complicates connection management and error handling. On a small Debian VM, every connection is overhead.
**Do this instead:** Single shared MqttService that all plugins use. Plugins call `this.mqtt.publish()` and `this.mqtt.subscribe()` -- they never create their own mqtt.js clients.

### Anti-Pattern 2: Polling the Loxone Miniserver

**What people do:** Periodically HTTP-request control states from the Miniserver.
**Why it's wrong:** The Miniserver has limited HTTP connections (48 for Gen 1, 256 for Gen 2). Polling misses rapid state changes and wastes CPU on the Miniserver.
**Do this instead:** Use the WebSocket Event-Table mechanism. Send `jdev/sps/enablebinstatusupdate` once after authentication, then receive push-based binary event tables for all state changes. This is the official, efficient approach documented by Loxone.

### Anti-Pattern 3: Storing UUIDs in MQTT Topics

**What people do:** Publish Loxone states to topics like `loxone/0f3c1a2b-034e-29a4-ffff-a40e12345678/value`.
**Why it's wrong:** UUIDs are meaningless to humans. Other MQTT clients (Node-RED, Home Assistant, custom scripts) cannot easily subscribe to or discover controls by name.
**Do this instead:** Build the UUID-to-topic map from LoxAPP3.json and publish to human-readable topics like `loxone/living-room/main-light/value`. Keep UUIDs in the JSON payload for programmatic access.

### Anti-Pattern 4: Tightly Coupling Plugin UI to Plugin Backend

**What people do:** Each plugin ships its own HTML page that the server must know about and route to.
**Why it's wrong:** Breaks the plugin contract, requires server-side routing changes for each plugin.
**Do this instead:** Plugins expose a config schema (JSON Schema). The webapp renders a dynamic form from the schema. The plugin only needs to define `getConfigSchema()` returning a declarative schema object.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Mosquitto Broker | mqtt.js client over TCP (:1883) for backend; MQTT-over-WebSocket (:9001) for potential direct browser use | Backend uses TCP for reliability. The broker must have `listener 9001` with `protocol websockets` for the browser message viewer option. |
| Loxone Miniserver | WebSocket (ws://{ip}/ws/rfc6455) with `Sec-WebSocket-Protocol: remotecontrol` | Binary protocol with 8-byte message headers. Token auth via JWT (since Config 10.2). Connection must send keepalive within 5 minutes or server disconnects. Max 31 live event slots. Since v11.2, encryption is optional if TLS is used, but still recommended. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Server <-> Browser | WebSocket (JSON messages) + REST API (JSON) | WebSocket for live data push (broker stats, MQTT messages). REST for config CRUD operations. Static file serving for the webapp. |
| Plugin Manager <-> Plugins | Method calls on plugin instances (start/stop/getStatus/getConfigSchema) | Plugin Manager owns the lifecycle. Plugins receive a context object at construction with MQTT service, config, and logger. |
| Plugins <-> MQTT Service | EventEmitter subscription + publish/subscribe methods | Plugins subscribe to specific topic patterns for inbound commands. They publish state changes. All through the shared MqttService. |
| Config Service <-> Filesystem | Synchronous/async JSON file read/write | Config stored at `/etc/mqtt-master/config.json` (system-wide) or `./config/` (development). Plugin configs nested under `plugins.{pluginId}`. |

### Loxone WebSocket Binary Protocol Details

The Loxone Miniserver uses a custom binary protocol over standard WebSocket frames. Every message from the Miniserver is preceded by an 8-byte binary Message Header:

| Byte | Field | Value |
|------|-------|-------|
| 1 | Type | Always 0x03 |
| 2 | Identifier | 0=Text, 1=Binary, 2=ValueEvents, 3=TextEvents, 4=DaytimerEvents, 5=OutOfService, 6=Keepalive, 7=WeatherEvents |
| 3 | InfoFlags | Bit 0: Estimated size flag |
| 4 | Reserved | 0x00 |
| 5-8 | Length | 32-bit unsigned int (little endian), payload size |

Value-Events are the most common: each is 24 bytes (16-byte UUID + 8-byte double). A single message can contain multiple events packed sequentially. The parser must iterate the binary buffer in 24-byte chunks.

## Build Order (Dependency Chain)

The following build order reflects true technical dependencies:

```
Phase 1: Core Foundation
   ├── Fastify HTTP server + static file serving
   ├── MQTT Service (mqtt.js client, $SYS subscription, event emitter)
   ├── Config Service (JSON file store)
   └── Basic webapp shell (sidebar, routing, Venus OS theme)
         │
         │ Reason: Everything else depends on these. The MQTT Service
         │ is the central nervous system; plugins and dashboard need it.
         ▼
Phase 2: Broker Dashboard
   ├── $SYS topic parser + in-memory cache
   ├── REST API: GET /api/broker/stats
   ├── Dashboard page with metric cards
   └── WebSocket relay for live stats push
         │
         │ Reason: Validates the full stack (backend -> frontend) with
         │ the simplest possible data source (read-only $SYS topics).
         │ No external system dependencies beyond the existing Mosquitto.
         ▼
Phase 3: Live MQTT Message Viewer
   ├── WebSocket route for message streaming
   ├── Topic filter/subscription management
   └── Message viewer page (scrolling list, topic filter input)
         │
         │ Reason: Builds on Phase 2 WebSocket infrastructure. Still no
         │ plugin system needed. This is useful standalone and will later
         │ serve to verify Loxone bridge messages are arriving.
         ▼
Phase 4: Plugin System
   ├── Plugin interface/contract definition
   ├── Plugin Manager (discover, load, start, stop, restart)
   ├── Plugin config API routes
   └── Dynamic config UI (renders forms from plugin schema)
         │
         │ Reason: The plugin system must exist before any plugin. This
         │ phase produces a working framework with no actual plugins yet,
         │ but the infrastructure to load them.
         ▼
Phase 5: Loxone Plugin
   ├── WebSocket connection to Miniserver
   ├── Token authentication (JWT acquisition, refresh, keepalive)
   ├── LoxAPP3.json download + UUID-to-topic mapper
   ├── Binary event table parser
   ├── Bidirectional bridge (state -> MQTT, MQTT cmd -> Miniserver)
   └── Loxone config schema (Miniserver IP, credentials, topic prefix)
         │
         │ Reason: Most complex component. Depends on plugin system,
         │ MQTT service, and config service all being stable. The Loxone
         │ WebSocket protocol involves binary parsing, encryption, and
         │ token lifecycle -- enough complexity for its own phase.
         ▼
Phase 6: Installer + Deployment
   ├── install.sh (wget one-liner, apt deps, systemd setup)
   ├── mqtt-master.service (systemd unit)
   ├── Update mechanism
   └── Documentation
```

## Sources

- [Loxone: Communicating with the Miniserver v16.0 (2025.06.03)](https://www.loxone.com/wp-content/uploads/datasheets/CommunicatingWithMiniserver.pdf) -- Official WebSocket API, token auth, binary protocol, event tables, LoxAPP3.json (HIGH confidence)
- [node-lox-mqtt-gateway](https://github.com/alladdin/node-lox-mqtt-gateway) -- Existing Node.js Loxone-to-MQTT bridge, architectural reference (HIGH confidence)
- [MQTT.js - npm](https://github.com/mqttjs/MQTT.js) -- Standard Node.js MQTT client library (HIGH confidence)
- [Fastify WebSocket](https://github.com/fastify/fastify-websocket) -- WebSocket support for Fastify (HIGH confidence)
- [Node.js Plugin Architecture: ES Modules](https://medium.com/codeelevation/node-js-plugin-architecture-build-your-own-plugin-system-with-es-modules-5b9a5df19884) -- Plugin system patterns (MEDIUM confidence)
- [HiveMQ: Why you shouldn't use $SYS topics for monitoring](https://www.hivemq.com/blog/why-you-shouldnt-use-sys-topics-for-monitoring/) -- $SYS limitations context (MEDIUM confidence)
- [Mosquitto man page](https://mosquitto.org/man/mosquitto-8.html) -- $SYS topic list and update intervals (HIGH confidence)
- [Evaluation of MQTT Bridge Architectures (2025)](https://arxiv.org/html/2501.14890v1) -- Academic review of bridge patterns (MEDIUM confidence)

---
*Architecture research for: MQTT Master -- dashboard + smart home bridge system*
*Researched: 2026-03-22*
