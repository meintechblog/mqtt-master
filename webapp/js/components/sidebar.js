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
    setSelectedType('');
    try {
      const res = await fetch('/api/plugins/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
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
      <div class="ve-modal-overlay" onClick=${(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
        <div class="ve-modal">
          <div class="ve-modal-title">Add Plugin</div>
          <div class="ve-modal-type-picker">
            ${templates.map(t => html`
              <div
                key=${t.type}
                class="ve-modal-type-card ${selectedType === t.type ? 've-modal-type-card--selected' : ''}"
                onClick=${() => { setSelectedType(t.type); if (!newId) setNewId(t.type); }}
              >
                <div class="ve-modal-type-label">${t.label}</div>
                <div class="ve-modal-type-desc">${t.description}</div>
              </div>
            `)}
          </div>
          ${selectedType && html`
            <div class="ve-modal-form">
              <label class="ve-modal-field-label">Instance Name</label>
              <input
                type="text"
                class="ve-modal-input"
                placeholder="e.g. venus-os, knx-gateway"
                value=${newId}
                onInput=${(e) => setNewId(e.target.value)}
                onKeyDown=${(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
            </div>
          `}
          ${error && html`<div style="font-size:13px;color:var(--ve-red);margin-top:12px;">${error}</div>`}
          <div class="ve-modal-actions">
            <button class="lox-push-btn" onClick=${() => setOpen(false)}>Cancel</button>
            <button class="lox-cmd-btn" disabled=${!newId.trim() || !selectedType || creating} onClick=${handleCreate}>
              ${creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
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
            // Plugin type label (technical name)
            // Fixed type labels - always properly capitalized
            const TYPE_LABELS = { 'loxone': 'Loxone', 'mqtt-bridge': 'MQTT-Bridge' };
            const typeLabel = TYPE_LABELS[p.id] || TYPE_LABELS[p.name] || (p.name || p.id).charAt(0).toUpperCase() + (p.name || p.id).slice(1);
            return {
              id: p.id,
              label: p.displayName || typeLabel,
              typeLabel: p.displayName ? typeLabel : '',
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
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">
          <${StatusDot} status=${brokerConnected.value ? 'connected' : 'disconnected'} />
          Lokaler Broker
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
                <span class="sidebar-plugin-info">
                  <span class="sidebar-plugin-name">${item.label}</span>
                  ${item.typeLabel && html`<span class="sidebar-plugin-type">${item.typeLabel}</span>`}
                </span>
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
