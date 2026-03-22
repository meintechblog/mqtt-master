import { readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class PluginManager {
  /**
   * @param {{ pluginDir: string, configService: object, mqttService: object, logger: object }} opts
   */
  constructor({ pluginDir, configService, mqttService, logger }) {
    this.pluginDir = pluginDir;
    this.configService = configService;
    this.mqttService = mqttService;
    this.logger = logger;
    /** @type {Map<string, { id: string, name: string, status: string, instance: object|null, error: string|null, modulePath: string }>} */
    this.plugins = new Map();
  }

  /**
   * Scan pluginDir for subdirectories containing plugin.js.
   * Loads each plugin module to extract static metadata (name, configSchema)
   * so the UI can render config forms even before the plugin is started.
   */
  async discover() {
    let entries;
    try {
      entries = await readdir(this.pluginDir, { withFileTypes: true });
    } catch {
      // pluginDir doesn't exist or can't be read
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginFile = join(this.pluginDir, entry.name, 'plugin.js');
      try {
        await access(pluginFile);
      } catch {
        continue; // no plugin.js in this directory
      }

      // Load module to extract schema without starting the plugin
      let configSchema = {};
      let pluginName = entry.name;
      try {
        const moduleUrl = pathToFileURL(pluginFile).href;
        const mod = await import(moduleUrl);
        const PluginClass = mod.default;
        const tempInstance = new PluginClass();
        if (typeof tempInstance.getConfigSchema === 'function') {
          configSchema = tempInstance.getConfigSchema();
        }
        pluginName = tempInstance.name || entry.name;
      } catch (err) {
        this.logger.warn(`Could not load schema for plugin '${entry.name}': ${err.message}`);
      }

      this.plugins.set(entry.name, {
        id: entry.name,
        name: pluginName,
        status: 'stopped',
        instance: null,
        error: null,
        modulePath: pluginFile,
        configSchema,
      });
    }
  }

  /**
   * Start a plugin by id.
   */
  async start(id) {
    const meta = this.plugins.get(id);
    if (!meta) {
      throw new Error(`Plugin '${id}' not found`);
    }

    try {
      // Cache-bust: append query param so Node reimports the module
      const moduleUrl = pathToFileURL(meta.modulePath).href + `?t=${Date.now()}`;
      const mod = await import(moduleUrl);
      const PluginClass = mod.default;
      const instance = new PluginClass();

      await instance.start({
        mqttService: this.mqttService,
        configService: this.configService,
        logger: this.logger,
        pluginId: id,
      });

      meta.instance = instance;
      meta.status = 'running';
      meta.error = null;
    } catch (err) {
      meta.status = 'error';
      meta.error = err.message;
      meta.instance = null;
    }
  }

  /**
   * Stop a plugin by id.
   */
  async stop(id) {
    const meta = this.plugins.get(id);
    if (!meta) {
      throw new Error(`Plugin '${id}' not found`);
    }

    try {
      if (meta.instance && typeof meta.instance.stop === 'function') {
        await meta.instance.stop();
      }
    } catch (err) {
      this.logger.warn(`Error stopping plugin '${id}': ${err.message}`);
    }

    meta.instance = null;
    meta.status = 'stopped';
    meta.error = null;
  }

  /**
   * Reload a plugin: stop, re-import, start.
   */
  async reload(id) {
    const meta = this.plugins.get(id);
    if (!meta) {
      throw new Error(`Plugin '${id}' not found`);
    }

    if (meta.status === 'running') {
      await this.stop(id);
    }

    await this.start(id);
  }

  /**
   * List all discovered plugins with their status.
   */
  listAll() {
    const result = [];
    for (const meta of this.plugins.values()) {
      result.push({
        id: meta.id,
        name: meta.name,
        status: meta.status,
        error: meta.error,
      });
    }
    return result;
  }

  /**
   * Get status of a single plugin.
   */
  getStatus(id) {
    const meta = this.plugins.get(id);
    if (!meta) {
      throw new Error(`Plugin '${id}' not found`);
    }
    return { status: meta.status, error: meta.error };
  }

  /**
   * Get config for a plugin from ConfigService.
   */
  getConfig(id) {
    return this.configService.get(`plugins.${id}`, {});
  }

  /**
   * Set and persist config for a plugin.
   */
  async setConfig(id, data) {
    this.configService.set(`plugins.${id}`, data);
    await this.configService.save();
  }

  /**
   * Get the config schema cached at discovery time.
   */
  getSchema(id) {
    const meta = this.plugins.get(id);
    return meta ? (meta.configSchema || {}) : {};
  }

  /**
   * Get the plugin instance (for accessing getConfigSchema etc).
   */
  getInstance(id) {
    const meta = this.plugins.get(id);
    return meta ? meta.instance : null;
  }
}
