# MQTT Master

## What This Is

MQTT Master is a web dashboard and plugin system for the Mosquitto MQTT broker, designed for home automation enthusiasts. It provides real-time broker monitoring and bridges third-party smart home systems (that lack native MQTT support) into the MQTT ecosystem via a plugin architecture. The first plugin integrates the Loxone Miniserver bidirectionally. It runs on Debian as a self-hosted service, installable via a single command.

## Core Value

Bridge non-MQTT smart home systems into the MQTT world through an extensible plugin system, making every device controllable and monitorable via standard MQTT topics.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Real-time Mosquitto broker status dashboard (clients, messages, subscriptions, memory, load)
- [ ] Live MQTT message viewer with topic filter and WebSocket connection
- [ ] Plugin system architecture for third-party integrations
- [ ] Loxone Miniserver plugin: bidirectional bridge via WebSocket API
- [ ] Loxone Auto-Discovery: automatically publish all Loxone controls as MQTT topics
- [ ] Loxone Token-Auth: authenticate once, use token for subsequent connections
- [ ] Human-readable MQTT topic structure (loxone/{room}/{control}) with UUIDs internally mapped
- [ ] JSON payloads for Loxone status changes (value, name, type, UUID, room)
- [ ] Loxone plugin configuration UI in webapp (Miniserver IP, credentials, topic prefix)
- [ ] Dark theme UI consistent with Venus OS design system (PV Inverter Proxy suite)
- [ ] Responsive design (desktop, tablet, mobile)
- [ ] One-command installer/updater for Debian via wget
- [ ] systemd service with auto-start
- [ ] No webapp authentication required (open LAN access)

### Out of Scope

- Webapp authentication/login — open LAN access like the broker itself
- Cloud/remote access — local network only
- KNX IP Gateway plugin — planned for later, not v1
- Multi-broker support — single Mosquitto instance only
- MQTT broker configuration via webapp — Mosquitto config stays file-based
- Mobile app — web-only

## Context

- **Target VM:** Debian 13 (Trixie) on mqtt-master.local / 192.168.3.213
- **Mosquitto** is already installed and running: port 1883 (MQTT) + 9001 (WebSocket), anonymous access
- **GitHub repo:** meintechblog/mqtt-master (public), already initialized with installer script and Mosquitto config
- **Design reference:** PV Inverter Proxy at 192.168.3.191 — Venus OS Dark Theme palette:
  - Backgrounds: `#141414` (main), `#272622` (surface/sidebar), `#11263B` (widget/cards)
  - Colors: Blue `#387DC5`, Orange `#F0962E`, Red `#F35C58`, Green `#72B84C`
  - Text: `#FAF9F5` (primary), `#969591` (dim), `#DCDBD7` (secondary)
  - Sidebar navigation, card system, grid metrics layout, responsive breakpoints
  - Both apps should look like they belong to the same suite
- **Loxone Miniserver:** Accessible via WebSocket API on LAN, Token-based auth (firmware 10.2+)
- **Future plugin:** KNX IP Gateway (not in scope for v1)
- **Community project:** Everything documented, public repo, easy to install and contribute

## Constraints

- **OS:** Debian/Ubuntu (installer targets apt-based systems)
- **Design:** Must match Venus OS Dark Theme from PV Inverter Proxy exactly
- **Network:** LAN-only, no internet dependency for operation
- **Auth:** No webapp auth — trust the LAN
- **Deployment:** Single command install + update via wget from GitHub raw
- **Broker:** Mosquitto $SYS topics for monitoring, WebSocket for live messages

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tech stack left open | Research should determine best fit for MQTT bridge + web dashboard | — Pending |
| Token-Auth for Loxone | More secure than persistent user/password, modern approach | — Pending |
| Human-readable MQTT topics | Better usability for other MQTT clients, UUIDs mapped internally | — Pending |
| JSON payloads for Loxone | Structured data with full context (value, name, type, UUID, room) | — Pending |
| Auto-Discovery for Loxone controls | Minimal config needed, user doesn't have to manually map controls | — Pending |
| Venus OS Dark Theme | Consistent look with existing PV Inverter Proxy, suite feel | — Pending |
| No webapp auth | Same philosophy as the broker itself — trusted LAN environment | — Pending |

---
*Last updated: 2026-03-22 after initialization*
