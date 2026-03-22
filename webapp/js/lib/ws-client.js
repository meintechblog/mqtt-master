import { signal } from '@preact/signals';

/** Reactive state for dashboard metrics from $SYS topics */
export const dashboardState = signal({ data: {}, topics: {} });

/** Whether the MQTT broker is connected (from backend connection_status messages) */
export const brokerConnected = signal(false);

/** Whether the WebSocket transport itself is open */
export const wsConnected = signal(false);

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/dashboard`;
}

export function connectDashboardWs() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const url = getWsUrl();
  ws = new WebSocket(url);

  ws.onopen = () => {
    wsConnected.value = true;
    reconnectDelay = 1000; // reset backoff on successful connection
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'sys_state':
          dashboardState.value = { data: msg.data, topics: msg.topics };
          break;
        case 'connection_status':
          brokerConnected.value = msg.connected;
          break;
      }
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    wsConnected.value = false;
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // Force close to trigger onclose -> reconnect
    if (ws) ws.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectDashboardWs();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

export function disconnectDashboardWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelay = 1000;
  if (ws) {
    ws.onclose = null; // prevent reconnect on intentional close
    ws.close();
    ws = null;
    wsConnected.value = false;
  }
}

// Auto-connect on module import
connectDashboardWs();
