import { signal } from '@preact/signals';

const MAX_RECONNECT_DELAY = 30000;

/**
 * Create a managed WebSocket client with exponential backoff reconnection
 * and Preact signal-based state.
 *
 * @param {object} opts
 * @param {string} opts.path - WebSocket endpoint path (e.g. '/ws/dashboard')
 * @param {(msg: object) => void} opts.onMessage - handler for parsed JSON messages
 * @param {object} [opts.signals] - optional extra signals to expose
 * @returns {{ connected: Signal<boolean>, connect: () => void, disconnect: () => void, send: (data: any) => void }}
 */
export function createWsClient({ path, onMessage }) {
  const connected = signal(false);

  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;

  function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${path}`;
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      connected.value = true;
      reconnectDelay = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        onMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      connected.value = false;
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      if (ws) ws.close();
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectDelay = 1000;
    if (ws) {
      ws.onclose = null; // prevent reconnect on intentional close
      ws.close();
      ws = null;
      connected.value = false;
    }
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  return { connected, connect, disconnect, send };
}
