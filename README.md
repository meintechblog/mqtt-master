# MQTT Master

A self-hosted MQTT broker dashboard and smart home bridge for Debian/Ubuntu.

MQTT Master provides a real-time web interface for monitoring your Mosquitto MQTT broker and bridges non-MQTT smart home systems into your broker through an extensible plugin architecture.

## Features

- Real-time broker dashboard (connected clients, message rates, memory usage, uptime)
- Live MQTT message viewer with topic pattern filtering
- Hierarchical topic tree browser
- Plugin system for smart home integrations
- Loxone Miniserver bridge with auto-discovery and human-readable MQTT topics
- Home Assistant auto-detection via MQTT Discovery
- Venus OS-inspired dark theme
- No database required -- JSON config + in-memory state

## Installation

One command installs everything on a fresh Debian 12+ or Ubuntu 22.04+ system:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install.sh | bash
```

The installer handles all dependencies automatically:

- Installs Node.js 20 LTS (if not present or too old)
- Installs and configures Mosquitto MQTT broker (port 1883, anonymous access)
- Clones the repository to `/opt/mqtt-master/`
- Installs Node.js dependencies
- Creates a systemd service with automatic restart

After installation, open your browser to:

```
http://<your-server-ip>:3000
```

## Updating

Run the same install command to update to the latest version:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install.sh | bash
```

The installer detects the existing installation, pulls the latest code, reinstalls dependencies, and restarts the service. Your `config.json` is preserved.

## Configuration

The configuration file is located at `/opt/mqtt-master/config.json`.

### Available Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mqtt.broker` | `mqtt://localhost:1883` | MQTT broker connection URL |
| `web.port` | `3000` | Web dashboard port |
| `logLevel` | `info` | Log level (trace, debug, info, warn, error) |
| `pluginDir` | `plugins/` | Directory to scan for plugins |

### Example config.json

```json
{
  "mqtt": { "broker": "mqtt://localhost:1883" },
  "web": { "port": 3000 },
  "logLevel": "info"
}
```

After changing the config, restart the service:

```bash
systemctl restart mqtt-master
```

## Loxone Bridge Setup

The Loxone plugin bridges your Loxone Miniserver into MQTT, publishing all controls with human-readable topic names.

1. Open the MQTT Master web UI and navigate to the **Plugins** page
2. Click on the **Loxone** plugin
3. Configure your Miniserver connection:
   - **Host**: Miniserver IP address (e.g., `192.168.1.10`)
   - **Port**: `80` (default)
   - **Username**: Loxone user with admin access
   - **Password**: Loxone user password
4. Click **Start** to activate the plugin

Once connected, the plugin:

- Auto-discovers all controls from the Miniserver structure file
- Publishes state updates to `loxone/{room}/{control-name}`
- Subscribes to command topics for bidirectional control
- Supports Home Assistant auto-detection via MQTT Discovery
- Allows per-control enable/disable from the plugin UI

### Topic Routes

Topic routes allow custom MQTT forwarding rules. You can map incoming MQTT messages to Loxone controls or forward Loxone state changes to custom topics. Configure routes from the plugin settings page in the web UI.

## Plugin System

MQTT Master uses a plugin architecture to bridge external systems into MQTT.

### Plugin Directory

Plugins are stored in the `plugins/` directory. Each plugin is a subdirectory containing an `index.js` file.

```
plugins/
  loxone/
    index.js
  example/
    index.js
```

### Plugin Contract

Every plugin must export a class with these methods:

```javascript
export default class MyPlugin {
  // Called when the plugin is started
  // context provides: mqttService, configService, logger
  async start(context) { }

  // Called when the plugin is stopped
  async stop() { }

  // Returns current plugin status
  getStatus() {
    return {
      running: true,
      stats: { /* plugin-specific stats */ }
    };
  }

  // Returns JSON schema for plugin configuration
  getConfigSchema() {
    return {
      fields: [
        { name: 'host', type: 'string', label: 'Host', required: true },
        { name: 'port', type: 'number', label: 'Port', default: 80 }
      ]
    };
  }
}
```

### Plugin Context

The `start(context)` method receives:

- `mqttService` -- publish and subscribe to MQTT topics
- `configService` -- read and write persistent configuration
- `logger` -- structured logger instance

## Development

```bash
# Clone the repository
git clone https://github.com/meintechblog/mqtt-master.git
cd mqtt-master

# Install dependencies
npm install

# Start in development mode (with file watching)
npm run dev

# Run tests
npm test

# Deploy to VM (development)
./scripts/deploy-vm.sh
```

## Service Management

```bash
# Check service status
systemctl status mqtt-master

# Restart the service
systemctl restart mqtt-master

# Stop the service
systemctl stop mqtt-master

# View live logs
journalctl -u mqtt-master -f

# View recent logs
journalctl -u mqtt-master --no-pager -n 50
```

## Mosquitto Configuration

The installer creates `/etc/mosquitto/conf.d/mqtt-master.conf`:

```
listener 1883
allow_anonymous true
```

This allows anonymous MQTT access from your LAN. Do not expose this to the internet without adding authentication.

## License

ISC
