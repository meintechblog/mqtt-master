/**
 * Shared utilities for MQTT input binding execution.
 * Used by both Loxone and MQTT-Bridge plugins.
 */

/**
 * Extract a field from a JSON object using dot notation.
 * @param {object} obj
 * @param {string} path - e.g. "ac_power_w" or "data.power"
 * @returns {number|string|null}
 */
export function extractField(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return null;
    current = current[part];
  }
  return current ?? null;
}

/**
 * Walk a JSON object recursively and emit every leaf as
 * `{ path: 'a.b.c', value, type }`. Useful for input-binding pickers that
 * need to surface nested numeric fields (e.g. Tasmota `ENERGY.Power`).
 *
 * - Arrays are skipped (no stable path) and not recursed.
 * - `null` and `undefined` are skipped.
 * - `maxDepth` guards against runaway nesting (default 6 levels).
 */
export function flattenJsonFields(obj, { maxDepth = 6 } = {}) {
  const out = [];
  function walk(node, path, depth) {
    if (node == null || depth > maxDepth) return;
    if (typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) {
        const next = path ? `${path}.${k}` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          walk(v, next, depth + 1);
        } else if (v != null && !Array.isArray(v)) {
          out.push({ path: next, value: v, type: typeof v });
        }
      }
    }
  }
  walk(obj, '', 0);
  return out;
}

/**
 * Apply a value transform.
 * @param {number|string} value
 * @param {string|null} transform
 * @returns {number|string}
 */
export function applyTransform(value, transform) {
  if (!transform) return value;
  const num = Number(value);
  if (isNaN(num)) return value;
  switch (transform) {
    case 'div1000': return Math.round(num / 1000 * 1e3) / 1e3;
    case 'div100': return Math.round(num / 100 * 1e2) / 1e2;
    case 'mul1000': return num * 1000;
    case 'mul100': return num * 100;
    case 'round': return Math.round(num);
    case 'round1': return Math.round(num * 10) / 10;
    default: return num;
  }
}

/**
 * Apply input bindings: subscribe to MQTT topics, extract values, send to targets.
 *
 * @param {object} opts
 * @param {Array} opts.bindings - binding definitions
 * @param {object} opts.mqttService - local MQTT service
 * @param {object} opts.logger
 * @param {Function} opts.sendToTarget - (uuid, value) => void
 * @param {Map} opts.handlerMap - Map to store handlers for cleanup
 * @param {Map} opts.lastSendMap - Map to store last-send state for dedup
 */
export function applyBindings({ bindings, mqttService, logger, sendToTarget, handlerMap, lastSendMap }) {
  cleanupBindings({ mqttService, handlerMap, lastSendMap });

  for (const binding of bindings) {
    if (!binding.enabled || !binding.mqttTopic || !binding.jsonField || !binding.targetUuid) continue;

    const keepaliveMs = binding.keepaliveMs || binding.intervalMs || 30000;
    mqttService.subscribe(binding.mqttTopic);

    const handler = (msg) => {
      if (msg.topic !== binding.mqttTopic) return;
      try {
        const data = JSON.parse(msg.payload);
        let value = extractField(data, binding.jsonField);
        if (value == null) return;
        value = applyTransform(value, binding.transform);
        if (typeof value === 'number') value = Math.round(value * 1000) / 1000;

        const now = Date.now();
        const last = lastSendMap.get(binding.id);
        const valueChanged = !last || last.value !== value;
        const keepaliveExpired = !last || (now - last.ts >= keepaliveMs);
        if (!valueChanged && !keepaliveExpired) return;

        sendToTarget(binding.targetUuid, String(value));
        lastSendMap.set(binding.id, { ts: now, value });

        if (valueChanged) {
          logger.debug(`Binding ${binding.label || binding.id}: ${value} → ${binding.targetUuid}`);
        }
      } catch { /* ignore parse errors */ }
    };

    mqttService.on('message', handler);
    handlerMap.set(binding.id, { handler, topic: binding.mqttTopic });
    logger.info(`Input binding: ${binding.mqttTopic} [${binding.jsonField}] → ${binding.targetUuid} (${binding.label || binding.id}, keepalive ${keepaliveMs / 1000}s)`);
  }
}

/**
 * Clean up all binding subscription handlers.
 */
export function cleanupBindings({ mqttService, handlerMap, lastSendMap }) {
  if (!mqttService) return;
  for (const [, entry] of handlerMap) {
    mqttService.removeListener('message', entry.handler);
  }
  handlerMap.clear();
  lastSendMap.clear();
}
