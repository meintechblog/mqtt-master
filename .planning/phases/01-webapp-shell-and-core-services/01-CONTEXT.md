# Phase 1: Webapp Shell and Core Services - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Fastify server serving a Preact/HTM SPA (no-build) with Venus OS dark theme, sidebar navigation, hash routing, MQTT service connected to Mosquitto, and config service. This phase delivers the foundation every subsequent phase builds on. No dashboard data, no live messages, no plugins — just the shell and core services.

</domain>

<decisions>
## Implementation Decisions

### Sidebar Navigation
- Grouped sections: "Broker" (Dashboard, Live Messages), "Plugins" (dynamic entries), "System" (Settings if needed)
- Broker connection status dot (green/red) in sidebar header
- Plugin status dots next to each plugin nav entry (running/stopped/error)
- Always visible on desktop, hamburger menu on mobile (consistent with PV Inverter Proxy)

### Page Structure
- Hash routing: `/#/dashboard`, `/#/messages`, `/#/plugins/loxone`
- Each page fills the entire content area with its own layout
- Preact components rendered based on hash route

### Config Management
- Config file at `/opt/mqtt-master/config.json`
- Configurable in v1: MQTT broker address, web port, log level, plugin directory, topic prefix
- Defaults baked into code, config file overrides
- Config loaded at startup, plugins manage their own config within the plugin directory

### Project Layout & Entry Point

#### Claude's Discretion
- Directory structure (flat vs nested — Claude picks best fit for a small Node.js app with plugin system)
- Entry point approach (single `server.js` vs `npm start`)
- Exact spacing, typography, and animation details beyond the Venus OS design tokens
- Error state handling for the shell (MQTT disconnect, config errors)
- Whether sidebar is collapsible on desktop (Claude picks based on content density)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design System
- `.planning/research/STACK.md` — Technology choices: Fastify 5, Preact + HTM, mqtt.js, no-build frontend
- `.planning/research/ARCHITECTURE.md` — Component boundaries, data flow, 6-layer architecture
- `.planning/PROJECT.md` §Context — Venus OS Dark Theme color palette and design tokens

### Venus OS Theme Reference (from PV Inverter Proxy at 192.168.3.191)
- Backgrounds: `#141414` (main), `#272622` (surface/sidebar), `#11263B` (widget/cards)
- Colors: Blue `#387DC5`, Orange `#F0962E`, Red `#F35C58`, Green `#72B84C`
- Text: `#FAF9F5` (primary), `#969591` (dim), `#DCDBD7` (secondary)
- Border: `#64635F`, Radius: `12px` / `6px`
- Font: system stack (-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)
- Mono: 'Courier New', monospace
- Sidebar: 220px width, nav items with 3px left border on active, blue-dim active background
- Cards: `.ve-card` with `#11263B` bg, `.ve-panel` with `#272622` bg
- Grid: `repeat(auto-fit, minmax(180px, 1fr))` with 12px gap
- Responsive: sidebar collapses to hamburger at 768px

### Research
- `.planning/research/PITFALLS.md` — Pitfalls for WebSocket management, plugin architecture

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code beyond install script

### Established Patterns
- `scripts/install.sh` — Establishes `/opt/mqtt-master/` as install path, `mqtt-master` as service user, systemd service pattern
- `scripts/mqtt-master.service` — WorkingDirectory is `/opt/mqtt-master/webapp` — implies webapp code lives there

### Integration Points
- Mosquitto broker already running on localhost:1883 (MQTT) and localhost:9001 (WebSocket)
- systemd service expects entry point in `/opt/mqtt-master/webapp/`
- Install script clones repo to `/opt/mqtt-master/` and creates venv (needs updating for Node.js)

</code_context>

<specifics>
## Specific Ideas

- App should look like it belongs to the same suite as PV Inverter Proxy (192.168.3.191) — same sidebar pattern, same card styles, same dark theme
- MQTT network icon (nodes connected by lines) as sidebar logo, not a generic icon
- The existing install script needs updating from Python/Flask to Node.js in Phase 6

</specifics>

<deferred>
## Deferred Ideas

- Loxone Miniserver auto-discovery in LAN (scan for Miniservers instead of manual IP entry) — Phase 5 enhancement
- MQTT topic routing (forward payloads between arbitrary topics) — already captured as LOX-11/12/13

</deferred>

---

*Phase: 01-webapp-shell-and-core-services*
*Context gathered: 2026-03-22*
