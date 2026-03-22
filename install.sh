#!/bin/bash
# MQTT Master Installer
# Usage: wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install.sh | bash
#   or:  bash install.sh
set -e

export DEBIAN_FRONTEND=noninteractive

INSTALL_DIR="/opt/mqtt-master"
REPO_URL="https://github.com/meintechblog/mqtt-master.git"
SERVICE_FILE="/etc/systemd/system/mqtt-master.service"
MOSQUITTO_CONF="/etc/mosquitto/conf.d/mqtt-master.conf"

# --- Root check ---
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: This script must be run as root."
  echo "Usage: sudo bash install.sh"
  exit 1
fi

# --- OS check ---
if [ ! -f /etc/os-release ]; then
  echo "Error: Cannot detect OS. This installer supports Debian and Ubuntu only."
  exit 1
fi

. /etc/os-release
if [ "$ID" != "debian" ] && [ "$ID" != "ubuntu" ]; then
  echo "Error: Unsupported OS '$ID'. This installer supports Debian and Ubuntu only."
  exit 1
fi

echo "============================================"
echo "  MQTT Master Installer"
echo "============================================"
echo ""

# --- Node.js check/install ---
NEED_NODE=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "Node.js v${NODE_MAJOR} found, but v20+ is required."
    NEED_NODE=1
  else
    echo "Node.js $(node -v) found."
  fi
else
  NEED_NODE=1
fi

if [ "$NEED_NODE" -eq 1 ]; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "Node.js $(node -v) installed."
fi

# --- Git install ---
if ! command -v git >/dev/null 2>&1; then
  echo "Installing git..."
  apt-get install -y git
fi

# --- Mosquitto install ---
echo "Installing Mosquitto MQTT broker..."
apt-get install -y mosquitto

if [ ! -f "$MOSQUITTO_CONF" ]; then
  echo "Configuring Mosquitto..."
  cat > "$MOSQUITTO_CONF" <<'MQTTCONF'
listener 1883
allow_anonymous true
MQTTCONF
else
  echo "Mosquitto config already exists, skipping."
fi

systemctl enable mosquitto
systemctl restart mosquitto
echo "Mosquitto running on port 1883."

# --- Application install/update ---
if [ -d "${INSTALL_DIR}/.git" ]; then
  echo "Updating MQTT Master..."
  cd "$INSTALL_DIR"
  git pull
else
  echo "Installing MQTT Master..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

echo "Installing Node.js dependencies..."
cd "$INSTALL_DIR"
npm install --production

# --- Config preservation ---
if [ ! -f "${INSTALL_DIR}/config.json" ]; then
  echo "Creating default config.json..."
  cat > "${INSTALL_DIR}/config.json" <<'CFGJSON'
{
  "mqtt": { "broker": "mqtt://localhost:1883" },
  "web": { "port": 3000 },
  "logLevel": "info"
}
CFGJSON
else
  echo "Existing config.json preserved."
fi

# --- systemd service ---
echo "Configuring systemd service..."
cat > "$SERVICE_FILE" <<'SVCUNIT'
[Unit]
Description=MQTT Master
After=network.target mosquitto.service

[Service]
Type=simple
WorkingDirectory=/opt/mqtt-master
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCUNIT

systemctl daemon-reload
systemctl enable mqtt-master
systemctl restart mqtt-master

# --- Success message ---
echo ""
echo "============================================"
echo "  MQTT Master installed successfully!"
echo "============================================"

IP_ADDR=$(hostname -I | awk '{print $1}')
echo ""
echo "  Web UI:  http://${IP_ADDR}:3000"
echo "  Config:  ${INSTALL_DIR}/config.json"
echo "  Service: systemctl status mqtt-master"
echo "  Logs:    journalctl -u mqtt-master -f"
echo ""
