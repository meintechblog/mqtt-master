/**
 * Loxone bridge plugin -- bidirectional MQTT bridge with HA Discovery.
 *
 * Composes LoxoneWs (WebSocket client) and LoxoneStructure (UUID mapper)
 * into a plugin that bridges Loxone Miniserver state events to MQTT topics
 * and MQTT commands back to the Miniserver.
 */
import { LoxoneWs } from './loxone-ws.js';
import { LoxoneStructure } from './loxone-structure.js';

/** Map Loxone control types to Home Assistant MQTT Discovery components */
const HA_TYPE_MAP = {
  Switch: 'switch',
  Dimmer: 'light',
  Jalousie: 'cover',
  InfoOnlyAnalog: 'sensor',
  InfoOnlyDigital: 'binary_sensor',
};

export default class LoxonePlugin {
  constructor() {
    /** @type {LoxoneWs|null} */
    this._ws = null;
    /** @type {LoxoneStructure|null} */
    this._structure = null;
    this._running = false;
    this._connected = false;
    this._controlCount = 0;
    this._lastEvent = null;
    this._messageCount = 0;
    this._prefix = 'loxone';
    this._config = {};
    this._ctx = null;

    /** @type {Function|null} bound MQTT message handler for cleanup */
    this._mqttHandler = null;

    /** @type {string[]} UUIDs of disabled controls */
    this._disabledControls = [];

    /** @type {Array<object>} active topic route definitions */
    this._topicRoutes = [];

    /** @type {Map<string, Function>} active topic route subscription handlers for cleanup */
    this._routeHandlers = new Map();

    /** @type {Map<string, Map<string, number>>} controlUuid -> Map<moodName, moodId> */
    this._moodsByControl = new Map();

    /** @type {Map<string, { value?: number, text?: string }>} stateUuid -> last known value */
    this._stateCache = new Map();

    /** @type {Array<object>} MQTT input binding definitions */
    this._inputBindings = [];

    /** @type {Map<string, Function>} binding MQTT subscription handlers */
    this._bindingHandlers = new Map();

    /** @type {Map<string, { ts: number, value: number|string }>} binding last-send state */
    this._bindingLastSend = new Map();

    /** @type {Map<string, string>} UUID -> previous topic (for detecting renames) */
    this._prevTopics = new Map();

    /** @type {ReturnType<typeof setInterval>|null} periodic structure check */
    this._structureCheckInterval = null;
  }

  /**
   * Start the plugin: fetch structure, connect WebSocket, wire events.
   * @param {{ mqttService: object, configService: object, logger: object, pluginId: string }} context
   */
  async start(context) {
    this._ctx = context;
    const { mqttService, configService, logger } = context;

    // 1. Read config
    this._config = configService.get('plugins.loxone', {});
    const {
      ip = '127.0.0.1',
      port = 80,
      username = '',
      password = '',
      prefix = 'loxone',
      enableHaDiscovery = true,
    } = this._config;

    this._prefix = prefix;
    this._disabledControls = this._config.disabledControls || [];

    // 2. Create structure parser and fetch structure
    this._structure = new LoxoneStructure(prefix);
    try {
      const loxApp3 = await this._structure.fetchStructure(ip, port, username, password);
      this._structure.buildMap(loxApp3);
    } catch (err) {
      logger.error(`Failed to fetch Loxone structure: ${err.message}`);
      throw err;
    }

    const controls = this._structure.getAll();
    this._controlCount = controls.length;
    this._snapshotTopics();
    logger.info(`Loxone structure loaded: ${this._controlCount} controls`);

    // 3. Create WebSocket client
    this._ws = new LoxoneWs({ host: ip, port, user: username, pass: password });

    // 4. Wire value events -> MQTT publish
    this._ws.on('valueEvent', ({ uuid, value }) => {
      this._onValueEvent(uuid, value);
    });

    // 5. Wire text events -> MQTT publish
    this._ws.on('textEvent', ({ uuid, text }) => {
      logger.debug(`textEvent uuid=${uuid} text=${text.substring(0, 120)}`);
      this._onTextEvent(uuid, text);
    });

    // 5b. Wire text messages (non-binary responses) for debugging
    this._ws.on('textMessage', (text) => {
      logger.debug(`textMessage: ${text.substring(0, 200)}`);
    });

    // 5c. Log unknown binary payload types
    this._ws.on('debugPayload', ({ identifier, length }) => {
      logger.debug(`Unknown binary payload: identifier=0x${identifier.toString(16)}, length=${length}`);
    });

    // 5d. Wire text state events (header 0x00 + text frame) — these carry moodList etc.
    this._ws.on('textStateEvent', (text) => {
      logger.debug(`textStateEvent: ${text.substring(0, 200)}`);
      this._onTextStateEvent(text);
    });

    // 6. Wire reconnected -> re-fetch structure with change detection
    this._ws.on('reconnected', async () => {
      logger.info('Loxone WebSocket reconnected, re-fetching structure');
      await this._refreshStructure();
    });

    // 7. Subscribe to MQTT cmd topics (controls and sub-controls)
    mqttService.subscribe(`${prefix}/+/+/cmd`);
    mqttService.subscribe(`${prefix}/+/+/+/cmd`);

    // 8. Wire MQTT messages -> WebSocket commands
    this._mqttHandler = (msg) => this._onMqttMessage(msg);
    mqttService.on('message', this._mqttHandler);

    // 9. Connect WebSocket
    await this._ws.connect();
    this._connected = true;

    // 10. Publish HA Discovery if enabled
    if (enableHaDiscovery) {
      this._publishHaDiscovery();
    }

    // 11. Publish bridge status online
    mqttService.publish(`${prefix}/bridge/status`, 'online', { retain: true });

    // 12. Request mood lists for all LightControllerV2 controls
    this._requestMoodLists();

    // 12. Set up topic routes
    this._topicRoutes = this._config.topicRoutes || [];
    this._applyTopicRoutes();

    // 13. Set up MQTT input bindings
    this._inputBindings = this._config.inputBindings || [];
    this._applyInputBindings();

    // 14. Periodic structure check (detects renames/additions/removals)
    this._structureCheckInterval = setInterval(() => {
      this._refreshStructure();
    }, 60_000);

    this._running = true;
    logger.info('Loxone bridge plugin started');
  }

  /**
   * Stop the plugin: disconnect, unsubscribe, clean up.
   */
  async stop() {
    if (!this._running && !this._ctx) return;

    const { mqttService, logger } = this._ctx || {};

    // 1. Publish offline status
    if (mqttService) {
      mqttService.publish(`${this._prefix}/bridge/status`, 'offline', { retain: true });
    }

    // 2. Disconnect WebSocket
    if (this._ws) {
      this._ws.removeAllListeners();
      await this._ws.disconnect();
      this._ws = null;
    }

    // 3. Unsubscribe from MQTT cmd topics
    if (mqttService) {
      mqttService.unsubscribe(`${this._prefix}/+/+/cmd`);
      mqttService.unsubscribe(`${this._prefix}/+/+/+/cmd`);
    }

    // 4. Remove MQTT message listener
    if (mqttService && this._mqttHandler) {
      mqttService.removeListener('message', this._mqttHandler);
      this._mqttHandler = null;
    }

    // 4b. Clean up topic route subscriptions
    this._cleanupRouteHandlers();

    // 4c. Clean up input binding subscriptions
    this._cleanupBindingHandlers();

    // 4d. Stop periodic structure check
    if (this._structureCheckInterval) {
      clearInterval(this._structureCheckInterval);
      this._structureCheckInterval = null;
    }

    // 5. Clear state
    this._running = false;
    this._connected = false;
    this._controlCount = 0;
    this._lastEvent = null;
    this._structure = null;
    this._stateCache.clear();

    if (logger) logger.info('Loxone bridge plugin stopped');
  }

  /**
   * Return current plugin status.
   * @returns {{ running: boolean, connected: boolean, controlCount: number, lastEvent: number|null }}
   */
  getStatus() {
    return {
      running: this._running,
      connected: this._connected,
      controlCount: this._controlCount,
      lastEvent: this._lastEvent,
      messageCount: this._messageCount,
    };
  }

  /**
   * Return JSON Schema for the plugin configuration form.
   * @returns {object}
   */
  getConfigSchema() {
    return {
      type: 'object',
      properties: {
        displayName: {
          type: 'string',
          title: 'Display Name',
          description: 'Name shown in the sidebar (e.g. "Miniserver Wohnung")',
        },
        ip: {
          type: 'string',
          title: 'Miniserver IP',
          description: 'IP address or hostname of the Loxone Miniserver',
        },
        port: {
          type: 'integer',
          title: 'Port',
          default: 80,
          description: 'HTTP/WebSocket port',
        },
        username: {
          type: 'string',
          title: 'Username',
        },
        password: {
          type: 'string',
          title: 'Password',
          format: 'password',
        },
        prefix: {
          type: 'string',
          title: 'MQTT Topic Prefix',
          default: 'loxone',
          description: 'Root prefix for all Loxone MQTT topics',
        },
        autoStart: {
          type: 'boolean',
          title: 'Auto-start',
          default: false,
          description: 'Start the plugin automatically when the server starts',
        },
        enableHaDiscovery: {
          type: 'boolean',
          title: 'Home Assistant Discovery',
          default: true,
          description: 'Publish MQTT Discovery messages for Home Assistant auto-detection',
        },
      },
    };
  }

  // --- Controls management ---

  /**
   * Get all controls with their enabled state.
   * @returns {Array<{ uuid: string, name: string, type: string, room: string, topic: string, enabled: boolean }>}
   */
  getControls() {
    if (!this._structure) return [];
    return this._structure.getAll().map(ctrl => ({
      uuid: ctrl.uuid,
      name: ctrl.name,
      type: ctrl.type,
      room: ctrl.room,
      topic: ctrl.topic,
      enabled: !this._disabledControls.includes(ctrl.uuid),
    }));
  }

  /**
   * Get detailed control tree with subcontrols, live state values, and moods.
   * @returns {Array<object>}
   */
  getDetailedControls() {
    if (!this._structure) return [];
    const tree = this._structure.getControlTree();

    return tree.map(ctrl => {
      const states = {};
      for (const s of ctrl.states) {
        const cached = this._stateCache.get(s.uuid);
        states[s.key] = cached || null;
      }

      const subControls = ctrl.subControls.map(sub => {
        const subStates = {};
        for (const s of sub.states) {
          const cached = this._stateCache.get(s.uuid);
          subStates[s.key] = cached || null;
        }
        return {
          uuid: sub.uuid,
          name: sub.name,
          type: sub.type,
          topic: sub.topic,
          states: subStates,
        };
      });

      // Get moods if available (as {id, name} array)
      const moodMap = this._moodsByControl.get(ctrl.uuid);
      const moods = [];
      if (moodMap) {
        const seen = new Set();
        for (const [name, id] of moodMap) {
          // Skip lowercase duplicates — keep original casing
          if (name === name.toLowerCase() && moodMap.has(name.charAt(0).toUpperCase() + name.slice(1))) continue;
          if (!seen.has(id)) {
            seen.add(id);
            moods.push({ id, name });
          }
        }
      }

      // Determine active mood IDs from activeMoodsNum or activeMoods state
      let activeMoodIds = [];
      if (states.activeMoods && states.activeMoods.text) {
        try { activeMoodIds = JSON.parse(states.activeMoods.text); } catch { /* ignore */ }
      } else if (states.activeMoodsNum && states.activeMoodsNum.value != null) {
        activeMoodIds = [states.activeMoodsNum.value];
      }

      return {
        uuid: ctrl.uuid,
        name: ctrl.name,
        type: ctrl.type,
        room: ctrl.room,
        category: ctrl.category || '',
        topic: ctrl.topic,
        enabled: !this._disabledControls.includes(ctrl.uuid),
        states,
        subControls,
        moods,
        activeMoodIds,
      };
    });
  }

  /**
   * Set a control's enabled state. Updates config and persists.
   * @param {string} uuid
   * @param {boolean} enabled
   */
  async setControlEnabled(uuid, enabled) {
    if (enabled) {
      this._disabledControls = this._disabledControls.filter(id => id !== uuid);
    } else {
      if (!this._disabledControls.includes(uuid)) {
        this._disabledControls.push(uuid);
      }
    }
    // Persist to config
    this._config.disabledControls = this._disabledControls;
    if (this._ctx) {
      this._ctx.configService.set('plugins.loxone', this._config);
      await this._ctx.configService.save();
    }
  }

  /**
   * Send a command to a control/subcontrol via the WebSocket.
   * @param {string} uuid
   * @param {string} command
   */
  sendControlCommand(uuid, command) {
    if (!this._ws) throw new Error('WebSocket not connected');
    const cmd = `jdev/sps/io/${uuid}/${command}`;
    this._ctx.logger.info(`API→Loxone: ${uuid} → ${cmd}`);
    this._ws.sendCommand(cmd);
  }

  // --- Topic routes management ---

  /**
   * Get current topic routes.
   * @returns {Array<object>}
   */
  getTopicRoutes() {
    return [...this._topicRoutes];
  }

  /**
   * Set topic routes, persist, and re-apply subscriptions.
   * @param {Array<object>} routes
   */
  async setTopicRoutes(routes) {
    this._topicRoutes = routes;
    this._config.topicRoutes = routes;
    if (this._ctx) {
      this._ctx.configService.set('plugins.loxone', this._config);
      await this._ctx.configService.save();
    }
    this._applyTopicRoutes();
  }

  // --- Input bindings management ---

  /**
   * Get current MQTT input bindings.
   * @returns {Array<object>}
   */
  getInputBindings() {
    return [...this._inputBindings];
  }

  /**
   * Set input bindings, persist, and re-apply subscriptions.
   * @param {Array<object>} bindings
   */
  async setInputBindings(bindings) {
    this._inputBindings = bindings;
    this._config.inputBindings = bindings;
    if (this._ctx) {
      this._ctx.configService.set('plugins.loxone', this._config);
      await this._ctx.configService.save();
    }
    this._applyInputBindings();
  }

  /**
   * Apply input bindings: subscribe to MQTT topics, extract values, forward to Loxone.
   *
   * Binding format:
   * {
   *   id: string,
   *   enabled: boolean,
   *   mqttTopic: string,        // e.g. "pv-inverter-proxy/device/5303f554b55d/state"
   *   jsonField: string,        // e.g. "ac_power_w" (dot notation for nested)
   *   targetUuid: string,       // Loxone control/VI UUID
   *   transform: string|null,   // "div1000" (W→kW), "mul100", "round", or null
   *   keepaliveMs: number,     // resend unchanged value every N ms (default 30000)
   *   label: string,            // display name
   * }
   */
  _applyInputBindings() {
    if (!this._ctx) return;
    const { mqttService, logger } = this._ctx;

    this._cleanupBindingHandlers();

    for (const binding of this._inputBindings) {
      if (!binding.enabled) continue;
      if (!binding.mqttTopic || !binding.jsonField || !binding.targetUuid) continue;

      const keepaliveMs = binding.keepaliveMs || binding.intervalMs || 30000;

      mqttService.subscribe(binding.mqttTopic);

      const handler = (msg) => {
        if (msg.topic !== binding.mqttTopic) return;

        try {
          const data = JSON.parse(msg.payload);
          let value = this._extractField(data, binding.jsonField);
          if (value == null) return;

          value = this._applyTransform(value, binding.transform);

          // Round to 3 decimals to filter out micro-fluctuations
          if (typeof value === 'number') {
            value = Math.round(value * 1000) / 1000;
          }

          const now = Date.now();
          const last = this._bindingLastSend.get(binding.id);
          const valueChanged = !last || last.value !== value;
          const keepaliveExpired = !last || (now - last.ts >= keepaliveMs);

          // Send if value changed OR keepalive expired
          if (!valueChanged && !keepaliveExpired) return;

          if (this._ws) {
            const cmd = `jdev/sps/io/${binding.targetUuid}/${value}`;
            this._ws.sendCommand(cmd);
            this._bindingLastSend.set(binding.id, { ts: now, value });
            if (valueChanged) {
              logger.debug(`Binding ${binding.label || binding.id}: ${value} → ${binding.targetUuid}`);
            }
          }
        } catch { /* ignore parse errors */ }
      };

      mqttService.on('message', handler);
      this._bindingHandlers.set(binding.id, { handler, topic: binding.mqttTopic });
      logger.info(`Input binding: ${binding.mqttTopic} [${binding.jsonField}] → ${binding.targetUuid} (${binding.label || binding.id}, keepalive ${keepaliveMs / 1000}s)`);
    }
  }

  /**
   * Extract a field from a JSON object using dot notation.
   * @param {object} obj
   * @param {string} path - e.g. "ac_power_w" or "data.power"
   * @returns {number|string|null}
   */
  _extractField(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return null;
      current = current[part];
    }
    return current ?? null;
  }

  /**
   * Apply a value transform.
   * @param {number} value
   * @param {string|null} transform
   * @returns {number}
   */
  _applyTransform(value, transform) {
    if (!transform) return value;
    const num = Number(value);
    if (isNaN(num)) return value;
    switch (transform) {
      case 'div1000': return Math.round(num / 1000 * 1000) / 1000;   // W→kW, 3 decimal
      case 'div100': return Math.round(num / 100 * 100) / 100;
      case 'mul1000': return num * 1000;
      case 'mul100': return num * 100;
      case 'round': return Math.round(num);
      case 'round1': return Math.round(num * 10) / 10;
      default: return num;
    }
  }

  /** Clean up all input binding subscription handlers. */
  _cleanupBindingHandlers() {
    if (!this._ctx) return;
    const { mqttService } = this._ctx;

    for (const [, entry] of this._bindingHandlers) {
      mqttService.removeListener('message', entry.handler);
      mqttService.unsubscribe(entry.topic);
    }
    this._bindingHandlers.clear();
    this._bindingLastSend.clear();
  }

  // --- Structure change detection ---

  /**
   * Snapshot current UUID->topic mapping for later comparison.
   */
  _snapshotTopics() {
    this._prevTopics.clear();
    if (!this._structure) return;
    for (const ctrl of this._structure.getAll()) {
      this._prevTopics.set(ctrl.uuid, ctrl.topic);
    }
  }

  /**
   * Re-fetch structure, detect renames, clean up stale MQTT topics.
   */
  async _refreshStructure() {
    if (!this._ctx || !this._structure) return;
    const { mqttService, logger } = this._ctx;
    const { ip, port, username, password, enableHaDiscovery } = this._config;

    try {
      const loxApp3 = await this._structure.fetchStructure(ip, port, username, password);
      this._structure.buildMap(loxApp3);
    } catch (err) {
      logger.warn(`Structure refresh failed: ${err.message}`);
      return;
    }

    const newControls = this._structure.getAll();
    this._controlCount = newControls.length;

    // Detect renamed/removed controls
    let changes = 0;
    for (const [uuid, oldTopic] of this._prevTopics) {
      const newMeta = this._structure.getMeta(uuid);
      if (!newMeta) {
        // Control removed — clear old retained messages
        this._clearRetainedTopics(oldTopic);
        logger.info(`Control removed: ${oldTopic}`);
        changes++;
      } else if (newMeta.topic !== oldTopic) {
        // Control renamed — clear old, new will be published by events
        this._clearRetainedTopics(oldTopic);
        logger.info(`Control renamed: ${oldTopic} → ${newMeta.topic}`);
        changes++;
      }
    }

    // Detect new controls
    for (const ctrl of newControls) {
      if (!this._prevTopics.has(ctrl.uuid)) {
        logger.info(`New control discovered: ${ctrl.topic} (${ctrl.name})`);
        changes++;
      }
    }

    if (changes > 0) {
      logger.info(`Structure updated: ${changes} change(s), ${newControls.length} controls total`);
      if (enableHaDiscovery) {
        this._publishHaDiscovery();
      }
    }

    // Update snapshot
    this._snapshotTopics();
  }

  /**
   * Clear retained MQTT messages for a control topic and its subtopics.
   * Publishes empty retained messages to remove stale data from the broker.
   */
  _clearRetainedTopics(baseTopic) {
    if (!this._ctx) return;
    const { mqttService } = this._ctx;
    // Clear state topic and common subtopics
    const suffixes = ['/state', '/cmd', ''];
    for (const suffix of suffixes) {
      mqttService.publish(baseTopic + suffix, '', { retain: true });
    }
    // Clear HA Discovery for this topic
    const slug = baseTopic.split('/').pop();
    mqttService.publish(`homeassistant/sensor/loxone_bridge/${slug}/config`, '', { retain: true });
    mqttService.publish(`homeassistant/switch/loxone_bridge/${slug}/config`, '', { retain: true });
    mqttService.publish(`homeassistant/light/loxone_bridge/${slug}/config`, '', { retain: true });
    mqttService.publish(`homeassistant/cover/loxone_bridge/${slug}/config`, '', { retain: true });
    mqttService.publish(`homeassistant/binary_sensor/loxone_bridge/${slug}/config`, '', { retain: true });
  }

  // --- Internal methods ---

  /**
   * Handle a value event from the Loxone WebSocket.
   * @param {string} uuid
   * @param {number} value
   */
  _onValueEvent(uuid, value) {
    this._stateCache.set(uuid, { value });

    if (!this._isControlEnabled(uuid)) return;

    const meta = this._structure.getMeta(uuid);
    if (!meta) return;

    const topic = `${meta.topic}/state`;
    const payload = JSON.stringify({
      value,
      name: meta.name,
      type: meta.type,
      uuid: meta.uuid,
      room: meta.room,
    });

    this._ctx.mqttService.publish(topic, payload);
    this._lastEvent = Date.now();
    this._messageCount++;
  }

  /**
   * Handle a text event from the Loxone WebSocket.
   * @param {string} uuid
   * @param {string} text
   */
  _onTextEvent(uuid, text) {
    this._stateCache.set(uuid, { text });

    if (!this._isControlEnabled(uuid)) return;

    const meta = this._structure.getMeta(uuid);
    if (!meta) return;

    // Detect moodList state events and cache mood name→id mapping
    if (meta.stateKey === 'moodList') {
      this._parseMoodList(uuid, meta, text);
    }

    const topic = `${meta.topic}/state`;
    const payload = JSON.stringify({
      text,
      name: meta.name,
      type: meta.type,
      uuid: meta.uuid,
      room: meta.room,
    });

    this._ctx.mqttService.publish(topic, payload);
    this._lastEvent = Date.now();
    this._messageCount++;
  }

  /**
   * Parse a moodList text event and cache mood name→id mapping.
   * The moodList text is a JSON array like: [{"name":"Nacht","id":1},{"name":"Hell","id":2}]
   * We need to find the parent control UUID for this state UUID.
   * @param {string} stateUuid
   * @param {object} meta
   * @param {string} text
   */
  _parseMoodList(stateUuid, meta, text) {
    try {
      const moods = JSON.parse(text);
      if (!Array.isArray(moods)) return;

      // Find the parent control UUID from the topic (strip /moodList)
      const controlTopic = meta.topic.replace(/\/moodList$/, '');
      const controlUuid = this._structure.topicToUuid(controlTopic);

      if (!controlUuid) return;

      const nameToId = new Map();
      for (const mood of moods) {
        if (mood.name && mood.id != null) {
          // Store both original name and lowercase for case-insensitive lookup
          nameToId.set(mood.name.toLowerCase(), mood.id);
          nameToId.set(mood.name, mood.id);
        }
      }

      this._moodsByControl.set(controlUuid, nameToId);
      this._ctx.logger.info(`Cached ${moods.length} moods for ${meta.name}: ${moods.map(m => `${m.name}(${m.id})`).join(', ')}`);
    } catch (err) {
      this._ctx.logger.debug(`Failed to parse moodList: ${err.message}`);
    }
  }

  /**
   * Handle an incoming MQTT message. If it matches the cmd pattern,
   * forward to the Miniserver via WebSocket.
   * @param {{ topic: string, payload: string, timestamp: number }} msg
   */
  _onMqttMessage({ topic, payload }) {
    // Only process messages matching our prefix and ending with /cmd
    if (!topic.startsWith(this._prefix + '/') || !topic.endsWith('/cmd')) {
      return;
    }

    // Extract the control topic (remove /cmd suffix)
    const controlTopic = topic.slice(0, -4); // remove "/cmd"
    const uuid = this._structure.topicToUuid(controlTopic);

    if (!uuid) {
      this._ctx.logger.warn(`No UUID found for cmd topic: ${topic}`);
      return;
    }

    // Loxone natively supports changeTo/<name> (e.g. changeTo/Nacht) — pass through as-is
    const cmd = `jdev/sps/io/${uuid}/${payload}`;
    this._ctx.logger.info(`MQTT→Loxone: ${topic} → ${cmd}`);

    // Send command to Miniserver
    this._ws.sendCommand(cmd);
  }

  /**
   * Handle text state events (0x00 header + text frame).
   * These carry JSON arrays like moodList, circuitNames, etc.
   * @param {string} text
   */
  _onTextStateEvent(text) {
    try {
      const data = JSON.parse(text);
      // moodList is an array of {id, name, ...} objects
      if (Array.isArray(data) && data.length > 0 && data[0].id != null && data[0].name) {
        // This looks like a moodList - find which LightControllerV2 it belongs to
        const controls = this._structure.getAll();
        for (const ctrl of controls) {
          if (ctrl.type === 'LightControllerV2') {
            const nameToId = new Map();
            for (const mood of data) {
              if (mood.name && mood.id != null) {
                nameToId.set(mood.name, mood.id);
                nameToId.set(mood.name.toLowerCase(), mood.id);
              }
            }
            this._moodsByControl.set(ctrl.uuid, nameToId);
            this._ctx.logger.info(`Cached ${data.length} moods for ${ctrl.name}: ${data.map(m => `${m.name}(${m.id})`).join(', ')}`);
            break; // For now, assign to first LightControllerV2 found
          }
        }
      }
    } catch {
      // Not JSON or not a mood list - ignore
    }
  }

  /**
   * Fetch mood lists for all LightControllerV2 controls via WebSocket.
   * Sends getmoodlist command and collects moods from text events on the
   * moodList state UUID.
   */
  async _requestMoodLists() {
    const tree = this._structure.getControlTree();

    for (const ctrl of tree) {
      if (ctrl.type !== 'LightControllerV2') continue;

      // Find the moodList state UUID from the control tree
      const moodListState = ctrl.states.find(s => s.key === 'moodList');
      if (!moodListState) continue;

      try {
        const moods = await this._fetchMoodList(ctrl.uuid, moodListState.uuid);
        if (moods && moods.length > 0) {
          const nameToId = new Map();
          for (const mood of moods) {
            if (mood.name && mood.id != null) {
              nameToId.set(mood.name, mood.id);
              nameToId.set(mood.name.toLowerCase(), mood.id);
            }
          }
          this._moodsByControl.set(ctrl.uuid, nameToId);
          this._ctx.logger.info(`Cached ${moods.length} moods for ${ctrl.name}: ${moods.map(m => `${m.name}(${m.id})`).join(', ')}`);
        } else {
          this._ctx.logger.info(`No moods found for ${ctrl.name}`);
        }
      } catch (err) {
        this._ctx.logger.warn(`Failed to fetch moods for ${ctrl.name}: ${err.message}`);
      }
    }
  }

  /**
   * Fetch mood list by sending getmoodlist command and listening for the
   * moodList state text event (identified by UUID).
   */
  async _fetchMoodList(controlUuid, moodListStateUuid) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        // Check if moodList arrived via state cache
        const cached = this._stateCache.get(moodListStateUuid);
        if (cached && cached.text) {
          try {
            resolve(JSON.parse(cached.text));
            return;
          } catch { /* not JSON */ }
        }
        resolve([]);
      }, 5000);

      // Listen for text events on any UUID — the mood data often arrives
      // as a separate text frame not tied to the moodList state UUID
      const textHandler = (text) => {
        try {
          if (text.includes('"LL"')) return;
          const data = JSON.parse(text.trim());
          if (Array.isArray(data) && data.length > 0 && data[0].id != null && data[0].name) {
            cleanup();
            resolve(data);
          }
        } catch { /* not JSON */ }
      };

      const stateHandler = (text) => {
        textHandler(text);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this._ws.removeListener('textMessage', textHandler);
        this._ws.removeListener('textStateEvent', stateHandler);
      };

      this._ws.on('textMessage', textHandler);
      this._ws.on('textStateEvent', stateHandler);

      this._ws.sendCommand(`jdev/sps/io/${controlUuid}/getmoodlist`);
    });
  }

  /**
   * Resolve a mood name to its ID for a given control UUID.
   * Checks the control itself and walks up to parent controls.
   * @param {string} uuid
   * @param {string} moodName
   * @returns {number|null}
   */
  _resolveMoodName(uuid, moodName) {
    // Check direct control
    const moods = this._moodsByControl.get(uuid);
    if (moods) {
      // Try exact match first, then case-insensitive
      const exact = moods.get(moodName);
      if (exact != null) return exact;
      const lower = moods.get(moodName.toLowerCase());
      if (lower != null) return lower;
    }

    // Check parent control (sub-control UUID might be like "parentUuid/AI1")
    if (uuid.includes('/')) {
      const parentUuid = uuid.split('/')[0];
      const parentMoods = this._moodsByControl.get(parentUuid);
      if (parentMoods) {
        const exact = parentMoods.get(moodName);
        if (exact != null) return exact;
        const lower = parentMoods.get(moodName.toLowerCase());
        if (lower != null) return lower;
      }
    }

    // Check all controls (fallback — useful when the topic maps to a different UUID)
    for (const [, controlMoods] of this._moodsByControl) {
      const exact = controlMoods.get(moodName);
      if (exact != null) return exact;
      const lower = controlMoods.get(moodName.toLowerCase());
      if (lower != null) return lower;
    }

    return null;
  }

  /**
   * Publish Home Assistant MQTT Discovery config for all controls.
   */
  _publishHaDiscovery() {
    const controls = this._structure.getAll();
    const nodeId = 'loxone_bridge';
    const { mqttService } = this._ctx;

    for (const ctrl of controls) {
      if (!this._isControlEnabled(ctrl.uuid)) continue;

      const component = this._loxoneTypeToHaComponent(ctrl.type);
      const objectId = this._structure.slugify(ctrl.name);
      const discoveryTopic = `homeassistant/${component}/${nodeId}/${objectId}/config`;

      const config = {
        name: ctrl.name,
        unique_id: `loxone_${ctrl.uuid.replace(/-/g, '')}`,
        state_topic: `${ctrl.topic}/state`,
        value_template: '{{ value_json.value }}',
        availability_topic: `${this._prefix}/bridge/status`,
        device: {
          identifiers: [nodeId],
          name: 'Loxone Miniserver',
          manufacturer: 'Loxone',
          model: 'Miniserver',
          via_device: 'mqtt-master',
        },
      };

      // Add command_topic for actuator types
      if (['switch', 'light', 'cover'].includes(component)) {
        config.command_topic = `${ctrl.topic}/cmd`;
      }

      mqttService.publish(discoveryTopic, JSON.stringify(config), { retain: true });
    }
  }

  /**
   * Check if a control is enabled (not in the disabledControls list).
   * @param {string} uuid
   * @returns {boolean}
   */
  _isControlEnabled(uuid) {
    const disabled = this._config.disabledControls || [];
    return !disabled.includes(uuid);
  }

  /**
   * Map a Loxone control type to a Home Assistant component type.
   * @param {string} type
   * @returns {string}
   */
  _loxoneTypeToHaComponent(type) {
    return HA_TYPE_MAP[type] || 'sensor';
  }

  /**
   * Apply topic routes: subscribe to source topics and set up forwarding.
   * Cleans up previous route handlers first.
   */
  _applyTopicRoutes() {
    if (!this._ctx) return;
    const { mqttService, logger } = this._ctx;

    // Clean up existing route handlers
    this._cleanupRouteHandlers();

    for (const route of this._topicRoutes) {
      if (!route.enabled) continue;

      if (route.direction === 'inbound') {
        // External -> Loxone: subscribe to sourceTopic, forward to targetTopic
        mqttService.subscribe(route.sourceTopic);

        const handler = (msg) => {
          if (msg.topic === route.sourceTopic) {
            mqttService.publish(route.targetTopic, msg.payload);
          }
        };
        mqttService.on('message', handler);
        this._routeHandlers.set(`inbound:${route.id}`, { handler, topic: route.sourceTopic });

        logger.info(`Topic route: ${route.sourceTopic} -> ${route.targetTopic} (inbound)`);
      } else if (route.direction === 'outbound') {
        // Loxone -> External: subscribe to sourceTopic, forward to targetTopic
        mqttService.subscribe(route.sourceTopic);

        const handler = (msg) => {
          if (msg.topic === route.sourceTopic) {
            mqttService.publish(route.targetTopic, msg.payload);
          }
        };
        mqttService.on('message', handler);
        this._routeHandlers.set(`outbound:${route.id}`, { handler, topic: route.sourceTopic });

        logger.info(`Topic route: ${route.sourceTopic} -> ${route.targetTopic} (outbound)`);
      }
    }
  }

  /**
   * Clean up all route subscription handlers.
   */
  _cleanupRouteHandlers() {
    if (!this._ctx) return;
    const { mqttService } = this._ctx;

    for (const [, entry] of this._routeHandlers) {
      mqttService.removeListener('message', entry.handler);
      mqttService.unsubscribe(entry.topic);
    }
    this._routeHandlers.clear();
  }
}
