import { html } from 'htm/preact';
import { useEffect, useState, useCallback } from 'preact/hooks';
import { fetchInputBindings, saveInputBindings, fetchLoxoneControlsDetailed } from '../lib/api-client.js';
import { TRANSFORMS, suggestTransform, previewTransform } from '../lib/transform-utils.js';

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

function BindingCard({ binding, controls, onRemove, onToggle, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const target = controls.find(c => c.uuid === binding.targetUuid);
  const targetSub = controls.flatMap(c => c.subControls || []).find(s => s.uuid === binding.targetUuid);
  const targetCtrl = target || targetSub;
  const targetName = targetCtrl ? targetCtrl.name : binding.targetUuid.substring(0, 12) + '...';
  const transform = TRANSFORMS.find(t => t.value === binding.transform);
  const keepalive = binding.keepaliveMs || binding.intervalMs || 30000;
  const live = liveValue(targetCtrl);
  const liveStr = live != null ? (typeof live === 'number' ? (Number.isInteger(live) ? String(live) : live.toFixed(3)) : String(live)) : null;

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
          ${binding.label || binding.id}
        </span>
        <button class="bind-remove" onClick=${() => onRemove(binding.id)} title="Remove">×</button>
      </div>
      <div class="bind-card-detail" onClick=${() => setExpanded(!expanded)} style="cursor:pointer">
        <div class="bind-card-flow">
          <span class="bind-card-topic">${binding.mqttTopic.split('/').pop()}</span>
          <span class="bind-card-field">.${binding.jsonField}</span>
          <span class="bind-card-arrow">→</span>
          ${transform && transform.value && html`<span class="bind-card-transform">${transform.label}</span>`}
          <span class="bind-card-arrow">→</span>
          <span class="bind-card-target">${targetName}</span>
        </div>
        ${liveStr != null && html`<span class="bind-card-live">${liveStr}</span>`}
        <span class="bind-card-interval">${(keepalive / 1000).toFixed(0)}s</span>
      </div>
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

// ── Wizard: Step 1 - Discover MQTT topics ──────────────────────
function StepDiscover({ onSelect, defaultPattern }) {
  const [pattern, setPattern] = useState(defaultPattern || 'pv-inverter-proxy/#');
  const [scanning, setScanning] = useState(false);
  const [topics, setTopics] = useState([]);

  const scan = useCallback(async () => {
    setScanning(true);
    setTopics([]);
    try {
      const res = await fetch('/api/mqtt/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern, durationMs: 3000 }),
      });
      const data = await res.json();
      if (res.ok) setTopics(data);
    } catch { /* ignore */ }
    setScanning(false);
  }, [pattern]);

  return html`
    <div class="wiz-step">
      <div class="wiz-step-title">1. Discover MQTT Sources</div>
      <div class="wiz-step-desc">Enter a topic pattern to scan the broker for available data sources.</div>
      <div class="wiz-discover-row">
        <input
          type="text"
          class="bind-input"
          style="flex:1"
          placeholder="topic/pattern/#"
          value=${pattern}
          onInput=${(e) => setPattern(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') scan(); }}
        />
        <button class="lox-cmd-btn" onClick=${scan} disabled=${scanning || !pattern.trim()}>
          ${scanning ? 'Scanning...' : 'Scan'}
        </button>
      </div>
      ${topics.length > 0 && html`
        <div class="wiz-results">
          ${topics.filter(t => t.fields && t.fields.length > 0).map(t => {
            // Extract device name from payload if available
            const nameField = t.fields.find(f => f.key === 'name');
            const displayName = nameField ? nameField.sample : t.topic;
            return html`
              <div class="wiz-topic-card" key=${t.topic} onClick=${() => onSelect(t)}>
                <div class="wiz-topic-name">${displayName}</div>
                <div class="wiz-topic-path">${t.topic}</div>
                <div class="wiz-topic-fields">
                  ${t.fields.filter(f => f.type === 'number').slice(0, 6).map(f => html`
                    <span class="wiz-field-preview" key=${f.key}>
                      <span class="wiz-field-key">${f.key}</span>
                      <span class="wiz-field-val">${typeof f.sample === 'number' ? f.sample.toLocaleString() : f.sample}</span>
                    </span>
                  `)}
                </div>
              </div>
            `;
          })}
          ${topics.filter(t => !t.fields || t.fields.length === 0).length > 0 && html`
            <div style="font-size:12px;color:var(--ve-text-dim);margin-top:8px;">
              ${topics.filter(t => !t.fields || t.fields.length === 0).length} non-JSON topics hidden
            </div>
          `}
        </div>
      `}
      ${!scanning && topics.length === 0 && pattern && html`
        <div style="font-size:13px;color:var(--ve-text-dim);margin-top:12px;">
          Click Scan to discover topics matching the pattern.
        </div>
      `}
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
      <div class="wiz-step-title">3. Select Loxone Target</div>
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
  const [label, setLabel] = useState(`${deviceName} ${field.key.replace(/_/g, ' ')}`);

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
  const [controls, setControls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

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

  useEffect(() => {
    async function load() {
      try {
        const [b, c] = await Promise.all([
          fetchInputBindings(pluginId),
          fetchLoxoneControlsDetailed().catch(() => []),
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
        setControls(await fetchLoxoneControlsDetailed());
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
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
          MQTT → ${pluginId}
        </span>
      </div>

      ${!wizardOpen && html`
        <!-- Existing bindings -->
        ${bindings.length > 0 && html`
          ${bindings.map(b => html`
            <${BindingCard}
              key=${b.id}
              binding=${b}
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
            <${StepDiscover} defaultPattern=${defaultPattern} onSelect=${(source) => { setWizSource(source); setWizStep(2); }} />
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
