import { html } from 'htm/preact';
import { useEffect, useState, useRef } from 'preact/hooks';
import { dashboardState, brokerConnected } from '../lib/ws-client.js';
import { fetchPlugins } from '../lib/api-client.js';
import { StatusDot } from '../components/status-dot.js';
import { fmtRate, fmtTotal, fmtUptime } from '../lib/format.js';

const MAX_SPARKLINE_POINTS = 60;

function stripVersion(v) {
  return v ? v.replace(/^mosquitto version\s*/i, '') : '--';
}

function pluginDotStatus(p) {
  if (p.status === 'error') return 'error';
  if (p.status === 'running' && p.connected === false) return 'error';
  if (p.status === 'running') return 'connected';
  return 'stopped';
}

/** SVG sparkline from an array of values */
function Sparkline({ data, color = 'var(--ve-blue)', height = 32, width = 120 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ');
  const lastY = height - ((data[data.length - 1] - min) / range) * (height - 4) - 2;

  return html`
    <svg class="dash-sparkline" width=${width} height=${height} viewBox="0 0 ${width} ${height}">
      <polyline points=${points} fill="none" stroke=${color} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx=${width} cy=${lastY} r="2.5" fill=${color} class="dash-spark-dot" />
    </svg>
  `;
}

/** Live activity bar - shows pulses based on message rate */
function ActivityBar({ rateIn, rateOut }) {
  const inRate = parseFloat(rateIn) / 60 || 0;
  const outRate = parseFloat(rateOut) / 60 || 0;
  const maxRate = Math.max(inRate, outRate, 1);
  const inPct = Math.min((inRate / maxRate) * 100, 100);
  const outPct = Math.min((outRate / maxRate) * 100, 100);

  return html`
    <div class="dash-activity">
      <div class="dash-activity-row">
        <span class="dash-activity-label">IN</span>
        <div class="dash-activity-track">
          <div class="dash-activity-fill dash-activity-fill--in" style="width:${inPct}%"></div>
        </div>
        <span class="dash-activity-rate">${fmtRate(rateIn)}/s</span>
      </div>
      <div class="dash-activity-row">
        <span class="dash-activity-label">OUT</span>
        <div class="dash-activity-track">
          <div class="dash-activity-fill dash-activity-fill--out" style="width:${outPct}%"></div>
        </div>
        <span class="dash-activity-rate">${fmtRate(rateOut)}/s</span>
      </div>
    </div>
  `;
}

export function Dashboard() {
  const [plugins, setPlugins] = useState([]);
  const rateHistory = useRef({ in: [], out: [] });
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    fetchPlugins().then(setPlugins).catch(() => {});
    const pluginInterval = setInterval(() => {
      fetchPlugins().then(setPlugins).catch(() => {});
    }, 5000);

    // Track rate history for sparklines
    const historyInterval = setInterval(() => {
      const d = dashboardState.value.data || {};
      const inRate = parseFloat(d.load_received_1min) / 60 || 0;
      const outRate = parseFloat(d.load_sent_1min) / 60 || 0;
      const h = rateHistory.current;
      h.in = [...h.in, inRate].slice(-MAX_SPARKLINE_POINTS);
      h.out = [...h.out, outRate].slice(-MAX_SPARKLINE_POINTS);
      setHistoryVersion(v => v + 1);
    }, 2000);

    return () => { clearInterval(pluginInterval); clearInterval(historyInterval); };
  }, []);

  const d = dashboardState.value.data || {};
  const connected = brokerConnected.value;
  const h = rateHistory.current;

  return html`
    <div>
      <h1 class="page-header">Dashboard</h1>

      <!-- Hero: rate cards with sparklines -->
      <div class="dash-hero">
        <div class="dash-hero-card dash-hero-card--accent">
          <div class="dash-hero-top">
            <div>
              <div class="dash-hero-value">${fmtRate(d.load_received_1min)}</div>
              <div class="dash-hero-unit">msg/s</div>
            </div>
            <${Sparkline} data=${h.in} color="var(--ve-blue)" />
          </div>
          <div class="dash-hero-label">Receive Rate</div>
          ${connected && html`<div class="dash-hero-glow"></div>`}
        </div>
        <div class="dash-hero-card">
          <div class="dash-hero-top">
            <div>
              <div class="dash-hero-value">${fmtRate(d.load_sent_1min)}</div>
              <div class="dash-hero-unit">msg/s</div>
            </div>
            <${Sparkline} data=${h.out} color="var(--ve-green)" />
          </div>
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

      <!-- Activity bar -->
      <${ActivityBar} rateIn=${d.load_received_1min} rateOut=${d.load_sent_1min} />

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
