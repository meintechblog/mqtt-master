import { html } from 'htm/preact';
import { useEffect, useState, useCallback } from 'preact/hooks';
import { fetchLoxoneControlsDetailed, sendLoxoneCommand } from '../lib/api-client.js';

/** Extract the primary display value from states */
function primaryValue(type, states) {
  if (!states) return null;
  switch (type) {
    case 'Switch':
      return states.active != null ? (states.active.value > 0 ? 'ON' : 'OFF') : null;
    case 'Dimmer':
      return states.position != null ? states.position.value + '%' : null;
    case 'InfoOnlyAnalog':
      return states.value != null ? fmtNum(states.value.value) : null;
    case 'InfoOnlyDigital':
      return states.active != null ? (states.active.value > 0 ? 'Active' : 'Inactive') : null;
    case 'Meter':
      return states.actual != null ? fmtNum(states.actual.value) + ' kW' : null;
    case 'Jalousie':
      return states.position != null ? Math.round(states.position.value * 100) + '%' : null;
    default:
      return null;
  }
}

function fmtNum(v) {
  if (v == null) return '--';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(Math.abs(v) < 10 ? 3 : 1);
}

/** Is this type something we can switch on/off? */
function isControllable(type) {
  return ['Switch', 'Dimmer', 'LightControllerV2'].includes(type);
}

/** Is this type a sensor/read-only? */
function isSensor(type) {
  return ['InfoOnlyAnalog', 'InfoOnlyDigital', 'Meter'].includes(type);
}

/** Flatten controls + subcontrols into a single list of displayable items */
function flattenControls(controls) {
  const items = [];
  for (const ctrl of controls) {
    if (ctrl.subControls && ctrl.subControls.length > 0) {
      // For LightControllerV2 etc: show subcontrols as individual items
      for (const sub of ctrl.subControls) {
        items.push({
          uuid: sub.uuid,
          name: sub.name,
          type: sub.type,
          room: ctrl.room,
          category: ctrl.category,
          topic: sub.topic,
          states: sub.states,
          parentName: ctrl.name,
        });
      }
    } else {
      items.push({
        uuid: ctrl.uuid,
        name: ctrl.name,
        type: ctrl.type,
        room: ctrl.room,
        category: ctrl.category,
        topic: ctrl.topic,
        states: ctrl.states,
        parentName: null,
      });
    }
  }
  // Filter: only items with actual values or that are controllable
  // Sort: controllable first, then sensors, alphabetically within each group
  return items
    .filter(item => isControllable(item.type) || isSensor(item.type))
    .sort((a, b) => {
      const ac = isControllable(a.type) ? 0 : 1;
      const bc = isControllable(b.type) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return a.name.localeCompare(b.name);
    });
}

export function LoxoneControls() {
  const [controls, setControls] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');

  async function loadControls() {
    try {
      setError(null);
      const data = await fetchLoxoneControlsDetailed();
      setControls(data);
    } catch (err) {
      setError(err.message);
      setControls([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadControls();
    const interval = setInterval(async () => {
      try {
        const data = await fetchLoxoneControlsDetailed();
        setControls(data);
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleCmd = useCallback(async (uuid, command) => {
    try {
      await sendLoxoneCommand(uuid, command);
      setToast({ type: 'ok', text: command });
    } catch (err) {
      setToast({ type: 'error', text: err.message });
    }
    setTimeout(() => setToast(null), 2000);
  }, []);

  if (loading) return html`<div class="page-placeholder">Loading controls...</div>`;

  if (error) {
    return html`
      <div>
        <div class="page-header">Loxone Controls</div>
        <div class="ve-card" style="padding:20px;color:var(--ve-text-dim);">
          Plugin not running or unavailable: ${error}
        </div>
      </div>
    `;
  }

  const allItems = flattenControls(controls);

  const rooms = [...new Set(allItems.map(i => i.room).filter(Boolean))].sort();
  const types = [...new Set(allItems.map(i => i.type).filter(Boolean))].sort();
  const cats = [...new Set(allItems.map(i => i.category).filter(Boolean))].sort();

  const items = allItems.filter(item => {
    if (roomFilter && item.room !== roomFilter) return false;
    if (typeFilter && item.type !== typeFilter) return false;
    if (catFilter && item.category !== catFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!item.name.toLowerCase().includes(s)
        && !(item.parentName || '').toLowerCase().includes(s)
        && !item.room.toLowerCase().includes(s)
        && !item.type.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  return html`
    <div>
      <div class="page-header">
        Loxone Elements
        <span style="font-size:14px;color:var(--ve-text-dim);font-weight:400;margin-left:8px;">
          (${items.length}${items.length !== allItems.length ? ' / ' + allItems.length : ''})
        </span>
      </div>
      <div class="wiz-filters">
        <input
          type="text"
          class="bind-input"
          style="flex:1"
          placeholder="Search..."
          value=${search}
          onInput=${(e) => setSearch(e.target.value)}
        />
        ${rooms.length > 1 && html`
          <select class="bind-select" value=${roomFilter} onChange=${(e) => setRoomFilter(e.target.value)}>
            <option value="">All rooms</option>
            ${rooms.map(r => html`<option key=${r} value=${r}>${r}</option>`)}
          </select>
        `}
        ${cats.length > 1 && html`
          <select class="bind-select" value=${catFilter} onChange=${(e) => setCatFilter(e.target.value)}>
            <option value="">All categories</option>
            ${cats.map(c => html`<option key=${c} value=${c}>${c}</option>`)}
          </select>
        `}
        ${types.length > 1 && html`
          <select class="bind-select" value=${typeFilter} onChange=${(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            ${types.map(t => html`<option key=${t} value=${t}>${t}</option>`)}
          </select>
        `}
        ${(search || roomFilter || catFilter || typeFilter) && html`
          <button class="lox-push-btn" onClick=${() => { setSearch(''); setRoomFilter(''); setCatFilter(''); setTypeFilter(''); }}>Reset</button>
        `}
      </div>
      ${items.length === 0 && html`
        <div class="ve-card" style="padding:20px;text-align:center;color:var(--ve-text-dim);">
          ${allItems.length === 0 ? 'No elements discovered.' : 'No elements match the filter.'}
        </div>
      `}
      <div class="lox-list">
        ${items.map(item => {
          const val = primaryValue(item.type, item.states);
          const controllable = isControllable(item.type);
          const isOn = item.type === 'Switch' ? item.states?.active?.value > 0
            : item.type === 'Dimmer' ? item.states?.position?.value > 0
            : false;
          const isExpanded = expanded === item.uuid;

          // Build MQTT topic list for this element
          const topics = [];
          if (item.topic) {
            // State topics (outgoing from Loxone → MQTT)
            if (item.states) {
              for (const [key, state] of Object.entries(item.states)) {
                if (state) {
                  const v = state.value != null ? state.value : state.text;
                  topics.push({ topic: item.topic + '/' + key + '/state', label: key, value: v, dir: 'out' });
                }
              }
            }
            // Command topic (incoming MQTT → Loxone)
            if (controllable) {
              topics.push({ topic: item.topic + '/cmd', label: 'command', value: null, dir: 'in' });
            }
          }

          return html`
            <div class="lox-item-wrap" key=${item.uuid}>
              <div class="lox-item" onClick=${() => setExpanded(isExpanded ? null : item.uuid)} style="cursor:pointer">
                <div class="lox-item-info">
                  <span class="lox-item-name">
                    ${item.name}
                    ${item.parentName && html`<span class="lox-item-parent">${item.parentName}</span>`}
                  </span>
                  <span class="lox-item-meta">
                    ${item.room}${item.category ? ' · ' + item.category : ''} · ${item.type}
                  </span>
                </div>
                <div class="lox-item-value ${val && (val === 'ON' || val === 'Active' || (controllable && isOn)) ? 'on' : ''}">${val || '--'}</div>
                ${controllable && html`
                  <div class="lox-item-actions">
                    <button class="lox-push-btn" onClick=${(e) => { e.stopPropagation(); handleCmd(item.uuid, 'on'); }}>On</button>
                    <button class="lox-push-btn" onClick=${(e) => { e.stopPropagation(); handleCmd(item.uuid, 'off'); }}>Off</button>
                  </div>
                `}
              </div>
              ${isExpanded && topics.length > 0 && html`
                <div class="lox-item-topics">
                  ${topics.map(t => html`
                    <div class="lox-topic-row" key=${t.topic}>
                      <span class="lox-topic-dir" title=${t.dir === 'out' ? 'Loxone → MQTT (outgoing)' : 'MQTT → Loxone (incoming)'}>
                        <svg class="lox-topic-mqtt" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="12" cy="19" r="2.5"/><circle cx="12" cy="12" r="1.5"/><line x1="7" y1="6.5" x2="10.5" y2="11"/><line x1="17" y1="6.5" x2="13.5" y2="11"/><line x1="12" y1="13.5" x2="12" y2="16.5"/></svg>
                        <span class="lox-topic-arrow lox-topic-dir--${t.dir}">${t.dir === 'out' ? '←' : '→'}</span>
                      </span>
                      <span class="lox-topic-path">${t.topic}</span>
                      <span class="lox-topic-label">${t.label}</span>
                      ${t.value != null && html`
                        <span class="lox-topic-val">${typeof t.value === 'number' ? (Number.isInteger(t.value) ? t.value : t.value.toFixed(3)) : t.value}</span>
                      `}
                      ${t.value == null && html`<span class="lox-topic-val" style="color:var(--ve-text-dim)">writable</span>`}
                    </div>
                  `)}
                </div>
              `}
            </div>
          `;
        })}
      </div>
      ${toast && html`<div class="lox-toast lox-toast--${toast.type}">${toast.text}</div>`}
    </div>
  `;
}
