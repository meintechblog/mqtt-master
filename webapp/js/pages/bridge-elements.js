import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

function fmtNum(v) {
  if (v == null) return '--';
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1);
}

/** Group topics by category (first path segment after prefix) */
function groupByCategory(elements) {
  const groups = {};
  for (const el of elements) {
    const parts = el.localTopic.split('/');
    // venus/system/0/... → category = "system"
    const cat = parts.length >= 2 ? parts[1] : 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(el);
  }
  return groups;
}

export function BridgeElements() {
  const [elements, setElements] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/plugins/mqtt-bridge/elements');
        if (!res.ok) throw new Error((await res.json()).error || res.statusText);
        setElements(await res.json());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/plugins/mqtt-bridge/elements');
        if (res.ok) setElements(await res.json());
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return html`<div class="page-placeholder">Loading...</div>`;

  if (error) {
    return html`
      <div>
        <div class="page-header">MQTT-Bridge Elements</div>
        <div class="ve-card" style="padding:20px;color:var(--ve-text-dim);">
          Plugin not running or unavailable: ${error}
        </div>
      </div>
    `;
  }

  const cats = [...new Set(elements.map(el => {
    const parts = el.localTopic.split('/');
    return parts.length >= 2 ? parts[1] : 'other';
  }))].sort();

  const filtered = elements.filter(el => {
    if (catFilter) {
      const parts = el.localTopic.split('/');
      const cat = parts.length >= 2 ? parts[1] : 'other';
      if (cat !== catFilter) return false;
    }
    if (search) {
      const s = search.toLowerCase();
      if (!el.localTopic.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  return html`
    <div>
      <div class="page-header">
        MQTT-Bridge Elements
        <span style="font-size:14px;color:var(--ve-text-dim);font-weight:400;margin-left:8px;">
          (${filtered.length}${filtered.length !== elements.length ? ' / ' + elements.length : ''})
        </span>
      </div>
      <div class="wiz-filters">
        <input
          type="text"
          class="bind-input"
          style="flex:1"
          placeholder="Search topics..."
          value=${search}
          onInput=${(e) => setSearch(e.target.value)}
        />
        ${cats.length > 1 && html`
          <select class="bind-select" value=${catFilter} onChange=${(e) => setCatFilter(e.target.value)}>
            <option value="">All (${cats.join(', ')})</option>
            ${cats.map(c => html`<option key=${c} value=${c}>${c}</option>`)}
          </select>
        `}
        ${(search || catFilter) && html`
          <button class="lox-push-btn" onClick=${() => { setSearch(''); setCatFilter(''); }}>Reset</button>
        `}
      </div>
      ${filtered.length === 0 && html`
        <div class="ve-card" style="padding:20px;text-align:center;color:var(--ve-text-dim);">
          ${elements.length === 0 ? 'No topics bridged yet. Is the bridge connected?' : 'No topics match the filter.'}
        </div>
      `}
      <div class="lox-list">
        ${filtered.map(el => {
          // Extract short name from topic: last meaningful segment(s)
          const parts = el.localTopic.split('/');
          const shortName = parts.slice(-2).join('/');
          const category = parts.length >= 2 ? parts[1] : '';

          return html`
            <div class="lox-item" key=${el.localTopic}>
              <div class="lox-item-info">
                <span class="lox-item-name">${shortName}</span>
                <span class="lox-item-meta">${el.localTopic}</span>
              </div>
              <div class="lox-item-value">${fmtNum(el.value)}</div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}
