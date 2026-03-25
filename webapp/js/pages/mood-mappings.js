import { html } from 'htm/preact';
import { useEffect, useState, useCallback } from 'preact/hooks';
import { fetchLoxoneControlsDetailed } from '../lib/api-client.js';

/**
 * Mood Mapping page — configure mood ID → name mappings for LightControllerV2.
 * Default mappings apply to all controllers; per-control overrides are possible.
 */
export function MoodMappings({ pluginId = 'loxone' } = {}) {
  const [mappings, setMappings] = useState(null);
  const [controls, setControls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [editControl, setEditControl] = useState(null); // null = defaults, uuid = per-control

  useEffect(() => {
    async function load() {
      try {
        const [moodRes, ctrlData] = await Promise.all([
          fetch(`/api/plugins/${pluginId}/moods`).then(r => r.json()),
          fetchLoxoneControlsDetailed(pluginId).catch(() => []),
        ]);
        setMappings(moodRes);
        setControls(ctrlData.filter(c => c.type === 'LightControllerV2'));
      } catch (err) {
        setToast({ type: 'error', text: err.message });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [pluginId]);

  const showToast = useCallback((type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const save = useCallback(async (newMappings) => {
    try {
      const res = await fetch(`/api/plugins/${pluginId}/moods`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMappings),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setMappings(newMappings);
      showToast('ok', 'Saved');
    } catch (err) {
      showToast('error', err.message);
    }
  }, [pluginId, showToast]);

  const handleUpdateEntry = useCallback((key, moodId, name) => {
    const section = key === '_defaults' ? mappings._defaults : (mappings[key] || {});
    const updated = { ...section, [String(moodId)]: name };
    save({ ...mappings, [key]: updated });
  }, [mappings, save]);

  /** Special IDs that live outside the regular 0-31 range */
  const SPECIAL_IDS = new Set([-1, 777, 778]);
  const MAX_REGULAR_ID = 31;

  const handleChangeId = useCallback((key, oldId, newId) => {
    if (String(oldId) === String(newId)) return;
    const section = { ...(key === '_defaults' ? mappings._defaults : mappings[key] || {}) };
    // Validate range: -1, 0-31, 777, 778
    if (!SPECIAL_IDS.has(newId) && (newId < 0 || newId > MAX_REGULAR_ID)) return;
    if (section[String(newId)] != null) {
      // Swap: move the other entry to the old ID
      const otherName = section[String(newId)];
      section[String(newId)] = section[String(oldId)];
      section[String(oldId)] = otherName;
    } else {
      const name = section[String(oldId)];
      delete section[String(oldId)];
      section[String(newId)] = name;
    }
    save({ ...mappings, [key]: section });
  }, [mappings, save]);

  /** Move entry up (swap with previous in sorted list) */
  const handleMoveUp = useCallback((key, id) => {
    const section = key === '_defaults' ? mappings._defaults : (mappings[key] || {});
    const sorted = Object.keys(section).map(Number).sort((a, b) => a - b);
    const idx = sorted.indexOf(Number(id));
    if (idx <= 0) return;
    handleChangeId(key, id, sorted[idx - 1]);
  }, [mappings, handleChangeId]);

  /** Move entry down (swap with next in sorted list) */
  const handleMoveDown = useCallback((key, id) => {
    const section = key === '_defaults' ? mappings._defaults : (mappings[key] || {});
    const sorted = Object.keys(section).map(Number).sort((a, b) => a - b);
    const idx = sorted.indexOf(Number(id));
    if (idx < 0 || idx >= sorted.length - 1) return;
    handleChangeId(key, id, sorted[idx + 1]);
  }, [mappings, handleChangeId]);

  const handleDeleteEntry = useCallback((key, moodId) => {
    const name = (key === '_defaults' ? mappings._defaults : mappings[key] || {})[String(moodId)] || moodId;
    if (!confirm(`Mood "${name}" (ID ${moodId}) wirklich löschen?`)) return;
    const section = { ...(key === '_defaults' ? mappings._defaults : mappings[key] || {}) };
    delete section[String(moodId)];
    save({ ...mappings, [key]: section });
  }, [mappings, save]);

  const handleAddEntry = useCallback((key) => {
    const section = key === '_defaults' ? mappings._defaults : (mappings[key] || {});
    // Find next free ID
    const ids = Object.keys(section).map(Number);
    let nextId = 0;
    while (ids.includes(nextId)) nextId++;
    save({ ...mappings, [key]: { ...section, [String(nextId)]: '' } });
  }, [mappings, save]);

  const handleDeleteOverride = useCallback((uuid) => {
    const next = { ...mappings };
    delete next[uuid];
    save(next);
    setEditControl(null);
  }, [mappings, save]);

  const handleCreateOverride = useCallback((uuid) => {
    // Copy defaults as starting point
    save({ ...mappings, [uuid]: { ...mappings._defaults } });
    setEditControl(uuid);
  }, [mappings, save]);

  if (loading) return html`<div class="page-placeholder">Loading...</div>`;

  if (!mappings) {
    return html`
      <div>
        <div class="page-header">Mood Mapping</div>
        <div class="ve-card" style="padding:20px;color:var(--ve-text-dim);">Plugin not running</div>
      </div>
    `;
  }

  const currentKey = editControl || '_defaults';
  const currentSection = currentKey === '_defaults' ? mappings._defaults : (mappings[currentKey] || {});
  const entries = Object.entries(currentSection).sort((a, b) => Number(a[0]) - Number(b[0]));
  const overrideUuids = Object.keys(mappings).filter(k => k !== '_defaults');

  return html`
    <div>
      <div class="page-header">Mood Mapping</div>

      <div class="mood-tabs">
        <button
          class="mood-tab ${!editControl ? 'active' : ''}"
          onClick=${() => setEditControl(null)}
        >
          Defaults
        </button>
        ${controls.map(c => {
          const hasOverride = overrideUuids.includes(c.uuid);
          return html`
            <button
              key=${c.uuid}
              class="mood-tab ${editControl === c.uuid ? 'active' : ''} ${hasOverride ? 'mood-tab--has-override' : ''}"
              onClick=${() => setEditControl(c.uuid)}
            >
              ${c.name} <span class="mood-tab-room">${c.room}</span>
            </button>
          `;
        })}
      </div>

      ${editControl && !mappings[editControl] && html`
        <div class="ve-card" style="padding:20px;text-align:center;">
          <div style="color:var(--ve-text-dim);margin-bottom:12px;">
            Using default mappings. Create an override to customize moods for this controller.
          </div>
          <button class="lox-cmd-btn" onClick=${() => handleCreateOverride(editControl)}>
            Create Override
          </button>
        </div>
      `}

      ${(currentKey === '_defaults' || mappings[currentKey]) && html`
        <div class="mood-editor">
          ${currentKey !== '_defaults' && html`
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <span style="font-size:13px;color:var(--ve-text-dim);">
                Override for ${controls.find(c => c.uuid === currentKey)?.name || currentKey}
              </span>
              <button class="lox-push-btn" style="font-size:11px;" onClick=${() => handleDeleteOverride(currentKey)}>
                Remove Override
              </button>
            </div>
          `}

          <div class="mood-list">
            <div class="mood-row mood-row--header">
              <span class="mood-move-col"></span>
              <span class="mood-id-col">ID</span>
              <span class="mood-name-col">Mood Name</span>
              <span class="mood-actions-col"></span>
            </div>
            ${entries.map(([id, name], idx) => html`
              <div class="mood-row" key=${id}>
                <span class="mood-move-col">
                  <button
                    class="mood-move-btn"
                    onClick=${() => handleMoveUp(currentKey, id)}
                    disabled=${idx === 0}
                    title="Move up (swap IDs)"
                  >▲</button>
                  <button
                    class="mood-move-btn"
                    onClick=${() => handleMoveDown(currentKey, id)}
                    disabled=${idx === entries.length - 1}
                    title="Move down (swap IDs)"
                  >▼</button>
                </span>
                <span class="mood-id-col">
                  <input
                    type="number"
                    class="mood-id-input"
                    value=${id}
                    min="-1"
                    max="778"
                    onBlur=${(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v !== Number(id)) handleChangeId(currentKey, id, v); else e.target.value = id; }}
                    onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  />
                </span>
                <span class="mood-name-col">
                  <input
                    type="text"
                    class="mood-name-input"
                    value=${name}
                    placeholder="Mood name..."
                    onBlur=${(e) => { if (e.target.value !== name) handleUpdateEntry(currentKey, id, e.target.value); }}
                    onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  />
                </span>
                <span class="mood-actions-col">
                  <button class="mood-delete-btn" onClick=${() => handleDeleteEntry(currentKey, id)} title="Remove">×</button>
                </span>
              </div>
            `)}
          </div>

          <button class="lox-push-btn" style="margin-top:8px;" onClick=${() => handleAddEntry(currentKey)}>
            + Add Mood
          </button>

          ${controls.length > 0 && currentKey === '_defaults' && html`
            <div style="margin-top:16px;font-size:12px;color:var(--ve-text-dim);">
              These defaults apply to all LightControllerV2 controls.
              Switch to a specific controller tab to create per-control overrides.
            </div>
          `}
        </div>
      `}

      ${toast && html`<div class="lox-toast lox-toast--${toast.type}">${toast.text}</div>`}
    </div>
  `;
}
