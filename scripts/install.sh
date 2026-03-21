#!/usr/bin/env bash
# ============================================================================
# MQTT Master - Installer & Updater
# Usage: wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/scripts/install.sh | bash
# ============================================================================
set -euo pipefail

APP_NAME="mqtt-master"
APP_DIR="/opt/mqtt-master"
REPO_URL="https://github.com/meintechblog/mqtt-master.git"
BRANCH="main"
SERVICE_NAME="mqtt-master"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
VENV_DIR="${APP_DIR}/venv"
APP_USER="mqtt-master"
APP_PORT=8080

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${BLUE}[MQTT Master]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ---------------------------------------------------------------------------
# Pre-checks
# ---------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
    err "This script must be run as root."
fi

IS_UPDATE=false
if [ -d "${APP_DIR}" ]; then
    IS_UPDATE=true
    log "Existing installation detected — running update..."
else
    log "Starting fresh installation of MQTT Master..."
fi

# ---------------------------------------------------------------------------
# Install system dependencies
# ---------------------------------------------------------------------------
log "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq mosquitto mosquitto-clients python3 python3-venv python3-pip git > /dev/null 2>&1
ok "System dependencies installed"

# ---------------------------------------------------------------------------
# Configure Mosquitto (only on fresh install)
# ---------------------------------------------------------------------------
MOSQUITTO_CONF="/etc/mosquitto/conf.d/mqtt-master.conf"
if [ ! -f "${MOSQUITTO_CONF}" ]; then
    log "Configuring Mosquitto for open LAN access..."
    cat > "${MOSQUITTO_CONF}" << 'MQTTEOF'
# MQTT Master - Open LAN Configuration
allow_anonymous true

# MQTT listener on all interfaces
listener 1883 0.0.0.0

# WebSocket listener for web dashboard
listener 9001 0.0.0.0
protocol websockets
MQTTEOF
    systemctl restart mosquitto
    systemctl enable mosquitto
    ok "Mosquitto configured and started"
else
    ok "Mosquitto configuration already exists"
fi

# ---------------------------------------------------------------------------
# Create service user
# ---------------------------------------------------------------------------
if ! id "${APP_USER}" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "${APP_USER}"
    ok "Created service user: ${APP_USER}"
fi

# ---------------------------------------------------------------------------
# Clone or update repository
# ---------------------------------------------------------------------------
if [ "${IS_UPDATE}" = true ]; then
    log "Updating from GitHub..."
    cd "${APP_DIR}"
    git fetch origin "${BRANCH}" --quiet
    git reset --hard "origin/${BRANCH}" --quiet
    ok "Repository updated"
else
    log "Cloning repository..."
    git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${APP_DIR}" --quiet
    ok "Repository cloned"
fi

# ---------------------------------------------------------------------------
# Python virtual environment & dependencies
# ---------------------------------------------------------------------------
log "Setting up Python environment..."
if [ ! -d "${VENV_DIR}" ]; then
    python3 -m venv "${VENV_DIR}"
fi
"${VENV_DIR}/bin/pip" install --quiet --upgrade pip
"${VENV_DIR}/bin/pip" install --quiet -r "${APP_DIR}/webapp/requirements.txt"
ok "Python dependencies installed"

# ---------------------------------------------------------------------------
# Set permissions
# ---------------------------------------------------------------------------
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

# ---------------------------------------------------------------------------
# Install / update systemd service
# ---------------------------------------------------------------------------
log "Configuring systemd service..."
cp "${APP_DIR}/scripts/mqtt-master.service" "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
ok "Service installed and started"

# ---------------------------------------------------------------------------
# Wait for startup & verify
# ---------------------------------------------------------------------------
sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}"; then
    ok "MQTT Master is running!"
else
    warn "Service may still be starting... check: systemctl status ${SERVICE_NAME}"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ "${IS_UPDATE}" = true ]; then
    echo -e "${GREEN}  MQTT Master updated successfully!${NC}"
else
    echo -e "${GREEN}  MQTT Master installed successfully!${NC}"
fi
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
IP=$(hostname -I | awk '{print $1}')
echo -e "  Dashboard:  ${BLUE}http://${IP}:${APP_PORT}${NC}"
echo -e "  MQTT Broker: ${BLUE}mqtt://${IP}:1883${NC}"
echo -e "  WebSocket:   ${BLUE}ws://${IP}:9001${NC}"
echo ""
echo -e "  Manage:  ${YELLOW}systemctl {start|stop|restart|status} ${SERVICE_NAME}${NC}"
echo -e "  Logs:    ${YELLOW}journalctl -u ${SERVICE_NAME} -f${NC}"
echo -e "  Update:  ${YELLOW}wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/scripts/install.sh | bash${NC}"
echo ""
