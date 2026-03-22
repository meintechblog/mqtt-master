import { html } from 'htm/preact';
import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import {
  messages,
  subscriptions,
  messagesWsConnected,
  messageRate,
  connectMessagesWs,
  disconnectMessagesWs,
  subscribeTopic,
  unsubscribeTopic,
  clearMessages,
} from '../lib/ws-messages-client.js';

function formatTimestamp(ts) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

export function Messages() {
  const [topicInput, setTopicInput] = useState('');
  const [filter, setFilter] = useState('');
  const [userScrolled, setUserScrolled] = useState(false);
  const listRef = useRef(null);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connectMessagesWs();
    return () => disconnectMessagesWs();
  }, []);

  const subs = subscriptions.value;
  const isSubscribed = subs.has(topicInput);
  const rate = messageRate.value;
  const allMessages = messages.value;

  // Filter messages by substring match on topic or payload
  const displayedMessages = filter
    ? allMessages.filter(
        (m) =>
          m.topic.includes(filter) ||
          (typeof m.payload === 'string' && m.payload.includes(filter))
      )
    : allMessages;

  const handleSubscribe = useCallback(() => {
    const topic = topicInput.trim();
    if (!topic) return;
    if (subs.has(topic)) {
      unsubscribeTopic(topic);
    } else {
      subscribeTopic(topic);
    }
  }, [topicInput, subs]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') handleSubscribe();
    },
    [handleSubscribe]
  );

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop } = listRef.current;
    if (scrollTop === 0) {
      setUserScrolled(false);
    } else {
      setUserScrolled(true);
    }
  }, []);

  const handleRemoveSub = useCallback((topic) => {
    unsubscribeTopic(topic);
  }, []);

  // Empty state logic
  const hasSubscriptions = subs.size > 0;
  const hasMessages = allMessages.length > 0;

  return html`
    <div>
      <h1 class="page-header">Live Messages</h1>

      <!-- Controls bar -->
      <div class="ve-panel msg-controls">
        <input
          type="text"
          class="msg-topic-input"
          placeholder="Topic pattern, e.g. # or home/+/temp"
          value=${topicInput}
          onInput=${(e) => setTopicInput(e.target.value)}
          onKeyDown=${handleKeyDown}
        />
        <button
          class=${`msg-btn ${isSubscribed ? 'msg-btn--unsubscribe' : 'msg-btn--subscribe'}`}
          onClick=${handleSubscribe}
          disabled=${!topicInput.trim()}
        >
          ${isSubscribed ? 'Unsubscribe' : 'Subscribe'}
        </button>
        <button class="msg-btn msg-btn--clear" onClick=${clearMessages}>
          Clear
        </button>
        <span class="msg-rate" style=${rate > 0 ? 'color: var(--ve-green)' : ''}>
          ${rate} msg/s
        </span>
      </div>

      <!-- Active subscriptions -->
      ${hasSubscriptions && html`
        <div class="msg-subscriptions">
          ${[...subs].map(
            (topic) => html`
              <span class="msg-pill" key=${topic}>
                ${topic}
                <button
                  class="msg-pill-close"
                  onClick=${() => handleRemoveSub(topic)}
                  title="Unsubscribe"
                >x</button>
              </span>
            `
          )}
        </div>
      `}

      <!-- Filter input -->
      <input
        type="text"
        class="msg-filter"
        placeholder="Filter messages..."
        value=${filter}
        onInput=${(e) => setFilter(e.target.value)}
      />

      <!-- Message list -->
      <div class="ve-card msg-list" ref=${listRef} onScroll=${handleScroll}>
        ${!hasSubscriptions && !hasMessages && html`
          <div class="msg-empty">Subscribe to a topic pattern to start seeing messages.</div>
        `}
        ${hasSubscriptions && !hasMessages && html`
          <div class="msg-empty">Waiting for messages on ${[...subs].join(', ')}...</div>
        `}
        ${displayedMessages.map(
          (m, i) => html`
            <div class="msg-row" key=${`${m.timestamp}-${i}`}>
              <span class="msg-timestamp">${formatTimestamp(m.timestamp)}</span>
              <span class="msg-topic">${m.topic}</span>
              <span class="msg-payload">${typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload)}</span>
            </div>
          `
        )}
      </div>
    </div>
  `;
}
