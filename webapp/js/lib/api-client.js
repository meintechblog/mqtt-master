/**
 * REST API client helpers for plugin management.
 * Thin fetch wrappers around /api/plugins endpoints.
 */

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
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

// --- Loxone-specific endpoints ---

/** GET /api/plugins/loxone/controls -- list all discovered controls */
export function fetchLoxoneControls() {
  return request('/api/plugins/loxone/controls');
}

/** PUT /api/plugins/loxone/controls/:uuid -- toggle control enabled state */
export function toggleLoxoneControl(uuid, enabled) {
  return request(`/api/plugins/loxone/controls/${encodeURIComponent(uuid)}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

/** GET /api/plugins/loxone/routes -- list topic routes */
export function fetchTopicRoutes() {
  return request('/api/plugins/loxone/routes');
}

/** PUT /api/plugins/loxone/routes -- save topic routes */
export function saveTopicRoutes(routes) {
  return request('/api/plugins/loxone/routes', {
    method: 'PUT',
    body: JSON.stringify(routes),
  });
}
