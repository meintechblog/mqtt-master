import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

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

/** Prefix to identify encrypted values in config.json */
const ENC_PREFIX = 'enc:';

/** Fields that must be encrypted when stored (matched by key name) */
const SENSITIVE_KEYS = ['password', 'token', 'secret', 'apiKey', 'apikey', 'credentials'];

/**
 * Derive a stable encryption key from a machine-specific seed.
 * Uses the config file path + hostname as salt so the key is unique per installation.
 */
function deriveKey(configPath) {
  const salt = `mqtt-master:${configPath}`;
  return scryptSync('mqtt-master-secret-seed', salt, 32);
}

function encrypt(text, key) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return ENC_PREFIX + iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedStr, key) {
  if (!encryptedStr.startsWith(ENC_PREFIX)) return encryptedStr;
  const data = encryptedStr.slice(ENC_PREFIX.length);
  const [ivHex, encrypted] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** Check if a key name is sensitive */
function isSensitiveKey(key) {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some(s => lower === s.toLowerCase() || lower.endsWith(s.toLowerCase()));
}

export class ConfigService {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = this._deepMerge({}, DEFAULTS);
    this._encKey = deriveKey(configPath);
  }

  async load() {
    if (!existsSync(this.configPath)) {
      return; // Use defaults
    }
    try {
      const raw = await readFile(this.configPath, 'utf-8');
      const fileConfig = JSON.parse(raw);
      // Decrypt sensitive values after loading
      this._decryptDeep(fileConfig);
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

  set(key, value) {
    const keys = key.split('.');
    let obj = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (obj[k] == null || typeof obj[k] !== 'object') {
        obj[k] = {};
      }
      obj = obj[k];
    }
    obj[keys[keys.length - 1]] = value;
  }

  async save() {
    // Deep-clone config and encrypt sensitive values for storage
    const toSave = JSON.parse(JSON.stringify(this.config));
    this._encryptDeep(toSave);
    await writeFile(this.configPath, JSON.stringify(toSave, null, 2), 'utf-8');
  }

  /** Recursively encrypt sensitive string values */
  _encryptDeep(obj) {
    for (const key of Object.keys(obj)) {
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        this._encryptDeep(obj[key]);
      } else if (typeof obj[key] === 'string' && isSensitiveKey(key) && !obj[key].startsWith(ENC_PREFIX)) {
        obj[key] = encrypt(obj[key], this._encKey);
      }
    }
  }

  /** Recursively decrypt sensitive string values */
  _decryptDeep(obj) {
    for (const key of Object.keys(obj)) {
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        this._decryptDeep(obj[key]);
      } else if (typeof obj[key] === 'string' && obj[key].startsWith(ENC_PREFIX)) {
        try {
          obj[key] = decrypt(obj[key], this._encKey);
        } catch {
          // If decryption fails, leave as-is (key may have changed)
        }
      }
    }
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
