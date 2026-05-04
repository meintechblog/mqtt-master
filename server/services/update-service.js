import { existsSync, promises as fsp } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { getCurrentVersion, findInstallDir } from './version-service.js';

const GITHUB_COMMITS_URL = 'https://api.github.com/repos/meintechblog/mqtt-master/commits/main';
const FETCH_TIMEOUT_MS = 10_000;
const COMMIT_MESSAGE_MAX_LEN = 200;

// 6h main poll, 5min auto-update gate tick, 23h cooldown (max one auto-update
// per ~day). Keep these aligned with the charging-master numbers — we tested
// those settings end-to-end on production hardware already.
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const AUTO_UPDATE_TICK_MS = 5 * 60 * 1000;
const AUTO_UPDATE_MIN_INTERVAL_MS = 23 * 60 * 60 * 1000;
const AUTO_UPDATE_TZ = process.env.AUTO_UPDATE_TZ || 'Europe/Berlin';

const SIBLING_UNIT = 'mqtt-master-updater.service';

function trimSubject(message) {
  const first = (message || '').split('\n', 1)[0] ?? '';
  return first.slice(0, COMMIT_MESSAGE_MAX_LEN);
}

function getHourInTimezone(tz, now = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: tz });
    const n = parseInt(fmt.format(now), 10);
    if (Number.isFinite(n) && n >= 0 && n <= 23) return n;
  } catch { /* invalid TZ string */ }
  return now.getHours();
}

/**
 * UpdateService
 *  - polls GitHub /commits/main with ETag-based conditional requests
 *  - persists state under `update.*` in config.json
 *  - auto-applies updates inside a configurable hour window with 23h cooldown
 *  - reads /opt/mqtt-master/.update-state/state.json written by run-update.sh
 *    so the dashboard can show "rolled back from sha=…" after a failed run.
 */
export class UpdateService {
  constructor({ config, logger }) {
    this._config = config;
    this._logger = logger || console;
    this._intervalHandle = null;
    this._autoTickHandle = null;
    this._isChecking = false;
    this._lastSkipKey = null;
  }

  _settings() {
    return this._config.get('update', {}) || {};
  }

  async _saveSettings(patch) {
    const cur = this._settings();
    this._config.set('update', { ...cur, ...patch });
    try { await this._config.save(); }
    catch (err) { this._logger.warn?.(`[update] persisting config failed: ${err.message}`); }
  }

  /**
   * Read the runner-owned state.json (rollback flags, currentSha verified after
   * last update). Returns an empty object if not present.
   */
  async _readRunState() {
    const dir = findInstallDir();
    if (!dir) return {};
    const path = join(dir, '.update-state', 'state.json');
    try {
      const text = await fsp.readFile(path, 'utf8');
      return JSON.parse(text) || {};
    } catch {
      return {};
    }
  }

  async getStatus() {
    const [current, runState] = await Promise.all([
      getCurrentVersion({ refresh: true }),
      this._readRunState(),
    ]);
    const s = this._settings();
    const latestSha = s.latestSha || null;
    const hasUpdate =
      !!latestSha && !current.isDev && latestSha !== current.sha && !current.isDirty;
    return {
      current,
      lastCheckedAt: s.lastCheckedAt || null,
      latestSha,
      latestCommitDate: s.latestCommitDate || null,
      latestCommitMessage: s.latestCommitMessage || null,
      lastError: s.lastError || null,
      hasUpdate,
      autoApply: s.autoApply !== false,
      autoUpdateHour: Number.isInteger(s.autoUpdateHour) ? s.autoUpdateHour : 3,
      lastAutoUpdateAt: s.lastAutoUpdateAt || null,
      runState: {
        updateStatus: runState.updateStatus || 'idle',
        rollbackSha: runState.rollbackSha || null,
        rollbackHappened: !!runState.rollbackHappened,
        rollbackReason: runState.rollbackReason || null,
        lastUpdatedAt: runState.lastUpdatedAt || null,
      },
    };
  }

  /**
   * Live-check GitHub for the latest commit. Stores the result. Never throws.
   */
  async checkNow({ manual = false } = {}) {
    if (this._isChecking) {
      const s = this._settings();
      return { error: null, fromCache: true, latestSha: s.latestSha, latestCommitMessage: s.latestCommitMessage };
    }
    this._isChecking = true;
    try {
      const current = await getCurrentVersion({ refresh: true });
      if (current.isDev) {
        await this._saveSettings({ lastCheckedAt: new Date().toISOString(), lastError: 'dev_mode' });
        return { error: 'dev_mode', current };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const headers = {
          Accept: 'application/vnd.github+json',
          'User-Agent': `mqtt-master-update-check/${current.shortSha}`,
          'X-GitHub-Api-Version': '2022-11-28',
        };
        const etag = this._settings().lastCheckEtag;
        if (etag) headers['If-None-Match'] = etag;
        const res = await fetch(GITHUB_COMMITS_URL, { headers, signal: controller.signal, cache: 'no-store' });

        if (res.status === 304) {
          // ETag matched — keep previous metadata, just bump lastCheckedAt
          await this._saveSettings({ lastCheckedAt: new Date().toISOString(), lastError: null });
          if (manual) this._logger.info?.('[update] manual check: 304 unchanged');
          const s = this._settings();
          return {
            error: null, unchanged: true, current,
            latestSha: s.latestSha, latestCommitDate: s.latestCommitDate,
            latestCommitMessage: s.latestCommitMessage,
            hasUpdate: !!s.latestSha && s.latestSha !== current.sha,
          };
        }
        if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
          const resetUnix = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10);
          const resetAt = new Date(resetUnix * 1000).toISOString();
          await this._saveSettings({ lastError: `rate_limited:${resetAt}`, lastCheckedAt: new Date().toISOString() });
          return { error: 'rate_limited', resetAt, current };
        }
        if (!res.ok) {
          await this._saveSettings({ lastError: `network:HTTP ${res.status}`, lastCheckedAt: new Date().toISOString() });
          return { error: 'network', message: `HTTP ${res.status}`, current };
        }
        const body = await res.json();
        const latestSha = body.sha;
        const latestCommitDate = body.commit?.committer?.date || null;
        const latestCommitMessage = trimSubject(body.commit?.message || '');
        const newEtag = res.headers.get('etag') || null;
        const checkedAt = new Date().toISOString();
        await this._saveSettings({
          lastCheckedAt: checkedAt,
          latestSha, latestCommitDate, latestCommitMessage,
          lastCheckEtag: newEtag,
          lastError: null,
        });
        return {
          error: null, current, latestSha, latestCommitDate, latestCommitMessage,
          hasUpdate: current.sha !== latestSha && !current.isDirty,
          checkedAt,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'timeout' : (err?.message || 'unknown');
      await this._saveSettings({ lastError: `network:${msg}`, lastCheckedAt: new Date().toISOString() });
      return { error: 'network', message: msg };
    } finally {
      this._isChecking = false;
    }
  }

  /**
   * Trigger the sibling updater unit. Detached: `systemctl start --no-block`
   * returns immediately, the unit runs in its own cgroup and survives the
   * `systemctl restart mqtt-master` it executes mid-pipeline.
   */
  async runUpdate({ reason = 'manual' } = {}) {
    const dir = findInstallDir();
    if (!dir) throw new Error('not running from a git checkout');
    const current = await getCurrentVersion({ refresh: true });
    if (current.isDev) throw new Error('refusing to update: dev mode');
    if (current.isDirty) throw new Error('refusing to update: working tree is dirty');

    this._logger.info?.(`[update] triggering ${SIBLING_UNIT} (reason=${reason}, from=${current.shortSha})`);
    const child = spawn('systemctl', ['start', '--no-block', SIBLING_UNIT], {
      detached: true, stdio: 'ignore',
    });
    child.unref();
    return { unitName: SIBLING_UNIT, startedAt: new Date().toISOString(), preSha: current.sha };
  }

  /**
   * Read the last N journal lines for the updater unit. Used by the UI to
   * tail progress without polling files.
   */
  async readUpdaterJournal({ lines = 200 } = {}) {
    return await new Promise((resolve) => {
      const child = spawn('journalctl', [
        '-u', SIBLING_UNIT, '-n', String(lines), '--no-pager', '-o', 'cat',
      ]);
      let buf = '';
      child.stdout.on('data', (d) => { buf += d.toString('utf8'); });
      child.on('close', () => resolve(buf));
      child.on('error', () => resolve(''));
    });
  }

  /**
   * Periodic check loop (charging-master pattern). Initial tick is fired 30s
   * after start so the service has time to settle, then every 6h. A separate
   * 5-min tick gates auto-apply on hour window + cooldown.
   */
  start() {
    if (this._intervalHandle) return;
    const tick = async () => {
      try { await this.checkNow({ manual: false }); }
      catch (err) { this._logger.warn?.(`[update] periodic check failed: ${err.message}`); }
    };
    setTimeout(tick, 30_000);
    this._intervalHandle = setInterval(tick, SIX_HOURS_MS);
    this._intervalHandle.unref?.();

    this._autoTickHandle = setInterval(() => {
      this._maybeAutoUpdate().catch(() => { /* swallowed */ });
    }, AUTO_UPDATE_TICK_MS);
    this._autoTickHandle.unref?.();
    // Also evaluate once shortly after the initial check.
    setTimeout(() => { this._maybeAutoUpdate().catch(() => {}); }, 60_000);

    this._logger.info?.(`[update] scheduler started (poll 6h, gate tick 5min, tz=${AUTO_UPDATE_TZ})`);
  }

  stop() {
    if (this._intervalHandle) clearInterval(this._intervalHandle);
    if (this._autoTickHandle) clearInterval(this._autoTickHandle);
    this._intervalHandle = null;
    this._autoTickHandle = null;
  }

  _logGateSkip(gate, detail) {
    const key = `${gate}:${detail}`;
    if (this._lastSkipKey === key) return;
    this._lastSkipKey = key;
    this._logger.info?.(`[update] auto-update gated: ${gate} — ${detail}`);
  }

  async _maybeAutoUpdate() {
    const status = await this.getStatus();
    if (!status.autoApply) {
      this._logGateSkip('disabled', 'autoApply=false');
      return;
    }
    if (status.runState.updateStatus === 'installing') {
      this._logGateSkip('installing', 'updateStatus=installing');
      return;
    }
    if (!status.hasUpdate) {
      this._logGateSkip('up_to_date', 'no remote-vs-local diff');
      return;
    }
    const targetHour = status.autoUpdateHour;
    const localHour = getHourInTimezone(AUTO_UPDATE_TZ);
    if (localHour !== targetHour) {
      this._logGateSkip('outside_window', `localHour=${localHour} (${AUTO_UPDATE_TZ}) target=${targetHour}`);
      return;
    }
    const lastAuto = Date.parse(status.lastAutoUpdateAt || '') || 0;
    const elapsed = Date.now() - lastAuto;
    if (elapsed < AUTO_UPDATE_MIN_INTERVAL_MS) {
      const remainingMin = Math.ceil((AUTO_UPDATE_MIN_INTERVAL_MS - elapsed) / 60_000);
      this._logGateSkip('cooldown', `${remainingMin}min remaining`);
      return;
    }

    this._lastSkipKey = null;
    await this._saveSettings({ lastAutoUpdateAt: new Date().toISOString() });
    try {
      await this.runUpdate({ reason: 'auto' });
      this._logger.info?.(`[update] auto-update triggered to ${status.latestSha?.slice(0, 7)}`);
    } catch (err) {
      this._logger.warn?.(`[update] auto-update spawn failed: ${err.message}`);
    }
  }

  async setAutoApply(value) {
    await this._saveSettings({ autoApply: !!value });
  }

  async setAutoUpdateHour(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < 0 || n > 23) throw new Error('autoUpdateHour must be 0..23');
    await this._saveSettings({ autoUpdateHour: n });
  }
}
