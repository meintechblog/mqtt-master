# Feature Research

**Domain:** MQTT broker dashboard and smart home bridge system
**Researched:** 2026-03-22
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

#### Broker Dashboard

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Connected clients count | Every MQTT dashboard shows this (HiveMQ, BunkerM, EMQX) | LOW | Read from `$SYS/broker/clients/connected` |
| Message throughput (received/sent) | Core broker health metric | LOW | `$SYS/broker/messages/publish/received` and `/sent` |
| Active subscriptions count | Standard broker metric | LOW | `$SYS/broker/subscriptions/count` |
| Retained messages count | Users need to know stored message volume | LOW | `$SYS/broker/store/messages/count` |
| Broker uptime | Basic health indicator | LOW | `$SYS/broker/uptime` |
| Broker version info | Helps troubleshooting | LOW | `$SYS/broker/version` (static) |
| Auto-refresh / real-time updates | Dashboard without live data feels broken; HiveMQ and BunkerM both do this | MEDIUM | WebSocket subscription to `$SYS/#`, update every sys_interval (default 10s) |
| Live MQTT message viewer | MQTT Explorer's core feature; users expect to see messages flowing | MEDIUM | Subscribe via WebSocket on port 9001, render topic + payload in real-time |
| Topic filter/search | MQTT Explorer and HiveMQ both provide this; essential with many topics | LOW | Client-side text filter on topic strings |
| JSON payload formatting | MQTT Explorer pretty-prints JSON; raw JSON is unreadable | LOW | `JSON.parse()` + pretty-print in UI |

#### Loxone Bridge (Plugin)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Bidirectional communication | Both loxone2mqtt and Lox2MQTT do this; one-way bridge is half-baked | HIGH | Read states from Miniserver via WebSocket, send commands back |
| Auto-discovery of controls | Lox2MQTT connects to WebSocket and gets all controls without config changes in Loxone Config | MEDIUM | Parse `LoxAPP3.json` structure file for all controls, rooms, categories |
| Human-readable topic structure | loxone2mqtt uses `prefix/{state\|set}/category/room/control_name/`; UUIDs alone are unusable | MEDIUM | Map UUIDs to room/control names from structure file |
| JSON payloads with context | Raw values without metadata are useless for downstream consumers | LOW | Include value, name, type, UUID, room in each payload |
| Connection status reporting | Standard MQTT bridge practice; HA expects availability topics | LOW | Publish online/offline to a status topic |
| Reconnection with backoff | Miniserver reboots, network glitches happen; bridge must recover | MEDIUM | Exponential backoff, automatic reconnect on WebSocket close |

#### General / Infrastructure

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Dark theme UI | Explicitly required to match Venus OS design system | MEDIUM | Design tokens from PV Inverter Proxy (backgrounds, colors, typography) |
| Responsive layout | Users check dashboards from phones/tablets | MEDIUM | CSS grid with breakpoints; card-based layout like PV Inverter Proxy |
| One-command install | Community project expectation; wget-based like many OSS tools | MEDIUM | Shell script handling Node.js, npm deps, systemd setup |
| systemd service | Standard for self-hosted Linux services; auto-start on boot | LOW | Unit file with restart policy |
| Configuration UI for plugins | Users expect GUI config, not editing JSON files by hand | MEDIUM | Web form for Miniserver IP, credentials, topic prefix |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Plugin architecture for bridges | No existing tool combines broker dashboard + extensible bridge system; MQTT Explorer is view-only, loxone2mqtt is CLI-only, BunkerM has no bridge concept | HIGH | Plugin lifecycle (load/unload/configure), standardized bridge interface, isolated per-plugin config |
| Unified dashboard + bridge in one app | Users currently run separate tools (MQTT Explorer + loxone2mqtt + Mosquitto); one UI for everything | MEDIUM | Single web app with sidebar nav: Dashboard, Messages, Plugins sections |
| Home Assistant MQTT Discovery output | Bridges that publish HA-compatible discovery messages let devices auto-appear in HA | HIGH | Publish to `homeassistant/<component>/<node_id>/<object_id>/config` with proper payloads |
| Loxone token-based auth | More secure than persistent credentials; most Loxone bridges use basic user/password | HIGH | Token acquisition flow per Loxone firmware 10.2+ spec; token refresh before expiry |
| Visual connection status per plugin | See at a glance which bridges are healthy vs disconnected | LOW | Green/red indicators on plugin cards; last-seen timestamp |
| Topic tree visualization | MQTT Explorer's signature feature; seeing topic hierarchy is powerful for debugging | HIGH | Parse incoming messages into tree structure with expand/collapse; shows last value per topic |
| Message rate sparklines | BunkerM shows counts; sparklines show trends over time | MEDIUM | Rolling window (last 5-10 minutes) of messages/sec, rendered as inline charts |
| Per-plugin log viewer | Debugging bridge issues without SSH-ing into the server | MEDIUM | Capture plugin stdout/stderr, show in UI with severity levels |
| Loxone room/category grouping in UI | Structure file has rooms and categories; displaying controls grouped by room is natural | MEDIUM | Parse structure file hierarchy, render as collapsible groups |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Webapp authentication/login | Security instinct | Adds complexity for LAN-only tool; Mosquitto itself runs with anonymous access; creates password-reset support burden | Trust the LAN, same as broker. Document network segmentation best practices |
| Cloud/remote access | "Access from anywhere" | Massive security surface, latency, dependency on external service, privacy concerns for smart home data | VPN or WireGuard for remote access (user's responsibility) |
| Mosquitto config editing via UI | "Manage everything in one place" | Mosquitto config is complex (ACLs, listeners, bridges); mistakes break the broker; config file is the source of truth | Link to config file location in UI; provide documentation |
| Built-in MQTT broker | "All in one" | Mosquitto is already running and proven; bundling another broker creates conflicts and maintenance burden | Designed to work alongside existing Mosquitto installation |
| Multi-broker support | "Monitor all my brokers" | Multiplies complexity, confusing UI, unclear which broker a message belongs to | Single broker focus. Plugin for remote broker monitoring could come later (v2+) |
| Rule engine / automation | Node-RED territory | Duplicating Node-RED is a losing battle; it has years of ecosystem and flows | Integrate well with Node-RED via clean MQTT topics; let Node-RED handle logic |
| Drag-and-drop dashboard builder | "Customize my dashboard" | Enormous complexity for marginal value; becomes a maintenance nightmare | Opinionated, well-designed fixed layout. If customization needed, use Grafana |
| Mobile native app | "I want an app" | Web app works on mobile; native app doubles development effort for one developer | Responsive web design with PWA-ready manifest |
| Historical data / time-series storage | "Show me graphs over time" | Requires database, storage management, retention policies, backup | Real-time only in v1. Point users to InfluxDB + Grafana for historical data |

## Feature Dependencies

```
[Mosquitto $SYS subscription]
    └──requires──> [WebSocket connection to broker (port 9001)]

[Live message viewer]
    └──requires──> [WebSocket connection to broker (port 9001)]
        └──enhances──> [Topic filter/search]

[Plugin system architecture]
    └──requires──> [Configuration storage (file-based)]
        └──enables──> [Loxone plugin]
        └──enables──> [Future KNX plugin]

[Loxone auto-discovery]
    └──requires──> [Loxone WebSocket connection]
        └──requires──> [Loxone token auth OR basic auth]
    └──requires──> [Structure file parsing (LoxAPP3.json)]
        └──enables──> [Human-readable topic mapping]
        └──enables──> [Room/category grouping]

[Loxone bidirectional bridge]
    └──requires──> [Loxone WebSocket connection]
    └──requires──> [MQTT client connection to broker]
    └──requires──> [Human-readable topic mapping]

[Home Assistant MQTT Discovery]
    └──requires──> [Loxone auto-discovery]
    └──requires──> [MQTT client connection to broker]

[Configuration UI]
    └──requires──> [Plugin system architecture]
    └──enhances──> [Loxone plugin]

[Plugin log viewer]
    └──requires──> [Plugin system architecture]

[Topic tree visualization]
    └──requires──> [Live message viewer]
```

### Dependency Notes

- **Live message viewer requires WebSocket**: Mosquitto must have WebSocket listener on port 9001 (already configured per PROJECT.md)
- **Loxone plugin requires plugin system**: Plugin architecture must exist before any bridge can be built; but the architecture can be designed alongside the first plugin
- **HA Discovery requires auto-discovery**: Must know what controls exist before publishing discovery configs
- **Topic tree requires message stream**: Tree is built incrementally from observed messages
- **Human-readable topics require structure file**: UUID-to-name mapping comes from LoxAPP3.json

## MVP Definition

### Launch With (v1)

Minimum viable product -- what's needed to validate the concept.

- [ ] Broker status dashboard (clients, messages, subscriptions, uptime) -- core value proposition for monitoring
- [ ] Live MQTT message viewer with topic filter -- users need to see what's happening on the broker
- [ ] Loxone plugin: bidirectional bridge with auto-discovery -- the primary differentiator
- [ ] Human-readable MQTT topics (loxone/{room}/{control}) -- usability over raw UUIDs
- [ ] JSON payloads for state changes -- structured data for downstream consumers
- [ ] Plugin configuration UI (Miniserver IP, credentials, prefix) -- no SSH needed for setup
- [ ] Dark theme matching Venus OS design system -- suite consistency
- [ ] One-command Debian installer with systemd -- community project must be easy to install

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] Home Assistant MQTT Discovery output -- high value but requires careful implementation of HA conventions
- [ ] Topic tree visualization -- powerful debugging tool, but complex UI work
- [ ] Message rate sparklines/trends -- nice visual but not critical
- [ ] Per-plugin log viewer in UI -- helpful for debugging but can SSH initially
- [ ] Loxone room/category grouping in dashboard -- better UX for large installations
- [ ] Loxone token-based auth (upgrade from basic auth) -- more secure, but basic auth works for v1

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] KNX IP Gateway plugin -- explicitly out of scope for v1 per PROJECT.md
- [ ] Additional bridge plugins (Zigbee2MQTT relay, Shelly, etc.) -- validate plugin architecture with Loxone first
- [ ] Grafana integration guide -- point users to established tooling for historical data
- [ ] Plugin marketplace / community plugins -- requires stable plugin API and user base

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Broker status dashboard | HIGH | LOW | P1 |
| Live message viewer | HIGH | MEDIUM | P1 |
| Topic filter/search | HIGH | LOW | P1 |
| JSON payload formatting | MEDIUM | LOW | P1 |
| Loxone bidirectional bridge | HIGH | HIGH | P1 |
| Loxone auto-discovery | HIGH | MEDIUM | P1 |
| Human-readable topics | HIGH | MEDIUM | P1 |
| Plugin configuration UI | HIGH | MEDIUM | P1 |
| Dark theme UI | MEDIUM | MEDIUM | P1 |
| Responsive layout | MEDIUM | MEDIUM | P1 |
| One-command installer | HIGH | MEDIUM | P1 |
| systemd service | HIGH | LOW | P1 |
| Connection status per plugin | MEDIUM | LOW | P1 |
| Reconnection with backoff | HIGH | LOW | P1 |
| Plugin system architecture | HIGH | HIGH | P1 |
| HA MQTT Discovery | HIGH | HIGH | P2 |
| Topic tree visualization | HIGH | HIGH | P2 |
| Loxone token auth | MEDIUM | HIGH | P2 |
| Message rate sparklines | LOW | MEDIUM | P2 |
| Per-plugin log viewer | MEDIUM | MEDIUM | P2 |
| Room/category grouping | MEDIUM | MEDIUM | P2 |
| KNX plugin | MEDIUM | HIGH | P3 |
| Historical data guide | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | MQTT Explorer | BunkerM | loxone2mqtt | Lox2MQTT | Home Assistant MQTT | Our Approach |
|---------|--------------|---------|-------------|----------|--------------------|----|
| Broker monitoring | Client-side only (no $SYS) | Full $SYS dashboard | None | None | Basic via sensors | Full $SYS dashboard, real-time |
| Live message viewer | Yes, with tree | No | No | No | Via developer tools | Yes, with topic filter |
| Topic tree | Yes (signature feature) | No | No | No | No | v1.x (after core) |
| Loxone bridge | No | No | Yes (CLI, basic) | Yes (LoxBerry plugin) | No | Yes, with auto-discovery + UI |
| Bidirectional control | No | No | Limited | Yes | N/A | Yes, full bidirectional |
| Auto-discovery | No | No | Manual | WebSocket-based | HA Discovery protocol | WebSocket + structure file |
| Human-readable topics | N/A | N/A | Yes (category/room/name) | UUID-based | Component-based | Yes (room/control pattern) |
| Plugin architecture | No | Extensions (Docker) | No | No | Integration framework | Yes, designed for bridges |
| Web-based | Electron app | Yes (Docker) | CLI only | LoxBerry web | Yes | Yes, lightweight web app |
| Self-hosted install | Desktop app | Docker required | npm install | LoxBerry platform | Full HA install | Single wget command |
| HA Discovery output | No | No | No | No | Is the consumer | v1.x planned |
| Dark theme | Yes | Yes | N/A | N/A | Yes | Yes (Venus OS design system) |

## Sources

- [MQTT Explorer](http://mqtt-explorer.com/) -- Topic tree, message viewer, JSON formatting features
- [MQTT Explorer GitHub](https://github.com/thomasnordquist/MQTT-Explorer) -- Feature set and capabilities
- [HiveMQ Control Center](https://www.hivemq.com/products/control-center/) -- Enterprise broker dashboard features
- [BunkerM GitHub](https://github.com/bunkeriot/BunkerM) -- Open-source Mosquitto management platform
- [BunkerM Dashboard Docs](https://bunkeriot.github.io/BunkerM/ui/dashboard/) -- Dashboard feature details
- [Home Assistant MQTT Integration](https://www.home-assistant.io/integrations/mqtt/) -- MQTT Discovery protocol and conventions
- [hobbyquaker/loxone2mqtt](https://github.com/hobbyquaker/loxone2mqtt) -- Existing Loxone-MQTT bridge, topic structure
- [Lox2MQTT LoxBerry Plugin](https://github.com/nufke/LoxBerry-Plugin-Lox2MQTT) -- Bidirectional Loxone-MQTT bridge
- [Loxone Structure File](https://www.loxone.com/wp-content/uploads/datasheets/StructureFile.pdf) -- API structure for controls, rooms, categories
- [Loxone API Communication](https://www.loxone.com/wp-content/uploads/datasheets/CommunicatingWithMiniserver.pdf) -- WebSocket API documentation
- [Mosquitto man page](https://mosquitto.org/man/mosquitto-8.html) -- $SYS topic reference
- [EMQ Top MQTT Client Tools 2025](https://www.emqx.com/en/blog/mqtt-client-tools) -- Competitive landscape
- [EMQX Broker Comparison 2025](https://www.emqx.com/en/blog/a-comprehensive-comparison-of-open-source-mqtt-brokers-in-2023) -- Dashboard capabilities across brokers

---
*Feature research for: MQTT broker dashboard and smart home bridge system*
*Researched: 2026-03-22*
