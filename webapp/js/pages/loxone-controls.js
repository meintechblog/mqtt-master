import { html } from 'htm/preact';
import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { fetchLoxoneControlsDetailed, sendLoxoneCommand } from '../lib/api-client.js';
import { fmtNum, mqttIcon } from '../lib/format.js';

function DirBadge({ dir }) {
  const title = dir === 'out' ? 'Plugin → MQTT (outgoing)' : dir === 'in' ? 'MQTT → Plugin (incoming)' : 'bidirectional';
  if (dir === 'both') {
    return html`<span class="lox-dir-badge" title=${title}>${mqttIcon}<span class="lox-dir-both"><span class="lox-topic-arrow lox-topic-dir--out">\u2190</span><span class="lox-topic-arrow lox-topic-dir--in">\u2192</span></span></span>`;
  }
  return html`<span class="lox-dir-badge" title=${title}>${mqttIcon}<span class="lox-topic-arrow lox-topic-dir--${dir}">${dir === 'out' ? '\u2190' : '\u2192'}</span></span>`;
}

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

function isControllable(type) {
  return ['Switch', 'Dimmer', 'LightControllerV2'].includes(type);
}

function isSensor(type) {
  return ['InfoOnlyAnalog', 'InfoOnlyDigital', 'Meter'].includes(type);
}

/** Flatten controls + subcontrols into a single list */
function flattenControls(controls) {
  const items = [];
  for (const ctrl of controls) {
    if (ctrl.subControls && ctrl.subControls.length > 0) {
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
  return items.filter(item => isControllable(item.type) || isSensor(item.type));
}

/** Group items by category, then by room within each category */
function buildGroups(items) {
  const catMap = {};
  for (const item of items) {
    const cat = item.category || 'Other';
    if (!catMap[cat]) catMap[cat] = {};
    const room = item.room || 'Unknown';
    if (!catMap[cat][room]) catMap[cat][room] = [];
    catMap[cat][room].push(item);
  }
  // Sort categories, rooms, items
  return Object.entries(catMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cat, rooms]) => ({
      category: cat,
      rooms: Object.entries(rooms)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([room, items]) => ({
          room,
          items: items.sort((a, b) => {
            const ac = isControllable(a.type) ? 0 : 1;
            const bc = isControllable(b.type) ? 0 : 1;
            if (ac !== bc) return ac - bc;
            return a.name.localeCompare(b.name);
          }),
        })),
      count: Object.values(rooms).reduce((s, r) => s + r.length, 0),
    }));
}

function CategorySection({ group, search, typeFilter, expanded, setExpanded, onCmd, prevValues }) {
  const [open, setOpen] = useState(false);

  const filtered = group.rooms.map(r => ({
    ...r,
    items: r.items.filter(item => {
      if (typeFilter && item.type !== typeFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!item.name.toLowerCase().includes(s)
          && !(item.parentName || '').toLowerCase().includes(s)
          && !item.type.toLowerCase().includes(s)) return false;
      }
      return true;
    }),
  })).filter(r => r.items.length > 0);

  const totalFiltered = filtered.reduce((s, r) => s + r.items.length, 0);
  if (totalFiltered === 0) return null;

  return html`
    <div class="bridge-cat">
      <div class="bridge-cat-header" onClick=${() => setOpen(!open)}>
        <span class="bridge-cat-expand ${open ? 'open' : ''}">\u25B6</span>
        <span class="bridge-cat-label">${group.category}</span>
        <span class="bridge-cat-count">${totalFiltered}</span>
      </div>
      ${open && html`
        <div class="bridge-cat-body">
          ${filtered.map(r => html`
            ${filtered.length > 1 && html`<div class="bridge-group-label">${r.room}</div>`}
            ${r.items.map(item => {
              const val = primaryValue(item.type, item.states);
              const controllable = isControllable(item.type);
              const isOn = item.type === 'Switch' ? item.states?.active?.value > 0
                : item.type === 'Dimmer' ? item.states?.position?.value > 0
                : false;
              const isExpanded = expanded === item.uuid;

              const prevVal = prevValues.current[item.uuid];
              const changed = prevVal !== undefined && prevVal !== val;
              prevValues.current[item.uuid] = val;

              const topics = [];
              if (item.topic) {
                if (item.states) {
                  for (const [key, state] of Object.entries(item.states)) {
                    if (state) {
                      const v = state.value != null ? state.value : state.text;
                      topics.push({ topic: item.topic + '/' + key + '/state', label: key, value: v, dir: 'out' });
                    }
                  }
                }
                if (controllable) {
                  topics.push({ topic: item.topic + '/cmd', label: 'command', value: null, dir: 'in' });
                }
              }

              return html`
                <div class="lox-item-wrap" key=${item.uuid}>
                  <div class="lox-item ${changed ? 'val-ping' : ''}" onClick=${() => setExpanded(isExpanded ? null : item.uuid)} style="cursor:pointer">
                    <${DirBadge} dir=${controllable ? 'both' : 'out'} />
                    <div class="lox-item-info">
                      <span class="lox-item-name">
                        ${item.name}
                        ${item.parentName && html`<span class="lox-item-parent">${item.parentName}</span>`}
                      </span>
                      <span class="lox-item-meta">${item.type}</span>
                    </div>
                    <div class="lox-item-value ${val && (val === 'ON' || val === 'Active' || (controllable && isOn)) ? 'on' : ''}">${val || '--'}</div>
                    ${controllable && html`
                      <div class="lox-item-actions">
                        <button class="lox-push-btn" onClick=${(e) => { e.stopPropagation(); onCmd(item.uuid, 'on'); }}>On</button>
                        <button class="lox-push-btn" onClick=${(e) => { e.stopPropagation(); onCmd(item.uuid, 'off'); }}>Off</button>
                      </div>
                    `}
                  </div>
                  ${isExpanded && topics.length > 0 && html`
                    <div class="lox-item-topics">
                      ${topics.map(t => html`
                        <div class="lox-topic-row" key=${t.topic}>
                          <span class="lox-topic-dir" title=${t.dir === 'out' ? 'Loxone → MQTT (outgoing)' : 'MQTT → Loxone (incoming)'}>
                            <svg class="lox-topic-mqtt" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="12" cy="19" r="2.5"/><circle cx="12" cy="12" r="1.5"/><line x1="7" y1="6.5" x2="10.5" y2="11"/><line x1="17" y1="6.5" x2="13.5" y2="11"/><line x1="12" y1="13.5" x2="12" y2="16.5"/></svg>
                            <span class="lox-topic-arrow lox-topic-dir--${t.dir}">${t.dir === 'out' ? '\u2190' : '\u2192'}</span>
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
          `)}
        </div>
      `}
    </div>
  `;
}

export function LoxoneControls() {
  const [controls, setControls] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const prevValues = useRef({});

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

  if (loading) return html`<div class="page-placeholder">Loading...</div>`;

  if (error) {
    return html`
      <div>
        <div class="page-header">Loxone Elements</div>
        <div class="ve-card" style="padding:20px;color:var(--ve-text-dim);">
          Plugin not running or unavailable: ${error}
        </div>
      </div>
    `;
  }

  const allItems = flattenControls(controls);
  const types = [...new Set(allItems.map(i => i.type))].sort();
  const groups = buildGroups(allItems);

  // Count filtered items
  const filteredCount = allItems.filter(item => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!item.name.toLowerCase().includes(s)
        && !(item.parentName || '').toLowerCase().includes(s)
        && !item.type.toLowerCase().includes(s)) return false;
    }
    return true;
  }).length;

  return html`
    <div>
      <div class="page-header">
        Loxone Elements
        <span style="font-size:14px;color:var(--ve-text-dim);font-weight:400;margin-left:8px;">
          (${filteredCount}${filteredCount !== allItems.length ? ' / ' + allItems.length : ''})
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
        ${types.length > 1 && html`
          <select class="bind-select" value=${typeFilter} onChange=${(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            ${types.map(t => html`<option key=${t} value=${t}>${t}</option>`)}
          </select>
        `}
        ${(search || typeFilter) && html`
          <button class="lox-push-btn" onClick=${() => { setSearch(''); setTypeFilter(''); }}>Reset</button>
        `}
      </div>
      ${groups.map(group => html`
        <${CategorySection}
          key=${group.category}
          group=${group}
          search=${search}
          typeFilter=${typeFilter}
          expanded=${expanded}
          setExpanded=${setExpanded}
          onCmd=${handleCmd}
          prevValues=${prevValues}
        />
      `)}
      ${toast && html`<div class="lox-toast lox-toast--${toast.type}">${toast.text}</div>`}
    </div>
  `;
}
