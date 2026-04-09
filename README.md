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
- **Presets**: pre-configured templates for common devices (e.g. Venus OS)
- Custom display names per plugin instance
- Multiple instances of the same plugin type (e.g. two Loxone Miniservers)
- Plugin templates: Loxone, MQTT-Bridge (extensible)
- Connection status indicators (green/orange/red dots)
- Message rate display per plugin
- Auto-start: plugins restart automatically on server reboot

### Loxone Miniserver Bridge
- Bidirectional bridge with auto-discovery from LoxAPP3.json
- Human-readable MQTT topics: `loxone/{room}/{control}/state`
- **UUID-based stable topics**: `loxone/by-uuid/{uuid}/cmd` — survive control renames in Loxone Config
- Proper German umlaut handling: ä→ae, ö→oe, ü→ue, ß→ss
- Token-based authentication (firmware v16.x)
- **Elements page** with live values, copy-to-clipboard on all topics, search/filter
- **Inline command testing**: dropdown with all available commands per control type, instant trigger
  - Switch: On, Off, Pulse
  - Dimmer: On, Off, +, −
  - LightControllerV2: Stimmung +/−, changeTo/{name}, On, Off
  - Jalousie: Up, Down, Full Up/Down, Stop
  - Gate, Alarm, IRoomController, Ventilation: type-specific commands
- **Mood Mapping** for LightControllerV2: configurable mood ID → name resolution
  - Fixed grid of all 35 mood slots (IDs -1, 1-31, 777, 778) — just fill in names
  - Locked system moods: Manuell (-1), Viel Licht (777), Aus (778)
  - Default mappings (Nacht, Abend, Tag) + per-controller overrides via web UI
  - `changeTo/{name}` commands auto-translated to IDs (e.g. changeTo/Studio → changeTo/31)
  - Active mood name published as `loxone/{room}/{control}/mood/state`
  - Unsaved changes warning on navigation with Save/Discard buttons
- Direction indicators showing data flow (outgoing/incoming)
- Structure change detection (auto-cleanup on rename/remove)
- Home Assistant auto-detection via MQTT Discovery
- Grouped by category and room with search/filter

### MQTT-Bridge (External Broker)
- Connect to any external MQTT broker
- **Venus OS preset**: pre-configured topic filter (`N/#`), local prefix, keepalive
- Auto-detects Venus OS portal ID
- Smart republishing: only forwards changed values, 30s keepalive for unchanged
- Bare IP auto-fix: entering `192.168.1.100` automatically becomes `mqtt://192.168.1.100:1883`
- Elements page with collapsible category tree and live values

### Input Bindings
- Feed external MQTT data into plugin controls
- 4-step guided wizard: Discover topics → Pick field → Select target → Configure
- Smart throttling: instant on value change, configurable keepalive
- Auto-suggest transforms (e.g. W → kW)
- Per-plugin binding storage
- Already-bound targets greyed out to prevent duplicates
- Editable: change label, transform, keepalive on existing bindings

### General
- Venus OS-inspired dark theme
- Responsive design (desktop, tablet, mobile)
- No database — JSON config + in-memory state
- Passwords encrypted at rest (AES-256-CBC)
- Auto-reconnect for all WebSocket connections
- No authentication required (trusted LAN)

## Installation

### Option 1: Proxmox LXC (recommended)

One command on your Proxmox host — creates a Debian LXC container and installs everything inside:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install-lxc.sh | bash
```

Customizable via environment variables:

```bash
CTID=200 CT_HOSTNAME=mqtt CT_MEMORY=1024 CT_DISK=8 \
  wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install-lxc.sh | bash
```

### Option 2: Direct install (Debian/Ubuntu)

One command on a fresh Debian 12+ or Ubuntu 22.04+ system:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install.sh | bash
```

Both options install:
- Node.js 20 LTS
- Mosquitto MQTT broker (port 1883 + WebSocket 9001, anonymous LAN access)
- MQTT Master as systemd service with auto-restart

After installation: `http://<your-server-ip>:3000`

## Updating

Same command — detects existing installation, pulls latest code, preserves config:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install.sh | bash
```

## Quick Start

1. Open the dashboard at `http://<server-ip>:3000`
2. Click the **+** button next to "Plugins" in the sidebar
3. Choose **Loxone** or **MQTT-Bridge**
4. For MQTT-Bridge: pick a preset (e.g. Venus OS) or start with a custom config
5. Enter connection details and click **Start**

### Loxone Setup
1. Add a Loxone plugin, enter Miniserver IP, port, username, password
2. Click **Save** — plugin connects automatically, controls are auto-discovered
3. Browse **Elements** to see live values, test commands via dropdown, copy MQTT topics
4. Configure **Mood Mapping** for LightControllerV2 mood names (defaults included)
5. Use **Input Bindings** to feed external data (PV inverters, energy meters) into Loxone

### Multiple Miniservers

Each Loxone instance uses its own **MQTT Topic Prefix** (configured in the plugin settings). This keeps all topics cleanly separated:

```
Miniserver 1:  prefix "loxone"         → loxone/buero/licht/cmd
Miniserver 2:  prefix "loxone-og"      → loxone-og/schlafzimmer/dimmer/cmd
Miniserver 3:  prefix "loxone-hallbude" → loxone-hallbude/buero/licht/cmd
```

Each instance has its own Elements page, Mood Mappings, and Input Bindings.

### MQTT-Bridge Setup (Venus OS)
1. Add an MQTT-Bridge plugin → select the **Venus OS** preset
2. Enter the GX device IP (e.g. `192.168.1.100`) — protocol and port are added automatically
3. Start — all Venus OS topics are bridged to `venus/...` on your local broker
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

## MQTT Topic Reference

### Loxone Topics (name-based, human-readable)

```
loxone/{room}/{control}/state              ← state updates (JSON: value/text, name, type, uuid, room)
loxone/{room}/{control}/cmd                → commands (on, off, plus, minus, changeTo/Nacht, ...)
loxone/{room}/{control}/mood/state         ← resolved mood name (JSON: id, name, uuid)
loxone/{room}/{control}/{state}/state      ← sub-state (activeMoodsNum, position, presence, ...)
```

### Loxone Topics (UUID-based, rename-safe)

```
loxone/by-uuid/{uuid}/state               ← same payload as name-based
loxone/by-uuid/{uuid}/cmd                 → same commands as name-based
loxone/by-uuid/{uuid}/mood/state          ← same mood payload
```

Use UUID-based topics in automations — they survive control renames in Loxone Config.

### LightControllerV2 Commands

| Payload | Effect |
|---------|--------|
| `plus` | Next mood |
| `minus` | Previous mood |
| `changeTo/Nacht` | Set specific mood by name |
| `on` | Turn on (last active mood) |
| `off` | All off |

## Plugin Development

Plugins live in `plugins/{name}/plugin.js` and export a default class:

```javascript
export default class MyPlugin {
  async start(context) { }   // context: { mqttService, configService, logger, pluginId, pluginManager }
  async stop() { }
  getStatus() { }            // return { running, connected, messageCount, ... }
  getConfigSchema() { }      // JSON Schema → auto-generated config form
}
```

The `pluginId` in the context is the instance ID (e.g. `venus-os`), not the template type. Use it for reading config: `configService.get(\`plugins.${pluginId}\`)`.

Shared utilities available in `plugins/lib/`:
- `binding-utils.js` — input binding execution, field extraction, transforms
- `bindings-manager.js` — binding lifecycle management (apply, cleanup, persist)

### Adding Presets

Presets are defined in `server/services/plugin-manager.js` under the `PRESETS` constant. Each preset pre-fills config values when creating a new plugin instance:

```javascript
const PRESETS = {
  'mqtt-bridge': [
    {
      id: 'venus-os',
      label: 'Venus OS (Victron Energy)',
      description: 'GX device with MQTT enabled',
      suggestedId: 'venus-os',
      config: {
        displayName: 'Venus OS',
        subscribeTopic: 'N/#',
        localPrefix: 'venus',
        keepaliveEnabled: true,
        keepaliveIntervalMs: 30000,
      },
    },
  ],
};
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
│  │             │  │  │  ├─ ha-discovery.js    │  │
│  │             │  │  │  ├─ mood-manager.js    │  │
│  │             │  │  │  └─ structure-monitor  │  │
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
