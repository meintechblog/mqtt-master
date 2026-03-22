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
