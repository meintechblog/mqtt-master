import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return html`
    <button class="docs-copy-btn" onClick=${handleCopy} title="Copy">
      ${copied ? 'Copied!' : 'Copy'}
    </button>
  `;
}

function CodeBlock({ code, lang }) {
  return html`
    <div class="docs-code-block">
      <${CopyButton} text=${code} />
      <pre><code>${code}</code></pre>
    </div>
  `;
}

function Section({ id, title, children }) {
  return html`
    <section class="docs-section" id=${id}>
      <h2 class="docs-section-title">${title}</h2>
      ${children}
    </section>
  `;
}

export function Docs() {
  return html`
    <div class="docs-page">
      <h1 class="page-header">Documentation</h1>
      <p class="docs-intro">
        MQTT Master is a real-time web dashboard for managing Mosquitto MQTT brokers and connected devices.
        It supports Loxone Miniservers, Venus OS (Victron), and custom MQTT bridges via a plugin system.
      </p>

      <!-- Table of contents -->
      <nav class="docs-toc">
        <div class="docs-toc-title">Contents</div>
        <a href="#install" class="docs-toc-link">Installation</a>
        <a href="#install-proxmox" class="docs-toc-link docs-toc-sub">Proxmox LXC</a>
        <a href="#install-debian" class="docs-toc-link docs-toc-sub">Debian / Ubuntu</a>
        <a href="#update" class="docs-toc-link">Updating</a>
        <a href="#config" class="docs-toc-link">Configuration</a>
        <a href="#quickstart" class="docs-toc-link">Quick Start</a>
        <a href="#plugins" class="docs-toc-link">Plugins</a>
        <a href="#plugins-loxone" class="docs-toc-link docs-toc-sub">Loxone</a>
        <a href="#plugins-mqtt-bridge" class="docs-toc-link docs-toc-sub">MQTT Bridge</a>
        <a href="#mqtt" class="docs-toc-link">MQTT Topics</a>
        <a href="#api" class="docs-toc-link">REST API</a>
        <a href="#troubleshooting" class="docs-toc-link">Troubleshooting</a>
        <a href="#uninstall" class="docs-toc-link">Uninstall</a>
      </nav>

      <!-- Installation -->
      <${Section} id="install" title="Installation">
        <p>MQTT Master can be installed with a single command. Choose the method that fits your setup.</p>

        <h3 class="docs-h3" id="install-proxmox">Option 1: Proxmox LXC (recommended)</h3>
        <p>
          Run this on your <strong>Proxmox host</strong>. It automatically creates a Debian LXC container
          and installs everything inside — no manual container setup needed.
        </p>
        <${CodeBlock} code="wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install-lxc.sh | bash" />
        <p>You can customize the container with environment variables:</p>
        <${CodeBlock} code=${`CTID=200 CT_HOSTNAME=mqtt CT_MEMORY=1024 CT_DISK=8 \\
  wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install-lxc.sh | bash`} />

        <div class="docs-table-wrap">
          <table class="docs-table">
            <thead><tr><th>Variable</th><th>Default</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td><code>CTID</code></td><td>next free</td><td>Container ID</td></tr>
              <tr><td><code>CT_HOSTNAME</code></td><td>mqtt-master</td><td>Container hostname</td></tr>
              <tr><td><code>CT_MEMORY</code></td><td>1024</td><td>RAM in MB</td></tr>
              <tr><td><code>CT_SWAP</code></td><td>512</td><td>Swap in MB</td></tr>
              <tr><td><code>CT_DISK</code></td><td>8</td><td>Disk size in GB</td></tr>
              <tr><td><code>CT_BRIDGE</code></td><td>vmbr0</td><td>Network bridge</td></tr>
              <tr><td><code>CT_STORAGE</code></td><td>local-lvm</td><td>Storage backend</td></tr>
            </tbody>
          </table>
        </div>

        <h3 class="docs-h3" id="install-debian">Option 2: Direct Install (Debian / Ubuntu)</h3>
        <p>Run this directly on a Debian 12+ or Ubuntu 22.04+ machine:</p>
        <${CodeBlock} code="wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install.sh | bash" />

        <div class="docs-callout docs-callout--info">
          <strong>Note:</strong> If you accidentally run this on a Proxmox host, it will detect PVE and
          abort with a hint to use the LXC installer instead.
        </div>

        <h3 class="docs-h3">What gets installed</h3>
        <ul class="docs-list">
          <li>Node.js 20 LTS</li>
          <li>Mosquitto MQTT broker (port 1883 + WebSocket 9001)</li>
          <li>MQTT Master as systemd service with auto-restart</li>
        </ul>
      </${Section}>

      <!-- Updating -->
      <${Section} id="update" title="Updating">
        <p>Run the same install command again. It detects the existing installation, pulls the latest code, and preserves your config:</p>
        <${CodeBlock} code="wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install.sh | bash" />
        <p>For Proxmox LXC containers, enter the container first:</p>
        <${CodeBlock} code=${`pct enter <CTID>
wget -qO- https://raw.githubusercontent.com/meintechblog/mqtt-master/main/install.sh | bash`} />
      </${Section}>

      <!-- Configuration -->
      <${Section} id="config" title="Configuration">
        <p>The main configuration file is located at:</p>
        <${CodeBlock} code="/opt/mqtt-master/config.json" />
        <p>Default configuration:</p>
        <${CodeBlock} code=${`{
  "mqtt": { "broker": "mqtt://localhost:1883" },
  "web": { "port": 3000 },
  "logLevel": "info"
}`} />

        <div class="docs-table-wrap">
          <table class="docs-table">
            <thead><tr><th>Setting</th><th>Default</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td><code>mqtt.broker</code></td><td>mqtt://localhost:1883</td><td>MQTT broker connection URL</td></tr>
              <tr><td><code>web.port</code></td><td>3000</td><td>Web dashboard port</td></tr>
              <tr><td><code>logLevel</code></td><td>info</td><td>Log level: debug, info, warn, error</td></tr>
            </tbody>
          </table>
        </div>

        <p>After editing, restart the service:</p>
        <${CodeBlock} code="systemctl restart mqtt-master" />

        <h3 class="docs-h3">Service Management</h3>
        <${CodeBlock} code=${`systemctl status mqtt-master     # Check status
systemctl restart mqtt-master    # Restart
systemctl stop mqtt-master       # Stop
journalctl -u mqtt-master -f     # View live logs`} />
      </${Section}>

      <!-- Quick Start -->
      <${Section} id="quickstart" title="Quick Start">
        <ol class="docs-list docs-list--ordered">
          <li>Open the dashboard at <code>http://&lt;server-ip&gt;:3000</code></li>
          <li>Click the <strong>+</strong> button next to "Plugins" in the sidebar</li>
          <li>Choose a plugin type: <strong>Loxone</strong> or <strong>MQTT Bridge</strong></li>
          <li>Enter connection details and click <strong>Save</strong></li>
          <li>Click <strong>Start</strong> to connect the plugin</li>
        </ol>
      </${Section}>

      <!-- Plugins -->
      <${Section} id="plugins" title="Plugins">
        <p>MQTT Master uses a plugin system to connect to different devices and services.</p>

        <h3 class="docs-h3" id="plugins-loxone">Loxone</h3>
        <p>Connects to a Loxone Miniserver via WebSocket. All controls, rooms, and categories are auto-discovered.</p>
        <ul class="docs-list">
          <li><strong>Elements:</strong> Browse all controls with live values. Test commands, copy MQTT topics.</li>
          <li><strong>Mood Mapping:</strong> Map Loxone moods to MQTT topics for room-by-room scene control.</li>
          <li><strong>Input Bindings:</strong> Write MQTT values back to Loxone virtual inputs.</li>
        </ul>
        <div class="docs-callout docs-callout--info">
          <strong>Tip:</strong> All Loxone state changes are published in real-time via MQTT,
          so other systems (Home Assistant, Node-RED, etc.) can subscribe and react immediately.
        </div>

        <h3 class="docs-h3" id="plugins-mqtt-bridge">MQTT Bridge</h3>
        <p>Bridges a remote MQTT broker into your local Mosquitto. Useful for connecting Venus OS (Victron), Zigbee2MQTT, or any other MQTT-based system.</p>
        <ul class="docs-list">
          <li>Choose from presets (Venus OS, Zigbee2MQTT) or configure manually.</li>
          <li><strong>Elements:</strong> Browse all discovered topics from the remote broker with live values.</li>
          <li><strong>Input Bindings:</strong> Map local MQTT topics to remote broker commands.</li>
        </ul>
      </${Section}>

      <!-- MQTT Topics -->
      <${Section} id="mqtt" title="MQTT Topics">
        <p>MQTT Master publishes all data under structured topic hierarchies:</p>
        <${CodeBlock} code=${`# Loxone plugin
mqtt-master/<plugin-id>/status/<room>/<control>    # State values
mqtt-master/<plugin-id>/cmd/<control-uuid>          # Send commands

# MQTT Bridge
mqtt-master/<plugin-id>/bridge/<remote-topic>       # Bridged values`} />
        <p>Use the <strong>Live Messages</strong> page in the sidebar to explore all topics in real-time with wildcard subscriptions.</p>
      </${Section}>

      <!-- REST API -->
      <${Section} id="api" title="REST API">
        <div class="docs-table-wrap">
          <table class="docs-table">
            <thead><tr><th>Endpoint</th><th>Method</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td><code>/api/plugins</code></td><td>GET</td><td>List all plugins with status</td></tr>
              <tr><td><code>/api/plugins/create</code></td><td>POST</td><td>Create a new plugin</td></tr>
              <tr><td><code>/api/plugins/:id</code></td><td>GET</td><td>Get plugin config</td></tr>
              <tr><td><code>/api/plugins/:id</code></td><td>PUT</td><td>Update plugin config</td></tr>
              <tr><td><code>/api/plugins/:id</code></td><td>DELETE</td><td>Delete a plugin</td></tr>
              <tr><td><code>/api/plugins/:id/start</code></td><td>POST</td><td>Start plugin</td></tr>
              <tr><td><code>/api/plugins/:id/stop</code></td><td>POST</td><td>Stop plugin</td></tr>
            </tbody>
          </table>
        </div>
      </${Section}>

      <!-- Troubleshooting -->
      <${Section} id="troubleshooting" title="Troubleshooting">
        <h3 class="docs-h3">Service won't start</h3>
        <${CodeBlock} code=${`journalctl -u mqtt-master --no-pager -n 50
systemctl status mqtt-master`} />

        <h3 class="docs-h3">MQTT broker not reachable</h3>
        <${CodeBlock} code=${`systemctl status mosquitto
mosquitto_sub -t '#' -v    # Test broker locally`} />

        <h3 class="docs-h3">Port already in use</h3>
        <p>Edit <code>/opt/mqtt-master/config.json</code> and change <code>web.port</code>, then restart.</p>

        <h3 class="docs-h3">Loxone plugin shows "error"</h3>
        <ul class="docs-list">
          <li>Check that the Miniserver IP, port, user, and password are correct.</li>
          <li>Ensure the Miniserver is reachable from the MQTT Master machine.</li>
          <li>Check logs: <code>journalctl -u mqtt-master -f</code></li>
        </ul>
      </${Section}>

      <!-- Uninstall -->
      <${Section} id="uninstall" title="Uninstall">
        <h3 class="docs-h3">Direct installation</h3>
        <${CodeBlock} code=${`systemctl stop mqtt-master
systemctl disable mqtt-master
rm /etc/systemd/system/mqtt-master.service
systemctl daemon-reload
rm -rf /opt/mqtt-master
userdel mqtt-master`} />

        <h3 class="docs-h3">Proxmox LXC container</h3>
        <${CodeBlock} code=${`pct stop <CTID>
pct destroy <CTID>`} />
      </${Section}>

      <div class="docs-footer">
        <a href="https://github.com/meintechblog/mqtt-master" target="_blank" rel="noopener" class="docs-footer-link">
          GitHub Repository
        </a>
      </div>
    </div>
  `;
}
