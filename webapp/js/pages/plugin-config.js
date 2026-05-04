import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { StatusDot } from '../components/status-dot.js';
import {
  fetchPlugins,
  getPluginConfig,
  savePluginConfig,
  startPlugin,
  stopPlugin,
  reloadPlugin,
  deletePlugin,
} from '../lib/api-client.js';

/**
 * Plugin configuration page.
 * Renders plugin status, lifecycle buttons, and auto-generated config form.
 *
 * @param {{ pluginId: string }} props
 */
export function PluginConfig({ pluginId }) {
  const [pluginStatus, setPluginStatus] = useState('stopped');
  const [pluginName, setPluginName] = useState(pluginId);
  const [pluginType, setPluginType] = useState(null);
  const [isDeletable, setIsDeletable] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [schema, setSchema] = useState(null);
  const [configData, setConfigData] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState(null);

  /** Map plugin status to StatusDot status */
  function dotStatus(s) {
    if (s === 'running') return 'connected';
    if (s === 'error') return 'error';
    return 'stopped';
  }

  /** Load plugin info + config */
  async function loadPlugin() {
    try {
      const [plugins, configResult] = await Promise.all([
        fetchPlugins(),
        getPluginConfig(pluginId),
      ]);
      const plugin = plugins.find(p => p.id === pluginId);
      if (plugin) {
        setPluginStatus(plugin.status);
        setPluginName(plugin.name || plugin.id);
        setPluginType(plugin.type || null);
        setIsDeletable(!!plugin.deletable);
      }
      setSchema(configResult.schema);
      setConfigData({ ...configResult.config });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  /** Refresh just the status */
  async function refreshStatus() {
    try {
      const plugins = await fetchPlugins();
      const plugin = plugins.find(p => p.id === pluginId);
      if (plugin) {
        setPluginStatus(plugin.status);
      }
    } catch (_) {
      // Silently ignore refresh errors
    }
  }

  /** Show temporary feedback message */
  function showFeedback(type, text) {
    setFeedback({ type, text });
    setTimeout(() => { setFeedback(null); }, 3000);
  }

  async function handleStart() {
    try {
      await startPlugin(pluginId);
      showFeedback('success', 'Plugin started');
      await refreshStatus();
    } catch (err) {
      showFeedback('error', err.message);
    }
  }

  async function handleStop() {
    try {
      await stopPlugin(pluginId);
      showFeedback('success', 'Plugin stopped');
      await refreshStatus();
    } catch (err) {
      showFeedback('error', err.message);
    }
  }

  async function handleReload() {
    try {
      await reloadPlugin(pluginId);
      showFeedback('success', 'Plugin reloaded');
      await refreshStatus();
    } catch (err) {
      showFeedback('error', err.message);
    }
  }

  async function handleDelete() {
    try {
      await deletePlugin(pluginId);
      window.location.hash = '#/dashboard';
      window.location.reload();
    } catch (err) {
      showFeedback('error', err.message);
      setConfirmDelete(false);
    }
  }

  async function handleSave() {
    try {
      const result = await savePluginConfig(pluginId, configData);
      if (result.autoStarted && result.status === 'running') {
        showFeedback('success', 'Saved & connected');
      } else if (result.autoStarted && result.status === 'error') {
        showFeedback('error', result.error || 'Connection failed — check IP, port, and credentials');
      } else if (result.startError) {
        showFeedback('error', result.startError);
      } else {
        showFeedback('success', 'Configuration saved');
      }
      await refreshStatus();
    } catch (err) {
      showFeedback('error', err.message);
    }
  }

  /** Update a config field value */
  function setField(key, value) {
    setConfigData(prev => ({ ...prev, [key]: value }));
  }

  useEffect(() => { loadPlugin(); }, [pluginId]);

  /** UDP-broadcast scan for Loxone Miniservers on the LAN. */
  async function handleDiscover() {
    setDiscovering(true);
    setDiscoveryResults(null);
    try {
      const res = await fetch('/api/discovery/loxone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMs: 3000 }),
      });
      const data = await res.json();
      setDiscoveryResults(Array.isArray(data) ? data : []);
    } catch (err) {
      showFeedback('error', `Discovery failed: ${err.message}`);
    } finally {
      setDiscovering(false);
    }
  }

  function applyDiscoveredMiniserver(ms) {
    // Only suggest a displayName when the device gave us a real one (skip
    // the generic HTTP realm "data") and the user hasn't typed anything yet.
    const hasGoodName = ms.name && !/^data$/i.test(ms.name);
    setConfigData(prev => ({
      ...prev,
      ip: ms.ip || prev.ip,
      port: ms.port || prev.port || 80,
      ...(hasGoodName && !prev.displayName ? { displayName: ms.name } : {}),
    }));
    setDiscoveryResults(null);
    showFeedback('success', `Filled IP from ${ms.ip}`);
  }

  if (loading) {
    return html`<div class="page-placeholder">Loading plugin...</div>`;
  }

  const props = (schema && schema.properties) || {};

  return html`
    <div>
      <div class="page-header" style="display:flex;align-items:center;gap:10px;">
        <${StatusDot} status=${dotStatus(pluginStatus)} />
        <span>${pluginName}</span>
        <span style="font-size:13px;color:var(--ve-text-dim);font-weight:400;">(${pluginStatus})</span>
      </div>

      ${feedback && html`
        <div class="ve-card" style="margin-bottom:12px;padding:10px 14px;background:${feedback.type === 'error' ? 'var(--ve-red)' : 'var(--ve-green)'};color:#fff;border-radius:var(--ve-radius-sm);font-size:14px;">
          ${feedback.text}
        </div>
      `}

      <div class="ve-panel" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
        <button class="msg-btn msg-btn--subscribe" disabled=${pluginStatus === 'running'} onClick=${handleStart}>Start</button>
        <button class="msg-btn msg-btn--unsubscribe" disabled=${pluginStatus === 'stopped'} onClick=${handleStop}>Stop</button>
        <button class="msg-btn msg-btn--clear" onClick=${handleReload}>Reload</button>
      </div>

      ${pluginType === 'loxone' && html`
        <div class="ve-card" style="margin-bottom:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <div style="font-size:14px;font-weight:600;">Miniserver Discovery</div>
              <div style="font-size:12px;color:var(--ve-text-dim);margin-top:2px;">
                Scan the LAN for Loxone Miniservers via UDP broadcast (port 7777).
              </div>
            </div>
            <button class="msg-btn msg-btn--subscribe" onClick=${handleDiscover} disabled=${discovering}>
              ${discovering ? 'Scanning...' : 'Scan Network'}
            </button>
          </div>
          ${discoveryResults != null && html`
            <div style="margin-top:12px;">
              ${discoveryResults.length === 0
                ? html`<div style="font-size:13px;color:var(--ve-text-dim);">
                    No Miniservers responded. Make sure the device is powered on and on the same VLAN.
                    You can still type the IP manually below.
                  </div>`
                : html`
                  <div style="font-size:12px;color:var(--ve-text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">
                    Found ${discoveryResults.length} Miniserver${discoveryResults.length === 1 ? '' : 's'} — click to fill
                  </div>
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    ${discoveryResults.map(ms => html`
                      <div
                        key=${ms.ip}
                        onClick=${() => applyDiscoveredMiniserver(ms)}
                        style="cursor:pointer;padding:8px 12px;border:1px solid var(--ve-border);border-radius:var(--ve-radius-sm);display:flex;align-items:center;gap:12px;transition:background 0.15s;"
                        onMouseOver=${(e) => e.currentTarget.style.background = 'rgba(56,125,197,0.08)'}
                        onMouseOut=${(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style="flex:1;min-width:0;">
                          <div style="font-size:14px;font-weight:500;">
                            ${(ms.name && !/^data$/i.test(ms.name)) ? ms.name : 'Miniserver'}
                            <span style="color:var(--ve-text-dim);font-weight:normal;font-family:var(--ve-font-mono);font-size:13px;margin-left:6px;">${ms.ip}${ms.port && ms.port !== 80 ? `:${ms.port}` : ''}</span>
                          </div>
                          <div style="font-size:11px;color:var(--ve-text-dim);margin-top:2px;">
                            ${ms.mac || ''}${ms.mac && ms.firmware ? ' · ' : ''}${ms.firmware ? `firmware ${ms.firmware}` : ''}
                          </div>
                        </div>
                        <span style="font-size:11px;color:var(--ve-blue);text-transform:uppercase;letter-spacing:0.5px;">Use →</span>
                      </div>
                    `)}
                  </div>
                `}
            </div>
          `}
        </div>
      `}

      <div class="ve-card">
        <div style="font-size:16px;font-weight:600;margin-bottom:12px;">Configuration</div>
        ${Object.keys(props).length === 0
          ? html`<div class="page-placeholder">No configurable properties</div>`
          : html`
            <div>
              ${Object.entries(props).map(([key, prop]) => {
                const value = configData[key] !== undefined ? configData[key] : (prop.default || '');
                const label = prop.title || key;

                if (prop.type === 'boolean') {
                  return html`
                    <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
                      <input
                        type="checkbox"
                        checked=${!!value}
                        onChange=${(e) => setField(key, e.target.checked)}
                        style="width:16px;height:16px;"
                      />
                      <label style="font-size:14px;color:var(--ve-text-secondary);">${label}</label>
                    </div>
                  `;
                }

                const inputType = prop.format === 'password' ? 'password'
                  : (prop.type === 'number' || prop.type === 'integer') ? 'number' : 'text';
                return html`
                  <div style="margin-bottom:12px;">
                    <label style="display:block;font-size:12px;color:var(--ve-text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${label}</label>
                    <input
                      class="msg-topic-input"
                      type=${inputType}
                      value=${value}
                      placeholder=${prop.default || ''}
                      onInput=${(e) => setField(key, inputType === 'number' ? Number(e.target.value) : e.target.value)}
                      style="width:100%;"
                    />
                  </div>
                `;
              })}
              <button class="msg-btn msg-btn--subscribe" onClick=${handleSave} style="margin-top:8px;">Save</button>
            </div>
          `
        }
      </div>

      ${isDeletable && html`
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--ve-border);">
          ${!confirmDelete
            ? html`<button class="msg-btn" style="background:transparent;border:1px solid var(--ve-red);color:var(--ve-red);" onClick=${() => setConfirmDelete(true)}>Delete Plugin</button>`
            : html`
              <div style="display:flex;align-items:center;gap:12px;">
                <span style="font-size:14px;color:var(--ve-red);">Delete "${pluginName}" permanently?</span>
                <button class="msg-btn" style="background:var(--ve-red);" onClick=${handleDelete}>Yes, delete</button>
                <button class="msg-btn msg-btn--clear" onClick=${() => setConfirmDelete(false)}>Cancel</button>
              </div>
            `
          }
        </div>
      `}
    </div>
  `;
}
