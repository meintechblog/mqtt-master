import { html } from 'htm/preact';
import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { fetchLoxoneControlsDetailed } from '../lib/api-client.js';

/** Special IDs outside the regular 0-31 range */
const SPECIAL_IDS = new Set([-1, 777, 778]);
const MAX_REGULAR_ID = 31;

function isValidId(id) {
  return SPECIAL_IDS.has(id) || (id >= 0 && id <= MAX_REGULAR_ID);
}

/**
 * Mood Mapping page — configure mood ID → name mappings for LightControllerV2.
 * Edits are collected locally and only persisted when clicking Save.
 */
export function MoodMappings({ pluginId = 'loxone' } = {}) {
  const [savedMappings, setSavedMappings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [controls, setControls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [editControl, setEditControl] = useState(null);

  const hasChanges = draft && savedMappings && JSON.stringify(draft) !== JSON.stringify(savedMappings);

  useEffect(() => {
    async function load() {
      try {
        const [moodRes, ctrlData] = await Promise.all([
          fetch(`/api/plugins/${pluginId}/moods`).then(r => r.json()),
          fetchLoxoneControlsDetailed(pluginId).catch(() => []),
        ]);
        setSavedMappings(moodRes);
        setDraft(JSON.parse(JSON.stringify(moodRes)));
        setControls(ctrlData.filter(c => c.type === 'LightControllerV2'));
      } catch (err) {
        showToast('error', err.message);
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

  // --- Draft manipulation (local only, no API calls) ---

  const updateDraft = useCallback((fn) => {
    setDraft(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });
  }, []);

  const handleUpdateName = useCallback((key, moodId, name) => {
    updateDraft(d => {
      const section = key === '_defaults' ? d._defaults : d[key];
      if (section) section[String(moodId)] = name;
    });
  }, [updateDraft]);

  const handleChangeId = useCallback((key, oldId, newId) => {
    if (String(oldId) === String(newId)) return;
    if (!isValidId(newId)) return;
    updateDraft(d => {
      const section = key === '_defaults' ? d._defaults : d[key];
      if (!section) return;
      if (section[String(newId)] != null) {
        // Swap
        const otherName = section[String(newId)];
        section[String(newId)] = section[String(oldId)];
        section[String(oldId)] = otherName;
      } else {
        section[String(newId)] = section[String(oldId)];
        delete section[String(oldId)];
      }
    });
  }, [updateDraft]);

  const handleMoveUp = useCallback((key, id) => {
    const section = key === '_defaults' ? draft._defaults : (draft[key] || {});
    const sorted = Object.keys(section).map(Number).sort((a, b) => a - b);
    const idx = sorted.indexOf(Number(id));
    if (idx <= 0) return;
    handleChangeId(key, id, sorted[idx - 1]);
  }, [draft, handleChangeId]);

  const handleMoveDown = useCallback((key, id) => {
    const section = key === '_defaults' ? draft._defaults : (draft[key] || {});
    const sorted = Object.keys(section).map(Number).sort((a, b) => a - b);
    const idx = sorted.indexOf(Number(id));
    if (idx < 0 || idx >= sorted.length - 1) return;
    handleChangeId(key, id, sorted[idx + 1]);
  }, [draft, handleChangeId]);

  const handleAddEntry = useCallback((key) => {
    updateDraft(d => {
      const section = key === '_defaults' ? d._defaults : d[key];
      if (!section) return;
      const ids = Object.keys(section).map(Number);
      let nextId = 0;
      while (ids.includes(nextId)) nextId++;
      section[String(nextId)] = '';
    });
  }, [updateDraft]);

  const handleDeleteEntry = useCallback((key, moodId) => {
    const section = key === '_defaults' ? draft._defaults : (draft[key] || {});
    const name = section[String(moodId)] || moodId;
    if (!confirm(`Mood "${name}" (ID ${moodId}) wirklich löschen?`)) return;
    updateDraft(d => {
      const s = key === '_defaults' ? d._defaults : d[key];
      if (s) delete s[String(moodId)];
    });
  }, [draft, updateDraft]);

  const handleCreateOverride = useCallback((uuid) => {
    updateDraft(d => {
      d[uuid] = { ...d._defaults };
    });
    setEditControl(uuid);
  }, [updateDraft]);

  const handleDeleteOverride = useCallback((uuid) => {
    if (!confirm('Override entfernen? Es gelten dann wieder die Defaults.')) return;
    updateDraft(d => {
      delete d[uuid];
    });
    setEditControl(null);
  }, [updateDraft]);

  // --- Save to server ---

  const handleSave = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/${pluginId}/moods`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setSavedMappings(JSON.parse(JSON.stringify(draft)));
      showToast('ok', 'Saved');
    } catch (err) {
      showToast('error', err.message);
    }
  }, [pluginId, draft, showToast]);

  const handleDiscard = useCallback(() => {
    setDraft(JSON.parse(JSON.stringify(savedMappings)));
  }, [savedMappings]);

  // --- Render ---

  if (loading) return html`<div class="page-placeholder">Loading...</div>`;

  if (!draft) {
    return html`
      <div>
        <div class="page-header">Mood Mapping</div>
        <div class="ve-card" style="padding:20px;color:var(--ve-text-dim);">Plugin not running</div>
      </div>
    `;
  }

  const currentKey = editControl || '_defaults';
  const currentSection = currentKey === '_defaults' ? draft._defaults : (draft[currentKey] || {});
  const entries = Object.entries(currentSection).sort((a, b) => Number(a[0]) - Number(b[0]));
  const overrideUuids = Object.keys(draft).filter(k => k !== '_defaults');

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

      ${editControl && !draft[editControl] && html`
        <div class="ve-card" style="padding:20px;text-align:center;">
          <div style="color:var(--ve-text-dim);margin-bottom:12px;">
            Using default mappings. Create an override to customize moods for this controller.
          </div>
          <button class="lox-cmd-btn" onClick=${() => handleCreateOverride(editControl)}>
            Create Override
          </button>
        </div>
      `}

      ${(currentKey === '_defaults' || draft[currentKey]) && html`
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
              <div class="mood-row" key=${currentKey + ':' + id}>
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
                    onInput=${(e) => handleUpdateName(currentKey, id, e.target.value)}
                  />
                </span>
                <span class="mood-actions-col">
                  <button class="mood-delete-btn" onClick=${() => handleDeleteEntry(currentKey, id)} title="Remove">×</button>
                </span>
              </div>
            `)}
          </div>

          <div style="display:flex;gap:8px;align-items:center;margin-top:12px;">
            <button class="lox-push-btn" onClick=${() => handleAddEntry(currentKey)}>+ Add Mood</button>
            <div style="flex:1"></div>
            ${hasChanges && html`
              <span style="font-size:12px;color:var(--ve-orange);">Unsaved changes</span>
              <button class="lox-push-btn" onClick=${handleDiscard}>Discard</button>
              <button class="lox-cmd-btn" onClick=${handleSave}>Save</button>
            `}
          </div>

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
