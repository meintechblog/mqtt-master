import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const DEFAULTS = {
  mqtt: {
    broker: 'mqtt://localhost:1883',
  },
  web: {
    port: 3000,
  },
  logLevel: 'info',
  pluginDir: '/opt/mqtt-master/plugins',
  topicPrefix: 'mqtt-master',
};

export class ConfigService {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = this._deepMerge({}, DEFAULTS);
  }

  async load() {
    if (!existsSync(this.configPath)) {
      return; // Use defaults
    }
    try {
      const raw = await readFile(this.configPath, 'utf-8');
      const fileConfig = JSON.parse(raw);
      this.config = this._deepMerge(DEFAULTS, fileConfig);
    } catch (err) {
      console.warn(`Failed to load config from ${this.configPath}, using defaults:`, err.message);
    }
  }

  get(key, fallback) {
    const keys = key.split('.');
    let val = this.config;
    for (const k of keys) {
      if (val == null || typeof val !== 'object') return fallback;
      val = val[k];
    }
    return val !== undefined ? val : fallback;
  }

  _deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this._deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}
