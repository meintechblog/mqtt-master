import { html } from 'htm/preact';
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { StatusDot } from './status-dot.js';
import { brokerConnected, dashboardState } from '../lib/ws-client.js';
import { fetchPlugins } from '../lib/api-client.js';

export const menuOpen = signal(false);

export function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

/** Dynamic plugin items loaded from /api/plugins */
const pluginItems = signal([]);

/** Plugin message rates (computed from status polling) */
const pluginMsgCounts = {};

function fmtRate(rate) {
  if (rate == null || isNaN(rate)) return '';
  if (rate >= 1000) return (rate / 1000).toFixed(1) + 'k/s';
  if (rate >= 10) return Math.round(rate) + '/s';
  if (rate >= 1) return rate.toFixed(1) + '/s';
  if (rate > 0) return '<1/s';
  return '0/s';
}

const brokerSection = {
  title: 'Broker',
  items: [
    { label: 'Dashboard', hash: '#/dashboard' },
    { label: 'Live Messages', hash: '#/messages' },
  ],
};

/** Map plugin API status to StatusDot status */
function pluginDotStatus(status) {
  if (status === 'running') return 'connected';
  if (status === 'error') return 'error';
  return 'stopped';
}

function AddPluginButton() {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [newId, setNewId] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleOpen = async () => {
    setOpen(true);
    setError('');
    setNewId('');
    try {
      const res = await fetch('/api/plugins/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
        if (data.length > 0) setSelectedType(data[0].type);
      }
    } catch { /* ignore */ }
  };

  const handleCreate = async () => {
    if (!newId.trim() || !selectedType) return;
    setCreating(true);
    setError('');
    try {
      const cleanId = newId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const res = await fetch('/api/plugins/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: selectedType, id: cleanId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOpen(false);
      window.location.hash = '#/plugins/' + data.id;
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return html`
    <button class="sidebar-add-btn" onClick=${handleOpen} title="Add plugin">+</button>
    ${open && html`
      <div class="sidebar-add-dialog">
        <div class="sidebar-add-title">Add Plugin</div>
        ${templates.length === 0
          ? html`<div style="font-size:13px;color:var(--ve-text-dim);padding:8px 0;">No templates available</div>`
          : html`
            <select class="bind-select" style="width:100%;margin-bottom:8px" value=${selectedType} onChange=${(e) => setSelectedType(e.target.value)}>
              ${templates.map(t => html`<option key=${t.type} value=${t.type}>${t.label}</option>`)}
            </select>
            <div style="font-size:11px;color:var(--ve-text-dim);margin-bottom:8px;">
              ${templates.find(t => t.type === selectedType)?.description || ''}
            </div>
            <input
              type="text"
              class="bind-input"
              style="width:100%;margin-bottom:8px"
              placeholder="Name (e.g. venus-os)"
              value=${newId}
              onInput=${(e) => setNewId(e.target.value)}
              onKeyDown=${(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
            ${error && html`<div style="font-size:12px;color:var(--ve-red);margin-bottom:8px;">${error}</div>`}
            <div style="display:flex;gap:6px;justify-content:flex-end;">
              <button class="lox-push-btn" style="font-size:12px;padding:3px 10px;" onClick=${() => setOpen(false)}>Cancel</button>
              <button class="lox-cmd-btn" style="font-size:12px;padding:3px 10px;" disabled=${!newId.trim() || creating} onClick=${handleCreate}>
                ${creating ? '...' : 'Create'}
              </button>
            </div>
          `
        }
      </div>
    `}
  `;
}

export function Sidebar({ currentHash }) {

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const plugins = await fetchPlugins();
        if (!cancelled) {
          const now = Date.now();
          pluginItems.value = plugins.map(p => {
            // Compute msg/s rate from messageCount delta
            let rate = null;
            if (p.messageCount != null) {
              const prev = pluginMsgCounts[p.id];
              if (prev) {
                const dt = (now - prev.ts) / 1000;
                if (dt > 0) rate = (p.messageCount - prev.count) / dt;
              }
              pluginMsgCounts[p.id] = { count: p.messageCount, ts: now };
            }
            return {
              id: p.id,
              label: p.id === 'mqtt-bridge' ? 'MQTT-Bridge' : (p.name || p.id).charAt(0).toUpperCase() + (p.name || p.id).slice(1),
              hash: '#/plugins/' + p.id,
              status: p.status,
              rate,
            };
          });
        }
      } catch (_) {
        // API not available yet -- keep empty
      }
    }

    load();
    const interval = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return html`
    <aside class="sidebar ${menuOpen.value ? 'open' : ''}">
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="5" cy="5" r="2.5" />
            <circle cx="19" cy="5" r="2.5" />
            <circle cx="12" cy="19" r="2.5" />
            <circle cx="12" cy="12" r="1.5" />
            <line x1="7" y1="6.5" x2="10.5" y2="11" />
            <line x1="17" y1="6.5" x2="13.5" y2="11" />
            <line x1="12" y1="13.5" x2="12" y2="16.5" />
          </svg>
          <span class="sidebar-title">MQTT Master</span>
        </div>
        <div class="sidebar-status">
          <${StatusDot} status=${brokerConnected.value ? 'connected' : 'disconnected'} />
          <span>Broker</span>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">
          ${brokerSection.title}
          ${dashboardState.value.data.load_received_1min && html`
            <span class="sidebar-rate">${fmtRate(parseFloat(dashboardState.value.data.load_received_1min) / 60)}</span>
          `}
        </div>
        ${brokerSection.items.map(item => html`
          <a
            class="sidebar-nav-item ${currentHash.value === item.hash ? 'active' : ''}"
            href=${item.hash}
            onClick=${() => { menuOpen.value = false; }}
          >
            ${item.label}
          </a>
        `)}
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Plugins <${AddPluginButton} /></div>
        ${pluginItems.value.length === 0
          ? html`<div style="padding:6px 16px;font-size:13px;color:var(--ve-text-dim);">No plugins</div>`
          : pluginItems.value.map(item => html`
            <a
              class="sidebar-nav-item ${currentHash.value === item.hash ? 'active' : ''}"
              href=${item.hash}
              onClick=${() => { menuOpen.value = false; }}
            >
              <span class="sidebar-plugin-status">
                <${StatusDot} status=${pluginDotStatus(item.status)} />
                ${item.label}
                ${item.status === 'running' && html`<span class="sidebar-rate">${item.rate != null ? fmtRate(item.rate) : '0/s'}</span>`}
              </span>
            </a>
            ${item.hash === '#/plugins/loxone' && item.status === 'running' && html`
              <a
                class="sidebar-nav-item ${currentHash.value === '#/loxone/controls' ? 'active' : ''}"
                href="#/loxone/controls"
                style="padding-left:36px;font-size:13px;"
                onClick=${() => { menuOpen.value = false; }}
              >
                Elements
              </a>
              <a
                class="sidebar-nav-item ${currentHash.value === '#/loxone/bindings' ? 'active' : ''}"
                href="#/loxone/bindings"
                style="padding-left:36px;font-size:13px;"
                onClick=${() => { menuOpen.value = false; }}
              >
                Input Bindings
              </a>
            `}
            ${item.hash === '#/plugins/mqtt-bridge' && item.status === 'running' && html`
              <a
                class="sidebar-nav-item ${currentHash.value === '#/bridge/elements' ? 'active' : ''}"
                href="#/bridge/elements"
                style="padding-left:36px;font-size:13px;"
                onClick=${() => { menuOpen.value = false; }}
              >
                Elements
              </a>
              <a
                class="sidebar-nav-item ${currentHash.value === '#/bridge/bindings' ? 'active' : ''}"
                href="#/bridge/bindings"
                style="padding-left:36px;font-size:13px;"
                onClick=${() => { menuOpen.value = false; }}
              >
                Input Bindings
              </a>
            `}
          `)
        }
      </div>
    </aside>
    ${menuOpen.value && html`
      <div class="sidebar-backdrop" onClick=${toggleMenu}></div>
    `}
  `;
}
