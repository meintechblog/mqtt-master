# Phase 1: Webapp Shell and Core Services - Research

**Researched:** 2026-03-22
**Domain:** Fastify server + Preact/HTM no-build SPA + Venus OS dark theme + hash routing
**Confidence:** HIGH

## Summary

Phase 1 delivers the foundational shell: a Fastify 5 HTTP server serving a Preact/HTM single-page application with Venus OS dark theme styling, sidebar navigation, hash-based routing, and placeholder pages. The backend also initializes core services (MQTT client connection to Mosquitto, config file loading) that subsequent phases build on, though these services are not exposed in the UI yet.

The no-build frontend pattern using Preact + HTM via import maps from esm.sh is well-documented and production-viable. The critical constraint is that Preact must be a singleton -- all modules that depend on Preact must use `?external=preact` in their esm.sh imports to prevent duplicate instances. Hash routing is straightforward to implement manually (listen to `hashchange` event, switch rendered component) without needing a routing library.

**Primary recommendation:** Build the Fastify server with @fastify/static serving the webapp directory, implement a minimal hash router in pure Preact/HTM (no routing library needed for this simple case), and get the Venus OS theme pixel-perfect from the start since every subsequent phase inherits it.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Sidebar navigation: Grouped sections "Broker" (Dashboard, Live Messages), "Plugins" (dynamic entries), "System" (Settings if needed)
- Broker connection status dot (green/red) in sidebar header
- Plugin status dots next to each plugin nav entry (running/stopped/error)
- Always visible on desktop, hamburger menu on mobile (consistent with PV Inverter Proxy)
- Hash routing: `/#/dashboard`, `/#/messages`, `/#/plugins/loxone`
- Each page fills the entire content area with its own layout
- Config file at `/opt/mqtt-master/config.json`
- Configurable in v1: MQTT broker address, web port, log level, plugin directory, topic prefix
- Defaults baked into code, config file overrides
- App should look like it belongs to the same suite as PV Inverter Proxy (192.168.3.191)
- MQTT network icon (nodes connected by lines) as sidebar logo

### Claude's Discretion
- Directory structure (flat vs nested -- Claude picks best fit for a small Node.js app with plugin system)
- Entry point approach (single `server.js` vs `npm start`)
- Exact spacing, typography, and animation details beyond the Venus OS design tokens
- Error state handling for the shell (MQTT disconnect, config errors)
- Whether sidebar is collapsible on desktop (Claude picks based on content density)

### Deferred Ideas (OUT OF SCOPE)
- Loxone Miniserver auto-discovery in LAN -- Phase 5 enhancement
- MQTT topic routing (forward payloads between arbitrary topics) -- already captured as LOX-11/12/13
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | Webapp uses Venus OS Dark Theme (matching PV Inverter Proxy design system) | Venus OS theme tokens fully defined in CONTEXT.md; CSS custom properties pattern with exact hex values; system font stack specified |
| UI-02 | Webapp has sidebar navigation with page switching | Hash routing via `hashchange` event listener; Preact component switching; sidebar with grouped sections pattern |
| UI-03 | Webapp is responsive (desktop, tablet, mobile breakpoints) | CSS Grid + Flexbox; 768px breakpoint for sidebar collapse to hamburger; media queries for tablet/mobile |
| UI-04 | Webapp runs without authentication (open LAN access) | Fastify serves static files with no auth middleware; no login page or session management |
</phase_requirements>

## Standard Stack

### Core (Phase 1 only)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Fastify | 5.8.2 | HTTP server, static files, future API/WS host | Verified on npm 2026-03-22. Single port serves everything. |
| @fastify/static | 9.0.0 | Serve frontend assets from webapp/ directory | Verified on npm 2026-03-22. Fast, cache headers, SPA fallback. |
| @fastify/websocket | 11.2.0 | WebSocket support (Phase 2+ but register now) | Verified on npm 2026-03-22. Must register before routes. |
| mqtt.js | 5.15.0 | MQTT client connecting to Mosquitto on localhost:1883 | Verified on npm 2026-03-22. Connect in Phase 1, expose in Phase 2. |
| Preact | 10.29.0 | UI component framework (via esm.sh CDN, vendored locally) | Verified on npm 2026-03-22. 3KB, no build step. |
| HTM | 3.1.1 | Tagged template JSX alternative | Verified on npm 2026-03-22. Works natively in browsers. |
| @preact/signals | 2.8.2 | Reactive state management | Verified on npm 2026-03-22. Fine-grained reactivity. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual hash router | preact-router or preact-iso | Adds dependency for 5 routes; manual is ~30 lines of code |
| CSS custom properties | Tailwind/Bootstrap | Would fight Venus OS exact color tokens; adds build step or CDN bloat |
| esm.sh CDN | unpkg, jsdelivr, skypack | esm.sh has best `?external` support for singleton Preact; others risk duplicate instances |

**Installation (backend):**
```bash
npm install fastify@^5.8.0 @fastify/static@^9.0.0 @fastify/websocket@^11.2.0 mqtt@^5.15.0
```

**Frontend (vendored during install, not npm):**
Download from esm.sh to `webapp/vendor/` for offline/LAN-only operation.

## Architecture Patterns

### Recommended Project Structure

```
mqtt-master/
├── server/
│   ├── index.js                 # Entry point: create Fastify, register plugins, start
│   ├── services/
│   │   ├── mqtt-service.js      # Shared MQTT client (connect, subscribe, publish, events)
│   │   └── config-service.js    # Load/save /opt/mqtt-master/config.json
│   └── routes/
│       └── (empty for Phase 1 -- API routes added in Phase 2+)
├── webapp/
│   ├── index.html               # SPA shell with import map
│   ├── css/
│   │   └── theme.css            # Venus OS Dark Theme custom properties + base styles
│   ├── js/
│   │   ├── app.js               # Root component, hash router, layout
│   │   ├── components/
│   │   │   ├── sidebar.js       # Navigation sidebar with status dots
│   │   │   ├── hamburger.js     # Mobile menu toggle
│   │   │   └── status-dot.js    # Reusable connection status indicator
│   │   └── pages/
│   │       ├── dashboard.js     # Placeholder -- "Dashboard coming soon"
│   │       ├── messages.js      # Placeholder -- "Live Messages coming soon"
│   │       └── not-found.js     # 404 fallback page
│   └── vendor/
│       ├── preact.mjs           # Vendored from esm.sh
│       ├── preact-hooks.mjs     # Vendored from esm.sh
│       ├── signals.mjs          # Vendored from esm.sh
│       └── htm-preact.mjs       # Vendored from esm.sh
├── config/
│   └── default.json             # Default configuration template
├── scripts/
│   ├── install.sh               # Existing installer (updated in Phase 6)
│   └── mqtt-master.service      # Existing systemd unit (updated in Phase 6)
├── package.json
└── package-lock.json
```

**Rationale:**
- `server/` and `webapp/` are fully separated -- the server never imports from webapp and vice versa
- `webapp/vendor/` holds locally-vendored ESM modules so the app works offline on LAN
- `server/services/` contains singleton services initialized once at startup
- Flat `pages/` directory since there are only 5-6 pages total -- no need for nesting
- `config/default.json` provides defaults; runtime config lives at `/opt/mqtt-master/config.json`

### Pattern 1: Hash Router (Manual, No Library)

**What:** Listen for `hashchange` events, parse the hash, render the matching page component.
**When to use:** Always -- this is the only routing mechanism for the SPA.
**Why manual:** Only 5-6 routes total. A routing library adds complexity and a dependency for no benefit.

```javascript
// webapp/js/app.js
import { html } from 'htm/preact';
import { signal, computed } from '@preact/signals';
import { Sidebar } from './components/sidebar.js';
import { Dashboard } from './pages/dashboard.js';
import { Messages } from './pages/messages.js';
import { NotFound } from './pages/not-found.js';

const currentHash = signal(window.location.hash || '#/dashboard');

window.addEventListener('hashchange', () => {
  currentHash.value = window.location.hash;
});

const routes = {
  '#/dashboard': Dashboard,
  '#/messages': Messages,
};

const currentPage = computed(() => {
  return routes[currentHash.value] || NotFound;
});

export function App() {
  const Page = currentPage.value;
  return html`
    <div class="app-layout">
      <${Sidebar} currentHash=${currentHash} />
      <main class="content">
        <${Page} />
      </main>
    </div>
  `;
}
```

### Pattern 2: Import Map with Singleton Preact

**What:** Use browser-native import maps to resolve bare module specifiers. Mark Preact as external in all dependent packages to prevent duplicate instances.
**Critical:** Preact MUST be a singleton. Duplicate instances cause subtle, hard-to-debug rendering failures.

```html
<!-- webapp/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MQTT Master</title>
  <link rel="stylesheet" href="/css/theme.css">
  <script type="importmap">
  {
    "imports": {
      "preact": "/vendor/preact.mjs",
      "preact/": "/vendor/preact-",
      "preact/hooks": "/vendor/preact-hooks.mjs",
      "@preact/signals": "/vendor/signals.mjs",
      "htm/preact": "/vendor/htm-preact.mjs"
    }
  }
  </script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

### Pattern 3: Venus OS Theme via CSS Custom Properties

**What:** Define all design tokens as CSS custom properties. Components reference tokens, never raw hex values.
**Why:** Single source of truth for the theme. If tokens change, only one file needs updating.

```css
/* webapp/css/theme.css */
:root {
  /* Backgrounds */
  --ve-bg-main: #141414;
  --ve-bg-surface: #272622;
  --ve-bg-widget: #11263B;

  /* Accent colors */
  --ve-blue: #387DC5;
  --ve-orange: #F0962E;
  --ve-red: #F35C58;
  --ve-green: #72B84C;

  /* Text */
  --ve-text-primary: #FAF9F5;
  --ve-text-secondary: #DCDBD7;
  --ve-text-dim: #969591;

  /* Borders & Radius */
  --ve-border: #64635F;
  --ve-radius-lg: 12px;
  --ve-radius-sm: 6px;

  /* Typography */
  --ve-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --ve-font-mono: 'Courier New', monospace;

  /* Layout */
  --ve-sidebar-width: 220px;
  --ve-sidebar-active-border: 3px;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--ve-font-family);
  background: var(--ve-bg-main);
  color: var(--ve-text-primary);
  min-height: 100vh;
}

.app-layout {
  display: flex;
  min-height: 100vh;
}

/* Sidebar */
.sidebar {
  width: var(--ve-sidebar-width);
  background: var(--ve-bg-surface);
  border-right: 1px solid var(--ve-border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
}

.sidebar-nav-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  color: var(--ve-text-secondary);
  text-decoration: none;
  border-left: var(--ve-sidebar-active-border) solid transparent;
  transition: background 0.15s, border-color 0.15s;
}

.sidebar-nav-item:hover {
  background: rgba(56, 125, 197, 0.1);
}

.sidebar-nav-item.active {
  border-left-color: var(--ve-blue);
  background: rgba(56, 125, 197, 0.15);
  color: var(--ve-text-primary);
}

.content {
  margin-left: var(--ve-sidebar-width);
  flex: 1;
  padding: 24px;
}

/* Cards */
.ve-card {
  background: var(--ve-bg-widget);
  border-radius: var(--ve-radius-lg);
  padding: 16px;
}

.ve-panel {
  background: var(--ve-bg-surface);
  border-radius: var(--ve-radius-lg);
  padding: 16px;
}

/* Grid */
.ve-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

/* Status dots */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot--connected { background: var(--ve-green); }
.status-dot--disconnected { background: var(--ve-red); }
.status-dot--error { background: var(--ve-orange); }

/* Responsive: collapse sidebar to hamburger at 768px */
@media (max-width: 768px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.2s ease;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .content {
    margin-left: 0;
  }

  .hamburger {
    display: block;
  }
}

@media (min-width: 769px) {
  .hamburger {
    display: none;
  }
}
```

### Pattern 4: Fastify Server Entry Point

**What:** Single entry point that creates Fastify instance, registers plugins, starts listening.
**Key detail:** Register @fastify/websocket before routes. Serve webapp/ as static root.

```javascript
// server/index.js
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebSocket from '@fastify/websocket';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConfigService } from './services/config-service.js';
import { MqttService } from './services/mqtt-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function start() {
  const config = new ConfigService('/opt/mqtt-master/config.json');
  await config.load();

  const app = Fastify({
    logger: {
      level: config.get('logLevel', 'info'),
    },
  });

  // Static files -- serve webapp/
  await app.register(fastifyStatic, {
    root: join(__dirname, '..', 'webapp'),
    prefix: '/',
  });

  // WebSocket support (registered early, used in Phase 2+)
  await app.register(fastifyWebSocket);

  // MQTT service -- connect to broker
  const mqttService = new MqttService(config.get('mqtt.broker', 'mqtt://localhost:1883'));
  await mqttService.connect();

  // Decorate Fastify with shared services
  app.decorate('mqttService', mqttService);
  app.decorate('configService', config);

  // SPA fallback: serve index.html for unmatched routes
  app.setNotFoundHandler((request, reply) => {
    return reply.sendFile('index.html');
  });

  const port = config.get('web.port', 3000);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`MQTT Master listening on http://0.0.0.0:${port}`);
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
```

### Anti-Patterns to Avoid

- **Importing Preact from multiple CDN URLs:** Always use the import map so there is exactly one Preact instance. Two copies causes hooks to break silently.
- **Inline styles instead of CSS custom properties:** Makes theme changes impossible. Every color must come from a `--ve-*` variable.
- **Creating WebSocket connections per component:** Use a single application-level WebSocket manager (Pitfall 5 from PITFALLS.md).
- **Building a routing library:** 5 routes do not justify a router dependency. A `hashchange` listener + component map is sufficient.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP server | Custom Node.js http.createServer | Fastify 5 | Request parsing, error handling, logging, plugin system |
| Static file serving | fs.readFile + mime type detection | @fastify/static | Cache headers, streaming, range requests, security |
| MQTT client protocol | Raw TCP socket implementation | mqtt.js | MQTT 3.1.1/5.0 protocol, reconnection, QoS handling |
| Reactive UI updates | Manual DOM manipulation | Preact + @preact/signals | Component lifecycle, efficient diffing, state management |
| CSS reset/normalization | Custom reset | `box-sizing: border-box` + minimal reset | Full reset (Normalize.css) is overkill; 5 lines of CSS suffice |

## Common Pitfalls

### Pitfall 1: Preact Singleton Violation
**What goes wrong:** Multiple copies of Preact loaded via different import paths cause hooks to fail silently -- `useState` returns undefined, effects never fire, but no error is thrown.
**Why it happens:** esm.sh bundles dependencies by default. If `htm/preact` and `@preact/signals` each bring their own Preact copy, three instances exist.
**How to avoid:** Use `?external=preact` on all esm.sh URLs for packages that depend on Preact. When vendoring locally, ensure all modules reference the same Preact file via the import map.
**Warning signs:** Hooks return undefined. Components render once but never update. Console shows no errors.

### Pitfall 2: SPA Routing vs Static File Serving Conflict
**What goes wrong:** User navigates to `/#/dashboard`, refreshes the page, and gets a 404 because Fastify tries to serve a file called `dashboard` instead of `index.html`.
**Why it happens:** Hash routes (`#/...`) are client-side only -- the browser never sends the hash to the server. However, if using history API routes (`/dashboard`), Fastify would need a fallback. With hash routing, this is NOT an issue -- but developers sometimes mix approaches.
**How to avoid:** Use hash routing exclusively (`/#/path`). The server always serves `index.html` for the root path, and the hash is handled entirely in the browser. The `setNotFoundHandler` returning `index.html` is a safety net.

### Pitfall 3: WebSocket Connection Leak (from PITFALLS.md #5)
**What goes wrong:** Browser opens WebSocket connections that are never closed on component unmount or page navigation.
**How to avoid:** Manage the WebSocket connection at the app level (singleton), not inside components. Use Preact's `useEffect` cleanup to remove event listeners. Not critical in Phase 1 (no WS yet) but the pattern must be established.

### Pitfall 4: Config File Missing on First Run
**What goes wrong:** Server crashes on startup because `/opt/mqtt-master/config.json` does not exist yet (development environment, first install).
**How to avoid:** ConfigService must handle missing file gracefully -- fall back to defaults. Only write the config file when the user explicitly saves settings. Check `fs.existsSync` before reading, merge with defaults.

### Pitfall 5: Mobile Sidebar Overlay Without Backdrop
**What goes wrong:** Hamburger menu opens sidebar over content on mobile, but tapping outside the sidebar does not close it. Users get stuck with the sidebar open.
**How to avoid:** Add a semi-transparent backdrop overlay when sidebar is open on mobile. Clicking the backdrop closes the sidebar. Also close sidebar on navigation (hash change).

## Code Examples

### Sidebar Component with Status Dots

```javascript
// webapp/js/components/sidebar.js
import { html } from 'htm/preact';
import { signal } from '@preact/signals';

const menuOpen = signal(false);

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

const sections = [
  {
    title: 'Broker',
    items: [
      { label: 'Dashboard', hash: '#/dashboard', icon: 'grid' },
      { label: 'Live Messages', hash: '#/messages', icon: 'message' },
    ],
  },
  {
    title: 'Plugins',
    items: [], // Populated dynamically in Phase 4
  },
  {
    title: 'System',
    items: [
      // Settings added if needed
    ],
  },
];

export function Sidebar({ currentHash }) {
  return html`
    <aside class="sidebar ${menuOpen.value ? 'open' : ''}">
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <!-- MQTT network icon SVG -->
          <svg viewBox="0 0 24 24" width="28" height="28"><!-- nodes-connected icon --></svg>
          <span class="sidebar-title">MQTT Master</span>
        </div>
        <div class="sidebar-status">
          <span class="status-dot status-dot--disconnected"></span>
          <span class="status-label">Broker</span>
        </div>
      </div>
      ${sections.filter(s => s.items.length > 0).map(section => html`
        <div class="sidebar-section">
          <div class="sidebar-section-title">${section.title}</div>
          ${section.items.map(item => html`
            <a
              class="sidebar-nav-item ${currentHash.value === item.hash ? 'active' : ''}"
              href=${item.hash}
              onClick=${() => { menuOpen.value = false; }}
            >
              ${item.label}
            </a>
          `)}
        </div>
      `)}
    </aside>
    ${menuOpen.value && html`
      <div class="sidebar-backdrop" onClick=${toggleMenu}></div>
    `}
  `;
}

export { toggleMenu };
```

### Config Service

```javascript
// server/services/config-service.js
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const DEFAULTS = {
  mqtt: {
    broker: 'mqtt://localhost:1883',
  },
  web: {
    port: 3000,
  },
  logLevel: 'info',
  pluginDir: '/opt/mqtt-master/plugins',
  topicPrefix: 'mqtt-master',
};

export class ConfigService {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = { ...DEFAULTS };
  }

  async load() {
    if (!existsSync(this.configPath)) {
      return; // Use defaults
    }
    try {
      const raw = await readFile(this.configPath, 'utf-8');
      const fileConfig = JSON.parse(raw);
      this.config = this._deepMerge(DEFAULTS, fileConfig);
    } catch (err) {
      console.warn(`Failed to load config from ${this.configPath}, using defaults:`, err.message);
    }
  }

  get(key, fallback) {
    const keys = key.split('.');
    let val = this.config;
    for (const k of keys) {
      if (val == null || typeof val !== 'object') return fallback;
      val = val[k];
    }
    return val !== undefined ? val : fallback;
  }

  _deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this._deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}
```

### MQTT Service (Phase 1 scope: connect only)

```javascript
// server/services/mqtt-service.js
import { EventEmitter } from 'node:events';
import mqtt from 'mqtt';

export class MqttService extends EventEmitter {
  constructor(brokerUrl) {
    super();
    this.brokerUrl = brokerUrl;
    this.client = null;
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.brokerUrl, {
        clientId: `mqtt-master-${Date.now()}`,
        clean: true,
        reconnectPeriod: 5000,
      });

      this.client.on('connect', () => {
        this.connected = true;
        this.emit('connected');
        resolve();
      });

      this.client.on('error', (err) => {
        this.emit('error', err);
      });

      this.client.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });

      this.client.on('message', (topic, payload) => {
        this.emit('message', {
          topic,
          payload: payload.toString(),
          timestamp: Date.now(),
        });
      });

      // Timeout for initial connection
      setTimeout(() => {
        if (!this.connected) {
          resolve(); // Don't block startup if broker is down
        }
      }, 5000);
    });
  }

  subscribe(topic) {
    if (this.client) this.client.subscribe(topic);
  }

  publish(topic, payload, opts) {
    if (this.client) this.client.publish(topic, payload, opts);
  }

  isConnected() {
    return this.connected;
  }
}
```

### Vendoring Frontend Dependencies

```bash
#!/bin/bash
# scripts/vendor-frontend.sh
# Download frontend dependencies for offline LAN operation

VENDOR_DIR="webapp/vendor"
mkdir -p "$VENDOR_DIR"

# Preact core
curl -sL "https://esm.sh/preact@10.29.0?bundle" -o "$VENDOR_DIR/preact.mjs"
# Preact hooks
curl -sL "https://esm.sh/preact@10.29.0/hooks?external=preact&bundle" -o "$VENDOR_DIR/preact-hooks.mjs"
# Preact signals
curl -sL "https://esm.sh/@preact/signals@2.8.2?external=preact&bundle" -o "$VENDOR_DIR/signals.mjs"
# HTM + Preact integration
curl -sL "https://esm.sh/htm@3.1.1/preact?external=preact&bundle" -o "$VENDOR_DIR/htm-preact.mjs"
```

**Note:** The `?external=preact` parameter is critical. Without it, each package bundles its own Preact copy, breaking the singleton requirement.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Webpack/Babel build for Preact | Import maps + esm.sh (no build) | 2023+ | Zero build tooling, edit-and-refresh development |
| React Router for hash routing | Manual hashchange listener | Always viable | No dependency for simple apps |
| CSS frameworks for theming | CSS custom properties | CSS3 (2017+, universal support) | Theme tokens without framework overhead |
| Express.js | Fastify 5 | 2024 | 2-3x faster, built-in validation, plugin system |

**Deprecated/outdated:**
- `preact-router` hash mode has known issues (GitHub issue #414) -- manual hash routing is more reliable
- Preact 11 is still beta as of March 2026 -- use 10.x

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (from STACK.md decision) |
| Config file | None yet -- Wave 0 gap |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Venus OS theme CSS variables load correctly | smoke | Manual browser check -- CSS variables are runtime | N/A |
| UI-02 | Sidebar nav items switch page content on click | e2e | Manual browser check -- DOM interaction required | N/A |
| UI-03 | Layout adapts at 768px breakpoint | e2e | Manual browser resize check | N/A |
| UI-04 | No auth prompts on page load | smoke | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` returns 200 | Wave 0 |
| -- | Fastify server starts and serves index.html | integration | `npx vitest run tests/server.test.js` | Wave 0 |
| -- | ConfigService loads defaults when no file exists | unit | `npx vitest run tests/config-service.test.js` | Wave 0 |
| -- | MqttService connects to broker (or gracefully handles missing broker) | unit | `npx vitest run tests/mqtt-service.test.js` | Wave 0 |
| -- | Hash router maps routes to correct page components | unit | `npx vitest run tests/router.test.js` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] `vitest.config.js` -- test framework configuration
- [ ] `package.json` -- must include vitest as devDependency
- [ ] `tests/server.test.js` -- Fastify server starts and serves static files
- [ ] `tests/config-service.test.js` -- Config loading with missing file, defaults, deep merge
- [ ] `tests/mqtt-service.test.js` -- Connection handling, reconnection, event emission

## Open Questions

1. **Vendored module format from esm.sh**
   - What we know: esm.sh serves ES modules with `?external` support and `?bundle` for self-contained files
   - What's unclear: Whether vendored files with `?bundle` flag correctly resolve import map paths when served locally (the modules may contain hardcoded esm.sh URLs internally)
   - Recommendation: Test vendoring early in Phase 1. If `?bundle` does not work cleanly for local serving, use `?bundle&external=preact` and manually verify imports resolve. Fallback: serve from esm.sh with local caching proxy.

2. **MQTT network icon SVG**
   - What we know: User wants "MQTT network icon (nodes connected by lines)" as sidebar logo
   - What's unclear: No specific SVG provided
   - Recommendation: Create a simple SVG with 3-4 nodes connected by lines, matching the Venus OS icon style (monochrome, outlined). Keep it simple -- 24x24 viewBox.

3. **Sidebar collapsibility on desktop**
   - What we know: Claude's discretion per CONTEXT.md
   - Recommendation: Do NOT make sidebar collapsible on desktop. With only 5-6 nav items, collapsing adds UI complexity (toggle button, collapsed icons, tooltips) with no benefit. Keep it fixed at 220px on desktop, hamburger on mobile.

## Sources

### Primary (HIGH confidence)
- [npm registry: fastify@5.8.2](https://www.npmjs.com/package/fastify) -- version verified 2026-03-22
- [npm registry: @fastify/static@9.0.0](https://www.npmjs.com/package/@fastify/static) -- version verified 2026-03-22
- [npm registry: @fastify/websocket@11.2.0](https://www.npmjs.com/package/@fastify/websocket) -- version verified 2026-03-22
- [npm registry: preact@10.29.0](https://www.npmjs.com/package/preact) -- version verified 2026-03-22
- [Preact No-Build Workflows (official)](https://preactjs.com/guide/v10/no-build-workflows/) -- import map setup, ?external param
- [Preact Signals (official)](https://preactjs.com/guide/v10/signals/) -- reactive state management
- .planning/research/STACK.md -- project technology decisions
- .planning/research/ARCHITECTURE.md -- project structure, component responsibilities

### Secondary (MEDIUM confidence)
- [Preact without build step including routing](https://ricardoanderegg.com/posts/preact-without-build-step-including-routing/) -- routing patterns (uses preact-iso, not hash, but validates no-build approach)
- [Building a TODO app without a bundler](https://dev.to/ekeijl/no-build-todo-app-using-htm-preact-209p) -- HTM syntax patterns
- [React's Best Parts in 5KB: Preact + HTM](https://mfyz.com/react-best-parts-preact-htm-5kb) -- no-build architecture validation
- [Better Stack: Fastify WebSockets guide](https://betterstack.com/community/guides/scaling-nodejs/fastify-websockets/) -- @fastify/websocket setup
- [fastify-websocket README](https://github.com/fastify/fastify-websocket/blob/main/README.md) -- register before routes requirement

### Tertiary (LOW confidence)
- [preact-router hash routing issue #414](https://github.com/preactjs/preact-router/issues/414) -- hash mode has known bugs (confirms avoiding the library)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified on npm, well-documented official patterns
- Architecture: HIGH -- project structure validated against ARCHITECTURE.md and STACK.md research
- Pitfalls: HIGH -- Preact singleton issue well-documented; WebSocket leak from PITFALLS.md
- Theme implementation: HIGH -- exact color tokens provided in CONTEXT.md from real PV Inverter Proxy reference
- Hash routing: HIGH -- simple browser API, no library risk
- Vendoring: MEDIUM -- esm.sh `?bundle&external` behavior for local serving needs validation

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable libraries, no fast-moving dependencies)
