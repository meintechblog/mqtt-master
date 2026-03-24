import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { dashboardState, brokerConnected } from '../lib/ws-client.js';
import { fetchPlugins } from '../lib/api-client.js';

function fmtBytes(bytes) {
  if (bytes == null) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtUptime(seconds) {
  if (seconds == null) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtRate(val) {
  if (val == null) return '--';
  const n = parseFloat(val);
  if (isNaN(n)) return '--';
  const perSec = n / 60;
  if (perSec >= 1000) return (perSec / 1000).toFixed(1) + 'k';
  if (perSec >= 10) return Math.round(perSec).toString();
  if (perSec >= 1) return perSec.toFixed(1);
  return '<1';
}

function fmtNum(val) {
  if (val == null) return '--';
  return Number(val).toLocaleString();
}

function stripVersion(v) {
  return v ? v.replace(/^mosquitto version\s*/i, '') : '--';
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

  const runningPlugins = plugins.filter(p => p.status === 'running');
  const stoppedPlugins = plugins.filter(p => p.status !== 'running');

  return html`
    <div>
      <h1 class="page-header">Dashboard</h1>

      <!-- Hero: Key metrics -->
      <div class="dash-hero">
        <div class="dash-hero-card dash-hero-card--accent">
          <div class="dash-hero-value">${fmtRate(d.load_received_1min)}</div>
          <div class="dash-hero-unit">msg/s</div>
          <div class="dash-hero-label">Message Rate</div>
        </div>
        <div class="dash-hero-card">
          <div class="dash-hero-value">${d.clients_connected ?? '--'}</div>
          <div class="dash-hero-label">Clients</div>
        </div>
        <div class="dash-hero-card">
          <div class="dash-hero-value">${d.subscriptions_count ?? '--'}</div>
          <div class="dash-hero-label">Subscriptions</div>
        </div>
        <div class="dash-hero-card">
          <div class="dash-hero-value">${fmtUptime(d.uptime)}</div>
          <div class="dash-hero-label">Uptime</div>
        </div>
      </div>

      <!-- Row 2: Broker + Plugins -->
      <div class="dash-row2">
        <!-- Broker details -->
        <div class="dash-card">
          <div class="dash-card-title">
            <span class="status-dot ${connected ? 'status-dot--connected' : 'status-dot--disconnected'}"></span>
            Broker
          </div>
          <div class="dash-detail-grid">
            <div class="dash-detail">
              <span class="dash-detail-label">Version</span>
              <span class="dash-detail-value">${stripVersion(d.version)}</span>
            </div>
            <div class="dash-detail">
              <span class="dash-detail-label">Heap</span>
              <span class="dash-detail-value">${fmtBytes(d.heap_current)}</span>
            </div>
            <div class="dash-detail">
              <span class="dash-detail-label">Messages In</span>
              <span class="dash-detail-value">${fmtNum(d.messages_received)}</span>
            </div>
            <div class="dash-detail">
              <span class="dash-detail-label">Messages Out</span>
              <span class="dash-detail-value">${fmtNum(d.messages_sent)}</span>
            </div>
            <div class="dash-detail">
              <span class="dash-detail-label">Publish In</span>
              <span class="dash-detail-value">${fmtRate(d.publish_received_1min)}/s</span>
            </div>
            <div class="dash-detail">
              <span class="dash-detail-label">Publish Out</span>
              <span class="dash-detail-value">${fmtRate(d.publish_sent_1min)}/s</span>
            </div>
          </div>
        </div>

        <!-- Plugins overview -->
        <div class="dash-card">
          <div class="dash-card-title">Plugins</div>
          ${plugins.length === 0 && html`
            <div style="color:var(--ve-text-dim);font-size:13px;padding:12px 0;text-align:center;">
              No plugins configured.<br/>
              <span style="font-size:12px;">Use the <strong>+</strong> button in the sidebar to add one.</span>
            </div>
          `}
          <div class="dash-plugin-list">
            ${runningPlugins.map(p => html`
              <a class="dash-plugin" key=${p.id} href="#/plugins/${p.id}">
                <span class="status-dot status-dot--connected"></span>
                <span class="dash-plugin-name">${p.displayName || p.name}</span>
                ${p.displayName && html`<span class="dash-plugin-type">${p.name}</span>`}
                ${p.messageCount != null && html`
                  <span class="dash-plugin-stat">${p.messageCount.toLocaleString()} msgs</span>
                `}
                ${p.controlCount != null && html`
                  <span class="dash-plugin-stat">${p.controlCount} controls</span>
                `}
              </a>
            `)}
            ${stoppedPlugins.map(p => html`
              <a class="dash-plugin dash-plugin--stopped" key=${p.id} href="#/plugins/${p.id}">
                <span class="status-dot status-dot--stopped"></span>
                <span class="dash-plugin-name">${p.displayName || p.name}</span>
                ${p.error && html`<span class="dash-plugin-error">${p.error}</span>`}
              </a>
            `)}
          </div>
        </div>
      </div>

      <!-- Row 3: Load -->
      <div class="dash-card">
        <div class="dash-card-title">Load Average</div>
        <div class="dash-load">
          <div class="dash-load-item">
            <div class="dash-load-value">${fmtRate(d.load_received_1min)}</div>
            <div class="dash-load-period">1 min</div>
          </div>
          <div class="dash-load-item">
            <div class="dash-load-value">${fmtRate(d.load_received_5min)}</div>
            <div class="dash-load-period">5 min</div>
          </div>
          <div class="dash-load-item">
            <div class="dash-load-value">${fmtRate(d.load_received_15min)}</div>
            <div class="dash-load-period">15 min</div>
          </div>
        </div>
      </div>
    </div>
  `;
}
