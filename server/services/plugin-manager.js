import { readdir, access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPE_LABELS = { 'loxone': 'Loxone', 'mqtt-bridge': 'MQTT-Bridge' };
const TYPE_DESCRIPTIONS = {
  'loxone': 'Bidirectional Loxone Miniserver bridge with auto-discovery',
  'mqtt-bridge': 'Connect to an external MQTT broker and bridge topics locally',
};

function labelFor(id) { return TYPE_LABELS[id] || id.charAt(0).toUpperCase() + id.slice(1); }

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
    /** @type {Map<string, { type: string, label: string, description: string, modulePath: string, configSchema: object }>} */
    this._templates = new Map();
  }

  /**
   * Scan pluginDir for plugin templates and register configured plugins.
   *
   * Templates: all directories with plugin.js (available in + menu)
   * Active plugins: only those with a config entry in config.json
   */
  async discover() {
    let entries;
    try {
      entries = await readdir(this.pluginDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Phase 1: scan filesystem for templates
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginFile = join(this.pluginDir, entry.name, 'plugin.js');
      try {
        await access(pluginFile);
      } catch {
        continue;
      }

      // Skip user-created instances (re-export files) — they're not templates
      let isReExport = false;
      try {
        const content = await readFile(pluginFile, 'utf-8');
        isReExport = content.includes('export { default } from');
      } catch { /* ignore */ }
      if (isReExport) continue;

      let configSchema = {};
      try {
        const moduleUrl = pathToFileURL(pluginFile).href;
        const mod = await import(moduleUrl);
        const PluginClass = mod.default;
        const tempInstance = new PluginClass();
        if (typeof tempInstance.getConfigSchema === 'function') {
          configSchema = tempInstance.getConfigSchema();
        }
      } catch (err) {
        this.logger.warn(`Could not load schema for template '${entry.name}': ${err.message}`);
      }

      this._templates.set(entry.name, {
        type: entry.name,
        label: labelFor(entry.name),
        description: TYPE_DESCRIPTIONS[entry.name] || '',
        modulePath: pluginFile,
        configSchema,
      });
    }

    // Phase 2: register plugins that have config entries
    const allPluginConfig = this.configService.get('plugins', {});
    for (const [id, pluginConfig] of Object.entries(allPluginConfig)) {
      if (!pluginConfig || typeof pluginConfig !== 'object') continue;

      // Find the template for this plugin
      let template = this._templates.get(id);
      let modulePath;

      if (template) {
        // Direct match: plugin id matches a template (e.g. "loxone")
        modulePath = template.modulePath;
      } else {
        // Check for user-created instance directory
        const pluginFile = join(this.pluginDir, id, 'plugin.js');
        try {
          await access(pluginFile);
          modulePath = pluginFile;
          // Load schema from the re-exported module
          try {
            const content = await readFile(pluginFile, 'utf-8');
            const match = content.match(/from '\.\.\/([^/]+)\//);
            if (match) template = this._templates.get(match[1]);
          } catch { /* ignore */ }
        } catch {
          continue; // no plugin.js found, skip
        }
      }

      this.plugins.set(id, {
        id,
        name: id,
        status: 'stopped',
        instance: null,
        error: null,
        modulePath,
        configSchema: template ? template.configSchema : {},
      });
    }

    // Phase 3: auto-start plugins
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
      const config = this.configService.get(`plugins.${meta.id}`, {});
      const entry = {
        id: meta.id,
        name: labelFor(meta.id),
        displayName: config.displayName || '',
        status: meta.status,
        error: meta.error,
        deletable: true,
      };
      // Include plugin stats if running
      if (meta.instance && typeof meta.instance.getStatus === 'function') {
        try {
          const s = meta.instance.getStatus();
          if (s.messageCount != null) entry.messageCount = s.messageCount;
          if (s.controlCount != null) entry.controlCount = s.controlCount;
          if (s.lastEvent != null) entry.lastEvent = s.lastEvent;
          if (s.connected != null) entry.connected = s.connected;
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
   */
  getTemplates() {
    return [...this._templates.values()];
  }

  /**
   * Create a new plugin instance from a template.
   * For core templates: uses the template directory directly.
   * For additional instances: creates a re-export directory.
   */
  async createInstance(type, instanceId) {
    if (!instanceId || !/^[a-z0-9-]+$/.test(instanceId)) {
      throw new Error('Invalid instance ID (use lowercase, numbers, hyphens)');
    }
    if (this.plugins.has(instanceId)) {
      throw new Error(`Plugin '${instanceId}' already exists`);
    }
    const template = this._templates.get(type);
    if (!template) {
      throw new Error(`Plugin template '${type}' not found`);
    }

    let modulePath;

    if (instanceId === type) {
      // Using the template directly (e.g. id="loxone" from template "loxone")
      modulePath = template.modulePath;
    } else {
      // Create a new directory with re-export
      const { mkdir, writeFile } = await import('node:fs/promises');
      const newDir = join(this.pluginDir, instanceId);
      await mkdir(newDir, { recursive: true });
      const relPath = '../' + type + '/plugin.js';
      await writeFile(join(newDir, 'plugin.js'),
        `// Auto-generated instance of ${type} plugin\nexport { default } from '${relPath}';\n`
      );
      modulePath = join(newDir, 'plugin.js');
    }

    // Create config entry (triggers discovery on next restart)
    this.configService.set(`plugins.${instanceId}`, { displayName: '' });
    await this.configService.save();

    // Register immediately
    this.plugins.set(instanceId, {
      id: instanceId,
      name: instanceId,
      status: 'stopped',
      instance: null,
      error: null,
      modulePath,
      configSchema: template.configSchema || {},
    });

    this.logger.info(`Created plugin '${instanceId}' from template '${type}'`);
    return { id: instanceId, type };
  }

  /**
   * Delete a plugin instance. Stops it, removes config.
   * User-created instances: also removes the plugin directory.
   * Core plugins: keeps the directory (can be re-added), only removes config.
   */
  async deleteInstance(id) {
    const meta = this.plugins.get(id);
    if (!meta) throw new Error(`Plugin '${id}' not found`);

    // Stop if running
    if (meta.status === 'running') {
      await this.stop(id);
    }

    // Check if user-created instance (re-export file) → remove directory too
    let isUserCreated = false;
    try {
      const content = await readFile(meta.modulePath, 'utf-8');
      isUserCreated = content.includes('export { default } from');
    } catch { /* ignore */ }

    if (isUserCreated) {
      const pluginDir = join(this.pluginDir, id);
      await rm(pluginDir, { recursive: true, force: true });
    }

    // Remove config
    this.configService.set(`plugins.${id}`, undefined);
    await this.configService.save();

    // Remove from registry
    this.plugins.delete(id);

    this.logger.info(`Deleted plugin '${id}'${isUserCreated ? ' (instance removed)' : ' (config cleared)'}`);
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
