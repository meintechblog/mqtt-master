/**
 * MQTT Bridge plugin -- connects to an external MQTT broker and republishes
 * selected topics on the local broker with a configurable prefix.
 *
 * Designed for Venus OS (Victron Energy) but works with any external broker.
 * Handles Venus OS keepalive requirement automatically.
 */
import mqtt from 'mqtt';

const RECONNECT_MS = 5000;

export default class MqttBridgePlugin {
  constructor() {
    this._client = null;
    this._running = false;
    this._connected = false;
    this._config = {};
    this._ctx = null;
    this._keepaliveInterval = null;
    this._topicCount = 0;
    this._messageCount = 0;
    this._lastMessage = null;
    /** @type {string|null} detected portal ID for Venus OS */
    this._portalId = null;
    /** @type {Map<string, { localTopic: string, value: any, ts: number }>} remote topic -> state */
    this._topicCache = new Map();
  }

  async start(context) {
    this._ctx = context;
    const { configService, logger } = context;

    this._config = configService.get('plugins.mqtt-bridge', {});
    const {
      brokerUrl = '',
      subscribeTopic = '#',
      localPrefix = 'venus',
      keepaliveEnabled = true,
      keepaliveIntervalMs = 30000,
    } = this._config;

    if (!brokerUrl) {
      throw new Error('brokerUrl is required (e.g. mqtt://192.168.3.146:1883)');
    }

    logger.info(`MQTT Bridge connecting to ${brokerUrl}...`);

    this._client = mqtt.connect(brokerUrl, {
      reconnectPeriod: RECONNECT_MS,
      connectTimeout: 10000,
      clientId: 'mqtt-master-bridge-' + Date.now(),
    });

    this._client.on('connect', () => {
      this._connected = true;
      logger.info(`MQTT Bridge connected to ${brokerUrl}`);

      // Subscribe to external broker topics
      this._client.subscribe(subscribeTopic, (err) => {
        if (err) {
          logger.error(`MQTT Bridge subscribe failed: ${err.message}`);
        } else {
          logger.info(`MQTT Bridge subscribed to: ${subscribeTopic}`);
        }
      });

      // Start keepalive for Venus OS
      if (keepaliveEnabled) {
        this._startKeepalive(keepaliveIntervalMs);
      }
    });

    this._client.on('close', () => {
      this._connected = false;
      this._stopKeepalive();
    });

    this._client.on('error', (err) => {
      logger.warn(`MQTT Bridge error: ${err.message}`);
    });

    // Republish received messages on local broker
    const seenTopics = new Set();
    this._client.on('message', (topic, payload) => {
      const msg = payload.toString();

      // Track unique topics
      if (!seenTopics.has(topic)) {
        seenTopics.add(topic);
        this._topicCount = seenTopics.size;
      }
      this._messageCount++;
      this._lastMessage = Date.now();

      // Auto-detect Venus OS portal ID from topic pattern N/{portalId}/...
      if (!this._portalId && topic.startsWith('N/')) {
        const parts = topic.split('/');
        if (parts.length >= 3) {
          this._portalId = parts[1];
          logger.info(`Venus OS portal detected: ${this._portalId}`);
        }
      }

      // Build local topic: strip N/{portalId}/ prefix if present, add localPrefix
      let localTopic;
      if (this._portalId && topic.startsWith(`N/${this._portalId}/`)) {
        const stripped = topic.slice(`N/${this._portalId}/`.length);
        localTopic = `${localPrefix}/${stripped}`;
      } else {
        localTopic = `${localPrefix}/${topic}`;
      }

      // Cache value
      let parsedValue = msg;
      try {
        const json = JSON.parse(msg);
        if (json && json.value !== undefined) parsedValue = json.value;
      } catch { /* not JSON */ }
      this._topicCache.set(topic, { localTopic, value: parsedValue, ts: Date.now() });

      // Republish on local broker
      context.mqttService.publish(localTopic, msg);
    });

    this._running = true;
    logger.info('MQTT Bridge plugin started');
  }

  async stop() {
    if (!this._ctx) return;
    const { logger } = this._ctx;

    this._stopKeepalive();

    if (this._client) {
      this._client.end(true);
      this._client = null;
    }

    this._running = false;
    this._connected = false;
    this._topicCount = 0;
    this._messageCount = 0;
    this._portalId = null;
    this._topicCache.clear();

    if (logger) logger.info('MQTT Bridge plugin stopped');
  }

  getStatus() {
    return {
      running: this._running,
      connected: this._connected,
      topicCount: this._topicCount,
      messageCount: this._messageCount,
      lastMessage: this._lastMessage,
      portalId: this._portalId,
    };
  }

  /**
   * Get all bridged topics with live values for the Elements view.
   * @returns {Array<{ remoteTopic: string, localTopic: string, value: any, ts: number }>}
   */
  getElements() {
    const elements = [];
    for (const [remoteTopic, state] of this._topicCache) {
      elements.push({
        remoteTopic,
        localTopic: state.localTopic,
        value: state.value,
        ts: state.ts,
      });
    }
    // Sort by local topic
    elements.sort((a, b) => a.localTopic.localeCompare(b.localTopic));
    return elements;
  }

  getConfigSchema() {
    return {
      type: 'object',
      properties: {
        brokerUrl: {
          type: 'string',
          title: 'External Broker URL',
          description: 'MQTT broker to bridge from (e.g. mqtt://192.168.3.146:1883)',
        },
        subscribeTopic: {
          type: 'string',
          title: 'Subscribe Topic',
          default: '#',
          description: 'Topic pattern to subscribe on the external broker',
        },
        localPrefix: {
          type: 'string',
          title: 'Local Prefix',
          default: 'venus',
          description: 'Prefix for republished topics on local broker',
        },
        keepaliveEnabled: {
          type: 'boolean',
          title: 'Send Keepalive',
          default: true,
          description: 'Send periodic keepalive (required for Venus OS)',
        },
        keepaliveIntervalMs: {
          type: 'integer',
          title: 'Keepalive Interval (ms)',
          default: 30000,
          description: 'How often to send keepalive to external broker',
        },
        autoStart: {
          type: 'boolean',
          title: 'Auto-start',
          default: false,
          description: 'Start the plugin automatically when the server starts',
        },
      },
    };
  }

  /**
   * Start periodic keepalive for Venus OS.
   * Venus OS requires R/{portalId}/keepalive to keep sending data.
   */
  _startKeepalive(intervalMs) {
    this._stopKeepalive();

    // Send initial keepalive once portal ID is known
    const sendKeepalive = () => {
      if (this._portalId && this._client && this._connected) {
        this._client.publish(`R/${this._portalId}/keepalive`, '');
      }
    };

    // Also send a broad keepalive to trigger portal ID detection
    if (this._client && this._connected) {
      // Subscribe to all N/ topics to detect portal ID
      this._client.subscribe('N/+/system/0/Serial');
    }

    this._keepaliveInterval = setInterval(sendKeepalive, intervalMs);
    // Send first keepalive after a short delay (wait for portal ID detection)
    setTimeout(sendKeepalive, 2000);
  }

  _stopKeepalive() {
    if (this._keepaliveInterval) {
      clearInterval(this._keepaliveInterval);
      this._keepaliveInterval = null;
    }
  }
}
