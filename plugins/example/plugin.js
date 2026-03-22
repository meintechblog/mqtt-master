/**
 * Example plugin -- serves as a template for building new plugins.
 *
 * Every plugin must default-export a class with these lifecycle methods:
 *   start(context)  -- called when the plugin is started
 *   stop()          -- called when the plugin is stopped
 *   getStatus()     -- returns current status object
 *   getConfigSchema() -- returns JSON Schema for plugin config
 */
export default class ExamplePlugin {
  constructor() {
    this.running = false;
    this.ctx = null;
  }

  /**
   * Start the plugin.
   * @param {{ mqttService: object, configService: object, logger: object, pluginId: string }} context
   */
  async start(context) {
    this.ctx = context;
    this.running = true;
    context.logger.info(`Example plugin started (id: ${context.pluginId})`);
  }

  /**
   * Stop the plugin.
   */
  async stop() {
    this.running = false;
    if (this.ctx) {
      this.ctx.logger.info('Example plugin stopped');
    }
    this.ctx = null;
  }

  /**
   * Return current status.
   */
  getStatus() {
    return { running: this.running };
  }

  /**
   * Return JSON Schema describing this plugin's configuration.
   */
  getConfigSchema() {
    return {
      type: 'object',
      properties: {
        greeting: {
          type: 'string',
          title: 'Greeting',
          default: 'Hello',
        },
      },
    };
  }
}
