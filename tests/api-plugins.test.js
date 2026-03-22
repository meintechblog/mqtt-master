import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import apiPlugins from '../server/routes/api-plugins.js';

function createMockPluginManager() {
  const plugins = new Map();
  plugins.set('example', {
    id: 'example',
    name: 'example',
    status: 'stopped',
    error: null,
    instance: null,
  });

  return {
    listAll: vi.fn(() => {
      const result = [];
      for (const p of plugins.values()) {
        result.push({ id: p.id, name: p.name, status: p.status, error: p.error });
      }
      return result;
    }),
    start: vi.fn(async (id) => {
      if (!plugins.has(id)) throw new Error(`Plugin '${id}' not found`);
      plugins.get(id).status = 'running';
    }),
    stop: vi.fn(async (id) => {
      if (!plugins.has(id)) throw new Error(`Plugin '${id}' not found`);
      plugins.get(id).status = 'stopped';
    }),
    reload: vi.fn(async (id) => {
      if (!plugins.has(id)) throw new Error(`Plugin '${id}' not found`);
    }),
    getConfig: vi.fn((id) => {
      if (!plugins.has(id)) throw new Error(`Plugin '${id}' not found`);
      return { greeting: 'Hello' };
    }),
    setConfig: vi.fn(async (id, data) => {
      if (!plugins.has(id)) throw new Error(`Plugin '${id}' not found`);
    }),
    getStatus: vi.fn((id) => {
      if (!plugins.has(id)) throw new Error(`Plugin '${id}' not found`);
      return { status: plugins.get(id).status, error: null };
    }),
    getInstance: vi.fn((id) => {
      if (!plugins.has(id)) return null;
      if (plugins.get(id).status === 'running') {
        return {
          getConfigSchema: () => ({
            type: 'object',
            properties: { greeting: { type: 'string' } },
          }),
        };
      }
      return null;
    }),
    plugins,
  };
}

describe('API Plugins Routes', () => {
  let app;
  let mockPm;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    mockPm = createMockPluginManager();
    app.decorate('pluginManager', mockPm);
    await app.register(apiPlugins);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/plugins returns array of plugins with status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]).toHaveProperty('id', 'example');
    expect(body[0]).toHaveProperty('status', 'stopped');
  });

  it('POST /api/plugins/example/start returns 200 and starts plugin', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/plugins/example/start' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(mockPm.start).toHaveBeenCalledWith('example');
  });

  it('POST /api/plugins/example/stop returns 200 and stops plugin', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/plugins/example/stop' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(mockPm.stop).toHaveBeenCalledWith('example');
  });

  it('POST /api/plugins/example/reload returns 200', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/plugins/example/reload' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(mockPm.reload).toHaveBeenCalledWith('example');
  });

  it('GET /api/plugins/example/config returns config object + schema', async () => {
    // Start plugin first so getInstance returns something with getConfigSchema
    await app.inject({ method: 'POST', url: '/api/plugins/example/start' });

    const res = await app.inject({ method: 'GET', url: '/api/plugins/example/config' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('config');
    expect(body).toHaveProperty('schema');
    expect(body.config).toEqual({ greeting: 'Hello' });
  });

  it('GET /api/plugins/example/config returns empty schema when not running', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/example/config' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.config).toEqual({ greeting: 'Hello' });
    expect(body.schema).toEqual({});
  });

  it('PUT /api/plugins/example/config saves config and returns 200', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/plugins/example/config',
      payload: { greeting: 'Hi' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(mockPm.setConfig).toHaveBeenCalledWith('example', { greeting: 'Hi' });
  });

  it('POST /api/plugins/nonexistent/start returns 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/plugins/nonexistent/start' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('error');
  });

  it('POST /api/plugins/nonexistent/stop returns 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/plugins/nonexistent/stop' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('error');
  });

  it('GET /api/plugins/nonexistent/config returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/nonexistent/config' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('error');
  });
});
