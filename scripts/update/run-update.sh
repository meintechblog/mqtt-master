#!/usr/bin/env bash
# =============================================================================
# mqtt-master self-update runner
# =============================================================================
# Triggered by:  systemctl start --no-block mqtt-master-updater.service
# Runs as:       root (sibling unit, survives `systemctl restart mqtt-master`)
# Logs to:       journalctl -u mqtt-master-updater
# State file:    /opt/mqtt-master/.update-state/state.json
#
# Pipeline:
#   preflight → snapshot_sha → fetch → reset → install → restart → verify
# Rollback (any failure from `fetch` onwards):
#   git reset --hard $PRE_SHA → npm install → systemctl restart → verify
# =============================================================================

set -o pipefail

readonly INSTALL_DIR="${INSTALL_DIR:-/opt/mqtt-master}"
readonly STATE_DIR="${INSTALL_DIR}/.update-state"
readonly STATE_FILE="${STATE_DIR}/state.json"
readonly LOCK_FILE="${STATE_DIR}/updater.lock"
readonly SERVICE="mqtt-master"
readonly APP_URL="http://127.0.0.1:80"
readonly HEALTH_TIMEOUT=60

CURRENT_STAGE="init"
PRE_SHA=""
POST_SHA=""

log() {
    local ts
    ts="$(date '+%H:%M:%S')"
    echo "[${ts}][stage=${CURRENT_STAGE}] $*"
}

die() {
    log "FATAL: $*"
    exit 1
}

mkdir -p "${STATE_DIR}"

# ---------- Concurrency lock ------------------------------------------------
exec 9>"${LOCK_FILE}" || die "cannot open lock ${LOCK_FILE}"
if ! flock -n 9; then
    log "another updater is holding the lock — exiting"
    exit 2
fi

# ---------- State helpers ---------------------------------------------------
state_write_python() {
    # Args: a python snippet that mutates `state` in-place. Reads/writes
    # ${STATE_FILE} atomically (tmp + os.replace).
    python3 - "${STATE_FILE}" <<PYEOF
import json, os, sys
state_file = sys.argv[1]
try:
    with open(state_file) as f: state = json.load(f)
except Exception: state = {}
$1
tmp = state_file + ".tmp"
with open(tmp, "w") as f: json.dump(state, f, indent=2)
os.replace(tmp, state_file)
PYEOF
}

state_set() {
    # state_set "<key1>" "<value1>" ["<key2>" "<value2>" ...]
    # Values are passed through as JSON strings (so wrap in quotes if needed).
    local args=("$@")
    python3 - "${STATE_FILE}" "${args[@]}" <<'PYEOF'
import json, os, sys
state_file = sys.argv[1]
pairs = sys.argv[2:]
try:
    with open(state_file) as f: state = json.load(f)
except Exception: state = {}
for i in range(0, len(pairs), 2):
    k = pairs[i]
    v = pairs[i+1] if i+1 < len(pairs) else ""
    if v == "__null__": state[k] = None
    elif v == "__true__": state[k] = True
    elif v == "__false__": state[k] = False
    else: state[k] = v
state["lastUpdatedAt"] = int(__import__('time').time() * 1000)
tmp = state_file + ".tmp"
with open(tmp, "w") as f: json.dump(state, f, indent=2)
os.replace(tmp, state_file)
PYEOF
}

# ---------- Health probe ----------------------------------------------------
health_probe() {
    local target_sha="$1"
    local deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
    log "health-probing ${APP_URL}/api/version expecting sha=${target_sha:0:7}"
    local body=""
    while (( $(date +%s) < deadline )); do
        body=$(curl -sf --max-time 2 "${APP_URL}/api/version" 2>/dev/null) || { sleep 2; continue; }
        local sha
        sha=$(echo "${body}" | grep -o '"sha":"[a-f0-9]*"' | head -1 | cut -d'"' -f4)
        if [ "${sha}" = "${target_sha}" ]; then
            log "health probe OK"
            return 0
        fi
        sleep 2
    done
    log "health probe TIMEOUT after ${HEALTH_TIMEOUT}s (last body: ${body:-<empty>})"
    return 1
}

# ---------- Stages ----------------------------------------------------------
preflight() {
    CURRENT_STAGE="preflight"
    [ -d "${INSTALL_DIR}/.git" ] || die "${INSTALL_DIR} is not a git working tree"
    cd "${INSTALL_DIR}" || die "cd ${INSTALL_DIR} failed"
    git config --global --add safe.directory "${INSTALL_DIR}" >/dev/null 2>&1 || true
    PRE_SHA=$(git rev-parse HEAD) || die "git rev-parse failed"
    # Reject obviously dirty trees, but tolerate runtime artifacts we own.
    # Keep this allowlist in sync with version-service.js#IGNORED_DIRTY_PATTERNS.
    local dirty
    dirty=$(git status --porcelain | grep -vE '^( M package-lock\.json|\?\? config\.json|\?\? plugins/[^/]+/|\?\? \.update-state/)$' || true)
    if [ -n "${dirty}" ]; then
        die "working tree has unexpected changes:
${dirty}"
    fi
    # Reset the npm-tickled package-lock.json so `git fetch` + reset start clean.
    if git status --porcelain | grep -qE '^ M package-lock\.json$'; then
        log "stashing npm-rewritten package-lock.json"
        git checkout -- package-lock.json || die "could not reset package-lock.json"
    fi
    local avail
    avail=$(df -BM "${INSTALL_DIR}" | awk 'NR==2 {print $4}' | tr -d 'M')
    log "disk free: ${avail}MB"
    (( avail > 200 )) || die "insufficient disk: ${avail}MB free, need 200"
    command -v node >/dev/null || die "node not found in PATH"
    log "node $(node -v)"
    log "preflight OK — current sha=${PRE_SHA:0:7}"
}

mark_installing() {
    CURRENT_STAGE="mark_installing"
    state_set updateStatus installing rollbackSha "${PRE_SHA}" rollbackHappened __false__ rollbackReason __null__
}

do_fetch() {
    CURRENT_STAGE="fetch"
    log "git fetch origin main"
    cd "${INSTALL_DIR}"
    git fetch origin main || die "git fetch failed"
}

do_reset() {
    CURRENT_STAGE="reset"
    cd "${INSTALL_DIR}"
    git reset --hard origin/main || die "git reset failed"
    POST_SHA=$(git rev-parse HEAD)
    log "reset to ${POST_SHA:0:7}"
}

do_install() {
    CURRENT_STAGE="install"
    cd "${INSTALL_DIR}"
    # Skip npm install when neither package.json nor lockfile changed.
    local deps_changed=1
    if git diff --name-only "${PRE_SHA}" "${POST_SHA}" 2>/dev/null \
        | grep -qE '^(package\.json|package-lock\.json)$'; then
        deps_changed=1
    else
        deps_changed=0
    fi
    if [ "${deps_changed}" = "0" ]; then
        log "npm install SKIPPED (no package.json/lockfile changes)"
    else
        log "npm install --production"
        npm install --production 2>&1 | tail -5
        local rc=${PIPESTATUS[0]}
        [ "${rc}" -eq 0 ] || die "npm install failed (rc=${rc})"
    fi
}

do_restart() {
    CURRENT_STAGE="restart"
    log "systemctl restart ${SERVICE}"
    systemctl restart "${SERVICE}" || die "systemctl restart failed"
}

do_verify() {
    CURRENT_STAGE="verify"
    health_probe "${POST_SHA}" || die "health probe failed"
}

# ---------- Rollback --------------------------------------------------------
do_rollback() {
    local original_error="$1"
    CURRENT_STAGE="rollback"
    log "=== rolling back to ${PRE_SHA:0:7} (reason: ${original_error}) ==="
    cd "${INSTALL_DIR}" || { log "cd failed during rollback"; return 1; }
    git reset --hard "${PRE_SHA}" 2>&1 | tail -3 || { log "git reset during rollback failed"; return 1; }
    npm install --production 2>&1 | tail -5 || log "WARNING: rollback npm install failed (continuing)"
    systemctl restart "${SERVICE}" || { log "systemctl restart during rollback failed"; return 1; }
    if ! health_probe "${PRE_SHA}"; then
        log "ROLLBACK health probe failed — service may be inactive"
        state_set updateStatus rolled_back rollbackHappened __true__ rollbackReason "${original_error}"
        return 1
    fi
    state_set updateStatus rolled_back rollbackHappened __true__ rollbackReason "${original_error}"
    log "rollback complete"
    return 0
}

on_error() {
    local exit_code="$1"
    local lineno="$2"
    local failed_stage="${CURRENT_STAGE}"
    local error_message="stage=${failed_stage} line=${lineno} exit=${exit_code}"

    log "on_error triggered: ${error_message}"
    trap - ERR

    case "${failed_stage}" in
        init|preflight|mark_installing|fetch)
            log "failure before destructive change — no rollback needed"
            state_set updateStatus failed rollbackHappened __false__ rollbackReason "${error_message}"
            exit 1
            ;;
    esac

    if do_rollback "${error_message}"; then
        log "=== UPDATE_RESULT: rolled_back (was: ${error_message}) ==="
        exit 2
    fi

    log "=== UPDATE_RESULT: rollback_failed (was: ${error_message}) ==="
    exit 3
}

on_exit() {
    local exit_code=$?
    log "on_exit: exit_code=${exit_code}"
}

trap 'on_error $? $LINENO' ERR
trap on_exit EXIT
set -e

# ---------- Main pipeline ---------------------------------------------------
preflight
mark_installing
do_fetch

# If origin/main is the same as our current SHA, nothing to do — finalize.
cd "${INSTALL_DIR}"
REMOTE_SHA=$(git rev-parse origin/main)
if [ "${REMOTE_SHA}" = "${PRE_SHA}" ]; then
    log "already at origin/main (${REMOTE_SHA:0:7}) — no update needed"
    state_set updateStatus idle rollbackSha __null__ currentSha "${PRE_SHA}"
    log "=== UPDATE_RESULT: noop ==="
    exit 0
fi

do_reset
do_install
do_restart
do_verify

CURRENT_STAGE="finalize"
state_set updateStatus idle currentSha "${POST_SHA}" rollbackSha __null__
log "=== UPDATE_RESULT: success (${PRE_SHA:0:7} → ${POST_SHA:0:7}) ==="
exit 0
