# Phase 4: Plugin System -- Context

**Date:** 2026-03-22
**Phase Goal:** Users can manage third-party integration plugins through the webapp -- see their status, configure them, and control their lifecycle

## Decisions

### 1. Plugin Structure
Each plugin is a directory under `plugins/` with a `plugin.js` that exports a class with lifecycle methods: `start(context)`, `stop()`, `getStatus()`, `getConfigSchema()`. The context object provides: `mqttService`, `configService`, `logger`.

### 2. Plugin Manager
Server-side PluginManager service that discovers plugins in the `plugins/` directory, loads them via dynamic `import()`, manages lifecycle (start/stop/reload), and tracks status per plugin. Registered as a Fastify decoration like other services.

### 3. Config Schema
Plugins define their config schema as a JSON Schema object returned by `getConfigSchema()`. The frontend auto-generates a form from this schema. Plugin config is stored in the main config.json under `plugins.<pluginId>`.

### 4. REST API
- `GET /api/plugins` -- list all plugins with status
- `POST /api/plugins/:id/start` -- start a plugin
- `POST /api/plugins/:id/stop` -- stop a plugin
- `POST /api/plugins/:id/reload` -- reload a plugin (stop + re-import + start)
- `GET /api/plugins/:id/config` -- get plugin config + schema
- `PUT /api/plugins/:id/config` -- save plugin config

### 5. Sidebar Integration
Sidebar shows a "PLUGINS" section below "BROKER" with each discovered plugin listed as a nav item. Each plugin nav item shows a StatusDot indicating its state: green = running, red = error, gray = stopped.

### 6. Plugin Config Page
New route `/#/plugins/:id` showing:
- Plugin name and status
- Auto-generated config form from JSON Schema
- Start / Stop / Reload buttons
- Status feedback

### 7. No Sandboxing
Plugins run in the same Node.js process. Simple and fast. Security is out of scope for v1 (deferred to v2 PLEC-02).

## Deferred Ideas

- Plugin sandboxing (v2 PLEC-02)
- Plugin registry / install from npm (v2 PLEC-01)
- Plugin log output streaming to webapp

## Claude's Discretion

- Internal error handling strategy for plugin crashes (try/catch around lifecycle calls)
- Whether PluginManager uses an EventEmitter pattern or direct status polling
- Exact JSON Schema subset supported by the auto-generated form (string, number, boolean, integer are sufficient for v1)
