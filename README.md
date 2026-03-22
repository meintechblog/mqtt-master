# MQTT Master

A self-hosted MQTT broker dashboard and smart home bridge for Debian/Ubuntu.

MQTT Master provides a real-time web interface for monitoring your Mosquitto MQTT broker and bridges non-MQTT smart home systems into MQTT through a plugin architecture. The first plugin integrates the Loxone Miniserver bidirectionally.

## Features

- **Broker Dashboard** -- real-time metrics (clients, messages, subscriptions, memory, uptime)
- **Live Message Viewer** -- subscribe to topics, watch messages flow with filtering
- **Hierarchical Topic Tree** -- browse all active MQTT topics
- **Loxone Miniserver Bridge** -- bidirectional with auto-discovery and human-readable topics
- **Loxone Elements** -- live status view of all Loxone controls with On/Off testing and MQTT topic overview
- **MQTT Input Bindings** -- guided wizard to feed external MQTT data (e.g. PV inverter) into Loxone Virtual Inputs
- **Home Assistant Discovery** -- automatic device detection via MQTT Discovery
- **Auto-Reconnect** -- WebSocket reconnect with token re-auth, structure change detection, stale topic cleanup
- **Venus OS Dark Theme** -- consistent with PV Inverter Proxy UI
- **No database** -- JSON config + in-memory state

## Installation

One command installs everything on a fresh Debian 12+ or Ubuntu 22.04+ system:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/scripts/install.sh | bash
```

This handles:

- Node.js 20 LTS (installs or upgrades if needed)
- Mosquitto MQTT broker (port 1883 + WebSocket on 9001, anonymous LAN access)
- Clones the repository to `/opt/mqtt-master/`
- Node.js dependencies
- systemd service with auto-restart

After installation:

```
http://<your-server-ip>:3000
```

## Updating

Run the same command:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/scripts/install.sh | bash
```

Your `config.json` is preserved. The installer pulls the latest code, reinstalls dependencies, and restarts the service.

## Loxone Bridge

The Loxone plugin bridges your Miniserver into MQTT with zero manual mapping.

### Setup

1. Open the web UI, navigate to **Loxone** in the sidebar
2. Configure your Miniserver connection (IP, port, username, password)
3. Click **Start**

The plugin auto-discovers all controls and publishes them with human-readable topics:

```
loxone/{room}/{control}/state      -- outgoing state updates (JSON)
loxone/{room}/{control}/cmd        -- incoming commands
loxone/bridge/status               -- online/offline
```

### Loxone Elements

The **Elements** page shows all Loxone controls with:

- Live values updated every 2 seconds
- Room, category, and type for each element
- On/Off push buttons for testing switches and dimmers
- Click any element to see its MQTT topics with direction indicators (outgoing/incoming)
- Filter by room, category, type, or free text search

### MQTT Input Bindings

Feed external MQTT data into Loxone controls (e.g. PV inverter power into a Loxone Meter element):

1. Go to **Input Bindings** and click **+ New Binding**
2. **Scan** a topic pattern (e.g. `pv-inverter-proxy/#`) to discover available devices
3. **Pick a field** from the JSON payload (e.g. `ac_power_w`)
4. **Select a Loxone target** (e.g. a Virtual Input connected to a Meter)
5. **Choose a transform** (e.g. W to kW) and save

Bindings send values instantly on change and resend every 30s as keepalive. Already-bound targets are greyed out to prevent duplicates.

### Structure Change Detection

The plugin checks the Miniserver structure every 60 seconds. When controls are renamed, added, or removed:

- Old retained MQTT messages are automatically cleaned up
- New topics are published immediately
- Home Assistant Discovery is refreshed

## Configuration

Config file: `/opt/mqtt-master/config.json`

| Setting | Default | Description |
|---------|---------|-------------|
| `mqtt.broker` | `mqtt://localhost:1883` | MQTT broker URL |
| `web.port` | `3000` | Web dashboard port |
| `logLevel` | `info` | Log level (trace, debug, info, warn, error) |
| `pluginDir` | `plugins/` | Plugin directory |

Loxone plugin settings are managed through the web UI and stored in `config.json` under `plugins.loxone`. Passwords are encrypted at rest.

## Plugin System

Plugins live in `plugins/{name}/plugin.js` and export a class with:

```javascript
export default class MyPlugin {
  async start(context) { }   // context: { mqttService, configService, logger }
  async stop() { }
  getStatus() { }
  getConfigSchema() { }      // JSON Schema for auto-generated config UI
}
```

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
- **No database**: JSON files + in-memory state

## License

ISC
