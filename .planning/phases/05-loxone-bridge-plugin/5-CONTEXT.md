# Phase 5: Loxone Bridge Plugin -- Context

**Created:** 2026-03-22
**Phase:** 05-loxone-bridge-plugin

## Vision

Users can bridge their entire Loxone Miniserver into MQTT with human-readable topics, zero manual mapping, and bidirectional control. After entering Miniserver IP and credentials in the webapp, the plugin connects, auto-discovers all controls, and immediately starts publishing state changes and accepting commands via MQTT.

## Decisions

### Locked Decisions

1. **Plugin location**: `plugins/loxone/plugin.js` -- extends the Phase 4 plugin system using the same lifecycle contract (`start(context)`, `stop()`, `getStatus()`, `getConfigSchema()`).

2. **WebSocket client library**: Use the `ws` library (already a dependency) for connecting to `ws://<ip>/ws/rfc6455`. Custom implementation, NOT lxcommunicator or node-lox-ws-api (both abandoned).

3. **Authentication**: HTTP basic auth for initial implementation (sufficient for LAN use and the test Miniserver). Credentials passed as `ws://user:pass@ip/ws/rfc6455`. Token-based JWT auth is deferred to v1.x per FEATURES.md prioritization.

4. **Auto-discovery**: Fetch `LoxAPP3.json` via HTTP (`http://user:pass@ip/data/LoxAPP3.json`) to get all controls, rooms, categories, and UUIDs. Build the UUID-to-topic mapping table in memory.

5. **MQTT topic structure**: `{prefix}/{room}/{control}/state` for outgoing state updates, `{prefix}/{room}/{control}/cmd` for incoming commands. Default prefix is `loxone`. Room and control names are slugified (lowercase, special chars replaced with hyphens, trimmed).

6. **Payload format**: JSON containing `{ value, name, type, uuid, room }` for state updates. Command payloads are plain text forwarded directly to the Miniserver.

7. **Bidirectional bridge**:
   - Loxone to MQTT: Binary state events from WebSocket -> parse UUID -> look up in mapping table -> publish to `{prefix}/{room}/{control}/state`
   - MQTT to Loxone: Subscribe to `{prefix}/+/+/cmd`, parse topic -> reverse lookup UUID -> send `jdev/sps/io/{uuid}/{value}` via WebSocket

8. **Binary protocol**: State machine parser for Loxone binary messages. 8-byte message header (type=0x03, identifier, flags, reserved, 4-byte length). Value events are 24 bytes each (16-byte UUID + 8-byte IEEE 754 double). Text events have 16-byte UUID + 4-byte padding + 4-byte length + UTF-8 string.

9. **Keepalive**: Send `"keepalive"` text command every 60 seconds (well under Loxone's 5-minute timeout). Monitor for 0x06 response.

10. **Reconnection**: Exponential backoff (1s, 2s, 4s, 8s, 16s, cap at 30s) with jitter on WebSocket disconnect. Re-fetch LoxAPP3.json on reconnect to detect config changes.

11. **Config schema**: IP/hostname, port (default 80), username, password, topic prefix (default "loxone"), auto-start boolean, reconnect boolean.

12. **Home Assistant MQTT Discovery**: Publish discovery messages to `homeassistant/{component}/{node_id}/{object_id}/config` for auto-detected Loxone controls. Map common Loxone types to HA components (Switch->switch, Dimmer->light, Jalousie->cover, InfoOnlyAnalog->sensor, InfoOnlyDigital->binary_sensor).

13. **Topic routes**: Users can create forwarding rules between external MQTT topics and Loxone topics. Stored in plugin config. Each route has: source topic, target topic, direction (inbound/outbound), enabled flag.

14. **Control enable/disable**: Per-control toggle stored in plugin config. Disabled controls are not published to MQTT and commands to them are ignored.

### Deferred Ideas

- Token-based JWT auth (LOX-02) -- deferred to v1.x, HTTP basic auth is sufficient for trusted LAN
- Per-plugin log viewer in webapp -- use server logs for now
- Room/category grouping UI -- simple flat table for v1
- Daytimer event parsing -- complex and rarely needed, generic fallback covers it
- Weather event parsing -- same reasoning

### Claude's Discretion

- Internal code organization within `plugins/loxone/` (file splitting)
- Error message wording
- CSS styling details for Loxone-specific UI elements
- Throttling thresholds for high-frequency state updates
- Whether to deduplicate unchanged values before publishing

## Test Environment

- Miniserver IP: `192.168.3.152` (hostname: `mqtt-testserver`)
- Credentials: user=`mqtt-master`, password=`[REDACTED]`
- Test elements:
  - "Helligkeit" -- Virtueller Eingang (virtual input) -- can receive data via MQTT
  - "Anwesenheit" -- Merker (memory flag) -- can read status
  - "Lichtsteuerung" -- Lichtsteuerung (light controller) -- has both inputs and outputs

## Key Interfaces (from Phase 4)

```javascript
// Plugin contract (plugins/example/plugin.js)
export default class Plugin {
  async start(context) {}   // context: { mqttService, configService, logger, pluginId }
  async stop() {}
  getStatus() {}            // returns { running: boolean, ... }
  getConfigSchema() {}      // returns JSON Schema object
}

// MqttService (server/services/mqtt-service.js)
mqttService.subscribe(topic)
mqttService.unsubscribe(topic)
mqttService.publish(topic, payload, opts)
mqttService.on('message', ({ topic, payload, timestamp }) => {})

// ConfigService (server/services/config-service.js)
configService.get('plugins.loxone', {})
configService.set('plugins.loxone', data)
configService.save()

// PluginManager starts plugin with:
instance.start({ mqttService, configService, logger, pluginId: 'loxone' })
```

## Requirements Covered

| Requirement | Plan | Notes |
|-------------|------|-------|
| LOX-01 | 05-01 | WebSocket connection to Miniserver |
| LOX-02 | -- | DEFERRED (token auth) -- using HTTP basic auth instead |
| LOX-03 | 05-01 | LoxAPP3.json auto-discovery |
| LOX-04 | 05-02 | Human-readable MQTT topics for state changes |
| LOX-05 | 05-02 | Bidirectional MQTT commands |
| LOX-06 | 05-02 | JSON payloads with value, name, type, UUID, room |
| LOX-07 | 05-03 | UUID-to-name mapping table in webapp |
| LOX-08 | 05-02 | Config via webapp (uses Phase 4 auto-generated form) |
| LOX-09 | 05-02 | Home Assistant MQTT Discovery messages |
| LOX-10 | 05-03 | Enable/disable individual controls |
| LOX-11 | 05-03 | Topic routes external to Loxone |
| LOX-12 | 05-03 | Topic routes Loxone to external |
| LOX-13 | 05-03 | Topic route config via webapp |

---
*Context for Phase 5: Loxone Bridge Plugin*
*Created: 2026-03-22*
