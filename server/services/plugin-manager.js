import { readdir, access, readFile, rm } from 'node:fs/promises';
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

    // Auto-start plugins that have autoStart: true in their config
    for (const [id] of this.plugins) {
      const pluginConfig = this.configService.get(`plugins.${id}`, {});
      if (pluginConfig.autoStart) {
        this.logger.info(`Auto-starting plugin '${id}'`);
        try {
          await this.start(id);
        } catch (err) {
          this.logger.error(`Failed to auto-start plugin '${id}': ${err.message}`);
        }
      }
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
        pluginManager: this,
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
  async listAll() {
    const result = [];
    for (const meta of this.plugins.values()) {
      const entry = {
        id: meta.id,
        name: meta.name,
        status: meta.status,
        error: meta.error,
        deletable: false,
      };
      // Check if this is a user-created instance (re-export file)
      try {
        const content = await readFile(meta.modulePath, 'utf-8');
        if (content.includes('export { default } from')) entry.deletable = true;
      } catch { /* ignore */ }
      // Include plugin stats if running
      if (meta.instance && typeof meta.instance.getStatus === 'function') {
        try {
          const s = meta.instance.getStatus();
          if (s.messageCount != null) entry.messageCount = s.messageCount;
          if (s.controlCount != null) entry.controlCount = s.controlCount;
          if (s.lastEvent != null) entry.lastEvent = s.lastEvent;
        } catch { /* ignore */ }
      }
      result.push(entry);
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
   * List available plugin templates (for "Add Plugin" UI).
   * Returns plugin types that can be instantiated multiple times.
   */
  getTemplates() {
    const templates = [];
    for (const meta of this.plugins.values()) {
      // Only plugins that make sense to have multiple instances
      if (meta.id === 'mqtt-bridge') {
        templates.push({
          type: meta.id,
          label: 'MQTT Bridge',
          description: 'Connect to an external MQTT broker and bridge topics locally',
        });
      }
    }
    return templates;
  }

  /**
   * Create a new plugin instance from a template.
   * Copies the plugin code and registers with a unique ID.
   */
  async createInstance(type, instanceId) {
    if (!instanceId || !/^[a-z0-9-]+$/.test(instanceId)) {
      throw new Error('Invalid instance ID (use lowercase, numbers, hyphens)');
    }
    if (this.plugins.has(instanceId)) {
      throw new Error(`Plugin '${instanceId}' already exists`);
    }
    const template = this.plugins.get(type);
    if (!template) {
      throw new Error(`Plugin template '${type}' not found`);
    }

    // Create directory with a re-export module
    const { mkdir, writeFile } = await import('node:fs/promises');
    const newDir = join(this.pluginDir, instanceId);
    await mkdir(newDir, { recursive: true });

    const relPath = '../' + type + '/plugin.js';
    await writeFile(join(newDir, 'plugin.js'),
      `// Auto-generated instance of ${type} plugin\nexport { default } from '${relPath}';\n`
    );

    // Load schema from template
    let configSchema = template.configSchema || {};

    this.plugins.set(instanceId, {
      id: instanceId,
      name: instanceId,
      status: 'stopped',
      instance: null,
      error: null,
      modulePath: join(newDir, 'plugin.js'),
      configSchema,
    });

    this.logger.info(`Created plugin instance '${instanceId}' from template '${type}'`);
    return { id: instanceId, type };
  }

  /**
   * Delete a user-created plugin instance. Stops it, removes files and config.
   */
  async deleteInstance(id) {
    const meta = this.plugins.get(id);
    if (!meta) throw new Error(`Plugin '${id}' not found`);

    // Safety: only allow deleting user-created instances
    try {
      const content = await readFile(meta.modulePath, 'utf-8');
      if (!content.includes('export { default } from')) {
        throw new Error(`Plugin '${id}' is a core plugin and cannot be deleted`);
      }
    } catch (err) {
      if (err.message.includes('core plugin')) throw err;
      throw new Error(`Cannot read plugin '${id}'`);
    }

    // Stop if running
    if (meta.status === 'running') {
      await this.stop(id);
    }

    // Remove plugin directory
    const pluginDir = join(this.pluginDir, id);
    await rm(pluginDir, { recursive: true, force: true });

    // Remove config
    this.configService.set(`plugins.${id}`, undefined);
    await this.configService.save();

    // Remove from registry
    this.plugins.delete(id);

    this.logger.info(`Deleted plugin instance '${id}'`);
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
