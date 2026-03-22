import { html, render } from 'htm/preact';
import { signal, computed } from '@preact/signals';
import { Sidebar, menuOpen, toggleMenu } from './components/sidebar.js';
import { Hamburger } from './components/hamburger.js';
import { Dashboard } from './pages/dashboard.js';
import { Messages } from './pages/messages.js';
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

// Route map
const routes = {
  '#/dashboard': Dashboard,
  '#/messages': Messages,
};

const currentPage = computed(() => routes[currentHash.value] || NotFound);

function App() {
  const Page = currentPage.value;
  return html`
    <${Hamburger} onClick=${toggleMenu} />
    <div class="app-layout">
      <${Sidebar} currentHash=${currentHash} />
      <main class="content">
        <${Page} />
      </main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
