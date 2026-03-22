import { html } from 'htm/preact';
import { dashboardState, brokerConnected } from '../lib/ws-client.js';
import { StatCard } from '../components/stat-card.js';
import { TopicTree } from '../components/topic-tree.js';

function formatBytes(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUptime(seconds) {
  if (seconds == null) return null;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

function stripVersionPrefix(version) {
  if (!version) return null;
  return version.replace(/^mosquitto version\s*/i, '');
}

export function Dashboard() {
  const d = dashboardState.value.data || {};
  const topics = dashboardState.value.topics || {};

  const loadDisplay = (d.load_received_1min != null)
    ? `${d.load_received_1min} / ${d.load_received_5min} / ${d.load_received_15min}`
    : null;

  const heapLabel = d.heap_maximum
    ? `Heap Usage (max ${formatBytes(d.heap_maximum)})`
    : 'Heap Usage';

  return html`
    <div>
      <h1 class="page-header">Dashboard</h1>

      <div class="ve-grid dashboard-section">
        <${StatCard} label="Connected Clients" value=${d.clients_connected} />
        <${StatCard} label="Msgs In" value=${d.publish_received_1min} unit="/s" />
        <${StatCard} label="Msgs Out" value=${d.publish_sent_1min} unit="/s" />
        <${StatCard} label="Subscriptions" value=${d.subscriptions_count} />
        <${StatCard} label=${heapLabel} value=${formatBytes(d.heap_current)} />
        <${StatCard} label="Load 1 / 5 / 15 min" value=${loadDisplay} />
      </div>

      <div class="ve-panel broker-info dashboard-section">
        <div class="topic-tree-header">Broker Info</div>
        <div class="broker-info-grid">
          <div class="broker-info-item">
            <div class="broker-info-label">Version</div>
            <div class="broker-info-value">${stripVersionPrefix(d.version) || '--'}</div>
          </div>
          <div class="broker-info-item">
            <div class="broker-info-label">Uptime</div>
            <div class="broker-info-value">${formatUptime(d.uptime) || '--'}</div>
          </div>
          <div class="broker-info-item">
            <div class="broker-info-label">Messages Received</div>
            <div class="broker-info-value">${d.messages_received != null ? d.messages_received.toLocaleString() : '--'}</div>
          </div>
          <div class="broker-info-item">
            <div class="broker-info-label">Messages Sent</div>
            <div class="broker-info-value">${d.messages_sent != null ? d.messages_sent.toLocaleString() : '--'}</div>
          </div>
        </div>
      </div>

      <div class="dashboard-section">
        <${TopicTree} topics=${topics} />
      </div>
    </div>
  `;
}
