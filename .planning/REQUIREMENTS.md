# Requirements: MQTT Master

**Defined:** 2026-03-22
**Core Value:** Bridge non-MQTT smart home systems into the MQTT world through an extensible plugin system

## v1 Requirements

### Dashboard

- [ ] **DASH-01**: User can see number of connected MQTT clients in real-time
- [ ] **DASH-02**: User can see message throughput (received/sent totals and per-second rates)
- [ ] **DASH-03**: User can see active subscription count
- [ ] **DASH-04**: User can see broker memory/heap usage (current and maximum)
- [ ] **DASH-05**: User can see message load averages (1/5/15 min)
- [ ] **DASH-06**: User can see broker version and uptime
- [ ] **DASH-07**: User can see broker connection status indicator (connected/disconnected with visual dot)
- [ ] **DASH-08**: User can see a hierarchical topic tree of all active MQTT topics

### Live Messages

- [ ] **LIVE-01**: User can subscribe to any MQTT topic pattern via the webapp
- [ ] **LIVE-02**: User can see messages arriving in real-time with topic, payload, and timestamp
- [ ] **LIVE-03**: User can filter displayed messages by topic pattern
- [ ] **LIVE-04**: User can scroll back through recent messages (in-memory ring buffer, last N messages)
- [ ] **LIVE-05**: User can clear the message display

### Plugin System

- [ ] **PLUG-01**: Plugins follow a lifecycle contract (start/stop/getStatus/getConfigSchema)
- [ ] **PLUG-02**: User can see plugin status in the webapp sidebar (running/stopped/error)
- [ ] **PLUG-03**: User can configure plugins via auto-generated forms from plugin config schema
- [ ] **PLUG-04**: User can start and stop individual plugins from the webapp
- [ ] **PLUG-05**: User can reload a plugin without restarting the entire application

### Loxone Bridge

- [ ] **LOX-01**: Plugin connects to Loxone Miniserver via WebSocket API
- [ ] **LOX-02**: Plugin authenticates using token-based auth (firmware 10.2+)
- [ ] **LOX-03**: Plugin auto-discovers all Loxone controls by parsing LoxAPP3.json structure file
- [ ] **LOX-04**: Plugin publishes Loxone state changes to MQTT with human-readable topics (loxone/{room}/{control})
- [ ] **LOX-05**: Plugin accepts MQTT commands and forwards them to Loxone controls (bidirectional)
- [ ] **LOX-06**: Plugin publishes JSON payloads containing value, name, type, UUID, and room
- [ ] **LOX-07**: Plugin maps UUIDs to human-readable names internally and displays mapping in webapp
- [ ] **LOX-08**: User can configure Miniserver connection (IP, credentials, topic prefix) in webapp
- [ ] **LOX-09**: Plugin publishes Home Assistant MQTT Discovery messages for auto-detection in HA
- [ ] **LOX-10**: User can enable/disable individual Loxone controls from being bridged to MQTT

### Webapp & Design

- [ ] **UI-01**: Webapp uses Venus OS Dark Theme (matching PV Inverter Proxy design system)
- [ ] **UI-02**: Webapp has sidebar navigation with page switching
- [ ] **UI-03**: Webapp is responsive (desktop, tablet, mobile breakpoints)
- [ ] **UI-04**: Webapp runs without authentication (open LAN access)

### Deployment

- [ ] **DEP-01**: User can install MQTT Master with a single wget command on Debian/Ubuntu
- [ ] **DEP-02**: Installer sets up Mosquitto broker with open LAN access and WebSocket support
- [ ] **DEP-03**: Installer creates a systemd service for auto-start
- [ ] **DEP-04**: User can update to the latest version by running the same install command
- [ ] **DEP-05**: Installer is idempotent (safe to run multiple times)

## v2 Requirements

### KNX Integration

- **KNX-01**: Plugin bridges KNX IP Gateway to MQTT topics
- **KNX-02**: Plugin auto-discovers KNX group addresses

### Advanced Dashboard

- **ADVD-01**: User can see message rate charts over time
- **ADVD-02**: User can see per-client statistics

### Plugin Ecosystem

- **PLEC-01**: User can install plugins from a registry
- **PLEC-02**: Plugin sandboxing for untrusted plugins

## Out of Scope

| Feature | Reason |
|---------|--------|
| Webapp authentication/login | Trusted LAN environment, same philosophy as broker |
| Cloud/remote access | Local network only, security concerns |
| Multi-broker support | Single Mosquitto instance sufficient for target use case |
| Mosquitto configuration via webapp | Broker config stays file-based to avoid complexity |
| Mobile app | Web-first, responsive design covers mobile use |
| Rule engine / automation | Not competing with Node-RED or Home Assistant |
| Historical data storage / database | Real-time only, no persistence beyond ring buffer |
| MQTT broker replacement | Complements Mosquitto, doesn't replace it |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| *(populated during roadmap creation)* | | |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 0
- Unmapped: 29

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after initial definition*
