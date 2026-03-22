import { html, render } from 'htm/preact';
import { signal, computed } from '@preact/signals';
import { Sidebar, menuOpen, toggleMenu } from './components/sidebar.js';
import { Hamburger } from './components/hamburger.js';
import { Dashboard } from './pages/dashboard.js';
import { Messages } from './pages/messages.js';
import { PluginConfig } from './pages/plugin-config.js';
import { LoxoneControls } from './pages/loxone-controls.js';
import { TopicRoutes } from './pages/topic-routes.js';
import { NotFound } from './pages/not-found.js';

const currentHash = signal(window.location.hash || '#/dashboard');

// Set default hash if none present
if (!window.location.hash) {
  window.location.hash = '#/dashboard';
}

// Listen for hash changes
window.addEventListener('hashchange', () => {
  currentHash.value = window.location.hash;
  menuOpen.value = false;
});

// Static route map
const routes = {
  '#/dashboard': Dashboard,
  '#/messages': Messages,
};

/**
 * Resolve route: static routes first, then #/plugins/:id pattern, then NotFound.
 * Returns { component, props } to support parameterized routes.
 */
const currentRoute = computed(() => {
  const hash = currentHash.value;

  // Static routes
  if (routes[hash]) {
    return { component: routes[hash], props: {} };
  }

  // Loxone-specific sub-pages
  if (hash === '#/loxone/controls') {
    return { component: LoxoneControls, props: {} };
  }
  if (hash === '#/loxone/routes') {
    return { component: TopicRoutes, props: {} };
  }

  // Dynamic plugin route: #/plugins/:id
  if (hash.startsWith('#/plugins/')) {
    const pluginId = hash.slice('#/plugins/'.length);
    if (pluginId) {
      return { component: PluginConfig, props: { pluginId } };
    }
  }

  return { component: NotFound, props: {} };
});

function App() {
  const { component: Page, props } = currentRoute.value;
  return html`
    <${Hamburger} onClick=${toggleMenu} />
    <div class="app-layout">
      <${Sidebar} currentHash=${currentHash} />
      <main class="content">
        <${Page} ...${props} />
      </main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
