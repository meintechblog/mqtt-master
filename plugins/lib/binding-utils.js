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
 * `lastSendMap` is also used to track per-binding live stats consumed by the
 * dashboard: each entry has { value, ts, payloadTs, sendCount, recvCount,
 * lastError, lastErrorAt, lastReason } so the UI can show what's flowing
 * through and why a value didn't propagate (parse error, missing path,
 * dedup, etc.). Older entries with just { value, ts } are migrated lazily.
 *
 * @param {object} opts
 * @param {Array} opts.bindings - binding definitions
 * @param {object} opts.mqttService - local MQTT service
 * @param {object} opts.logger
 * @param {Function} opts.sendToTarget - (uuid, value) => void | Promise
 * @param {Map} opts.handlerMap - Map to store handlers for cleanup
 * @param {Map} opts.lastSendMap - Map to store per-binding stats
 */
export function applyBindings({ bindings, mqttService, logger, sendToTarget, handlerMap, lastSendMap }) {
  cleanupBindings({ mqttService, handlerMap, lastSendMap });

  for (const binding of bindings) {
    if (!binding.enabled || !binding.mqttTopic || !binding.jsonField || !binding.targetUuid) continue;

    const keepaliveMs = binding.keepaliveMs || binding.intervalMs || 30000;
    mqttService.subscribe(binding.mqttTopic);

    const stat = lastSendMap.get(binding.id) || { sendCount: 0, recvCount: 0 };
    lastSendMap.set(binding.id, stat);

    const recordReason = (reason, payloadTs) => {
      stat.recvCount = (stat.recvCount || 0) + 1;
      stat.payloadTs = payloadTs;
      stat.lastReason = reason;
    };

    const handler = (msg) => {
      if (msg.topic !== binding.mqttTopic) return;
      const now = Date.now();
      let data;
      try { data = JSON.parse(msg.payload); }
      catch {
        recordReason('parse_error', now);
        stat.lastError = 'payload is not valid JSON';
        stat.lastErrorAt = now;
        return;
      }
      const raw = extractField(data, binding.jsonField);
      if (raw == null) {
        recordReason('field_missing', now);
        stat.lastError = `path "${binding.jsonField}" not in payload`;
        stat.lastErrorAt = now;
        return;
      }
      let value = applyTransform(raw, binding.transform);
      if (typeof value === 'number') value = Math.round(value * 1000) / 1000;

      const valueChanged = !('value' in stat) || stat.value !== value;
      const keepaliveExpired = !stat.ts || (now - stat.ts >= keepaliveMs);
      if (!valueChanged && !keepaliveExpired) {
        recordReason('dedup', now);
        return;
      }

      // Optimistically record the send attempt first so dedup state stays
      // consistent — then track Promise rejection / sync throw on top.
      stat.value = value;
      stat.ts = now;
      stat.payloadTs = now;
      stat.recvCount = (stat.recvCount || 0) + 1;
      stat.sendCount = (stat.sendCount || 0) + 1;
      stat.lastReason = valueChanged ? 'changed' : 'keepalive';
      stat.lastError = null;
      stat.lastErrorAt = null;
      if (valueChanged) {
        logger.info(`Binding ${binding.label || binding.id}: ${value} → ${binding.targetUuid}`);
      }
      try {
        const result = sendToTarget(binding.targetUuid, String(value));
        // Async sendToTarget returns a Promise — capture rejections so they
        // surface in the stats (otherwise mqtt-bridge → loxone forwarders
        // would silently fail when the loxone plugin can't be reached).
        if (result && typeof result.then === 'function') {
          result.then(() => {}, (err) => {
            stat.lastError = err?.message || String(err);
            stat.lastErrorAt = Date.now();
            stat.lastReason = 'send_error';
            stat.sendCount = Math.max(0, (stat.sendCount || 1) - 1);
            logger.warn?.(`Binding ${binding.label || binding.id} send failed: ${stat.lastError}`);
          });
        }
      } catch (err) {
        stat.lastError = err?.message || String(err);
        stat.lastErrorAt = Date.now();
        stat.lastReason = 'send_error';
        stat.sendCount = Math.max(0, (stat.sendCount || 1) - 1);
        logger.warn?.(`Binding ${binding.label || binding.id} send failed: ${stat.lastError}`);
      }
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
