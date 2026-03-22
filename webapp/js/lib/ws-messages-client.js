import { signal } from '@preact/signals';

/** Reactive list of received messages (newest first, max 500) */
export const messages = signal([]);

/** Set of currently active subscription topic patterns */
export const subscriptions = signal(new Set());

/** Whether the messages WebSocket is connected */
export const messagesWsConnected = signal(false);

/** Messages per second, updated every 1000ms */
export const messageRate = signal(0);

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
const MAX_MESSAGES = 500;

// Rate counter: increment on each message, read and reset every second
let rateCount = 0;
let rateInterval = null;

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/messages`;
}

export function connectMessagesWs() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const url = getWsUrl();
  ws = new WebSocket(url);

  ws.onopen = () => {
    messagesWsConnected.value = true;
    reconnectDelay = 1000;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'message': {
          rateCount++;
          const current = messages.value;
          const next = [msg, ...current];
          messages.value = next.length > MAX_MESSAGES ? next.slice(0, MAX_MESSAGES) : next;
          break;
        }
        case 'subscribed': {
          const next = new Set(subscriptions.value);
          next.add(msg.topic);
          subscriptions.value = next;
          break;
        }
        case 'unsubscribed': {
          const next = new Set(subscriptions.value);
          next.delete(msg.topic);
          subscriptions.value = next;
          break;
        }
        case 'error':
          console.warn('[ws-messages]', msg.message);
          break;
      }
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    messagesWsConnected.value = false;
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    if (ws) ws.close();
  };

  // Start rate counter
  if (!rateInterval) {
    rateInterval = setInterval(() => {
      messageRate.value = rateCount;
      rateCount = 0;
    }, 1000);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectMessagesWs();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

export function disconnectMessagesWs() {
  // Clear reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelay = 1000;

  // Clear rate interval
  if (rateInterval) {
    clearInterval(rateInterval);
    rateInterval = null;
  }
  messageRate.value = 0;
  rateCount = 0;

  // Unsubscribe all active topics before closing
  if (ws && ws.readyState === WebSocket.OPEN) {
    for (const topic of subscriptions.value) {
      try {
        ws.send(JSON.stringify({ action: 'unsubscribe', topic }));
      } catch {
        // ignore send errors during cleanup
      }
    }
  }

  // Close WebSocket
  if (ws) {
    ws.onclose = null; // prevent reconnect on intentional close
    ws.close();
    ws = null;
    messagesWsConnected.value = false;
  }

  subscriptions.value = new Set();
}

export function subscribeTopic(topic) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'subscribe', topic }));
  }
}

export function unsubscribeTopic(topic) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'unsubscribe', topic }));
  }
}

export function clearMessages() {
  messages.value = [];
}
