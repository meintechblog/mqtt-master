import { html } from 'htm/preact';
import { useEffect, useState, useCallback } from 'preact/hooks';
import { fetchInputBindings, saveInputBindings, fetchLoxoneControlsDetailed } from '../lib/api-client.js';
import { TRANSFORMS, suggestTransform, previewTransform, UNITS, suggestUnit } from '../lib/transform-utils.js';
import { TopicBrowserPanel } from '../components/topic-browser.js';
import { flattenJsonFields } from '../lib/json-fields.js';

// ── Existing binding row (compact, expandable for edit) ────────
/** Extract the primary live value from a control's states */
function liveValue(ctrl) {
  if (!ctrl || !ctrl.states) return null;
  const s = ctrl.states;
  if (s.value != null && s.value.value != null) return s.value.value;
  if (s.actual != null && s.actual.value != null) return s.actual.value;
  if (s.active != null && s.active.value != null) return s.active.value;
  if (s.position != null && s.position.value != null) return s.position.value;
  return null;
}

/**
 * Render a number the way the binding actually transmits it: at most 3
 * decimals, with trailing zeros stripped. `21.400` → `21.4`, `21.000` → `21`.
 * Mirrors the `Math.round(v * 1000) / 1000 → String(v)` step in binding-utils
 * so the UI doesn't lie about what reaches Loxone.
 */
function fmtNumNice(n) {
  if (n == null) return null;
  if (typeof n !== 'number') return String(n);
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return parseFloat(n.toFixed(3)).toString();
}

function fmtAge(ts) {
  if (!ts) return null;
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 1) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function BindingCard({ binding, stats, controls, onRemove, onToggle, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const target = controls.find(c => c.uuid === binding.targetUuid);
  const targetSub = controls.flatMap(c => c.subControls || []).find(s => s.uuid === binding.targetUuid);
  const targetCtrl = target || targetSub;
  const targetName = targetCtrl ? targetCtrl.name : binding.targetUuid.substring(0, 12) + '…';
  // Loxone-side metadata: room + type, when we resolved the control. Useful
  // both as proof that the UUID matches a real device and as the same
  // identifier the Loxone app shows.
  const targetMeta = targetCtrl
    ? [targetCtrl.room && `Raum: ${targetCtrl.room}`, targetCtrl.type].filter(Boolean).join(' · ')
    : null;
  const targetPluginName = targetCtrl?._pluginName || null;
  const transform = TRANSFORMS.find(t => t.value === binding.transform);
  const keepalive = binding.keepaliveMs || binding.intervalMs || 30000;
  // Prefer the loxoneValue baked into the stats response — it was read at
  // the same instant as `stat.value`, so any drift between "we sent" and
  // "Loxone reports" reflects reality rather than poll-cadence skew.
  const liveFromStats = stats?.loxoneValue;
  const live = liveFromStats != null ? liveFromStats : liveValue(targetCtrl);
  const liveStr = fmtNumNice(live);

  // Live MQTT-side stats: what the binding pushed last and how often.
  const stat = stats || {};
  const sentValueStr = fmtNumNice(stat.value);
  const recentSendMs = stat.lastSentAt ? Date.now() - stat.lastSentAt : Infinity;
  const recentRecvMs = stat.lastReceivedAt ? Date.now() - stat.lastReceivedAt : Infinity;
  const flashSend = recentSendMs < 3000;
  const flashRecv = recentRecvMs < 3000;
  // Connection diagnosis line
  let diagText = null;
  let diagTone = 'dim';
  if (stat.lastError) {
    diagText = stat.lastError;
    diagTone = 'red';
  } else if (!stat.lastReceivedAt) {
    diagText = 'no MQTT message received yet';
    diagTone = 'dim';
  } else if (!stat.lastSentAt) {
    diagText = `received ${stat.recvCount}× but never forwarded — ${stat.lastReason || 'unknown'}`;
    diagTone = 'orange';
  } else if (stat.lastReason === 'dedup') {
    diagText = `unchanged value, holding until keepalive (${fmtAge(stat.lastSentAt)})`;
    diagTone = 'dim';
  } else {
    diagText = `forwarded ${stat.sendCount}× · last ${stat.lastReason || 'sent'} ${fmtAge(stat.lastSentAt)}`;
    diagTone = 'green';
  }

  return html`
    <div class="bind-card ${binding.enabled ? '' : 'bind-card--disabled'}">
      <div class="bind-card-header">
        <input
          type="checkbox"
          checked=${binding.enabled}
          onChange=${() => onToggle(binding.id)}
          class="lox-control-toggle"
        />
        <span class="bind-card-label" onClick=${() => setExpanded(!expanded)} style="cursor:pointer">
          ${(() => {
            // Strip a leading "<targetName> " prefix from legacy auto-generated
            // labels so existing bindings don't show "Wasserboiler
            // Wasserboiler.Temperature" — display-only, the stored label is
            // unchanged so saves still round-trip.
            const raw = binding.label || binding.id;
            const ctrlName = targetCtrl?.name;
            if (ctrlName) {
              const prefix = ctrlName + ' ';
              if (raw.toLowerCase().startsWith(prefix.toLowerCase())) {
                return raw.slice(prefix.length);
              }
            }
            return raw;
          })()}
        </span>
        <button class="bind-remove" onClick=${() => onRemove(binding.id)} title="Remove">×</button>
      </div>
      <div class="bind-card-flow-grid" onClick=${() => setExpanded(!expanded)} style="cursor:pointer">
        <!-- FROM: MQTT source -->
        <div class="bind-flow-col bind-flow-col--from">
          <span class="bind-flow-label">From MQTT</span>
          <span class="bind-flow-topic ${flashRecv ? 'bind-flash' : ''}">${binding.mqttTopic}</span>
          <span class="bind-flow-field">.${binding.jsonField}</span>
        </div>

        <!-- VALUE: the bridge — what we last forwarded -->
        <div class="bind-flow-col bind-flow-col--value">
          <span class="bind-flow-arrow">→</span>
          ${transform && transform.value && html`
            <span class="bind-flow-transform" title="transform applied before forwarding">${transform.label}</span>
          `}
          <span class="bind-flow-value ${flashSend ? 'bind-flash' : ''}" title="last value our plugin forwarded to Loxone via jdev/sps/io">
            ${sentValueStr ?? '—'}${binding.unit ? html`<span class="bind-flow-unit">${binding.unit}</span>` : ''}
          </span>
          <span class="bind-flow-arrow">→</span>
        </div>

        <!-- TO: target control (usually a Loxone Miniserver, possibly via the bridge plugin) -->
        <div class="bind-flow-col bind-flow-col--to">
          <span class="bind-flow-label">${targetPluginName ? `To ${targetPluginName}` : 'To Loxone'}</span>
          <span class="bind-flow-target-name" title=${binding.targetUuid}>
            ${targetName}
            ${targetCtrl?.category && html`<span class="bind-flow-target-category"> · ${targetCtrl.category}</span>`}
          </span>
          ${targetCtrl?.description && html`
            <span class="bind-flow-target-desc" title="Loxone Bezeichnung / description">${targetCtrl.description}</span>
          `}
          ${targetMeta && html`<span class="bind-flow-target-meta">${targetMeta}</span>`}
          <span
            class="bind-flow-target-uuid"
            title="Loxone UUID — click to copy"
            onClick=${(e) => { e.stopPropagation(); navigator.clipboard?.writeText(binding.targetUuid).catch(() => {}); }}
          >${binding.targetUuid}</span>
          ${liveStr != null && html`
            <span class="bind-flow-live" title="The value Loxone is currently reporting for this control. May differ from the value we sent if the control is fed by another source (e.g. a hardware 1-Wire sensor) — common with InfoOnlyAnalog read-only displays.">
              Loxone reports: ${liveStr}${binding.unit ? ' ' + binding.unit : ''}
            </span>
          `}
        </div>
      </div>
      ${diagText && html`
        <div class="bind-card-diag bind-card-diag--${diagTone}">
          ${diagText}
          <span class="bind-card-diag-meta">keepalive ${(keepalive / 1000).toFixed(0)}s</span>
        </div>
      `}
      ${expanded && html`
        <div class="bind-edit">
          <div class="bind-field-row">
            <div class="bind-field" style="flex:1">
              <label class="bind-field-label">Label</label>
              <input type="text" class="bind-input" value=${binding.label}
                onInput=${(e) => onUpdate(binding.id, 'label', e.target.value)} />
            </div>
            <div class="bind-field">
              <label class="bind-field-label">Transform</label>
              <select class="bind-select" value=${binding.transform || ''}
                onChange=${(e) => onUpdate(binding.id, 'transform', e.target.value)}>
                ${TRANSFORMS.map(t => html`<option key=${t.value} value=${t.value}>${t.label}</option>`)}
              </select>
            </div>
            <div class="bind-field">
              <label class="bind-field-label" title="Display-only — does not affect what's sent to Loxone">Unit</label>
              <select class="bind-select" value=${binding.unit || ''}
                onChange=${(e) => onUpdate(binding.id, 'unit', e.target.value)}>
                ${UNITS.map(u => html`<option key=${u.value} value=${u.value}>${u.label}</option>`)}
              </select>
            </div>
            <div class="bind-field">
              <label class="bind-field-label">Keepalive</label>
              <select class="bind-select" value=${keepalive}
                onChange=${(e) => onUpdate(binding.id, 'keepaliveMs', Number(e.target.value))}>
                <option value="1000">1s</option>
                <option value="5000">5s</option>
                <option value="10000">10s</option>
                <option value="30000">30s</option>
                <option value="60000">60s</option>
                <option value="300000">5min</option>
              </select>
            </div>
          </div>
          <div class="bind-field-row" style="margin-top:6px">
            <div class="bind-field" style="flex:1">
              <label class="bind-field-label">MQTT Topic</label>
              <input type="text" class="bind-input" value=${binding.mqttTopic} disabled style="opacity:0.6" />
            </div>
            <div class="bind-field">
              <label class="bind-field-label">JSON Field</label>
              <input type="text" class="bind-input" value=${binding.jsonField} disabled style="opacity:0.6;width:120px" />
            </div>
          </div>
        </div>
      `}
    </div>
  `;
}

// ── Wizard: Step 1 - Browse MQTT topics ────────────────────────
/**
 * Synthesise the wizard's `source` shape from a raw cached payload so the
 * downstream steps (StepPickField, StepReview) work unchanged with nested
 * fields like `ENERGY.Power` or `Wifi.RSSI`.
 */
function topicToSource(topic, payload, ts) {
  const flat = flattenJsonFields(payload);
  const fields = flat.length > 0
    ? flat.map(({ path, value, type }) => ({
        key: path,
        path,
        type,
        sample: typeof value === 'number' ? value : String(value).substring(0, 100),
      }))
    : [{ key: 'value', path: 'value', type: typeof payload, sample: payload }];
  return { topic, payload, ts, fields };
}

function StepDiscover({ onSelect }) {
  return html`
    <div class="wiz-step">
      <div class="wiz-step-title">1. Pick MQTT Source</div>
      <div class="wiz-step-desc">
        Click <strong>Use →</strong> on any topic. The browser shows every
        topic seen since the service started, with live values.
      </div>
      <${TopicBrowserPanel}
        actionLabel="Use →"
        title="Available MQTT Topics"
        onSelect=${(topic, _value, payload, ts) => onSelect(topicToSource(topic, payload, ts))}
      />
    </div>
  `;
}

// ── Wizard: Step 2 - Pick field ────────────────────────────────
function StepPickField({ source, onSelect, onBack }) {
  const nameField = source.fields.find(f => f.key === 'name');
  const displayName = nameField ? nameField.sample : source.topic;

  return html`
    <div class="wiz-step">
      <div class="wiz-step-title">2. Select Field</div>
      <div class="wiz-step-desc">
        Pick the value to forward from <strong>${displayName}</strong>
      </div>
      <div class="wiz-topic-path" style="margin-bottom:12px">${source.topic}</div>
      <div class="wiz-field-list">
        ${source.fields.filter(f => f.type === 'number').map(f => html`
          <div class="wiz-field-row" key=${f.key} onClick=${() => onSelect(f)}>
            <span class="wiz-field-key">${f.key}</span>
            <span class="wiz-field-val">${typeof f.sample === 'number' ? f.sample.toLocaleString() : f.sample}</span>
            ${suggestTransform(f.key) && html`
              <span class="wiz-field-hint">${TRANSFORMS.find(t => t.value === suggestTransform(f.key))?.label}</span>
            `}
          </div>
        `)}
      </div>
      <button class="lox-cmd-btn--small lox-cmd-btn" style="margin-top:12px" onClick=${onBack}>Back</button>
    </div>
  `;
}

// ── Wizard: Step 3 - Pick Loxone target ────────────────────────
function StepPickTarget({ source, field, controls, existingBindings, onSelect, onBack }) {
  const [search, setSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Collect unique rooms and types
  const rooms = [...new Set(controls.map(c => c.room).filter(Boolean))].sort();
  const types = [...new Set(controls.map(c => c.type).filter(Boolean))].sort();

  // Set of already-bound target UUIDs
  const boundUuids = new Set(existingBindings.map(b => b.targetUuid));

  const filtered = controls.filter(c => {
    if (roomFilter && c.room !== roomFilter) return false;
    if (typeFilter && c.type !== typeFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!c.name.toLowerCase().includes(s) && !c.type.toLowerCase().includes(s)
        && !c.room.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  return html`
    <div class="wiz-step">
      <div class="wiz-step-title">3. Select Target</div>
      <div class="wiz-step-desc">
        Where should <strong>${field.key}</strong> be sent to?
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
        <select class="bind-select" value=${roomFilter} onChange=${(e) => setRoomFilter(e.target.value)}>
          <option value="">All rooms</option>
          ${rooms.map(r => html`<option key=${r} value=${r}>${r}</option>`)}
        </select>
        <select class="bind-select" value=${typeFilter} onChange=${(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          ${types.map(t => html`<option key=${t} value=${t}>${t}</option>`)}
        </select>
      </div>
      <div class="wiz-target-list">
        ${filtered.map(ctrl => {
          const ctrlBound = boundUuids.has(ctrl.uuid);
          return html`
            <div class="wiz-target-group" key=${ctrl.uuid}>
              <div
                class="wiz-target-row ${ctrlBound ? 'wiz-target-bound' : ''}"
                onClick=${() => { if (!ctrlBound) onSelect(ctrl); }}
              >
                <span class="wiz-target-name">${ctrl.name}</span>
                <span class="wiz-target-meta">${ctrl.type} · ${ctrl.room}</span>
                ${ctrlBound && html`<span class="wiz-target-badge">bound</span>`}
              </div>
              ${(ctrl.subControls || []).map(sub => {
                const subBound = boundUuids.has(sub.uuid);
                return html`
                  <div
                    class="wiz-target-row wiz-target-sub ${subBound ? 'wiz-target-bound' : ''}"
                    key=${sub.uuid}
                    onClick=${() => { if (!subBound) onSelect(sub); }}
                  >
                    <span class="wiz-target-name">${sub.name}</span>
                    <span class="wiz-target-meta">${sub.type}</span>
                    ${subBound && html`<span class="wiz-target-badge">bound</span>`}
                  </div>
                `;
              })}
            </div>
          `;
        })}
      </div>
      <button class="lox-cmd-btn--small lox-cmd-btn" style="margin-top:12px" onClick=${onBack}>Back</button>
    </div>
  `;
}

// ── Wizard: Step 4 - Review & Save ─────────────────────────────
function StepReview({ source, field, target, onSave, onBack }) {
  const nameField = source.fields.find(f => f.key === 'name');
  const deviceName = nameField ? nameField.sample : source.topic.split('/').pop();
  const autoTransform = suggestTransform(field.key);
  const [transform, setTransform] = useState(autoTransform);
  const [keepalive, setKeepalive] = useState(30000);
  // Default label = the JSON field path. The target's Loxone control name
  // is rendered separately on the binding card, so we don't prefix it here
  // (otherwise the label reads "Wasserboiler Wasserboiler.Temperature
  // (Wasserboiler)" — three times the same word).
  const [label, setLabel] = useState(field.key.replace(/_/g, ' '));
  const [unit, setUnit] = useState(suggestUnit(field.key));

  const preview = previewTransform(field.sample, transform);

  return html`
    <div class="wiz-step">
      <div class="wiz-step-title">4. Review & Save</div>
      <div class="wiz-review-flow">
        <div class="wiz-review-box">
          <div class="wiz-review-label">Source</div>
          <div class="wiz-review-val">${deviceName}</div>
          <div class="wiz-review-sub">${field.key} = ${field.sample}</div>
        </div>
        <div class="wiz-review-arrow">→</div>
        <div class="wiz-review-box">
          <div class="wiz-review-label">Transform</div>
          <select class="bind-select" value=${transform} onChange=${(e) => setTransform(e.target.value)}>
            ${TRANSFORMS.map(t => html`<option key=${t.value} value=${t.value}>${t.label}</option>`)}
          </select>
          <div class="wiz-review-sub">Preview: ${preview}</div>
        </div>
        <div class="wiz-review-arrow">→</div>
        <div class="wiz-review-box">
          <div class="wiz-review-label">Target</div>
          <div class="wiz-review-val">${target.name}</div>
          <div class="wiz-review-sub">${target.type}${target.room ? ' · ' + target.room : ''}</div>
        </div>
      </div>
      <div class="bind-field-row" style="margin-top:16px">
        <div class="bind-field" style="flex:1">
          <label class="bind-field-label">Label</label>
          <input type="text" class="bind-input" value=${label} onInput=${(e) => setLabel(e.target.value)} />
        </div>
        <div class="bind-field">
          <label class="bind-field-label" title="Display-only — does not affect what's sent to Loxone">Unit</label>
          <select class="bind-select" value=${unit} onChange=${(e) => setUnit(e.target.value)}>
            ${UNITS.map(u => html`<option key=${u.value} value=${u.value}>${u.label}</option>`)}
          </select>
        </div>
        <div class="bind-field">
          <label class="bind-field-label">Keepalive</label>
          <select class="bind-select" value=${keepalive} onChange=${(e) => setKeepalive(Number(e.target.value))}>
            <option value="10000">10s</option>
            <option value="30000">30s</option>
            <option value="60000">60s</option>
            <option value="300000">5min</option>
          </select>
        </div>
      </div>
      <div class="bind-actions" style="margin-top:16px">
        <button class="lox-cmd-btn--small lox-cmd-btn" onClick=${onBack}>Back</button>
        <button class="lox-cmd-btn" onClick=${() => onSave({
          id: 'b-' + Date.now(),
          enabled: true,
          mqttTopic: source.topic,
          jsonField: field.key,
          targetUuid: target.uuid,
          transform,
          keepaliveMs: keepalive,
          label,
          unit,
        })}>Save Binding</button>
      </div>
      <div style="font-size:12px;color:var(--ve-text-dim);margin-top:8px;">
        Values are sent instantly when they change. Keepalive resends the last value if nothing changed.
      </div>
    </div>
  `;
}

// ── Main page ──────────────────────────────────────────────────
export function InputBindings({ pluginId = 'loxone', defaultPattern } = {}) {
  const [bindings, setBindings] = useState([]);
  const [bindingStats, setBindingStats] = useState([]);
  const [controls, setControls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [pluginDisplayName, setPluginDisplayName] = useState(pluginId);

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizStep, setWizStep] = useState(1);
  const [wizSource, setWizSource] = useState(null);
  const [wizField, setWizField] = useState(null);
  const [wizTarget, setWizTarget] = useState(null);

  // Reset state when plugin changes
  useEffect(() => {
    setWizardOpen(false);
    setLoading(true);
    setBindings([]);
    setToast(null);
  }, [pluginId]);

  /**
   * Pull controls from EVERY running Loxone plugin (`type === 'loxone'`)
   * and merge into one list keyed by uuid. Each control gets `_pluginName`
   * tagged so the UI can show "To Knausi" instead of a hardcoded "To Loxone"
   * when the user named their Miniserver instance `knausi` rather than the
   * default `loxone`.
   */
  async function fetchAllLoxoneControls() {
    const r = await fetch('/api/plugins');
    if (!r.ok) return [];
    const plugins = await r.json();
    const loxones = plugins.filter(p => p.type === 'loxone' && p.status === 'running');
    if (loxones.length === 0) return [];
    const all = await Promise.all(loxones.map(async p => {
      try {
        const cr = await fetch(`/api/plugins/${encodeURIComponent(p.id)}/controls/detailed`);
        if (!cr.ok) return [];
        const ctrls = await cr.json();
        const tagName = p.displayName || p.name || p.id;
        return ctrls.map(c => ({ ...c, _pluginId: p.id, _pluginName: tagName }));
      } catch { return []; }
    }));
    return all.flat();
  }

  useEffect(() => {
    async function load() {
      try {
        // Fetch display name from plugin list
        fetch('/api/plugins').then(r => r.json()).then(plugins => {
          const p = plugins.find(p => p.id === pluginId);
          if (p) setPluginDisplayName(p.displayName || p.name || pluginId);
        }).catch(() => {});

        const [b, c] = await Promise.all([
          fetchInputBindings(pluginId),
          fetchAllLoxoneControls().catch(() => []),
        ]);
        setBindings(b);
        setControls(c);
      } catch (err) {
        setToast({ type: 'error', text: err.message });
      } finally {
        setLoading(false);
      }
    }
    load();
    // Refresh controls for live values
    const interval = setInterval(async () => {
      try {
        setControls(await fetchAllLoxoneControls());
      } catch { /* ignore */ }
    }, 3000);
    // Refresh per-binding stats (live MQTT-side values + send counters)
    const statsInterval = setInterval(async () => {
      try {
        const r = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/bindings/stats`);
        if (r.ok) setBindingStats(await r.json());
      } catch { /* ignore */ }
    }, 2000);
    return () => { clearInterval(interval); clearInterval(statsInterval); };
  }, [pluginId]);

  const showToast = useCallback((type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const save = useCallback(async (newBindings) => {
    try {
      await saveInputBindings(pluginId, newBindings);
      setBindings(newBindings);
      showToast('ok', 'Bindings saved');
    } catch (err) {
      showToast('error', err.message);
    }
  }, [showToast]);

  const handleRemove = useCallback((id) => {
    const next = bindings.filter(b => b.id !== id);
    save(next);
  }, [bindings, save]);

  const handleToggle = useCallback((id) => {
    const next = bindings.map(b => b.id === id ? { ...b, enabled: !b.enabled } : b);
    save(next);
  }, [bindings, save]);

  const handleUpdate = useCallback((id, field, value) => {
    const next = bindings.map(b => b.id === id ? { ...b, [field]: value } : b);
    save(next);
  }, [bindings, save]);

  const startWizard = useCallback(() => {
    setWizardOpen(true);
    setWizStep(1);
    setWizSource(null);
    setWizField(null);
    setWizTarget(null);
  }, []);

  const handleWizardSave = useCallback((newBinding) => {
    const next = [...bindings, newBinding];
    save(next);
    setWizardOpen(false);
  }, [bindings, save]);

  if (loading) {
    return html`<div class="page-placeholder">Loading...</div>`;
  }

  return html`
    <div>
      <div class="page-header">
        MQTT Input Bindings
        <span style="font-size:14px;color:var(--ve-text-dim);font-weight:400;margin-left:8px;">
          MQTT → ${pluginDisplayName}
        </span>
      </div>

      ${!wizardOpen && html`
        <!-- Existing bindings -->
        ${bindings.length > 0 && html`
          ${bindings.map(b => html`
            <${BindingCard}
              key=${b.id}
              binding=${b}
              stats=${bindingStats.find(s => s.id === b.id)}
              controls=${controls}
              onRemove=${handleRemove}
              onToggle=${handleToggle}
              onUpdate=${handleUpdate}
            />
          `)}
        `}
        ${bindings.length === 0 && html`
          <div class="ve-card" style="padding:24px;text-align:center;color:var(--ve-text-dim);">
            No bindings yet. Create one to start feeding MQTT data into Loxone.
          </div>
        `}
        <div class="bind-actions">
          <button class="lox-cmd-btn" onClick=${startWizard}>+ New Binding</button>
        </div>
      `}

      ${wizardOpen && html`
        <div class="wiz-container">
          <div class="wiz-progress">
            ${[1,2,3,4].map(s => html`
              <div class="wiz-dot ${wizStep >= s ? 'active' : ''}" key=${s}>${s}</div>
            `)}
          </div>

          ${wizStep === 1 && html`
            <${StepDiscover} onSelect=${(source) => { setWizSource(source); setWizStep(2); }} />
          `}
          ${wizStep === 2 && wizSource && html`
            <${StepPickField}
              source=${wizSource}
              onSelect=${(field) => { setWizField(field); setWizStep(3); }}
              onBack=${() => setWizStep(1)}
            />
          `}
          ${wizStep === 3 && wizField && html`
            <${StepPickTarget}
              source=${wizSource}
              field=${wizField}
              controls=${controls}
              existingBindings=${bindings}
              onSelect=${(target) => { setWizTarget(target); setWizStep(4); }}
              onBack=${() => setWizStep(2)}
            />
          `}
          ${wizStep === 4 && wizTarget && html`
            <${StepReview}
              source=${wizSource}
              field=${wizField}
              target=${wizTarget}
              onSave=${handleWizardSave}
              onBack=${() => setWizStep(3)}
            />
          `}

          <button class="lox-cmd-btn--small lox-cmd-btn" style="margin-top:16px" onClick=${() => setWizardOpen(false)}>Cancel</button>
        </div>
      `}

      ${toast && html`<div class="lox-toast lox-toast--${toast.type}">${toast.text}</div>`}
    </div>
  `;
}
