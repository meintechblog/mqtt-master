import { html } from 'htm/preact';
import { signal } from '@preact/signals';
import { StatusDot } from './status-dot.js';

export const menuOpen = signal(false);

export function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

const sections = [
  {
    title: 'Broker',
    items: [
      { label: 'Dashboard', hash: '#/dashboard' },
      { label: 'Live Messages', hash: '#/messages' },
    ],
  },
  {
    title: 'Plugins',
    items: [], // Populated dynamically in Phase 4
  },
];

export function Sidebar({ currentHash }) {
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
          <${StatusDot} status="disconnected" />
          <span>Broker</span>
        </div>
      </div>
      ${sections.filter(s => s.items.length > 0).map(section => html`
        <div class="sidebar-section">
          <div class="sidebar-section-title">${section.title}</div>
          ${section.items.map(item => html`
            <a
              class="sidebar-nav-item ${currentHash.value === item.hash ? 'active' : ''}"
              href=${item.hash}
              onClick=${() => { menuOpen.value = false; }}
            >
              ${item.label}
            </a>
          `)}
        </div>
      `)}
    </aside>
    ${menuOpen.value && html`
      <div class="sidebar-backdrop" onClick=${toggleMenu}></div>
    `}
  `;
}
