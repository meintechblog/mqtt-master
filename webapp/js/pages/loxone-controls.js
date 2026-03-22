import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { fetchLoxoneControls, toggleLoxoneControl } from '../lib/api-client.js';

/**
 * Loxone controls table page.
 * Displays all discovered controls with enable/disable toggles.
 */
export function LoxoneControls() {
  const [controls, setControls] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadControls() {
    try {
      setError(null);
      const data = await fetchLoxoneControls();
      setControls(data);
    } catch (err) {
      setError(err.message);
      setControls([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(uuid, currentEnabled) {
    try {
      await toggleLoxoneControl(uuid, !currentEnabled);
      setControls(prev =>
        prev.map(c => c.uuid === uuid ? { ...c, enabled: !currentEnabled } : c)
      );
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { loadControls(); }, []);

  if (loading) {
    return html`<div class="page-placeholder">Loading controls...</div>`;
  }

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

  return html`
    <div>
      <div class="page-header">
        Loxone Controls
        <span style="font-size:14px;color:var(--ve-text-dim);font-weight:400;margin-left:8px;">
          (${controls.length} controls)
        </span>
      </div>
      <div class="ve-card" style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="border-bottom:1px solid var(--ve-border);text-align:left;">
              <th style="padding:8px 12px;color:var(--ve-text-dim);font-weight:500;">Name</th>
              <th style="padding:8px 12px;color:var(--ve-text-dim);font-weight:500;">Room</th>
              <th style="padding:8px 12px;color:var(--ve-text-dim);font-weight:500;">Type</th>
              <th style="padding:8px 12px;color:var(--ve-text-dim);font-weight:500;">Topic</th>
              <th style="padding:8px 12px;color:var(--ve-text-dim);font-weight:500;text-align:center;">Enabled</th>
            </tr>
          </thead>
          <tbody>
            ${controls.map(ctrl => html`
              <tr key=${ctrl.uuid} style="border-bottom:1px solid rgba(100,99,95,0.2);">
                <td style="padding:8px 12px;color:var(--ve-text-primary);">${ctrl.name}</td>
                <td style="padding:8px 12px;color:var(--ve-text-secondary);">${ctrl.room}</td>
                <td style="padding:8px 12px;color:var(--ve-text-dim);">${ctrl.type}</td>
                <td style="padding:8px 12px;font-family:var(--ve-font-mono);font-size:12px;color:var(--ve-text-dim);">${ctrl.topic}</td>
                <td style="padding:8px 12px;text-align:center;">
                  <input
                    type="checkbox"
                    checked=${ctrl.enabled}
                    onChange=${() => handleToggle(ctrl.uuid, ctrl.enabled)}
                    style="width:16px;height:16px;cursor:pointer;"
                  />
                </td>
              </tr>
            `)}
          </tbody>
        </table>
        ${controls.length === 0 && html`
          <div style="padding:20px;text-align:center;color:var(--ve-text-dim);">
            No controls discovered. Make sure the Loxone plugin is running and connected.
          </div>
        `}
      </div>
    </div>
  `;
}
