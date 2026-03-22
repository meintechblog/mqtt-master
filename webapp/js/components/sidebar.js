import { html } from 'htm/preact';
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { StatusDot } from './status-dot.js';
import { brokerConnected } from '../lib/ws-client.js';
import { fetchPlugins } from '../lib/api-client.js';

export const menuOpen = signal(false);

export function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

/** Dynamic plugin items loaded from /api/plugins */
const pluginItems = signal([]);

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

export function Sidebar({ currentHash }) {

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const plugins = await fetchPlugins();
        if (!cancelled) {
          pluginItems.value = plugins.map(p => ({
            label: (p.name || p.id) === 'mqtt-bridge' ? 'MQTT-Bridge' : (p.name || p.id).charAt(0).toUpperCase() + (p.name || p.id).slice(1),
            hash: '#/plugins/' + p.id,
            status: p.status,
          }));
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
        <div class="sidebar-section-title">${brokerSection.title}</div>
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
        <div class="sidebar-section-title">Plugins</div>
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
