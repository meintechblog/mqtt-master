/**
 * Loxone bridge plugin -- bidirectional MQTT bridge with HA Discovery.
 *
 * Orchestrates sub-modules:
 *  - LoxoneWs: WebSocket client to Miniserver
 *  - LoxoneStructure: UUID mapper / structure parser
 *  - MoodManager: mood caching, fetching, resolution
 *  - StructureMonitor: change detection, stale topic cleanup
 *  - BindingsManager: MQTT input binding lifecycle
 *  - ha-discovery: Home Assistant MQTT Discovery publishing
 */
import { LoxoneWs } from './loxone-ws.js';
import { LoxoneStructure } from './loxone-structure.js';
import { MoodManager } from './mood-manager.js';
import { StructureMonitor } from './structure-monitor.js';
import { BindingsManager } from '../lib/bindings-manager.js';
import { publishHaDiscovery } from './ha-discovery.js';

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
    /** @type {object|null} stored WS event handler refs for cleanup */
    this._wsHandlers = null;

    /** @type {string[]} UUIDs of disabled controls */
    this._disabledControls = [];

    /** @type {Array<object>} active topic route definitions */
    this._topicRoutes = [];
    /** @type {Map<string, Function>} active topic route subscription handlers */
    this._routeHandlers = new Map();

    /** @type {Map<string, { value?: number, text?: string }>} stateUuid -> last known value */
    this._stateCache = new Map();

    this._moodManager = new MoodManager();
    this._structureMonitor = new StructureMonitor();
    this._bindingsManager = null;
  }

  /**
   * Start the plugin: fetch structure, connect WebSocket, wire events.
   * @param {{ mqttService: object, configService: object, logger: object, pluginId: string }} context
   */
  async start(context) {
    this._ctx = context;
    const { mqttService, configService, logger, pluginId } = context;
    this._pluginId = pluginId || 'loxone';

    // 1. Read config
    this._config = configService.get(`plugins.${this._pluginId}`, {});
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
    this._moodMappings = this._config.moodMappings || {};

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
    this._structureMonitor.snapshot(this._structure);
    logger.info(`Loxone structure loaded: ${this._controlCount} controls`);

    // 3. Create WebSocket client
    this._ws = new LoxoneWs({ host: ip, port, user: username, pass: password });

    // 4. Wire events (store refs for cleanup)
    this._wsHandlers = {
      valueEvent: ({ uuid, value }) => this._onValueEvent(uuid, value),
      textEvent: ({ uuid, text }) => {
        logger.debug(`textEvent uuid=${uuid} text=${text.substring(0, 120)}`);
        this._onTextEvent(uuid, text);
      },
      textMessage: (text) => logger.debug(`textMessage: ${text.substring(0, 200)}`),
      debugPayload: ({ identifier, length }) => {
        logger.debug(`Unknown binary payload: identifier=0x${identifier.toString(16)}, length=${length}`);
      },
      textStateEvent: (text) => {
        logger.debug(`textStateEvent: ${text.substring(0, 200)}`);
        this._moodManager.handleTextStateEvent(text, this._structure, logger);
      },
      reconnected: async () => {
        logger.info('Loxone WebSocket reconnected, re-fetching structure');
        await this._refreshStructure();
      },
    };
    for (const [event, handler] of Object.entries(this._wsHandlers)) {
      this._ws.on(event, handler);
    }

    // 5. Subscribe to MQTT cmd topics (name-based and UUID-based)
    mqttService.subscribe(`${prefix}/+/+/cmd`);
    mqttService.subscribe(`${prefix}/+/+/+/cmd`);
    mqttService.subscribe(`${prefix}/by-uuid/+/cmd`);

    // 6. Wire MQTT messages -> WebSocket commands
    this._mqttHandler = (msg) => this._onMqttMessage(msg);
    mqttService.on('message', this._mqttHandler);

    // 7. Connect WebSocket
    await this._ws.connect();
    this._connected = true;

    // 8. Publish HA Discovery if enabled
    if (enableHaDiscovery) {
      publishHaDiscovery({
        structure: this._structure,
        mqttService,
        prefix: this._prefix,
        isEnabled: (uuid) => this._isControlEnabled(uuid),
      });
    }

    // 9. Publish bridge status online
    mqttService.publish(`${prefix}/bridge/status`, 'online', { retain: true });

    // 10. Request mood lists
    this._moodManager.requestMoodLists({
      structure: this._structure,
      ws: this._ws,
      stateCache: this._stateCache,
      logger,
    });

    // 11. Set up topic routes
    this._topicRoutes = this._config.topicRoutes || [];
    this._applyTopicRoutes();

    // 12. Set up MQTT input bindings
    this._bindingsManager = new BindingsManager({
      configKey: `plugins.${this._pluginId}`,
      sendToTarget: (uuid, value) => {
        if (this._ws) this._ws.sendCommand(`jdev/sps/io/${uuid}/${value}`);
      },
    });
    this._bindingsManager.init(context, this._config);

    // 13. Periodic structure check
    this._structureMonitor.startPolling(() => this._refreshStructure());

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

    // 2. Remove WebSocket event handlers and disconnect
    if (this._ws) {
      if (this._wsHandlers) {
        for (const [event, handler] of Object.entries(this._wsHandlers)) {
          this._ws.removeListener(event, handler);
        }
        this._wsHandlers = null;
      }
      await this._ws.disconnect();
      this._ws = null;
    }

    // 3. Unsubscribe from MQTT cmd topics
    if (mqttService) {
      mqttService.unsubscribe(`${this._prefix}/+/+/cmd`);
      mqttService.unsubscribe(`${this._prefix}/+/+/+/cmd`);
      mqttService.unsubscribe(`${this._prefix}/by-uuid/+/cmd`);
    }

    // 4. Remove MQTT message listener
    if (mqttService && this._mqttHandler) {
      mqttService.removeListener('message', this._mqttHandler);
      this._mqttHandler = null;
    }

    // 5. Clean up sub-modules
    this._cleanupRouteHandlers();
    if (this._bindingsManager) this._bindingsManager.cleanup();
    this._structureMonitor.stopPolling();

    // 6. Clear state
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
        username: { type: 'string', title: 'Username' },
        password: { type: 'string', title: 'Password', format: 'password' },
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

  getDetailedControls() {
    if (!this._structure) return [];
    const tree = this._structure.getControlTree();

    return tree.map(ctrl => {
      const states = {};
      for (const s of ctrl.states) {
        states[s.key] = this._stateCache.get(s.uuid) || null;
      }

      const subControls = ctrl.subControls.map(sub => {
        const subStates = {};
        for (const s of sub.states) {
          subStates[s.key] = this._stateCache.get(s.uuid) || null;
        }
        return { uuid: sub.uuid, name: sub.name, type: sub.type, topic: sub.topic, states: subStates };
      });

      let moods = this._moodManager.getMoods(ctrl.uuid);

      // Determine active mood IDs
      let activeMoodIds = [];
      if (states.activeMoods && states.activeMoods.text) {
        try { activeMoodIds = JSON.parse(states.activeMoods.text); } catch { /* ignore */ }
      } else if (states.activeMoodsNum && states.activeMoodsNum.value != null) {
        activeMoodIds = [states.activeMoodsNum.value];
      }

      // Resolve mood names from config mapping (per-control override → defaults)
      if (ctrl.type === 'LightControllerV2') {
        const resolved = this._resolveMoodMapping(ctrl.uuid, activeMoodIds);
        moods = resolved.moods;
        if (resolved.activeMoodName) {
          // Attach for display
        }
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
        activeMoodName: ctrl.type === 'LightControllerV2'
          ? this._getMoodName(ctrl.uuid, activeMoodIds[0]) : null,
      };
    });
  }

  async setControlEnabled(uuid, enabled) {
    if (enabled) {
      this._disabledControls = this._disabledControls.filter(id => id !== uuid);
    } else {
      if (!this._disabledControls.includes(uuid)) {
        this._disabledControls.push(uuid);
      }
    }
    this._config.disabledControls = this._disabledControls;
    if (this._ctx) {
      this._ctx.configService.set(`plugins.${this._pluginId}`, this._config);
      await this._ctx.configService.save();
    }
  }

  sendControlCommand(uuid, command) {
    if (!this._ws) throw new Error('WebSocket not connected');
    const cmd = `jdev/sps/io/${uuid}/${command}`;
    this._ctx.logger.info(`API→Loxone: ${uuid} → ${cmd}`);
    this._ws.sendCommand(cmd);
  }

  // --- Mood mapping ---

  /** Default mood names (apply to all LightControllerV2 unless overridden) */
  static DEFAULT_MOODS = {
    '-1': 'Manuell',
    0: 'Aus',
    1: 'Nacht',
    2: 'Abend',
    3: 'Tag',
    777: 'Viel Licht',
    778: 'Aus',
  };

  /**
   * Get mood name for a given activeMoodsNum value.
   * Checks per-control override first, then defaults.
   */
  _getMoodName(controlUuid, moodNum) {
    if (moodNum == null) return null;
    const perControl = this._moodMappings[controlUuid];
    if (perControl && perControl[String(moodNum)] != null) return perControl[String(moodNum)];
    const defaults = this._moodMappings._defaults || LoxonePlugin.DEFAULT_MOODS;
    if (defaults[String(moodNum)] != null) return defaults[String(moodNum)];
    return `Mood #${moodNum}`;
  }

  /**
   * Build moods array from config mapping for a control.
   * Merges defaults + per-control overrides.
   */
  _resolveMoodMapping(controlUuid, activeMoodIds) {
    const defaults = this._moodMappings._defaults || LoxonePlugin.DEFAULT_MOODS;
    const perControl = this._moodMappings[controlUuid] || {};
    const merged = { ...defaults, ...perControl };

    const moods = Object.entries(merged).map(([id, name]) => ({
      id: Number(id),
      name,
    })).sort((a, b) => a.id - b.id);

    const activeMoodName = activeMoodIds.length > 0
      ? this._getMoodName(controlUuid, activeMoodIds[0])
      : null;

    return { moods, activeMoodName };
  }

  /** Get mood mappings (defaults + per-control). */
  getMoodMappings() {
    return {
      _defaults: this._moodMappings._defaults || LoxonePlugin.DEFAULT_MOODS,
      ...Object.fromEntries(
        Object.entries(this._moodMappings).filter(([k]) => k !== '_defaults')
      ),
    };
  }

  /** Set mood mappings and persist. */
  async setMoodMappings(mappings) {
    this._moodMappings = mappings;
    this._config.moodMappings = mappings;
    if (this._ctx) {
      this._ctx.configService.set(`plugins.${this._pluginId}`, this._config);
      await this._ctx.configService.save();
    }
  }

  // --- Topic routes management ---

  getTopicRoutes() {
    return [...this._topicRoutes];
  }

  async setTopicRoutes(routes) {
    this._topicRoutes = routes;
    this._config.topicRoutes = routes;
    if (this._ctx) {
      this._ctx.configService.set(`plugins.${this._pluginId}`, this._config);
      await this._ctx.configService.save();
    }
    this._applyTopicRoutes();
  }

  // --- Input bindings management ---

  getInputBindings() {
    return this._bindingsManager.getBindings();
  }

  async setInputBindings(bindings) {
    await this._bindingsManager.setBindings(bindings);
  }

  // --- Internal methods ---

  _onValueEvent(uuid, value) {
    this._stateCache.set(uuid, { value });
    if (!this._isControlEnabled(uuid)) return;

    const meta = this._structure.getMeta(uuid);
    if (!meta) return;

    const payload = JSON.stringify({
      value, name: meta.name, type: meta.type, uuid: meta.uuid, room: meta.room,
    });
    this._ctx.mqttService.publish(`${meta.topic}/state`, payload);
    this._ctx.mqttService.publish(`${this._prefix}/by-uuid/${meta.uuid}/state`, payload);

    // Publish resolved mood name when activeMoodsNum changes
    if (meta.stateKey === 'activeMoodsNum') {
      const controlTopic = meta.topic.replace(/\/activeMoodsNum$/, '');
      const controlUuid = this._structure.topicToUuid(controlTopic);
      if (controlUuid) {
        const moodName = this._getMoodName(controlUuid, value);
        const moodPayload = JSON.stringify({
          id: value, name: moodName, uuid: controlUuid,
        });
        this._ctx.mqttService.publish(`${controlTopic}/mood/state`, moodPayload);
        this._ctx.mqttService.publish(`${this._prefix}/by-uuid/${controlUuid}/mood/state`, moodPayload);
      }
    }

    this._lastEvent = Date.now();
    this._messageCount++;
  }

  _onTextEvent(uuid, text) {
    this._stateCache.set(uuid, { text });
    if (!this._isControlEnabled(uuid)) return;

    const meta = this._structure.getMeta(uuid);
    if (!meta) return;

    // Detect moodList state events and cache mood name→id mapping
    if (meta.stateKey === 'moodList') {
      const controlTopic = meta.topic.replace(/\/moodList$/, '');
      const controlUuid = this._structure.topicToUuid(controlTopic);
      if (controlUuid) {
        if (this._moodManager.parseMoodListText(controlUuid, text)) {
          this._ctx.logger.info(`Cached moods for ${meta.name}`);
        }
      }
    }

    const payload = JSON.stringify({
      text, name: meta.name, type: meta.type, uuid: meta.uuid, room: meta.room,
    });
    this._ctx.mqttService.publish(`${meta.topic}/state`, payload);
    this._ctx.mqttService.publish(`${this._prefix}/by-uuid/${meta.uuid}/state`, payload);
    this._lastEvent = Date.now();
    this._messageCount++;
  }

  _onMqttMessage({ topic, payload }) {
    if (!topic.startsWith(this._prefix + '/') || !topic.endsWith('/cmd')) return;

    let uuid;
    const uuidPrefix = `${this._prefix}/by-uuid/`;

    if (topic.startsWith(uuidPrefix)) {
      // UUID-based: loxone/by-uuid/{uuid}/cmd
      uuid = topic.slice(uuidPrefix.length, -4); // strip prefix and /cmd
    } else {
      // Name-based: loxone/{room}/{control}/cmd
      const controlTopic = topic.slice(0, -4);
      uuid = this._structure.topicToUuid(controlTopic);
    }

    if (!uuid) {
      this._ctx.logger.warn(`No UUID found for cmd topic: ${topic}`);
      return;
    }

    // Translate changeTo/{moodName} → changeTo/{moodId} using mood mapping
    let resolvedPayload = payload;
    const changeToMatch = payload.match(/^changeTo\/(.+)$/);
    if (changeToMatch) {
      const moodRef = changeToMatch[1];
      // If it's not already a number, look up the name in mappings
      if (isNaN(Number(moodRef))) {
        const defaults = this._moodMappings._defaults || LoxonePlugin.DEFAULT_MOODS;
        const perControl = this._moodMappings[uuid] || {};
        const merged = { ...defaults, ...perControl };
        // Find ID by name (case-insensitive)
        const entry = Object.entries(merged).find(
          ([, name]) => name.toLowerCase() === moodRef.toLowerCase()
        );
        if (entry) {
          resolvedPayload = `changeTo/${entry[0]}`;
          this._ctx.logger.info(`Mood resolved: ${moodRef} → ID ${entry[0]}`);
        }
      }
    }

    const cmd = `jdev/sps/io/${uuid}/${resolvedPayload}`;
    this._ctx.logger.info(`MQTT→Loxone: ${topic} → ${cmd}`);
    this._ws.sendCommand(cmd);
  }

  async _refreshStructure() {
    if (!this._ctx || !this._structure) return;
    const { mqttService, logger } = this._ctx;
    const { ip, port = 80, username, password, enableHaDiscovery } = this._config;

    try {
      const loxApp3 = await this._structure.fetchStructure(ip, port, username, password);
      this._structure.buildMap(loxApp3);
    } catch (err) {
      logger.warn(`Structure refresh failed: ${err.message}`);
      return;
    }

    this._controlCount = this._structure.getAll().length;

    const changes = this._structureMonitor.detectChanges({
      structure: this._structure,
      mqttService,
      logger,
    });

    if (changes > 0) {
      logger.info(`Structure updated: ${changes} change(s), ${this._controlCount} controls total`);
      if (enableHaDiscovery) {
        publishHaDiscovery({
          structure: this._structure,
          mqttService,
          prefix: this._prefix,
          isEnabled: (uuid) => this._isControlEnabled(uuid),
        });
      }
    }

    this._structureMonitor.snapshot(this._structure);
  }

  _isControlEnabled(uuid) {
    const disabled = this._config.disabledControls || [];
    return !disabled.includes(uuid);
  }

  _applyTopicRoutes() {
    if (!this._ctx) return;
    const { mqttService, logger } = this._ctx;

    this._cleanupRouteHandlers();

    for (const route of this._topicRoutes) {
      if (!route.enabled) continue;
      if (route.direction !== 'inbound' && route.direction !== 'outbound') continue;

      mqttService.subscribe(route.sourceTopic);

      const handler = (msg) => {
        if (msg.topic === route.sourceTopic) {
          mqttService.publish(route.targetTopic, msg.payload);
        }
      };
      mqttService.on('message', handler);
      this._routeHandlers.set(`${route.direction}:${route.id}`, { handler, topic: route.sourceTopic });

      logger.info(`Topic route: ${route.sourceTopic} -> ${route.targetTopic} (${route.direction})`);
    }
  }

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
