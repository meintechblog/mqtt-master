/**
 * REST API routes for plugin management.
 * Registered as a Fastify plugin -- expects app.pluginManager to be decorated.
 */
/** In-memory activity log (last 100 entries) */
const activityLog = [];
const MAX_LOG_ENTRIES = 100;

function addLogEntry(entry) {
  activityLog.unshift({ ...entry, timestamp: Date.now() });
  if (activityLog.length > MAX_LOG_ENTRIES) activityLog.length = MAX_LOG_ENTRIES;
}

export default async function apiPlugins(app) {
  // GET /api/activity-log -- get recent activity
  app.get('/api/activity-log', async () => {
    return activityLog;
  });

  // DELETE /api/activity-log -- clear log
  app.delete('/api/activity-log', async () => {
    activityLog.length = 0;
    return { ok: true };
  });

  // POST /api/mqtt/publish -- publish a message to the broker
  app.post('/api/mqtt/publish', async (request, reply) => {
    const { topic, payload, retain, qos } = request.body || {};
    if (!topic || typeof topic !== 'string') {
      return reply.status(400).send({ error: 'topic is required' });
    }
    try {
      await app.mqttService.publish(topic, payload ?? '', {
        retain: !!retain,
        qos: typeof qos === 'number' ? qos : 0,
      });
      addLogEntry({ action: 'publish', topic, payload: payload ?? '', retain: !!retain, qos: typeof qos === 'number' ? qos : 0 });
      app.log.info(`MQTT Publish: ${topic} → ${payload ?? ''}`);
      return { ok: true, topic, payload: payload ?? '' };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/plugins -- list all plugins with status
  app.get('/api/plugins', async () => {
    return app.pluginManager.listAll();
  });

  // GET /api/plugins/templates -- available plugin types for "Add Plugin"
  app.get('/api/plugins/templates', async () => {
    return app.pluginManager.getTemplates();
  });

  // POST /api/plugins/create -- create a new plugin instance
  app.post('/api/plugins/create', async (request, reply) => {
    const { type, id } = request.body || {};
    if (!type || !id) {
      return reply.status(400).send({ error: 'type and id are required' });
    }
    try {
      const result = await app.pluginManager.createInstance(type, id);
      return result;
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // DELETE /api/plugins/:id -- delete a plugin instance
  app.delete('/api/plugins/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await app.pluginManager.deleteInstance(id);
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
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
      const config = { ...app.pluginManager.getConfig(id) };
      // Try live instance first, fall back to schema cached at discovery time
      const instance = app.pluginManager.getInstance(id);
      let schema = {};
      if (instance && typeof instance.getConfigSchema === 'function') {
        schema = instance.getConfigSchema();
      } else {
        schema = app.pluginManager.getSchema(id);
      }
      // Mask sensitive fields in API response — never send passwords/tokens to the browser
      const props = (schema && schema.properties) || {};
      for (const [key, prop] of Object.entries(props)) {
        if (prop.format === 'password' && config[key]) {
          config[key] = '••••••••';
        }
      }
      // Strip internal fields managed by their own endpoints
      delete config.inputBindings;
      delete config.disabledControls;
      delete config.topicRoutes;
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
      const existingConfig = app.pluginManager.getConfig(id);
      // Strip internal fields that have their own API endpoints
      const body = { ...request.body };
      delete body.inputBindings;
      delete body.disabledControls;
      delete body.topicRoutes;
      // Merge: existing config as base, UI fields on top
      const newConfig = { ...existingConfig, ...body };
      const instance = app.pluginManager.getInstance(id);
      const schema = (instance && typeof instance.getConfigSchema === 'function')
        ? instance.getConfigSchema()
        : app.pluginManager.getSchema(id);
      const props = (schema && schema.properties) || {};
      for (const [key, prop] of Object.entries(props)) {
        if (prop.format === 'password' && newConfig[key] === '••••••••') {
          newConfig[key] = existingConfig[key] || '';
        }
      }
      await app.pluginManager.setConfig(id, newConfig);
      return { ok: true };
    } catch (err) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // --- Plugin-specific endpoints (dynamic :id) ---

  // GET /api/plugins/:id/controls -- list all discovered controls
  app.get('/api/plugins/:id/controls', async (request, reply) => {
    try {
      const instance = app.pluginManager.getInstance(request.params.id);
      if (!instance || typeof instance.getControls !== 'function') {
        return reply.status(400).send({ error: 'Plugin is not running or has no controls' });
      }
      return instance.getControls();
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/plugins/:id/controls/detailed -- controls with subcontrols and live state
  app.get('/api/plugins/:id/controls/detailed', async (request, reply) => {
    try {
      const instance = app.pluginManager.getInstance(request.params.id);
      if (!instance || typeof instance.getDetailedControls !== 'function') {
        return reply.status(400).send({ error: 'Plugin is not running or has no detailed controls' });
      }
      return instance.getDetailedControls();
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/plugins/:id/controls/:uuid -- toggle control enabled state
  app.put('/api/plugins/:id/controls/:uuid', async (request, reply) => {
    try {
      const instance = app.pluginManager.getInstance(request.params.id);
      if (!instance || typeof instance.setControlEnabled !== 'function') {
        return reply.status(400).send({ error: 'Plugin is not running or does not support control toggling' });
      }
      const { uuid } = request.params;
      const { enabled } = request.body || {};
      await instance.setControlEnabled(uuid, !!enabled);
      return { ok: true };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/plugins/:id/controls/:uuid/cmd -- send command to a control via WebSocket
  app.post('/api/plugins/:id/controls/:uuid/cmd', async (request, reply) => {
    try {
      const instance = app.pluginManager.getInstance(request.params.id);
      if (!instance || typeof instance.sendControlCommand !== 'function') {
        return reply.status(400).send({ error: 'Plugin is not running or does not support commands' });
      }
      const { uuid } = request.params;
      const { command } = request.body || {};
      if (!command || typeof command !== 'string') {
        return reply.status(400).send({ error: 'command is required' });
      }
      instance.sendControlCommand(uuid, command);
      return { ok: true, uuid, command };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/plugins/:id/bindings -- list MQTT input bindings for a plugin
  app.get('/api/plugins/:id/bindings', async (request, reply) => {
    const { id } = request.params;
    try {
      const instance = app.pluginManager.getInstance(id);
      if (instance && typeof instance.getInputBindings === 'function') {
        return instance.getInputBindings();
      }
      // Fallback: read from config directly
      const config = app.pluginManager.getConfig(id);
      return config.inputBindings || [];
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/plugins/:id/bindings -- save MQTT input bindings for a plugin
  app.put('/api/plugins/:id/bindings', async (request, reply) => {
    const { id } = request.params;
    try {
      const instance = app.pluginManager.getInstance(id);
      if (instance && typeof instance.setInputBindings === 'function') {
        await instance.setInputBindings(request.body || []);
      } else {
        // Store in config directly for plugins without runtime binding support
        const config = app.pluginManager.getConfig(id);
        config.inputBindings = request.body || [];
        await app.pluginManager.setConfig(id, config);
      }
      return { ok: true };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/mqtt/discover -- subscribe to a pattern, collect messages, return topics with sample payloads
  app.post('/api/mqtt/discover', async (request, reply) => {
    const { pattern, durationMs = 3000 } = request.body || {};
    if (!pattern || typeof pattern !== 'string') {
      return reply.status(400).send({ error: 'pattern is required (e.g. "pv-inverter-proxy/#")' });
    }
    const duration = Math.min(Math.max(Number(durationMs) || 3000, 1000), 10000);

    const collected = new Map(); // topic -> { payload, fields, ts }

    const handler = (msg) => {
      if (collected.has(msg.topic)) return; // one sample per topic
      let fields = null;
      try {
        const data = JSON.parse(msg.payload);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          fields = Object.entries(data).map(([key, val]) => ({
            key,
            type: typeof val,
            sample: typeof val === 'number' ? val : String(val).substring(0, 100),
          }));
        }
      } catch { /* not JSON */ }
      collected.set(msg.topic, {
        topic: msg.topic,
        payload: msg.payload.substring(0, 500),
        fields,
        ts: Date.now(),
      });
    };

    app.mqttService.subscribe(pattern);
    app.mqttService.on('message', handler);

    await new Promise(resolve => setTimeout(resolve, duration));

    app.mqttService.removeListener('message', handler);
    app.mqttService.unsubscribe(pattern);

    return [...collected.values()];
  });

  // GET /api/plugins/:id/elements -- list bridged topics with live values
  app.get('/api/plugins/:id/elements', async (request, reply) => {
    try {
      const instance = app.pluginManager.getInstance(request.params.id);
      if (!instance || typeof instance.getElements !== 'function') {
        return reply.status(400).send({ error: 'Plugin is not running or has no elements' });
      }
      return instance.getElements();
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

}
