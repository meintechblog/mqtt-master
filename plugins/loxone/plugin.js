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
    this._prefix = 'loxone';
    this._config = {};
    this._ctx = null;

    /** @type {Function|null} bound MQTT message handler for cleanup */
    this._mqttHandler = null;
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
    logger.info(`Loxone structure loaded: ${this._controlCount} controls`);

    // 3. Create WebSocket client
    this._ws = new LoxoneWs({ host: ip, port, user: username, pass: password });

    // 4. Wire value events -> MQTT publish
    this._ws.on('valueEvent', ({ uuid, value }) => {
      this._onValueEvent(uuid, value);
    });

    // 5. Wire text events -> MQTT publish
    this._ws.on('textEvent', ({ uuid, text }) => {
      this._onTextEvent(uuid, text);
    });

    // 6. Wire reconnected -> re-fetch structure
    this._ws.on('reconnected', async () => {
      logger.info('Loxone WebSocket reconnected, re-fetching structure');
      try {
        const loxApp3 = await this._structure.fetchStructure(ip, port, username, password);
        this._structure.buildMap(loxApp3);
        this._controlCount = this._structure.getAll().length;
        if (enableHaDiscovery) {
          this._publishHaDiscovery();
        }
      } catch (err) {
        logger.warn(`Failed to re-fetch structure on reconnect: ${err.message}`);
      }
    });

    // 7. Subscribe to MQTT cmd topics
    mqttService.subscribe(`${prefix}/+/+/cmd`);

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
    }

    // 4. Remove MQTT message listener
    if (mqttService && this._mqttHandler) {
      mqttService.removeListener('message', this._mqttHandler);
      this._mqttHandler = null;
    }

    // 5. Clear state
    this._running = false;
    this._connected = false;
    this._controlCount = 0;
    this._lastEvent = null;
    this._structure = null;

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

  // --- Internal methods ---

  /**
   * Handle a value event from the Loxone WebSocket.
   * @param {string} uuid
   * @param {number} value
   */
  _onValueEvent(uuid, value) {
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
  }

  /**
   * Handle a text event from the Loxone WebSocket.
   * @param {string} uuid
   * @param {string} text
   */
  _onTextEvent(uuid, text) {
    if (!this._isControlEnabled(uuid)) return;

    const meta = this._structure.getMeta(uuid);
    if (!meta) return;

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
      this._ctx.logger.debug(`No UUID found for cmd topic: ${topic}`);
      return;
    }

    // Send command to Miniserver
    this._ws.sendCommand(`jdev/sps/io/${uuid}/${payload}`);
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
}
