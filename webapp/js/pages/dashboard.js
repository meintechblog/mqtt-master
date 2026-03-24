import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { dashboardState, brokerConnected } from '../lib/ws-client.js';
import { fetchPlugins } from '../lib/api-client.js';
import { StatusDot } from '../components/status-dot.js';
import { fmtRate, fmtTotal, fmtUptime } from '../lib/format.js';

function stripVersion(v) {
  return v ? v.replace(/^mosquitto version\s*/i, '') : '--';
}

function pluginDotStatus(p) {
  if (p.status === 'error') return 'error';
  if (p.status === 'running' && p.connected === false) return 'error';
  if (p.status === 'running') return 'connected';
  return 'stopped';
}

export function Dashboard() {
  const [plugins, setPlugins] = useState([]);

  useEffect(() => {
    fetchPlugins().then(setPlugins).catch(() => {});
    const interval = setInterval(() => {
      fetchPlugins().then(setPlugins).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const d = dashboardState.value.data || {};
  const connected = brokerConnected.value;

  return html`
    <div>
      <h1 class="page-header">Dashboard</h1>

      <!-- Hero metrics -->
      <div class="dash-hero">
        <div class="dash-hero-card dash-hero-card--accent">
          <div class="dash-hero-value">${fmtRate(d.load_received_1min)}</div>
          <div class="dash-hero-unit">msg/s in</div>
          <div class="dash-hero-label">Receive Rate</div>
        </div>
        <div class="dash-hero-card">
          <div class="dash-hero-value">${fmtRate(d.load_sent_1min)}</div>
          <div class="dash-hero-unit">msg/s out</div>
          <div class="dash-hero-label">Send Rate</div>
        </div>
        <div class="dash-hero-card">
          <div class="dash-hero-value">${d.clients_connected ?? '--'}</div>
          <div class="dash-hero-label">Clients</div>
        </div>
        <div class="dash-hero-card">
          <div class="dash-hero-value">${fmtUptime(d.uptime)}</div>
          <div class="dash-hero-label">Uptime</div>
        </div>
      </div>

      <div class="dash-row2">
        <!-- Broker -->
        <div class="dash-card">
          <div class="dash-card-title">
            <${StatusDot} status=${connected ? 'connected' : 'disconnected'} />
            Lokaler Broker
          </div>
          <div class="dash-detail-grid">
            <div class="dash-detail">
              <span class="dash-detail-label">Version</span>
              <span class="dash-detail-value">${stripVersion(d.version)}</span>
            </div>
            <div class="dash-detail">
              <span class="dash-detail-label">Subscriptions</span>
              <span class="dash-detail-value">${d.subscriptions_count ?? '--'}</span>
            </div>
            <div class="dash-detail">
              <span class="dash-detail-label">Total In</span>
              <span class="dash-detail-value">${fmtTotal(d.messages_received)}</span>
            </div>
            <div class="dash-detail">
              <span class="dash-detail-label">Total Out</span>
              <span class="dash-detail-value">${fmtTotal(d.messages_sent)}</span>
            </div>
          </div>
        </div>

        <!-- Plugins -->
        <div class="dash-card">
          <div class="dash-card-title">Plugins</div>
          ${plugins.length === 0 && html`
            <div style="color:var(--ve-text-dim);font-size:13px;padding:12px 0;text-align:center;">
              No plugins configured.<br/>
              <span style="font-size:12px;">Use the <strong>+</strong> button in the sidebar to add one.</span>
            </div>
          `}
          <div class="dash-plugin-list">
            ${plugins.map(p => html`
              <a class="dash-plugin ${p.status !== 'running' ? 'dash-plugin--stopped' : ''}" key=${p.id} href="#/plugins/${p.id}">
                <${StatusDot} status=${pluginDotStatus(p)} />
                <div class="dash-plugin-info">
                  <span class="dash-plugin-name">${p.displayName || p.name}</span>
                  ${p.displayName && html`<span class="dash-plugin-type">${p.name}</span>`}
                </div>
                <div class="dash-plugin-stats">
                  ${p.controlCount != null && html`<span>${p.controlCount} elements</span>`}
                  ${p.messageCount != null && html`<span>${fmtTotal(p.messageCount)} msgs</span>`}
                  ${p.error && html`<span style="color:var(--ve-red)">${p.error}</span>`}
                </div>
              </a>
            `)}
          </div>
        </div>
      </div>
    </div>
  `;
}
