# Phase 2: Broker Dashboard - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Real-time broker dashboard displaying Mosquitto $SYS metrics with live-updating stat cards, broker info, connection status, and a hierarchical topic tree. Backend subscribes to `$SYS/#`, aggregates state, and pushes updates to the frontend via WebSocket. Frontend replaces the Phase 1 Dashboard placeholder with actual metric widgets. No live message viewer (Phase 3), no plugins (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Dashboard Layout
- Card-based grid using `.ve-grid` and `.ve-card` from Phase 1 theme
- Top row: stat cards for key metrics — Connected Clients, Messages/sec (received + sent rates), Active Subscriptions, Memory Usage, Load Averages (1/5/15 min)
- Second section: Broker Info panel — version string, uptime (human-readable), received/sent totals
- Third section: Topic Tree — collapsible hierarchical view of all `$SYS` topics
- Stat cards show the value in large font (28-32px) with a dim label below (12-14px), matching Venus OS PV Inverter Proxy card style
- All cards use `--ve-bg-widget` (#11263B) background

### Connection Status Indicator (DASH-07)
- The sidebar already has a StatusDot component rendered with `status="disconnected"` (hardcoded in Phase 1)
- Phase 2 wires this to real state: the backend pushes connection status over WebSocket, frontend updates the StatusDot to `connected` (green) or `disconnected` (red)
- No separate dashboard indicator needed — the sidebar dot IS the indicator, visible on every page

### Data Flow: Backend
- On server startup, MqttService subscribes to `$SYS/#`
- A new `SysBrokerService` (or equivalent module in `server/services/`) listens to MqttService `message` events, filters `$SYS/` topics, and maintains an aggregated state object
- The state object maps $SYS topic paths to their latest values, parsed as numbers where applicable
- A WebSocket route (e.g., `/ws/dashboard`) is registered on Fastify using `@fastify/websocket`
- When the broker state changes, the backend sends a JSON message to all connected WebSocket clients with the updated state
- On WebSocket client connect, send the full current state immediately so the dashboard populates instantly

### Data Flow: Frontend
- Dashboard page opens a WebSocket connection to `/ws/dashboard` on mount
- Incoming state updates are stored in Preact signals, triggering reactive re-renders of stat cards
- WebSocket reconnect logic: if the connection drops, retry with exponential backoff (1s, 2s, 4s, max 30s)
- On unmount (page navigation away), close the WebSocket connection cleanly

### $SYS Topics to Track
Key Mosquitto $SYS topics consumed by the dashboard:

| Metric | $SYS Topic | Display |
|--------|-----------|---------|
| Connected clients | `$SYS/broker/clients/connected` | Integer |
| Messages received | `$SYS/broker/messages/received` | Integer total |
| Messages sent | `$SYS/broker/messages/sent` | Integer total |
| Publish received/sec | `$SYS/broker/load/publish/received/1min` | Rate (msgs/sec) |
| Publish sent/sec | `$SYS/broker/load/publish/sent/1min` | Rate (msgs/sec) |
| Active subscriptions | `$SYS/broker/subscriptions/count` | Integer |
| Heap current | `$SYS/broker/heap/current` | Bytes, formatted as KB/MB |
| Heap maximum | `$SYS/broker/heap/maximum` | Bytes, formatted as KB/MB |
| Load 1min | `$SYS/broker/load/messages/received/1min` | Float |
| Load 5min | `$SYS/broker/load/messages/received/5min` | Float |
| Load 15min | `$SYS/broker/load/messages/received/15min` | Float |
| Broker version | `$SYS/broker/version` | String |
| Uptime | `$SYS/broker/uptime` | Seconds, formatted as "Xd Xh Xm" |

### Hierarchical Topic Tree (DASH-08)
- Built from all `$SYS/#` topics received by the backend
- Displayed as a collapsible tree on the dashboard page (below the stat cards), not a separate page
- Each leaf node shows the topic path segment and its current value
- Branch nodes (e.g., `$SYS/broker/load/`) are expandable/collapsible, default collapsed except the first level
- Tree updates reactively as new $SYS values arrive
- Simple CSS-based expand/collapse with a toggle arrow, no external tree library

### Update Frequency
- Mosquitto publishes `$SYS` topics every ~10 seconds by default (configurable via `sys_interval` in mosquitto.conf)
- The backend pushes changes to WebSocket clients immediately on receipt — no additional polling or throttling
- Frontend updates are reactive via signals, so the UI re-renders only the changed values
- Debounce: the backend may receive a batch of $SYS updates within the same second; accumulate for 500ms before pushing to avoid flooding WebSocket with per-topic messages

### Venus OS Design Consistency
- Stat cards: dark blue cards (`--ve-bg-widget`) with large white value text and dim label below
- Topic tree: uses `--ve-bg-surface` panel style with monospace font for topic paths
- Page header "Dashboard" stays as-is from Phase 1
- Responsive: stat card grid reflows from 4-5 columns on desktop to 2 columns on tablet to 1 on mobile (already handled by `.ve-grid` minmax)
- No new colors or design tokens needed — everything uses the Phase 1 theme

### WebSocket Message Format
Backend sends JSON over WebSocket:
```json
{
  "type": "sys_state",
  "data": {
    "clients_connected": 3,
    "messages_received": 1542,
    "messages_sent": 890,
    "publish_received_1min": 2.4,
    "publish_sent_1min": 1.8,
    "subscriptions_count": 12,
    "heap_current": 524288,
    "heap_maximum": 1048576,
    "load_received_1min": 5.2,
    "load_received_5min": 4.1,
    "load_received_15min": 3.8,
    "version": "mosquitto version 2.0.18",
    "uptime": 86400
  },
  "topics": {
    "$SYS": {
      "broker": {
        "clients": { "connected": "3" },
        "messages": { "received": "1542", "sent": "890" }
      }
    }
  }
}
```
- `data`: flattened, parsed metrics for stat cards (numbers, not strings)
- `topics`: raw hierarchical tree structure for the topic tree view (string values, mirrors $SYS hierarchy)
- `type`: message type discriminator for future extensibility (Phase 3 will add `live_message` type)

Connection status message:
```json
{ "type": "connection_status", "connected": true }
```

### Claude's Discretion
- Exact stat card ordering and grouping within the grid
- Whether load averages are shown as a single card with three values or three separate cards
- Topic tree expand/collapse animation style
- Whether uptime formatting includes seconds or stops at minutes
- Error states for individual metrics (e.g., if a $SYS topic hasn't been received yet, show "--" or "N/A")
- Whether to show a "Last updated" timestamp on the dashboard

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### From Phase 1
- `webapp/css/theme.css` — Venus OS design tokens, card classes (`.ve-card`, `.ve-panel`, `.ve-grid`), status dot styles
- `webapp/js/components/sidebar.js` — Sidebar with StatusDot (currently hardcoded `status="disconnected"`, needs wiring)
- `webapp/js/components/status-dot.js` — StatusDot component accepting `status` prop (connected/disconnected/error)
- `webapp/js/pages/dashboard.js` — Placeholder page to be replaced with real dashboard
- `webapp/js/app.js` — Root app with hash router, signals, route map
- `webapp/index.html` — Import map for vendored Preact/HTM/Signals modules
- `server/index.js` — Fastify server with `@fastify/websocket` already registered, MqttService decorated on app
- `server/services/mqtt-service.js` — MqttService with subscribe/publish/message events, connection state tracking
- `server/services/config-service.js` — ConfigService for reading config values
- `config/default.json` — Default config (mqtt.broker, web.port, logLevel)

### Design System
- `.planning/PROJECT.md` §Context — Venus OS Dark Theme color palette
- `.planning/phases/01-webapp-shell-and-core-services/01-CONTEXT.md` — Theme reference details

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **MqttService** (`server/services/mqtt-service.js`): Already has `subscribe()`, `message` event emission, and `isConnected()`. Phase 2 calls `subscribe('$SYS/#')` and listens for messages.
- **StatusDot** (`webapp/js/components/status-dot.js`): Ready to accept dynamic status prop. Currently hardcoded in sidebar — needs to be driven by a signal.
- **Theme CSS** (`webapp/css/theme.css`): `.ve-card`, `.ve-panel`, `.ve-grid` classes ready for dashboard cards. Status dot styles for connected/disconnected/error already defined.
- **Fastify WebSocket** (`@fastify/websocket`): Already registered in `server/index.js`, just needs route handlers.

### Established Patterns
- **Service classes** decorated on Fastify app (`app.mqttService`, `app.configService`) — new SysBrokerService follows same pattern
- **Preact signals** for shared state across components — dashboard metrics will use signals
- **One component per file** in `webapp/js/components/` and `webapp/js/pages/`
- **HTM tagged templates** for JSX-like rendering without build step
- **Vendored modules** via import map — no npm packages on the frontend

### Integration Points
- `server/index.js` line 32-33: `mqttService.connect()` then `app.decorate('mqttService', mqttService)` — SysBrokerService receives mqttService as dependency
- `server/index.js` line 29: `app.register(fastifyWebSocket)` — WebSocket routes can be added after this
- `webapp/js/app.js` line 23-26: Route map — Dashboard component import is already wired, just needs the component itself to change
- `webapp/js/components/sidebar.js` line 42: `<${StatusDot} status="disconnected" />` — needs to become signal-driven

</code_context>

<deferred>
## Deferred Ideas

- **Per-client statistics** (ADVD-02) — v2 feature, not Phase 2 scope
- **Message rate charts over time** (ADVD-01) — v2 feature, would add sparklines or mini charts to stat cards
- **$SYS topic filtering in topic tree** — search/filter within the tree, can be added later if tree gets large
- **Dashboard layout customization** — drag-to-reorder cards, user preference storage; not needed for v1
- **Configurable $SYS update interval** — could expose `sys_interval` tuning in settings; Mosquitto config stays file-based per project constraints

</deferred>

---

*Phase: 02-broker-dashboard*
*Context gathered: 2026-03-22*
