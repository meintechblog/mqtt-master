/**
 * Monitors Loxone structure for changes (renames, additions, removals)
 * and cleans up stale MQTT topics.
 * Extracted from LoxonePlugin to isolate structure change detection.
 */
import { clearHaDiscovery } from './ha-discovery.js';

export class StructureMonitor {
  constructor() {
    /** @type {Map<string, string>} UUID -> previous topic */
    this._prevTopics = new Map();
    /** @type {ReturnType<typeof setInterval>|null} */
    this._interval = null;
  }

  /**
   * Snapshot current UUID->topic mapping for later comparison.
   * @param {object} structure - LoxoneStructure instance
   */
  snapshot(structure) {
    this._prevTopics.clear();
    if (!structure) return;
    for (const ctrl of structure.getAll()) {
      this._prevTopics.set(ctrl.uuid, ctrl.topic);
    }
  }

  /**
   * Start periodic structure checks.
   * @param {() => Promise<void>} refreshFn - function to call for refresh
   * @param {number} intervalMs
   */
  startPolling(refreshFn, intervalMs = 60_000) {
    this.stopPolling();
    this._interval = setInterval(refreshFn, intervalMs);
  }

  /** Stop periodic structure checks. */
  stopPolling() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  /**
   * Detect changes between previous snapshot and current structure.
   * Cleans up stale MQTT topics for renamed/removed controls.
   *
   * @param {object} opts
   * @param {object} opts.structure - LoxoneStructure instance
   * @param {object} opts.mqttService
   * @param {object} opts.logger
   * @returns {number} number of changes detected
   */
  detectChanges({ structure, mqttService, logger }) {
    const newControls = structure.getAll();
    let changes = 0;

    // Detect renamed/removed controls
    for (const [uuid, oldTopic] of this._prevTopics) {
      const newMeta = structure.getMeta(uuid);
      if (!newMeta) {
        this._clearRetainedTopics(mqttService, oldTopic);
        logger.info(`Control removed: ${oldTopic}`);
        changes++;
      } else if (newMeta.topic !== oldTopic) {
        this._clearRetainedTopics(mqttService, oldTopic);
        logger.info(`Control renamed: ${oldTopic} → ${newMeta.topic}`);
        changes++;
      }
    }

    // Detect new controls
    for (const ctrl of newControls) {
      if (!this._prevTopics.has(ctrl.uuid)) {
        logger.info(`New control discovered: ${ctrl.topic} (${ctrl.name})`);
        changes++;
      }
    }

    return changes;
  }

  /**
   * Clear retained MQTT messages for a control topic and its subtopics.
   *
   * Deliberately does NOT clear the `/cmd` retained slot: cmd topics are
   * input-only, and a retained empty payload there gets re-delivered to the
   * loxone plugin's own /cmd subscriber on every publish, which would forward
   * an empty `jdev/sps/io/<uuid>/` write to the Miniserver and zero the
   * control. State-side cleanup is enough to drop stale topics from the UI.
   * @private
   */
  _clearRetainedTopics(mqttService, baseTopic) {
    const suffixes = ['/state', ''];
    for (const suffix of suffixes) {
      mqttService.publish(baseTopic + suffix, '', { retain: true });
    }
    clearHaDiscovery(mqttService, baseTopic);
  }
}
