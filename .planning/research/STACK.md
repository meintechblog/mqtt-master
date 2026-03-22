# Technology Stack

**Project:** MQTT Master -- MQTT Broker Dashboard & Smart Home Bridge
**Researched:** 2026-03-22

## Recommended Stack

### Runtime & Backend

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | 20.x (Debian 13 default) | Runtime | Ships with Debian 13 Trixie via `apt install nodejs` -- zero version management overhead. Fastify 5 targets Node 20+. LTS until April 2026. | HIGH |
| Fastify | 5.8.x | HTTP server, REST API, static files | 2-3x faster than Express. Built-in JSON schema validation. First-class plugin system mirrors our own plugin architecture. Native TypeScript types. WebSocket plugin shares the same server instance -- critical for single-port deployment. | HIGH |
| @fastify/websocket | latest (v11.x) | Dashboard WebSocket | Route-based WS handlers that respect Fastify's hook pipeline. Uses `ws` under the hood. Shares the HTTP server -- no extra port needed for live dashboard updates. | HIGH |
| @fastify/static | 9.x | Serve frontend assets | Serves the Preact dashboard from `/public`. Fast, supports cache headers, no separate file server. | HIGH |

### MQTT

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| mqtt.js | 5.15.x | MQTT client (backend) | The standard Node.js MQTT client. 35M+ weekly npm downloads. Supports MQTT 3.1.1 and 5.0, WebSocket and TCP connections. Connects to Mosquitto on `mqtt://localhost:1883` for bridge operations and `$SYS` topic monitoring. | HIGH |
| Mosquitto | (pre-installed) | MQTT broker | Already running on target. Port 1883 (TCP) + 9001 (WebSocket). We connect to it, not replace it. | HIGH |

### Loxone Integration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| ws | 8.19.x | Loxone WebSocket client | Direct WebSocket connection to Loxone Miniserver. More control than lxcommunicator (last updated 5 years ago). Build token-auth and binary protocol parsing ourselves -- the protocol is well-documented and we avoid depending on an unmaintained wrapper. | MEDIUM |

**Why NOT lxcommunicator:** Loxone's official npm package (`lxcommunicator@1.1.1`) was last published 5 years ago. It bundles its own WebSocket implementation and authentication, but is effectively abandoned -- no updates for modern Node.js, no ESM support. The Loxone WebSocket API protocol is documented; implementing token-auth and binary status parsing with raw `ws` gives us full control, debuggability, and no dead dependency risk.

**Why NOT node-lox-ws-api:** Community library (`0.4.5`), also unmaintained (6 years since last publish). Same reasoning as above -- wrapping an unmaintained library adds risk without saving meaningful effort.

**Fallback:** If token-auth implementation proves complex, lxcommunicator can be used as a reference implementation (read its source, not import it as dependency). The protocol logic is straightforward: HMAC-SHA1 key exchange, AES-256-CBC encrypted commands, JWT-like token refresh.

### Frontend

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Preact | 10.x (stable) | UI framework | 3KB React alternative. No-build workflow with HTM -- serve directly from CDN/vendor. Signals for fine-grained reactivity (perfect for live MQTT message streams). Component model for dashboard widgets. | HIGH |
| HTM | 3.1.x | JSX alternative | Tagged template literals -- JSX-like syntax without a build step. Works natively in browsers. Combined with Preact: ~4KB total. | HIGH |
| @preact/signals | 2.8.x | State management | Fine-grained reactivity without re-rendering entire component trees. Ideal for high-frequency MQTT message updates. Computed signals for derived dashboard metrics. | HIGH |
| CSS (custom, no framework) | -- | Styling | Venus OS Dark Theme requires exact color matching (`#141414`, `#272622`, `#11263B`, etc.). A CSS framework would fight the design system. Custom CSS with CSS custom properties for the palette. CSS Grid + Flexbox for responsive layout. | HIGH |

**Why no build step:** This is a self-hosted appliance on Debian, installed via `wget`. A build step means requiring Node.js tooling at install time or shipping pre-built bundles. The no-build approach means: (1) the installer copies files as-is, (2) contributors can edit and see changes immediately, (3) debugging in production shows real source code. Preact+HTM via import maps makes this viable without sacrificing component architecture.

**Why NOT React:** 40KB+ runtime, requires build tooling (Babel/webpack/Vite) for JSX. Overkill for a dashboard with ~10 views.

**Why NOT Vue/Svelte:** Both require build steps for single-file components. Vue's runtime is 30KB+. Svelte compiles well but mandates a build pipeline.

**Why NOT vanilla JS:** Tempting for a small app, but the plugin system means third-party contributors need a component model. Managing DOM updates for live MQTT streams without reactivity leads to spaghetti. Preact gives structure at near-vanilla cost.

**Why Preact 10.x, NOT 11 beta:** Preact 11 was in beta as of September 2025 with no stable release. Production migrations are explicitly discouraged. Preact 10.x to 11 migration should be straightforward when 11 ships.

### Frontend Delivery (Import Maps)

```html
<script type="importmap">
{
  "imports": {
    "preact": "https://esm.sh/preact@10.25.4",
    "preact/hooks": "https://esm.sh/preact@10.25.4/hooks",
    "@preact/signals": "https://esm.sh/@preact/signals@2.8.2",
    "htm/preact": "https://esm.sh/htm@3.1.1/preact"
  }
}
</script>
```

**For LAN-only / offline operation:** Vendor these files locally. The installer downloads them once during install and serves them from `@fastify/static`. No runtime internet dependency.

### Plugin System

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js dynamic import | (native) | Plugin loading | `import()` for loading plugin modules at runtime. No framework needed -- plugins export a standard interface (`register`, `start`, `stop`, `getStatus`). Fastify's own plugin pattern is the model. | HIGH |
| JSON config files | -- | Plugin configuration | Each plugin has a `config.json`. Dashboard reads/writes via REST API. Simple, no database needed for configuration. | HIGH |

### Data Storage

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| JSON files | -- | Plugin config, topic mappings | No database. Plugin configs are small JSON files. Loxone UUID-to-topic mappings are a single JSON map. Survives restarts, trivially backed up, human-readable. | HIGH |
| In-memory | -- | Live state, metrics | MQTT messages, broker stats, connected clients -- all ephemeral. No persistence needed for real-time dashboard data. Signals/state held in memory, refreshed from broker on reconnect. | HIGH |

**Why NOT SQLite/LevelDB:** The data profile doesn't warrant it. Config is tiny JSON. Live data is ephemeral. Adding a database means a dependency, migration story, and backup complexity -- all for storing what amounts to a few KB of preferences.

### Deployment & Operations

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| systemd | (OS) | Process management | Standard on Debian 13. Auto-start, restart on crash, journal logging. The installer generates a `.service` unit file. | HIGH |
| bash installer | -- | One-command install | `wget -qO- https://raw.githubusercontent.com/.../install.sh \| bash`. Downloads repo, installs Node.js deps, creates systemd service, starts. Already initialized in the GitHub repo. | HIGH |

### Development Tools

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| ESLint | 9.x | Linting | Flat config, modern JS/ESM support. | MEDIUM |
| Vitest | 3.x | Testing | Fast, ESM-native, no config needed for simple setups. Works without build step. | MEDIUM |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Backend framework | Fastify 5 | Express 4/5 | Express is slower, no built-in schema validation, WebSocket requires separate server instance |
| Backend framework | Fastify 5 | Koa | Smaller ecosystem, no plugin system, less community momentum in 2025 |
| Frontend | Preact + HTM (no build) | React + Vite | Requires build tooling, 10x larger runtime, overkill for dashboard |
| Frontend | Preact + HTM (no build) | Vue 3 | Requires build step for SFCs, larger runtime (30KB+) |
| Frontend | Preact + HTM (no build) | Svelte | Requires compiler/build step -- great framework but wrong deployment model |
| Frontend | Preact + HTM (no build) | Alpine.js | No component model for plugins, limited ecosystem for complex UIs |
| Frontend | Preact + HTM (no build) | Vanilla JS | No component model, no reactivity, contributor-hostile for plugin UIs |
| State management | @preact/signals | Redux/Zustand | Signals are built for Preact, lighter, fine-grained (no selector boilerplate) |
| Loxone client | Raw ws + custom auth | lxcommunicator | Abandoned 5 years, bundles old deps, no ESM |
| Loxone client | Raw ws + custom auth | node-lox-ws-api | Abandoned 6 years, wraps deprecated APIs |
| Database | JSON files | SQLite | Unnecessary complexity for tiny config data |
| Process manager | systemd | PM2 | Extra dependency when systemd is already there |
| MQTT client | mqtt.js | MQTT.js alternatives | mqtt.js is the de facto standard, 35M downloads/week |

## Full Dependency List

```bash
# Core runtime (via apt on Debian 13)
sudo apt install nodejs npm

# Production dependencies
npm install fastify@^5.8.0
npm install @fastify/websocket@^11.0.0
npm install @fastify/static@^9.0.0
npm install mqtt@^5.15.0
npm install ws@^8.19.0

# Frontend (vendored, not npm-installed for production)
# Downloaded during install to /public/vendor/
# preact@10.25.4, htm@3.1.1, @preact/signals@2.8.2

# Dev dependencies
npm install -D vitest@^3.0.0
npm install -D eslint@^9.0.0
```

## Architecture Summary

```
[Browser] <--WS (port 3000)--> [Fastify Server] <--MQTT (port 1883)--> [Mosquitto]
    |                               |
    |                               |--WS (Loxone port)--> [Loxone Miniserver]
    |                               |
    +--HTTP (port 3000)----> [@fastify/static: /public]
```

Single port (3000) serves: static frontend, REST API, WebSocket connections.
Backend connects outward to: Mosquitto (MQTT/TCP), Loxone Miniserver (WebSocket).

## Version Pinning Strategy

- **Lock major versions** in `package.json` using `^` (caret) ranges
- **package-lock.json** committed for reproducible installs
- **Frontend vendor files** pinned to exact versions, updated manually during releases
- **Node.js 20.x** -- use Debian's default package, no version manager

## Sources

- [mqtt.js on npm](https://www.npmjs.com/package/mqtt) - v5.15.0, 35M weekly downloads
- [Fastify on npm](https://www.npmjs.com/package/fastify) - v5.8.2, active development
- [Fastify v5 announcement](https://openjsf.org/blog/fastifys-growth-and-success) - Official OpenJS Foundation
- [@fastify/websocket on npm](https://www.npmjs.com/package/@fastify/websocket) - Route-based WebSocket
- [@fastify/static on npm](https://www.npmjs.com/package/@fastify/static) - v9.0.0
- [ws on npm](https://www.npmjs.com/package/ws) - v8.19.0, 35M weekly downloads
- [Preact no-build workflows](https://preactjs.com/guide/v10/no-build-workflows/) - Official documentation
- [Preact signals](https://preactjs.com/guide/v10/signals/) - Official guide
- [htm on npm](https://www.npmjs.com/package/htm) - v3.1.1, tagged templates
- [@preact/signals on npm](https://www.npmjs.com/package/@preact/signals) - v2.8.2
- [Preact 11 beta](https://www.infoq.com/news/2025/09/preact-11-beta/) - Not stable yet, use 10.x
- [lxcommunicator on GitHub](https://github.com/Loxone/lxcommunicator) - Loxone official, v1.1.1, last update 5 years ago
- [node-lox-ws-api on npm](https://www.npmjs.com/package/node-lox-ws-api) - v0.4.5, last update 6 years ago
- [Debian 13 Trixie Node.js package](https://packages.debian.org/trixie/nodejs) - Node.js 20.x default
- [Fastify vs Express benchmarks](https://betterstack.com/community/guides/scaling-nodejs/fastify-express/) - Performance comparison
- [Preact + HTM buildless guide](https://medium.com/@antoniogallo.it/creating-a-buildless-javascript-application-with-preact-htm-and-signal-f99386ad36d4) - No-build workflow walkthrough
