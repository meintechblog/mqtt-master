# Phase 6 Context: Installer and Deployment

## Phase Goal

Users can install and update MQTT Master on Debian with a single command, and it runs automatically as a system service.

## Decisions

### Locked

1. **Install command**: `wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install.sh | bash` -- single command, no prerequisites beyond wget (pre-installed on Debian)
2. **Install location**: `/opt/mqtt-master/` -- already established in dev deploys and hardcoded in server/index.js configPath default
3. **Config preservation**: Installer checks for existing `config.json` and preserves it during updates -- never overwrite user config
4. **Mosquitto setup**: Install mosquitto via apt, configure listener on port 1883 with `allow_anonymous true` -- no WebSocket listener needed (MQTT Master has its own WS server on port 3000)
5. **systemd service**: `/etc/systemd/system/mqtt-master.service` -- already used in manual dev deploys, now automated in install script
6. **Node.js**: Install from NodeSource if not present, targeting v20 LTS
7. **Update mode**: Same install.sh script detects existing `/opt/mqtt-master/.git` directory, runs `git pull` instead of `git clone`, runs `npm install --production`, preserves config.json, restarts service
8. **GitHub repo**: `meintechblog/mqtt-master` -- install script pulls from this repo
9. **README**: Project overview, feature list, one-command install, configuration reference, plugin system docs, Loxone setup guide

### Deferred

- Versioned releases / tagged downloads (v2 concern)
- Docker container packaging
- Multi-architecture support (ARM installer)
- Automated backup of config before update

## Claude's Discretion

- Exact systemd service settings (restart policy, environment vars, working directory)
- Mosquitto config file location and content structure
- README section ordering and depth
- Success/error message formatting in install script
- Whether to add a version display endpoint or CLI flag
