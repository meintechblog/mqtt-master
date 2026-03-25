import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock loxone-ws and loxone-structure so the plugin can be tested in isolation
vi.mock('../plugins/loxone/loxone-ws.js', () => {
  const { EventEmitter } = require('node:events');

  class MockLoxoneWs extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this._connected = false;
    }
    async connect() {
      this._connected = true;
    }
    async disconnect() {
      this._connected = false;
    }
    sendCommand(cmd) {
      this._lastCommand = cmd;
    }
  }

  return { LoxoneWs: MockLoxoneWs };
});

vi.mock('../plugins/loxone/loxone-structure.js', () => {
  class MockLoxoneStructure {
    constructor(prefix) {
      this.prefix = prefix || 'loxone';
      this._controls = [];
      this._uuidToTopicMap = new Map();
      this._topicToUuidMap = new Map();
      this._metaMap = new Map();
    }

    async fetchStructure() {
      return { controls: {}, rooms: {}, cats: {} };
    }

    buildMap() {
      // Pre-populate with test data
      this._controls = [
        {
          uuid: 'aabb-1111',
          name: 'Helligkeit',
          type: 'InfoOnlyAnalog',
          room: 'Wohnzimmer',
          topic: `${this.prefix}/wohnzimmer/helligkeit`,
          category: 'Beleuchtung',
        },
        {
          uuid: 'aabb-2222',
          name: 'Lichtsteuerung',
          type: 'Switch',
          room: 'Wohnzimmer',
          topic: `${this.prefix}/wohnzimmer/lichtsteuerung`,
          category: 'Beleuchtung',
        },
        {
          uuid: 'aabb-3333',
          name: 'Dimmer',
          type: 'Dimmer',
          room: 'Schlafzimmer',
          topic: `${this.prefix}/schlafzimmer/dimmer`,
          category: 'Beleuchtung',
        },
        {
          uuid: 'aabb-4444',
          name: 'Rolladen',
          type: 'Jalousie',
          room: 'Schlafzimmer',
          topic: `${this.prefix}/schlafzimmer/rolladen`,
          category: '',
        },
        {
          uuid: 'aabb-5555',
          name: 'Bewegung',
          type: 'InfoOnlyDigital',
          room: 'Flur',
          topic: `${this.prefix}/flur/bewegung`,
          category: '',
        },
        {
          uuid: 'aabb-6666',
          name: 'Temperatur',
          type: 'SomeUnknownType',
          room: 'Flur',
          topic: `${this.prefix}/flur/temperatur`,
          category: '',
        },
      ];

      for (const ctrl of this._controls) {
        this._uuidToTopicMap.set(ctrl.uuid, ctrl.topic);
        this._topicToUuidMap.set(ctrl.topic, ctrl.uuid);
        this._metaMap.set(ctrl.uuid, ctrl);
      }
    }

    uuidToTopic(uuid) {
      return this._uuidToTopicMap.get(uuid);
    }

    topicToUuid(topic) {
      return this._topicToUuidMap.get(topic);
    }

    getMeta(uuid) {
      return this._metaMap.get(uuid);
    }

    getAll() {
      return [...this._controls];
    }

    getControlTree() {
      return this._controls.map(ctrl => ({
        ...ctrl,
        states: [],
        subControls: [],
      }));
    }

    slugify(str) {
      if (!str) return 'unknown';
      return str.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
  }

  return { LoxoneStructure: MockLoxoneStructure };
});

// Import after mocks are set up
const { default: LoxonePlugin } = await import('../plugins/loxone/plugin.js');
const { LoxoneWs } = await import('../plugins/loxone/loxone-ws.js');

function createMockContext(configOverrides = {}) {
  const defaultConfig = {
    ip: '192.168.1.100',
    port: 80,
    username: 'admin',
    password: 'secret',
    prefix: 'loxone',
    autoStart: false,
    enableHaDiscovery: true,
  };

  const config = { ...defaultConfig, ...configOverrides };
  const published = [];
  const subscribed = [];
  const unsubscribed = [];
  const messageListeners = [];

  return {
    mqttService: {
      publish: vi.fn((topic, payload, opts) => {
        published.push({ topic, payload, opts });
      }),
      subscribe: vi.fn((topic) => {
        subscribed.push(topic);
      }),
      unsubscribe: vi.fn((topic) => {
        unsubscribed.push(topic);
      }),
      on: vi.fn((event, handler) => {
        if (event === 'message') messageListeners.push(handler);
      }),
      removeListener: vi.fn(),
    },
    configService: {
      get: vi.fn((key, def) => {
        if (key === 'plugins.loxone') return config;
        return def;
      }),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    pluginId: 'loxone',
    // Test helpers
    _published: published,
    _subscribed: subscribed,
    _unsubscribed: unsubscribed,
    _messageListeners: messageListeners,
    _config: config,
  };
}

describe('LoxonePlugin', () => {
  let plugin;
  let ctx;

  beforeEach(() => {
    plugin = new LoxonePlugin();
    ctx = createMockContext();
  });

  afterEach(async () => {
    try {
      await plugin.stop();
    } catch {
      // ignore if already stopped
    }
  });

  describe('start()', () => {
    it('creates WebSocket and structure, connects, and subscribes to cmd topics', async () => {
      await plugin.start(ctx);

      // Should be running
      const status = plugin.getStatus();
      expect(status.running).toBe(true);

      // Should have subscribed to cmd topic pattern
      expect(ctx.mqttService.subscribe).toHaveBeenCalledWith('loxone/+/+/cmd');

      // Should have registered MQTT message listener
      expect(ctx.mqttService.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('publishes bridge status online', async () => {
      await plugin.start(ctx);

      const statusPub = ctx._published.find(
        (p) => p.topic === 'loxone/bridge/status'
      );
      expect(statusPub).toBeDefined();
      expect(statusPub.payload).toBe('online');
      expect(statusPub.opts).toEqual(expect.objectContaining({ retain: true }));
    });

    it('publishes HA Discovery messages when enabled', async () => {
      await plugin.start(ctx);

      // Should have published discovery configs for the mock controls
      const discoveryPubs = ctx._published.filter((p) =>
        p.topic.startsWith('homeassistant/')
      );
      expect(discoveryPubs.length).toBeGreaterThan(0);
    });

    it('does not publish HA Discovery when disabled', async () => {
      ctx = createMockContext({ enableHaDiscovery: false });
      await plugin.start(ctx);

      const discoveryPubs = ctx._published.filter((p) =>
        p.topic.startsWith('homeassistant/')
      );
      expect(discoveryPubs.length).toBe(0);
    });
  });

  describe('valueEvent handling', () => {
    it('publishes MQTT message with correct topic and JSON payload on valueEvent', async () => {
      await plugin.start(ctx);

      // Clear previous publishes from start
      ctx._published.length = 0;

      // Simulate a value event from the WS client
      // We need to get the internal WS instance and emit on it
      plugin._ws.emit('valueEvent', { uuid: 'aabb-1111', value: 42.5 });

      // Should have published to the mapped topic
      const statePub = ctx._published.find(
        (p) => p.topic === 'loxone/wohnzimmer/helligkeit/state'
      );
      expect(statePub).toBeDefined();

      const payload = JSON.parse(statePub.payload);
      expect(payload.value).toBe(42.5);
      expect(payload.name).toBe('Helligkeit');
      expect(payload.type).toBe('InfoOnlyAnalog');
      expect(payload.uuid).toBe('aabb-1111');
      expect(payload.room).toBe('Wohnzimmer');
    });

    it('skips disabled controls', async () => {
      ctx = createMockContext({ disabledControls: ['aabb-1111'] });
      await plugin.start(ctx);
      ctx._published.length = 0;

      plugin._ws.emit('valueEvent', { uuid: 'aabb-1111', value: 10 });

      const statePub = ctx._published.find(
        (p) => p.topic === 'loxone/wohnzimmer/helligkeit/state'
      );
      expect(statePub).toBeUndefined();
    });

    it('ignores unknown UUIDs', async () => {
      await plugin.start(ctx);
      ctx._published.length = 0;

      plugin._ws.emit('valueEvent', { uuid: 'unknown-uuid', value: 1 });

      // Should not have published any state
      const statePubs = ctx._published.filter((p) => p.topic.endsWith('/state'));
      expect(statePubs.length).toBe(0);
    });
  });

  describe('textEvent handling', () => {
    it('publishes text event with correct payload', async () => {
      await plugin.start(ctx);
      ctx._published.length = 0;

      plugin._ws.emit('textEvent', { uuid: 'aabb-1111', text: 'Hello World' });

      const statePub = ctx._published.find(
        (p) => p.topic === 'loxone/wohnzimmer/helligkeit/state'
      );
      expect(statePub).toBeDefined();

      const payload = JSON.parse(statePub.payload);
      expect(payload.text).toBe('Hello World');
      expect(payload.name).toBe('Helligkeit');
    });
  });

  describe('MQTT command handling', () => {
    it('forwards MQTT cmd to WebSocket sendCommand', async () => {
      await plugin.start(ctx);

      // Simulate an incoming MQTT message on a cmd topic
      const handler = ctx._messageListeners[0];
      handler({
        topic: 'loxone/wohnzimmer/lichtsteuerung/cmd',
        payload: 'on',
        timestamp: Date.now(),
      });

      // Should have sent command to Loxone via WebSocket
      expect(plugin._ws._lastCommand).toBe('jdev/sps/io/aabb-2222/on');
    });

    it('ignores non-cmd topics', async () => {
      await plugin.start(ctx);

      const handler = ctx._messageListeners[0];
      handler({
        topic: 'loxone/wohnzimmer/helligkeit/state',
        payload: '42',
        timestamp: Date.now(),
      });

      // Should not have sent any command
      expect(plugin._ws._lastCommand).toBeUndefined();
    });

    it('ignores cmd topics with wrong prefix', async () => {
      await plugin.start(ctx);

      const handler = ctx._messageListeners[0];
      handler({
        topic: 'other/room/control/cmd',
        payload: 'on',
        timestamp: Date.now(),
      });

      expect(plugin._ws._lastCommand).toBeUndefined();
    });
  });

  describe('stop()', () => {
    it('disconnects WebSocket and cleans up', async () => {
      await plugin.start(ctx);
      await plugin.stop();

      const status = plugin.getStatus();
      expect(status.running).toBe(false);

      // Should have published offline status
      const offlinePub = ctx._published.find(
        (p) => p.topic === 'loxone/bridge/status' && p.payload === 'offline'
      );
      expect(offlinePub).toBeDefined();

      // Should have unsubscribed from cmd topics
      expect(ctx.mqttService.unsubscribe).toHaveBeenCalledWith('loxone/+/+/cmd');

      // Should have removed MQTT message listener
      expect(ctx.mqttService.removeListener).toHaveBeenCalled();
    });
  });

  describe('getStatus()', () => {
    it('returns initial status when not started', () => {
      const status = plugin.getStatus();
      expect(status.running).toBe(false);
      expect(status.connected).toBe(false);
      expect(status.controlCount).toBe(0);
    });

    it('reflects running state after start', async () => {
      await plugin.start(ctx);
      const status = plugin.getStatus();
      expect(status.running).toBe(true);
      expect(status.controlCount).toBe(6); // 6 mock controls
    });

    it('tracks lastEvent timestamp', async () => {
      await plugin.start(ctx);

      const before = Date.now();
      plugin._ws.emit('valueEvent', { uuid: 'aabb-1111', value: 1 });
      const after = Date.now();

      const status = plugin.getStatus();
      expect(status.lastEvent).toBeGreaterThanOrEqual(before);
      expect(status.lastEvent).toBeLessThanOrEqual(after);
    });
  });

  describe('getConfigSchema()', () => {
    it('returns valid JSON Schema with required properties', () => {
      const schema = plugin.getConfigSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();

      // Check all required config fields exist
      const props = Object.keys(schema.properties);
      expect(props).toContain('ip');
      expect(props).toContain('port');
      expect(props).toContain('username');
      expect(props).toContain('password');
      expect(props).toContain('prefix');
      expect(props).toContain('autoStart');
      expect(props).toContain('enableHaDiscovery');

      // Check password format
      expect(schema.properties.password.format).toBe('password');

      // Check defaults
      expect(schema.properties.port.default).toBe(80);
      expect(schema.properties.prefix.default).toBe('loxone');
    });
  });

  describe('HA Discovery', () => {
    it('maps Switch to switch component', async () => {
      await plugin.start(ctx);

      const switchDiscovery = ctx._published.find(
        (p) => p.topic.startsWith('homeassistant/switch/') && p.topic.endsWith('/config')
      );
      expect(switchDiscovery).toBeDefined();

      const payload = JSON.parse(switchDiscovery.payload);
      expect(payload.name).toBe('Lichtsteuerung');
      expect(payload.command_topic).toBeDefined();
      expect(payload.state_topic).toBeDefined();
    });

    it('maps Dimmer to light component', async () => {
      await plugin.start(ctx);

      const lightDiscovery = ctx._published.find(
        (p) => p.topic.startsWith('homeassistant/light/') && p.topic.endsWith('/config')
      );
      expect(lightDiscovery).toBeDefined();
    });

    it('maps InfoOnlyAnalog to sensor component', async () => {
      await plugin.start(ctx);

      const sensorDiscovery = ctx._published.find(
        (p) => p.topic.startsWith('homeassistant/sensor/') && p.topic.endsWith('/config')
      );
      expect(sensorDiscovery).toBeDefined();
    });

    it('maps InfoOnlyDigital to binary_sensor component', async () => {
      await plugin.start(ctx);

      const binarySensorDiscovery = ctx._published.find(
        (p) => p.topic.startsWith('homeassistant/binary_sensor/') && p.topic.endsWith('/config')
      );
      expect(binarySensorDiscovery).toBeDefined();
    });

    it('maps Jalousie to cover component', async () => {
      await plugin.start(ctx);

      const coverDiscovery = ctx._published.find(
        (p) => p.topic.startsWith('homeassistant/cover/') && p.topic.endsWith('/config')
      );
      expect(coverDiscovery).toBeDefined();
    });

    it('maps unknown types to sensor as default', async () => {
      await plugin.start(ctx);

      // SomeUnknownType should map to sensor
      const sensorPubs = ctx._published.filter(
        (p) => p.topic.startsWith('homeassistant/sensor/') && p.topic.endsWith('/config')
      );
      // Should have at least 2: InfoOnlyAnalog + unknown type
      expect(sensorPubs.length).toBeGreaterThanOrEqual(2);
    });

    it('includes availability_topic in discovery payloads', async () => {
      await plugin.start(ctx);

      const anyDiscovery = ctx._published.find(
        (p) => p.topic.startsWith('homeassistant/') && p.topic.endsWith('/config')
      );
      const payload = JSON.parse(anyDiscovery.payload);
      expect(payload.availability_topic).toBe('loxone/bridge/status');
    });

    it('includes device info in discovery payloads', async () => {
      await plugin.start(ctx);

      const anyDiscovery = ctx._published.find(
        (p) => p.topic.startsWith('homeassistant/') && p.topic.endsWith('/config')
      );
      const payload = JSON.parse(anyDiscovery.payload);
      expect(payload.device).toBeDefined();
      expect(payload.device.name).toBeDefined();
      expect(payload.device.identifiers).toBeDefined();
    });
  });
});
