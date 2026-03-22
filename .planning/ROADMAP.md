# Roadmap: MQTT Master

## Overview

MQTT Master delivers a self-hosted MQTT broker dashboard and smart home bridge in six phases. The first three phases validate the full stack (server, frontend, MQTT client) with zero external dependencies beyond Mosquitto, producing a useful standalone dashboard. Phase 4 introduces the plugin framework, Phase 5 builds the Loxone bridge (the primary differentiator and highest-risk component), and Phase 6 packages everything into a one-command installer for Debian.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Webapp Shell and Core Services** - Fastify server, Preact SPA with Venus OS dark theme, MQTT service connected to Mosquitto, config service (completed 2026-03-22)
- [x] **Phase 2: Broker Dashboard** - Real-time broker metrics display from $SYS topics with auto-refreshing widgets (completed 2026-03-22)
- [x] **Phase 3: Live Message Viewer** - Subscribe to topics and watch messages arrive in real-time with filtering (completed 2026-03-22)
- [x] **Phase 4: Plugin System** - Plugin lifecycle management, dynamic config UI, and sidebar status indicators (completed 2026-03-22)
- [ ] **Phase 5: Loxone Bridge Plugin** - Bidirectional Loxone-MQTT bridge with auto-discovery, basic auth, and human-readable topics
- [ ] **Phase 6: Installer and Deployment** - One-command Debian installer with systemd service and idempotent updates

## Phase Details

### Phase 1: Webapp Shell and Core Services
**Goal**: Users can open the webapp in a browser and see a fully styled, responsive shell with sidebar navigation -- the foundation every subsequent phase builds on
**Depends on**: Nothing (first phase)
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. User can open the webapp in a browser and see the Venus OS dark theme with sidebar navigation
  2. Webapp layout adapts correctly across desktop, tablet, and mobile screen sizes
  3. Webapp loads without authentication prompts (open LAN access)
  4. Switching between sidebar navigation items changes the visible page content
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md -- Backend scaffold: Fastify server, config service, MQTT service, vendored deps, tests
- [x] 01-02-PLAN.md -- Frontend SPA: Venus OS theme, sidebar navigation, hash routing, responsive layout

### Phase 2: Broker Dashboard
**Goal**: Users can monitor their Mosquitto broker health at a glance with live-updating metrics
**Depends on**: Phase 1
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08
**Success Criteria** (what must be TRUE):
  1. User can see connected client count, message rates, subscription count, memory usage, and load averages updating in real-time without page refresh
  2. User can see broker version and uptime displayed on the dashboard
  3. User can see a visual indicator (colored dot) showing whether the broker connection is live or disconnected
  4. User can browse a hierarchical topic tree showing all active MQTT topics
  5. Dashboard metrics reflect actual Mosquitto $SYS values within seconds of change
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md -- Backend: SysBrokerService for $SYS aggregation, WebSocket /ws/dashboard endpoint, tests
- [x] 02-02-PLAN.md -- Frontend: Dashboard stat cards, broker info, topic tree, StatusDot wiring, visual verification

### Phase 3: Live Message Viewer
**Goal**: Users can subscribe to any MQTT topic and watch messages flow in real-time, with filtering and scrollback
**Depends on**: Phase 2
**Requirements**: LIVE-01, LIVE-02, LIVE-03, LIVE-04, LIVE-05
**Success Criteria** (what must be TRUE):
  1. User can enter a topic pattern and see matching MQTT messages appear in real-time with topic, payload, and timestamp
  2. User can filter the displayed message stream by topic pattern to focus on specific topics
  3. User can scroll back through previously received messages (ring buffer of recent messages)
  4. User can clear the message display to start fresh
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md -- Backend: WebSocket /ws/messages route with per-client topic subscriptions, MqttService.unsubscribe, tests
- [x] 03-02-PLAN.md -- Frontend: Messages page UI with subscription controls, message list, filter, clear, rate counter, visual verification

### Phase 4: Plugin System
**Goal**: Users can manage third-party integration plugins through the webapp -- see their status, configure them, and control their lifecycle
**Depends on**: Phase 3
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05
**Success Criteria** (what must be TRUE):
  1. User can see each plugin's status (running/stopped/error) in the webapp sidebar
  2. User can configure a plugin through an auto-generated form derived from the plugin's config schema
  3. User can start and stop individual plugins from the webapp
  4. User can reload a plugin without restarting the entire application
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md -- Backend: PluginManager service, REST API routes, example plugin, ConfigService.set/save, tests
- [x] 04-02-PLAN.md -- Frontend: Sidebar plugin list with status dots, plugin config page with auto-generated form, lifecycle buttons

### Phase 5: Loxone Bridge Plugin
**Goal**: Users can bridge their entire Loxone Miniserver into MQTT with human-readable topics, zero manual mapping, and bidirectional control
**Depends on**: Phase 4
**Requirements**: LOX-01, LOX-02, LOX-03, LOX-04, LOX-05, LOX-06, LOX-07, LOX-08, LOX-09, LOX-10, LOX-11, LOX-12, LOX-13
**Success Criteria** (what must be TRUE):
  1. After entering Miniserver IP and credentials in the webapp, the plugin connects and auto-discovers all Loxone controls without manual configuration
  2. Loxone state changes appear as MQTT messages with human-readable topics (loxone/{room}/{control}) and JSON payloads containing value, name, type, UUID, and room
  3. User can send MQTT commands that are forwarded to Loxone controls (bidirectional operation)
  4. User can view the UUID-to-name mapping table in the webapp and enable/disable individual controls from being bridged
  5. Home Assistant auto-detects bridged Loxone devices via MQTT Discovery messages
  6. User can create topic routes in the webapp to forward payloads between external MQTT topics and Loxone topics (both directions)
**Plans**: 3 plans

Plans:
- [ ] 05-01-PLAN.md -- Loxone WebSocket client with binary protocol parser, LoxAPP3.json structure parser with UUID-to-topic mapping
- [ ] 05-02-PLAN.md -- Loxone bridge plugin composing WS client + structure parser into bidirectional MQTT bridge with HA Discovery
- [ ] 05-03-PLAN.md -- Loxone controls table UI with enable/disable, topic routes configuration page, sidebar sub-navigation

### Phase 6: Installer and Deployment
**Goal**: Users can install and update MQTT Master on Debian with a single command, and it runs automatically as a system service
**Depends on**: Phase 5
**Requirements**: DEP-01, DEP-02, DEP-03, DEP-04, DEP-05
**Success Criteria** (what must be TRUE):
  1. User can run a single wget command on a fresh Debian/Ubuntu system and have MQTT Master fully installed and running
  2. Installer configures Mosquitto with open LAN access and WebSocket support if not already configured
  3. MQTT Master starts automatically on boot via systemd and restarts on failure
  4. Running the same install command again updates to the latest version without breaking the existing installation
**Plans**: 2 plans

Plans:
- [ ] 06-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Webapp Shell and Core Services | 2/2 | Complete   | 2026-03-22 |
| 2. Broker Dashboard | 2/2 | Complete   | 2026-03-22 |
| 3. Live Message Viewer | 2/2 | Complete   | 2026-03-22 |
| 4. Plugin System | 2/2 | Complete   | 2026-03-22 |
| 5. Loxone Bridge Plugin | 0/3 | Not started | - |
| 6. Installer and Deployment | 0/? | Not started | - |
