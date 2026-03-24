# MQTT Master

A self-hosted MQTT broker dashboard and smart home bridge for Debian/Ubuntu.

MQTT Master provides a real-time web interface for monitoring your Mosquitto MQTT broker and bridges non-MQTT smart home systems into MQTT through an extensible plugin architecture.

## Features

### Dashboard
- Real-time metrics with sparkline trend charts (receive/send rate, clients, uptime)
- Live activity bar showing IN/OUT message throughput
- Plugin overview with status indicators and message counts
- Auto-updating every 2 seconds

### Live Messages
- **Stream view**: subscribe to topic patterns, watch messages flow in real-time with filtering
- **Topic Browser**: auto-discovered tree view of all broker topics with live values
- **Inline binding creation**: click any topic to create an Input Binding directly

### Plugin System
- Add/remove plugins from the web UI (no filesystem access needed)
- Custom display names per plugin instance
- Multiple instances of the same plugin type
- Plugin templates: Loxone, MQTT-Bridge (extensible)
- Connection status indicators (green/orange/red dots)
- Message rate display per plugin

### Loxone Miniserver Bridge
- Bidirectional bridge with auto-discovery from LoxAPP3.json
- Human-readable MQTT topics: `loxone/{room}/{control}/state`
- Token-based authentication (firmware v16.x)
- Elements page with live values, On/Off testing, MQTT topic inspector
- Direction indicators showing data flow (outgoing/incoming)
- Structure change detection (auto-cleanup on rename/remove)
- Home Assistant auto-detection via MQTT Discovery
- Grouped by category and room with search/filter

### MQTT-Bridge (External Broker)
- Connect to any external MQTT broker (designed for Venus OS / Victron Energy)
- Auto-detects Venus OS portal ID
- Smart republishing: only forwards changed values, 30s keepalive for unchanged
- Reduces broker traffic by ~92% compared to naive bridging
- Elements page with collapsible category tree and live values

### Input Bindings
- Feed external MQTT data into Loxone controls via WebSocket
- 4-step guided wizard: Discover topics → Pick field → Select target → Configure
- Smart throttling: instant on value change, configurable keepalive
- Auto-suggest transforms (e.g. W → kW)
- Per-plugin binding storage (Loxone and MQTT-Bridge have separate bindings)
- Already-bound targets greyed out to prevent duplicates
- Editable: change label, transform, keepalive on existing bindings

### General
- Venus OS-inspired dark theme (consistent with PV Inverter Proxy)
- Responsive design (desktop, tablet, mobile)
- No database — JSON config + in-memory state
- Passwords encrypted at rest (AES-256-CBC)
- Auto-reconnect for all WebSocket connections
- No authentication required (trusted LAN)

## Installation

One command on a fresh Debian 12+ or Ubuntu 22.04+ system:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/scripts/install.sh | bash
```

This installs:
- Node.js 20 LTS
- Mosquitto MQTT broker (port 1883 + WebSocket 9001, anonymous LAN access)
- MQTT Master as systemd service with auto-restart

After installation: `http://<your-server-ip>:3000`

## Updating

Same command — detects existing installation, pulls latest code, preserves config:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/scripts/install.sh | bash
```

## Quick Start

1. Open the dashboard at `http://<server-ip>:3000`
2. Click the **+** button next to "Plugins" in the sidebar
3. Choose **Loxone** or **MQTT-Bridge**, give it a name
4. Configure connection details and click **Start**

### Loxone Setup
1. Add a Loxone plugin, enter Miniserver IP, port, username, password
2. Start the plugin — controls are auto-discovered
3. Browse **Elements** to see live values and test On/Off
4. Use **Input Bindings** to feed external data (PV inverters, energy meters) into Loxone

### MQTT-Bridge Setup (Venus OS)
1. Add an MQTT-Bridge plugin, enter the external broker URL (e.g. `mqtt://192.168.1.100:1883`)
2. Set subscribe topic to `N/#` (for Venus OS) and local prefix to `venus`
3. Start — all topics are bridged to `venus/...` on your local broker
4. Use **Input Bindings** to forward Venus OS data to Loxone controls

## Configuration

Config file: `/opt/mqtt-master/config.json`

| Setting | Default | Description |
|---------|---------|-------------|
| `mqtt.broker` | `mqtt://localhost:1883` | Local MQTT broker URL |
| `web.port` | `3000` | Web dashboard port |
| `logLevel` | `info` | Log level (trace, debug, info, warn, error) |
| `pluginDir` | `plugins/` | Plugin directory |

Plugin settings are managed through the web UI and stored under `plugins.*` in config.json. Passwords are automatically encrypted.

## Plugin Development

Plugins live in `plugins/{name}/plugin.js` and export a default class:

```javascript
export default class MyPlugin {
  async start(context) { }   // context: { mqttService, configService, logger, pluginManager }
  async stop() { }
  getStatus() { }            // return { running, connected, messageCount, ... }
  getConfigSchema() { }      // JSON Schema → auto-generated config form
}
```

Shared utilities available in `plugins/lib/`:
- `binding-utils.js` — input binding execution, field extraction, transforms

## Service Management

```bash
systemctl status mqtt-master
systemctl restart mqtt-master
journalctl -u mqtt-master -f       # live logs
journalctl -u mqtt-master -n 50    # recent logs
```

## Development

```bash
git clone https://github.com/meintechblog/mqtt-master.git
cd mqtt-master
npm install
npm run dev
npm test
./scripts/deploy-vm.sh             # deploy to test VM
```

## Tech Stack

- **Backend**: Node.js 20, Fastify 5, mqtt.js, ws
- **Frontend**: Preact + HTM (no build step), Preact Signals
- **Styling**: CSS custom properties (Venus OS Dark Theme)
- **MQTT Broker**: Mosquitto
- **Storage**: JSON config files, in-memory state, no database

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Web Browser (Preact SPA, no build step)        │
│  Dashboard │ Messages │ Elements │ Bindings     │
└──────────────┬──────────────────────────────────┘
               │ WebSocket + REST API
┌──────────────┴──────────────────────────────────┐
│  Fastify Server                                  │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │ MQTT Service │  │ Plugin Manager           │  │
│  │ (mqtt.js)   │  │  ├─ Loxone Plugin        │  │
│  │             │  │  │  (WS to Miniserver)    │  │
│  │             │  │  ├─ MQTT-Bridge Plugin    │  │
│  │             │  │  │  (external broker)     │  │
│  │             │  │  └─ ... more plugins      │  │
│  └──────┬──────┘  └──────────────────────────┘  │
└─────────┼───────────────────────────────────────┘
          │
┌─────────┴───────────┐
│  Mosquitto Broker    │
│  Port 1883 + WS 9001│
└─────────────────────┘
```

## License

ISC
