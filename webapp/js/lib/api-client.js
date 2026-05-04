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

/** GET /api/system/info -- LAN connection info (hostname, IPs, broker URLs) */
export function fetchSystemInfo() {
  return request('/api/system/info');
}

/** GET /api/bindings -- flat list of every input binding across plugins */
export function fetchAllBindings() {
  return request('/api/bindings');
}

/** GET /api/update/status -- current version + GitHub-poll state + auto-update settings */
export function fetchUpdateStatus() {
  return request('/api/update/status');
}

/** POST /api/update/check -- force a fresh GitHub /commits/main check */
export function triggerUpdateCheck() {
  return request('/api/update/check', { method: 'POST', body: JSON.stringify({}) });
}

/** POST /api/update/run -- spawn the sibling updater unit (manual trigger) */
export function triggerUpdateRun() {
  return request('/api/update/run', { method: 'POST', body: JSON.stringify({}) });
}

/** PUT /api/update/settings -- toggle autoApply / autoUpdateHour */
export function saveUpdateSettings(patch) {
  return request('/api/update/settings', { method: 'PUT', body: JSON.stringify(patch) });
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

// --- Plugin control endpoints (dynamic pluginId) ---

/** GET /api/plugins/:id/controls */
export function fetchLoxoneControls(pluginId = 'loxone') {
  return request(`/api/plugins/${encodeURIComponent(pluginId)}/controls`);
}

/** GET /api/plugins/:id/controls/detailed */
export function fetchLoxoneControlsDetailed(pluginId = 'loxone') {
  return request(`/api/plugins/${encodeURIComponent(pluginId)}/controls/detailed`);
}

/** PUT /api/plugins/:id/controls/:uuid */
export function toggleLoxoneControl(uuid, enabled, pluginId = 'loxone') {
  return request(`/api/plugins/${encodeURIComponent(pluginId)}/controls/${encodeURIComponent(uuid)}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

/** POST /api/plugins/:id/controls/:uuid/cmd */
export function sendLoxoneCommand(uuid, command, pluginId = 'loxone') {
  return request(`/api/plugins/${encodeURIComponent(pluginId)}/controls/${encodeURIComponent(uuid)}/cmd`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}

/** GET /api/plugins/:id/elements */
export function fetchBridgeElements(pluginId) {
  return request(`/api/plugins/${encodeURIComponent(pluginId)}/elements`);
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

