/**
 * REST API routes for plugin management.
 * Registered as a Fastify plugin -- expects app.pluginManager to be decorated.
 */
export default async function apiPlugins(app) {
  // GET /api/plugins -- list all plugins with status
  app.get('/api/plugins', async () => {
    return app.pluginManager.listAll();
  });

  // POST /api/plugins/:id/start
  app.post('/api/plugins/:id/start', async (request, reply) => {
    const { id } = request.params;
    try {
      await app.pluginManager.start(id);
      return { ok: true };
    } catch (err) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/plugins/:id/stop
  app.post('/api/plugins/:id/stop', async (request, reply) => {
    const { id } = request.params;
    try {
      await app.pluginManager.stop(id);
      return { ok: true };
    } catch (err) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/plugins/:id/reload
  app.post('/api/plugins/:id/reload', async (request, reply) => {
    const { id } = request.params;
    try {
      await app.pluginManager.reload(id);
      return { ok: true };
    } catch (err) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/plugins/:id/config
  app.get('/api/plugins/:id/config', async (request, reply) => {
    const { id } = request.params;
    try {
      const config = app.pluginManager.getConfig(id);
      const instance = app.pluginManager.getInstance(id);
      const schema = instance && typeof instance.getConfigSchema === 'function'
        ? instance.getConfigSchema()
        : {};
      return { config, schema };
    } catch (err) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/plugins/:id/config
  app.put('/api/plugins/:id/config', async (request, reply) => {
    const { id } = request.params;
    try {
      await app.pluginManager.setConfig(id, request.body);
      return { ok: true };
    } catch (err) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // --- Loxone-specific endpoints ---

  // GET /api/plugins/loxone/controls -- list all discovered controls
  app.get('/api/plugins/loxone/controls', async (request, reply) => {
    try {
      const instance = app.pluginManager.getInstance('loxone');
      if (!instance || typeof instance.getControls !== 'function') {
        return reply.status(400).send({ error: 'Loxone plugin is not running' });
      }
      return instance.getControls();
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/plugins/loxone/controls/:uuid -- toggle control enabled state
  app.put('/api/plugins/loxone/controls/:uuid', async (request, reply) => {
    try {
      const instance = app.pluginManager.getInstance('loxone');
      if (!instance || typeof instance.setControlEnabled !== 'function') {
        return reply.status(400).send({ error: 'Loxone plugin is not running' });
      }
      const { uuid } = request.params;
      const { enabled } = request.body || {};
      await instance.setControlEnabled(uuid, !!enabled);
      return { ok: true };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/plugins/loxone/routes -- list topic routes
  app.get('/api/plugins/loxone/routes', async (request, reply) => {
    try {
      const instance = app.pluginManager.getInstance('loxone');
      if (!instance || typeof instance.getTopicRoutes !== 'function') {
        return reply.status(400).send({ error: 'Loxone plugin is not running' });
      }
      return instance.getTopicRoutes();
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/plugins/loxone/routes -- save topic routes
  app.put('/api/plugins/loxone/routes', async (request, reply) => {
    try {
      const instance = app.pluginManager.getInstance('loxone');
      if (!instance || typeof instance.setTopicRoutes !== 'function') {
        return reply.status(400).send({ error: 'Loxone plugin is not running' });
      }
      await instance.setTopicRoutes(request.body || []);
      return { ok: true };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
