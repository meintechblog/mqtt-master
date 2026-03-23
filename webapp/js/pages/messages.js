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

/** Build a tree structure from flat topic list */
function buildTopicTree(topicMap) {
  const root = { children: {}, count: 0 };
  for (const [topic, data] of topicMap) {
    const parts = topic.split('/');
    let node = root;
    for (const part of parts) {
      if (!node.children[part]) {
        node.children[part] = { children: {}, count: 0, topic: null, value: null, ts: null };
      }
      node = node.children[part];
    }
    node.topic = topic;
    node.value = data.value;
    node.ts = data.ts;
    root.count++;
  }
  return root;
}

function fmtValue(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  const s = String(v);
  return s.length > 60 ? s.substring(0, 57) + '...' : s;
}

function TopicNode({ name, node, depth, expanded, toggleExpand, onCreateBinding, prevValues }) {
  const hasChildren = Object.keys(node.children).length > 0;
  const isLeaf = node.topic != null;
  const isOpen = expanded.has(name);

  // Ping animation for value changes
  const prev = prevValues.current[node.topic];
  const changed = isLeaf && prev !== undefined && prev !== node.value;
  if (isLeaf) prevValues.current[node.topic] = node.value;

  return html`
    <div>
      <div class="tb-row ${changed ? 'val-ping' : ''}" style="padding-left:${12 + depth * 16}px">
        ${hasChildren
          ? html`<span class="tb-expand ${isOpen ? 'open' : ''}" onClick=${() => toggleExpand(name)}>\u25B6</span>`
          : html`<span class="tb-expand-spacer"></span>`
        }
        <span class="tb-name ${isLeaf ? '' : 'tb-name--branch'}" onClick=${() => hasChildren && toggleExpand(name)}>${name.split('/').pop()}</span>
        ${isLeaf && html`
          <span class="tb-value">${fmtValue(node.value)}</span>
          <button class="tb-bind-btn" onClick=${() => onCreateBinding(node.topic, node.value)} title="Create Input Binding">+Bind</button>
        `}
      </div>
      ${isOpen && Object.entries(node.children)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([childName, childNode]) => html`
          <${TopicNode}
            key=${childName}
            name=${node.topic ? node.topic + '/' + childName : (depth === 0 ? childName : name + '/' + childName)}
            node=${childNode}
            depth=${depth + 1}
            expanded=${expanded}
            toggleExpand=${toggleExpand}
            onCreateBinding=${onCreateBinding}
            prevValues=${prevValues}
          />
        `)
      }
    </div>
  `;
}

function TopicBrowser({ topicMap, onCreateBinding }) {
  const [expanded, setExpanded] = useState(new Set());
  const [search, setSearch] = useState('');
  const prevValues = useRef({});

  const toggleExpand = useCallback((name) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const tree = buildTopicTree(topicMap);

  // Filter: if searching, auto-expand matching paths
  const filteredTree = search ? filterTree(tree, search.toLowerCase()) : tree;

  return html`
    <div class="tb-panel">
      <div class="tb-header">
        <span class="tb-title">Topic Browser</span>
        <span class="tb-count">${topicMap.size} topics</span>
      </div>
      ${topicMap.size > 10 && html`
        <input
          type="text"
          class="bind-input"
          style="margin:0 12px 8px;width:calc(100% - 24px)"
          placeholder="Filter topics..."
          value=${search}
          onInput=${(e) => setSearch(e.target.value)}
        />
      `}
      <div class="tb-tree">
        ${Object.entries((search ? filteredTree : tree).children)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([name, node]) => html`
            <${TopicNode}
              key=${name}
              name=${name}
              node=${node}
              depth=${0}
              expanded=${search ? autoExpandAll(tree) : expanded}
              toggleExpand=${toggleExpand}
              onCreateBinding=${onCreateBinding}
              prevValues=${prevValues}
            />
          `)
        }
        ${topicMap.size === 0 && html`
          <div style="padding:16px;text-align:center;color:var(--ve-text-dim);font-size:13px;">
            Subscribe to a topic to browse.
          </div>
        `}
      </div>
    </div>
  `;
}

/** Auto-expand all nodes (used during search) */
function autoExpandAll(tree, prefix = '') {
  const set = new Set();
  for (const [name, node] of Object.entries(tree.children)) {
    const path = prefix ? prefix + '/' + name : name;
    set.add(path);
    const sub = autoExpandAll(node, path);
    for (const s of sub) set.add(s);
  }
  return set;
}

/** Filter tree to only show nodes matching search */
function filterTree(tree, search) {
  const result = { children: {}, count: 0 };
  for (const [name, node] of Object.entries(tree.children)) {
    const fullPath = node.topic || name;
    const matches = fullPath.toLowerCase().includes(search);
    const filtered = filterTree(node, search);
    if (matches || Object.keys(filtered.children).length > 0) {
      result.children[name] = { ...node, children: matches ? node.children : filtered.children };
      result.count++;
    }
  }
  return result;
}

// ── Binding creation dialog ─────────────────────────────────────
function CreateBindingDialog({ topic, value, onClose }) {
  const [plugins, setPlugins] = useState([]);
  const [selectedPlugin, setSelectedPlugin] = useState('');
  const [jsonField, setJsonField] = useState('value');
  const [fields, setFields] = useState([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/plugins').then(r => r.json()).then(data => {
      const running = data.filter(p => p.status === 'running');
      setPlugins(running);
      if (running.length > 0) setSelectedPlugin(running[0].id);
    }).catch(() => {});

    // Parse JSON fields from value
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setFields(Object.entries(parsed).filter(([, v]) => typeof v === 'number').map(([k, v]) => ({ key: k, value: v })));
      }
    } catch { /* not JSON */ }
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const res = await fetch(`/api/plugins/${selectedPlugin}/bindings`);
      const existing = await res.json();
      const newBinding = {
        id: 'b-' + Date.now(),
        enabled: true,
        mqttTopic: topic,
        jsonField,
        targetUuid: '',
        transform: jsonField.includes('_w') || jsonField.includes('power') ? 'div1000' : '',
        keepaliveMs: 30000,
        label: topic.split('/').slice(-2).join('/') + ' ' + jsonField,
      };
      const updated = [...existing, newBinding];
      const saveRes = await fetch(`/api/plugins/${selectedPlugin}/bindings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!saveRes.ok) throw new Error((await saveRes.json()).error);
      // Navigate to the binding page to finish configuration (target selection)
      const pluginBindingRoutes = { 'loxone': '#/loxone/bindings', 'mqtt-bridge': '#/bridge/bindings' };
      window.location.hash = pluginBindingRoutes[selectedPlugin] || '#/loxone/bindings';
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return html`
    <div class="ve-modal-overlay" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="ve-modal">
        <div class="ve-modal-title">Create Input Binding</div>
        <div style="margin-bottom:12px;">
          <div class="ve-modal-field-label">Source Topic</div>
          <div style="font-family:var(--ve-font-mono);font-size:13px;color:var(--ve-blue);padding:6px 0;">${topic}</div>
        </div>
        ${fields.length > 0 && html`
          <div style="margin-bottom:12px;">
            <div class="ve-modal-field-label">JSON Field</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
              ${fields.map(f => html`
                <button
                  key=${f.key}
                  class="lox-push-btn ${jsonField === f.key ? 'lox-push-btn--active' : ''}"
                  style="font-size:12px;padding:4px 10px;"
                  onClick=${() => setJsonField(f.key)}
                >${f.key} <span style="color:var(--ve-text-dim);margin-left:4px">${f.value}</span></button>
              `)}
            </div>
          </div>
        `}
        ${fields.length === 0 && html`
          <div style="margin-bottom:12px;">
            <div class="ve-modal-field-label">JSON Field</div>
            <input class="ve-modal-input" value=${jsonField} onInput=${(e) => setJsonField(e.target.value)} placeholder="value" />
          </div>
        `}
        <div style="margin-bottom:12px;">
          <div class="ve-modal-field-label">Target Plugin</div>
          <select class="bind-select" style="width:100%;margin-top:4px;" value=${selectedPlugin} onChange=${(e) => setSelectedPlugin(e.target.value)}>
            ${plugins.map(p => html`<option key=${p.id} value=${p.id}>${p.displayName || p.name} (${p.name})</option>`)}
          </select>
        </div>
        ${error && html`<div style="font-size:13px;color:var(--ve-red);margin-bottom:8px;">${error}</div>`}
        <div class="ve-modal-actions">
          <button class="lox-push-btn" onClick=${onClose}>Cancel</button>
          <button class="lox-cmd-btn" disabled=${!selectedPlugin || !jsonField || creating} onClick=${handleCreate}>
            ${creating ? 'Creating...' : 'Create & Configure'}
          </button>
        </div>
        <div style="font-size:11px;color:var(--ve-text-dim);margin-top:8px;">
          Creates the binding and opens the plugin's Input Bindings page to select a Loxone target.
        </div>
      </div>
    </div>
  `;
}

// ── Main Messages page ──────────────────────────────────────────
export function Messages() {
  const [topicInput, setTopicInput] = useState('');
  const [filter, setFilter] = useState('');
  const [userScrolled, setUserScrolled] = useState(false);
  const [view, setView] = useState('stream'); // 'stream' or 'browser'
  const [bindDialog, setBindDialog] = useState(null);
  const listRef = useRef(null);

  // Track unique topics with latest values for the browser
  const topicMapRef = useRef(new Map());

  useEffect(() => {
    connectMessagesWs();
    return () => disconnectMessagesWs();
  }, []);

  const subs = subscriptions.value;
  const isSubscribed = subs.has(topicInput);
  const rate = messageRate.value;
  const allMessages = messages.value;

  // Update topic map from messages
  for (const m of allMessages) {
    let val = m.payload;
    try {
      const parsed = JSON.parse(m.payload);
      if (parsed && typeof parsed === 'object' && parsed.value !== undefined) val = parsed.value;
    } catch { /* not JSON */ }
    topicMapRef.current.set(m.topic, { value: val, ts: m.timestamp });
  }

  const displayedMessages = filter
    ? allMessages.filter(m => m.topic.includes(filter) || (typeof m.payload === 'string' && m.payload.includes(filter)))
    : allMessages;

  const handleSubscribe = useCallback(() => {
    const topic = topicInput.trim();
    if (!topic) return;
    if (subs.has(topic)) unsubscribeTopic(topic);
    else subscribeTopic(topic);
  }, [topicInput, subs]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleSubscribe();
  }, [handleSubscribe]);

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    setUserScrolled(listRef.current.scrollTop !== 0);
  }, []);

  const handleRemoveSub = useCallback((topic) => {
    unsubscribeTopic(topic);
  }, []);

  const handleCreateBinding = useCallback((topic, value) => {
    setBindDialog({ topic, value });
  }, []);

  const hasSubscriptions = subs.size > 0;
  const hasMessages = allMessages.length > 0;

  return html`
    <div>
      <h1 class="page-header">Live Messages</h1>

      <div class="ve-panel msg-controls">
        <input
          type="text"
          class="msg-topic-input"
          placeholder="Topic pattern, e.g. # or venus/grid/#"
          value=${topicInput}
          onInput=${(e) => setTopicInput(e.target.value)}
          onKeyDown=${handleKeyDown}
        />
        <button
          class=${`msg-btn ${isSubscribed ? 'msg-btn--unsubscribe' : 'msg-btn--subscribe'}`}
          onClick=${handleSubscribe}
          disabled=${!topicInput.trim()}
        >${isSubscribed ? 'Unsubscribe' : 'Subscribe'}</button>
        <button class="msg-btn msg-btn--clear" onClick=${() => { clearMessages(); topicMapRef.current.clear(); }}>Clear</button>
        <span class="msg-rate" style=${rate > 0 ? 'color: var(--ve-green)' : ''}>${rate} msg/s</span>
      </div>

      ${hasSubscriptions && html`
        <div class="msg-subscriptions">
          ${[...subs].map(topic => html`
            <span class="msg-pill" key=${topic}>
              ${topic}
              <button class="msg-pill-close" onClick=${() => handleRemoveSub(topic)} title="Unsubscribe">x</button>
            </span>
          `)}
        </div>
      `}

      <!-- View toggle -->
      <div class="msg-view-toggle">
        <button class="msg-view-btn ${view === 'stream' ? 'active' : ''}" onClick=${() => setView('stream')}>Stream</button>
        <button class="msg-view-btn ${view === 'browser' ? 'active' : ''}" onClick=${() => setView('browser')}>Browser</button>
      </div>

      ${view === 'stream' && html`
        <input
          type="text"
          class="msg-filter"
          placeholder="Filter messages..."
          value=${filter}
          onInput=${(e) => setFilter(e.target.value)}
        />
        <div class="ve-card msg-list" ref=${listRef} onScroll=${handleScroll}>
          ${!hasSubscriptions && !hasMessages && html`
            <div class="msg-empty">Subscribe to a topic pattern to start seeing messages.</div>
          `}
          ${hasSubscriptions && !hasMessages && html`
            <div class="msg-empty">Waiting for messages on ${[...subs].join(', ')}...</div>
          `}
          ${displayedMessages.map((m, i) => html`
            <div class="msg-row" key=${`${m.timestamp}-${i}`}>
              <span class="msg-timestamp">${formatTimestamp(m.timestamp)}</span>
              <span class="msg-topic">${m.topic}</span>
              <span class="msg-payload">${typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload)}</span>
            </div>
          `)}
        </div>
      `}

      ${view === 'browser' && html`
        <${TopicBrowser} topicMap=${topicMapRef.current} onCreateBinding=${handleCreateBinding} />
      `}

      ${bindDialog && html`
        <${CreateBindingDialog}
          topic=${bindDialog.topic}
          value=${bindDialog.value}
          onClose=${() => setBindDialog(null)}
        />
      `}
    </div>
  `;
}
