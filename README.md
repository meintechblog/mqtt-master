# MQTT Master

Web Dashboard & Plugin System for Mosquitto MQTT Broker.

MQTT Master provides a sleek dark-themed web interface to monitor your Mosquitto MQTT broker and integrates third-party systems that lack native MQTT support through a plugin architecture.

![License](https://img.shields.io/github/license/meintechblog/mqtt-master)

## Features

- **Broker Dashboard** — Real-time monitoring of connected clients, message throughput, subscriptions, memory usage, and load averages
- **Live Messages** — Subscribe to any topic pattern and watch messages arrive in real-time via WebSocket
- **Plugin System** — Extensible architecture to bridge non-MQTT systems into your broker (first plugin: Loxone Miniserver)
- **Dark Theme** — Consistent dark UI design, optimized for always-on displays and dashboards
- **Mobile Responsive** — Works on desktop, tablet, and phone

## Quick Install (Debian/Ubuntu)

One command to install everything — Mosquitto broker, MQTT Master dashboard, and all dependencies:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/scripts/install.sh | bash
```

This will:
1. Install Mosquitto MQTT broker (open LAN access, no auth)
2. Configure WebSocket support on port 9001
3. Install MQTT Master web dashboard on port 8080
4. Set up a systemd service for auto-start

### Update

Run the same command to update to the latest version:

```bash
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/scripts/install.sh | bash
```

## What Gets Installed

| Component | Details |
|-----------|---------|
| **Mosquitto** | MQTT broker on port `1883` (MQTT) and `9001` (WebSocket) |
| **MQTT Master** | Web dashboard on port `8080` |
| **Install path** | `/opt/mqtt-master/` |
| **Service** | `systemctl {start\|stop\|restart\|status} mqtt-master` |
| **Logs** | `journalctl -u mqtt-master -f` |

## Manual Installation

```bash
# Install dependencies
apt-get install mosquitto mosquitto-clients python3 python3-venv git

# Clone repository
git clone https://github.com/meintechblog/mqtt-master.git /opt/mqtt-master
cd /opt/mqtt-master

# Create virtual environment
python3 -m venv venv
venv/bin/pip install -r webapp/requirements.txt

# Run
venv/bin/python webapp/app.py
```

## Mosquitto Configuration

The installer creates `/etc/mosquitto/conf.d/mqtt-master.conf`:

```
allow_anonymous true
listener 1883 0.0.0.0
listener 9001 0.0.0.0
protocol websockets
```

> **Note:** This configuration allows anonymous access from your LAN. Do not expose this to the internet without adding authentication.

## Architecture

```
mqtt-master/
├── webapp/                 # Flask web application
│   ├── app.py              # Main application & MQTT $SYS monitor
│   ├── static/
│   │   ├── style.css       # Dark theme stylesheet
│   │   └── app.js          # Dashboard frontend
│   ├── templates/
│   │   └── index.html      # Main page template
│   ├── requirements.txt    # Python dependencies
│   └── wsgi.py             # WSGI entry point
├── plugins/                # Plugin directory (upcoming)
├── scripts/
│   ├── install.sh          # One-command installer & updater
│   └── mqtt-master.service # systemd service file
└── README.md
```

## Plugins (Coming Soon)

MQTT Master's plugin system bridges third-party systems into your MQTT broker:

- **Loxone** — Bidirectional integration with Loxone Miniserver

## License

MIT License — see [LICENSE](LICENSE) for details.

## Contributing

Issues and pull requests welcome at [github.com/meintechblog/mqtt-master](https://github.com/meintechblog/mqtt-master).
