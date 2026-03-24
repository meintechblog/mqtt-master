/**
 * Encapsulates MQTT input binding lifecycle: state, apply, cleanup, get/set with persistence.
 * Used by LoxonePlugin and MqttBridgePlugin to eliminate duplicated binding boilerplate.
 */
import { applyBindings, cleanupBindings } from './binding-utils.js';

export class BindingsManager {
  /**
   * @param {object} opts
   * @param {string} opts.configKey - config path (e.g. 'plugins.loxone')
   * @param {(uuid: string, value: string) => void} opts.sendToTarget - forwards value to the target device
   */
  constructor({ configKey, sendToTarget }) {
    this._configKey = configKey;
    this._sendToTarget = sendToTarget;

    /** @type {Array<object>} */
    this._bindings = [];
    /** @type {Map<string, Function>} */
    this._handlers = new Map();
    /** @type {Map<string, { ts: number, value: any }>} */
    this._lastSend = new Map();

    this._ctx = null;
    this._config = null;
  }

  /**
   * Initialize from plugin context. Call in plugin.start().
   * @param {{ mqttService: object, configService: object, logger: object }} ctx
   * @param {object} config - the plugin's config object (mutated for persistence)
   */
  init(ctx, config) {
    this._ctx = ctx;
    this._config = config;
    this._bindings = config.inputBindings || [];
    this.apply();
  }

  /** @returns {Array<object>} */
  getBindings() {
    return [...this._bindings];
  }

  /**
   * Replace bindings, persist, and re-apply subscriptions.
   * @param {Array<object>} bindings
   */
  async setBindings(bindings) {
    this._bindings = bindings;
    this._config.inputBindings = bindings;
    if (this._ctx) {
      this._ctx.configService.set(this._configKey, this._config);
      await this._ctx.configService.save();
    }
    this.apply();
  }

  /** Subscribe to MQTT topics and wire up handlers. */
  apply() {
    if (!this._ctx) return;
    applyBindings({
      bindings: this._bindings,
      mqttService: this._ctx.mqttService,
      logger: this._ctx.logger,
      sendToTarget: this._sendToTarget,
      handlerMap: this._handlers,
      lastSendMap: this._lastSend,
    });
  }

  /** Unsubscribe all binding handlers. Call in plugin.stop(). */
  cleanup() {
    cleanupBindings({
      mqttService: this._ctx?.mqttService,
      handlerMap: this._handlers,
      lastSendMap: this._lastSend,
    });
  }
}
