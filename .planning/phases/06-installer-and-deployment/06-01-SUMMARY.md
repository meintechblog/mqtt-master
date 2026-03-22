---
phase: 06-installer-and-deployment
plan: 01
subsystem: infra
tags: [bash, installer, systemd, mosquitto, nodejs, debian, ubuntu, deployment]

# Dependency graph
requires:
  - phase: 01-scaffold-and-core-services
    provides: server/index.js entry point and package.json for npm install
  - phase: 05-loxone-bridge-plugin
    provides: complete plugin system and all features to document
provides:
  - Idempotent one-command installer for Debian/Ubuntu (install.sh)
  - Comprehensive project README with install guide and feature docs
  - systemd service with auto-restart and boot-time startup
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Idempotent installer pattern: check-before-act for each step (Node.js version, Mosquitto config, git dir, config.json)
    - Config preservation: only write config.json if it does not already exist
    - systemd service with Restart=always and RestartSec=5 for production resilience

key-files:
  created:
    - install.sh
    - README.md
  modified: []

key-decisions:
  - "install.sh uses apt-get (not apt) for non-interactive compatibility with DEBIAN_FRONTEND=noninteractive"
  - "Config preservation: installer writes default config.json only if file does not exist, never overwrites"
  - "Node.js version check before NodeSource install to avoid unnecessary setup_20.x curl on already-configured systems"
  - "Mosquitto config written to /etc/mosquitto/conf.d/mqtt-master.conf only if file does not exist (idempotent)"

patterns-established:
  - "Installer pattern: root check + OS check + per-dependency idempotent install + config preservation + systemd enable"

requirements-completed: [DEP-01, DEP-02, DEP-03, DEP-04, DEP-05]

# Metrics
duration: ~10min
completed: 2026-03-22
---

# Phase 6 Plan 01: Installer and Deployment Summary

**One-command idempotent Debian/Ubuntu installer with Mosquitto setup, Node.js 20 install, systemd service with auto-restart, and comprehensive README covering Loxone bridge, plugin system, and configuration**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-22
- **Completed:** 2026-03-22
- **Tasks:** 2 (+ 1 checkpoint approved)
- **Files modified:** 2

## Accomplishments
- install.sh handles both fresh Debian/Ubuntu installs and idempotent updates via check-before-act pattern
- systemd service configured with Restart=always, RestartSec=5, and After=mosquitto.service for correct boot ordering
- README.md covers all user-facing topics: one-command install, configuration, Loxone bridge setup, plugin system, and service management

## Task Commits

Each task was committed atomically:

1. **Task 1: Create install.sh installer script** - `e1bfc03` (feat)
2. **Task 2: Create README.md project documentation** - `3d810e7` (docs)

## Files Created/Modified
- `install.sh` - Idempotent Debian/Ubuntu installer: root/OS checks, Node.js 20 via NodeSource, Mosquitto with LAN config, git clone/pull, config.json preservation, systemd service creation and enable
- `README.md` - Project documentation: install command, features list, configuration reference, Loxone bridge guide, plugin system contract, development workflow, service management commands

## Decisions Made
- apt-get used over apt for non-interactive script compatibility (apt has unstable CLI contract for scripting)
- Config preservation implemented via file-existence check so repeated installs never overwrite user configuration
- Mosquitto config placed in /etc/mosquitto/conf.d/ (not the main conf file) to coexist cleanly with other Mosquitto configurations
- README kept practical with no badges, CI status, or contributor guidelines (personal project convention)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - installer handles all configuration. Users only need to run the one-line wget command.

## Next Phase Readiness
Phase 6 is the final phase. All phases 1-6 are complete.

- Full deployment path is ready: clone repo on any Debian/Ubuntu machine, run install.sh, service starts on port 3000
- Loxone bridge, plugin system, real-time dashboard, and topic viewer all documented and accessible via web UI
- No blockers. Project is ready for production use on the target Venus OS / Debian environment.

---
*Phase: 06-installer-and-deployment*
*Completed: 2026-03-22*
