import { html } from 'htm/preact';
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { StatusDot } from '../components/status-dot.js';
import {
  fetchPlugins,
  getPluginConfig,
  savePluginConfig,
  startPlugin,
  stopPlugin,
  reloadPlugin,
} from '../lib/api-client.js';

/**
 * Plugin configuration page.
 * Renders plugin status, lifecycle buttons, and auto-generated config form.
 *
 * @param {{ pluginId: string }} props
 */
export function PluginConfig({ pluginId }) {
  const pluginStatus = signal('stopped');
  const pluginName = signal(pluginId);
  const schema = signal(null);
  const configData = signal({});
  const feedback = signal(null);
  const loading = signal(true);

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
        pluginStatus.value = plugin.status;
        pluginName.value = plugin.name || plugin.id;
      }
      schema.value = configResult.schema;
      configData.value = { ...configResult.config };
    } catch (err) {
      feedback.value = { type: 'error', text: err.message };
    } finally {
      loading.value = false;
    }
  }

  /** Refresh just the status */
  async function refreshStatus() {
    try {
      const plugins = await fetchPlugins();
      const plugin = plugins.find(p => p.id === pluginId);
      if (plugin) {
        pluginStatus.value = plugin.status;
      }
    } catch (_) {
      // Silently ignore refresh errors
    }
  }

  /** Show temporary feedback message */
  function showFeedback(type, text) {
    feedback.value = { type, text };
    setTimeout(() => { feedback.value = null; }, 3000);
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

  async function handleSave() {
    try {
      await savePluginConfig(pluginId, configData.value);
      showFeedback('success', 'Configuration saved');
    } catch (err) {
      showFeedback('error', err.message);
    }
  }

  /** Update a config field value */
  function setField(key, value) {
    configData.value = { ...configData.value, [key]: value };
  }

  useEffect(() => { loadPlugin(); }, [pluginId]);

  if (loading.value) {
    return html`<div class="page-placeholder">Loading plugin...</div>`;
  }

  const props = (schema.value && schema.value.properties) || {};

  return html`
    <div>
      <div class="page-header" style="display:flex;align-items:center;gap:10px;">
        <${StatusDot} status=${dotStatus(pluginStatus.value)} />
        <span>${pluginName.value}</span>
        <span style="font-size:13px;color:var(--ve-text-dim);font-weight:400;">(${pluginStatus.value})</span>
      </div>

      ${feedback.value && html`
        <div class="ve-card" style="margin-bottom:12px;padding:10px 14px;background:${feedback.value.type === 'error' ? 'var(--ve-red)' : 'var(--ve-green)'};color:#fff;border-radius:var(--ve-radius-sm);font-size:14px;">
          ${feedback.value.text}
        </div>
      `}

      <div class="ve-panel" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
        <button class="msg-btn msg-btn--subscribe" disabled=${pluginStatus.value === 'running'} onClick=${handleStart}>Start</button>
        <button class="msg-btn msg-btn--unsubscribe" disabled=${pluginStatus.value === 'stopped'} onClick=${handleStop}>Stop</button>
        <button class="msg-btn msg-btn--clear" onClick=${handleReload}>Reload</button>
      </div>

      <div class="ve-card">
        <div style="font-size:16px;font-weight:600;margin-bottom:12px;">Configuration</div>
        ${Object.keys(props).length === 0
          ? html`<div class="page-placeholder">No configurable properties</div>`
          : html`
            <div>
              ${Object.entries(props).map(([key, prop]) => {
                const value = configData.value[key] !== undefined ? configData.value[key] : (prop.default || '');
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

                const inputType = (prop.type === 'number' || prop.type === 'integer') ? 'number' : 'text';
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
    </div>
  `;
}
