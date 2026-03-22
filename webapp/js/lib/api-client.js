/**
 * REST API client helpers for plugin management.
 * Thin fetch wrappers around /api/plugins endpoints.
 */

async function request(url, options = {}) {
  const headers = {};
  // Only set JSON content-type when there's actually a body to send
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    headers,
    ...options,
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return body;
}

/** GET /api/plugins -- list all plugins with status */
export function fetchPlugins() {
  return request('/api/plugins');
}

/** POST /api/plugins/:id/start */
export function startPlugin(id) {
  return request(`/api/plugins/${encodeURIComponent(id)}/start`, { method: 'POST' });
}

/** POST /api/plugins/:id/stop */
export function stopPlugin(id) {
  return request(`/api/plugins/${encodeURIComponent(id)}/stop`, { method: 'POST' });
}

/** DELETE /api/plugins/:id -- delete a plugin instance */
export function deletePlugin(id) {
  return request(`/api/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** POST /api/plugins/:id/reload */
export function reloadPlugin(id) {
  return request(`/api/plugins/${encodeURIComponent(id)}/reload`, { method: 'POST' });
}

/** GET /api/plugins/:id/config -- returns { config, schema } */
export function getPluginConfig(id) {
  return request(`/api/plugins/${encodeURIComponent(id)}/config`);
}

/** PUT /api/plugins/:id/config -- save config object */
export function savePluginConfig(id, config) {
  return request(`/api/plugins/${encodeURIComponent(id)}/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// --- MQTT publish ---

/** POST /api/mqtt/publish -- publish a message to the broker */
export function publishMqtt(topic, payload, { retain = false, qos = 0 } = {}) {
  return request('/api/mqtt/publish', {
    method: 'POST',
    body: JSON.stringify({ topic, payload, retain, qos }),
  });
}

// --- Loxone-specific endpoints ---

/** GET /api/plugins/loxone/controls -- list all discovered controls */
export function fetchLoxoneControls() {
  return request('/api/plugins/loxone/controls');
}

/** GET /api/plugins/loxone/controls/detailed -- controls with subcontrols and live state */
export function fetchLoxoneControlsDetailed() {
  return request('/api/plugins/loxone/controls/detailed');
}

/** PUT /api/plugins/loxone/controls/:uuid -- toggle control enabled state */
export function toggleLoxoneControl(uuid, enabled) {
  return request(`/api/plugins/loxone/controls/${encodeURIComponent(uuid)}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

/** POST /api/plugins/loxone/controls/:uuid/cmd -- send command directly via WebSocket */
export function sendLoxoneCommand(uuid, command) {
  return request(`/api/plugins/loxone/controls/${encodeURIComponent(uuid)}/cmd`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}

/** GET /api/plugins/:id/bindings -- list MQTT input bindings for a plugin */
export function fetchInputBindings(pluginId = 'loxone') {
  return request(`/api/plugins/${encodeURIComponent(pluginId)}/bindings`);
}

/** PUT /api/plugins/:id/bindings -- save MQTT input bindings for a plugin */
export function saveInputBindings(pluginId = 'loxone', bindings) {
  return request(`/api/plugins/${encodeURIComponent(pluginId)}/bindings`, {
    method: 'PUT',
    body: JSON.stringify(bindings),
  });
}

