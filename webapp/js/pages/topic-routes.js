import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { fetchTopicRoutes, saveTopicRoutes } from '../lib/api-client.js';

/**
 * Topic routes configuration page.
 * Allows creating forwarding rules between external MQTT topics and Loxone topics.
 */
export function TopicRoutes() {
  const [routes, setRoutes] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState(null);
  const [newSource, setNewSource] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newDirection, setNewDirection] = useState('inbound');

  function showFeedback(type, text) {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 3000);
  }

  async function loadRoutes() {
    try {
      setError(null);
      const data = await fetchTopicRoutes();
      setRoutes(data);
    } catch (err) {
      setError(err.message);
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(routesToSave) {
    try {
      await saveTopicRoutes(routesToSave);
      showFeedback('success', 'Routes saved');
    } catch (err) {
      showFeedback('error', err.message);
    }
  }

  function handleAdd() {
    if (!newSource.trim() || !newTarget.trim()) return;

    const route = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sourceTopic: newSource.trim(),
      targetTopic: newTarget.trim(),
      direction: newDirection,
      enabled: true,
    };

    const updated = [...routes, route];
    setRoutes(updated);
    handleSave(updated);
    setNewSource('');
    setNewTarget('');
  }

  function handleDelete(id) {
    const updated = routes.filter(r => r.id !== id);
    setRoutes(updated);
    handleSave(updated);
  }

  function handleToggle(id) {
    const updated = routes.map(r =>
      r.id === id ? { ...r, enabled: !r.enabled } : r
    );
    setRoutes(updated);
    handleSave(updated);
  }

  useEffect(() => { loadRoutes(); }, []);

  if (loading) {
    return html`<div class="page-placeholder">Loading topic routes...</div>`;
  }

  if (error) {
    return html`
      <div>
        <div class="page-header">Topic Routes</div>
        <div class="ve-card" style="padding:20px;color:var(--ve-text-dim);">
          Plugin not running or unavailable: ${error}
        </div>
      </div>
    `;
  }

  const directionLabel = (d) => d === 'inbound' ? 'External \u2192 Loxone' : 'Loxone \u2192 External';

  return html`
    <div>
      <div class="page-header">Topic Routes</div>

      ${feedback && html`
        <div class="ve-card" style="margin-bottom:12px;padding:10px 14px;background:${feedback.type === 'error' ? 'var(--ve-red)' : 'var(--ve-green)'};color:#fff;border-radius:var(--ve-radius-sm);font-size:14px;">
          ${feedback.text}
        </div>
      `}

      <div class="ve-card" style="margin-bottom:16px;">
        <div style="font-size:16px;font-weight:600;margin-bottom:12px;">Active Routes</div>
        ${routes.length === 0
          ? html`<div style="color:var(--ve-text-dim);font-size:14px;">No routes configured.</div>`
          : html`
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead>
                  <tr style="border-bottom:1px solid var(--ve-border);text-align:left;">
                    <th style="padding:8px 12px;color:var(--ve-text-dim);font-weight:500;">Source Topic</th>
                    <th style="padding:8px 12px;color:var(--ve-text-dim);font-weight:500;">Direction</th>
                    <th style="padding:8px 12px;color:var(--ve-text-dim);font-weight:500;">Target Topic</th>
                    <th style="padding:8px 12px;color:var(--ve-text-dim);font-weight:500;text-align:center;">Enabled</th>
                    <th style="padding:8px 12px;color:var(--ve-text-dim);font-weight:500;text-align:center;"></th>
                  </tr>
                </thead>
                <tbody>
                  ${routes.map(route => html`
                    <tr key=${route.id} style="border-bottom:1px solid rgba(100,99,95,0.2);">
                      <td style="padding:8px 12px;font-family:var(--ve-font-mono);font-size:12px;color:var(--ve-text-primary);">${route.sourceTopic}</td>
                      <td style="padding:8px 12px;color:var(--ve-text-secondary);font-size:13px;">${directionLabel(route.direction)}</td>
                      <td style="padding:8px 12px;font-family:var(--ve-font-mono);font-size:12px;color:var(--ve-text-primary);">${route.targetTopic}</td>
                      <td style="padding:8px 12px;text-align:center;">
                        <input
                          type="checkbox"
                          checked=${route.enabled}
                          onChange=${() => handleToggle(route.id)}
                          style="width:16px;height:16px;cursor:pointer;"
                        />
                      </td>
                      <td style="padding:8px 12px;text-align:center;">
                        <button
                          class="msg-btn msg-btn--unsubscribe"
                          style="padding:4px 10px;font-size:12px;"
                          onClick=${() => handleDelete(route.id)}
                        >Delete</button>
                      </td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>
          `
        }
      </div>

      <div class="ve-card">
        <div style="font-size:16px;font-weight:600;margin-bottom:12px;">Add Route</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:12px;color:var(--ve-text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Source Topic</label>
            <input
              class="msg-topic-input"
              type="text"
              value=${newSource}
              onInput=${(e) => setNewSource(e.target.value)}
              placeholder="e.g. external/sensor/temperature"
              style="width:100%;"
            />
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--ve-text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Target Topic</label>
            <input
              class="msg-topic-input"
              type="text"
              value=${newTarget}
              onInput=${(e) => setNewTarget(e.target.value)}
              placeholder="e.g. loxone/wohnzimmer/helligkeit/cmd"
              style="width:100%;"
            />
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--ve-text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Direction</label>
            <select
              value=${newDirection}
              onChange=${(e) => setNewDirection(e.target.value)}
              style="padding:8px 12px;background:var(--ve-bg-main);border:1px solid var(--ve-border);border-radius:var(--ve-radius-sm);color:var(--ve-text-primary);font-size:14px;width:100%;"
            >
              <option value="inbound">Inbound (External \u2192 Loxone)</option>
              <option value="outbound">Outbound (Loxone \u2192 External)</option>
            </select>
          </div>
          <button class="msg-btn msg-btn--subscribe" onClick=${handleAdd} style="align-self:flex-start;">
            Add Route
          </button>
        </div>
      </div>
    </div>
  `;
}
