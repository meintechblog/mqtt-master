/**
 * Loxone WebSocket client with binary protocol parser and reconnection.
 *
 * Connects to a Loxone Miniserver via WebSocket, parses binary state
 * events (value events, text events), sends keepalive, and reconnects
 * with exponential backoff on disconnect.
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

/** Binary message identifier types */
const IDENT = {
  TEXT_EVENT: 0x02,   // Identifier 2 = text event (but Loxone uses 2 for value events)
  VALUE_EVENT: 0x02,  // Value events
  TEXT_STATE: 0x03,   // Text state events
  KEEPALIVE: 0x06,    // Keepalive response
};

// Actually, Loxone protocol:
// 0x00 = text message
// 0x01 = binary file
// 0x02 = value states (24-byte chunks)
// 0x03 = text states
// 0x04 = daytimer states
// 0x05 = out-of-service indicator
// 0x06 = keepalive response
// 0x07 = weather states

const HEADER_SIZE = 8;
const VALUE_EVENT_SIZE = 24;
const KEEPALIVE_INTERVAL = 60_000;
const KEEPALIVE_TIMEOUT = 15_000;
const MAX_BACKOFF = 30_000;
const CONNECT_TIMEOUT = 10_000;

export class LoxoneWs extends EventEmitter {
  /**
   * @param {{ host: string, port: number, user: string, pass: string }} opts
   */
  constructor({ host, port, user, pass }) {
    super();
    this._host = host;
    this._port = port;
    this._user = user;
    this._pass = pass;

    /** @type {WebSocket|null} */
    this._ws = null;
    this._state = 'HEADER';
    this._pendingHeader = null;
    this._connected = false;
    this._reconnectAttempt = 0;
    this._shouldReconnect = true;

    // Timers
    this._keepaliveInterval = null;
    this._keepaliveTimeout = null;
    this._reconnectTimer = null;
  }

  /**
   * Build WebSocket URL with credentials.
   * @returns {string}
   */
  _buildUrl() {
    return `ws://${this._host}:${this._port}/ws/rfc6455`;
  }

  /**
   * Connect to the Miniserver WebSocket.
   * Resolves when connected or rejects after timeout.
   * @returns {Promise<void>}
   */
  async connect() {
    this._shouldReconnect = true;
    return this._doConnect(false);
  }

  /**
   * @param {boolean} isReconnect
   * @returns {Promise<void>}
   */
  _doConnect(isReconnect) {
    return new Promise((resolve, reject) => {
      const url = this._buildUrl();
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, CONNECT_TIMEOUT);

      try {
        const auth = Buffer.from(`${this._user}:${this._pass}`).toString('base64');
        this._ws = new WebSocket(url, 'remotecontrol', {
          headers: {
            'Authorization': `Basic ${auth}`,
          },
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
        return;
      }

      this._ws.on('open', () => {
        clearTimeout(timeout);
        this._connected = true;
        this._reconnectAttempt = 0;
        this._state = 'HEADER';
        this._pendingHeader = null;

        // Enable binary status updates
        this._ws.send('jdev/sps/enablebinstatusupdate');

        // Start keepalive
        this._startKeepalive();

        this.emit(isReconnect ? 'reconnected' : 'connected');
        resolve();
      });

      this._ws.on('message', (data, isBinary) => {
        this._onMessage(data, isBinary);
      });

      this._ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        const wasConnected = this._connected;
        this._connected = false;
        this._stopTimers();
        this.emit('disconnected');

        if (!wasConnected) {
          // Never reached 'open' — connection was rejected
          reject(new Error(`WebSocket closed before open (code: ${code})`));
          return;
        }

        if (this._shouldReconnect) {
          this._scheduleReconnect();
        }
      });

      this._ws.on('error', (err) => {
        clearTimeout(timeout);
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
        // Reject the promise if we haven't connected yet
        if (!this._connected) {
          reject(err);
        }
      });
    });
  }

  /**
   * Disconnect cleanly, stopping all timers.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._shouldReconnect = false;
    this._stopTimers();

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._ws) {
      return new Promise((resolve) => {
        if (this._ws.readyState === WebSocket.CLOSED) {
          this._ws = null;
          resolve();
          return;
        }
        this._ws.once('close', () => {
          this._ws = null;
          resolve();
        });
        this._ws.close();
      });
    }
  }

  /**
   * Send a text command to the Miniserver.
   * @param {string} cmd
   */
  sendCommand(cmd) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(cmd);
    }
  }

  /**
   * Handle incoming WebSocket message.
   * Routes binary messages through the state machine, text to textMessage event.
   * @param {Buffer} data
   * @param {boolean} isBinary
   */
  _onMessage(data, isBinary) {
    if (!isBinary) {
      this.emit('textMessage', data.toString());
      return;
    }

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (this._state === 'HEADER') {
      if (buf.length < HEADER_SIZE) return;

      const header = this._processHeader(buf);
      this._pendingHeader = header;

      if (header.identifier === 0x06) {
        // Keepalive response -- reset watchdog
        this._resetKeepaliveWatchdog();
        if (header.length === 0) {
          // No payload expected, stay in HEADER state
          this._state = 'HEADER';
          this._pendingHeader = null;
          return;
        }
      }

      if (header.length === 0) {
        // No payload, stay in HEADER
        this._state = 'HEADER';
        this._pendingHeader = null;
        return;
      }

      this._state = 'PAYLOAD';
    } else if (this._state === 'PAYLOAD') {
      this._processPayload(buf);
      this._state = 'HEADER';
      this._pendingHeader = null;
    }
  }

  /**
   * Parse 8-byte binary header.
   * @param {Buffer} buffer
   * @returns {{ identifier: number, length: number }}
   */
  _processHeader(buffer) {
    const identifier = buffer[1];
    const length = buffer.readUInt32LE(4);
    return { identifier, length };
  }

  /**
   * Dispatch payload based on pending header identifier.
   * @param {Buffer} buffer
   */
  _processPayload(buffer) {
    if (!this._pendingHeader) return;

    switch (this._pendingHeader.identifier) {
      case 0x02: // Value events
        this._parseValueEvents(buffer);
        break;
      case 0x03: // Text events
        this._parseTextEvents(buffer);
        break;
      default:
        // Other types (daytimer, weather, etc.) -- silently skip
        break;
    }
  }

  /**
   * Parse value event payload: 24-byte chunks (16-byte UUID + 8-byte double).
   * @param {Buffer} buffer
   */
  _parseValueEvents(buffer) {
    const count = Math.floor(buffer.length / VALUE_EVENT_SIZE);
    const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);

    for (let i = 0; i < count; i++) {
      const offset = i * VALUE_EVENT_SIZE;
      const uuid = this._uuidFromBuffer(buffer, offset);
      const value = dv.getFloat64(offset + 16, true); // littleEndian
      this.emit('valueEvent', { uuid, value });
    }
  }

  /**
   * Parse text event payload: 16-byte UUID + 4-byte padding + 4-byte textLen + UTF-8 text.
   * @param {Buffer} buffer
   */
  _parseTextEvents(buffer) {
    let offset = 0;

    while (offset < buffer.length) {
      if (offset + 24 > buffer.length) break; // minimum: 16 UUID + 4 padding + 4 length

      const uuid = this._uuidFromBuffer(buffer, offset);
      offset += 16;

      // 4 bytes padding (icon UUID reference -- unused)
      offset += 4;

      // 4 bytes text length (LE uint32)
      const textLen = buffer.readUInt32LE(offset);
      offset += 4;

      if (offset + textLen > buffer.length) break;

      // Read text as null-terminated UTF-8
      let text = buffer.toString('utf-8', offset, offset + textLen);
      // Strip null terminator if present
      const nullIdx = text.indexOf('\0');
      if (nullIdx >= 0) text = text.substring(0, nullIdx);

      this.emit('textEvent', { uuid, text });
      offset += textLen;

      // Align to 4-byte boundary
      const remainder = offset % 4;
      if (remainder > 0) offset += 4 - remainder;
    }
  }

  /**
   * Read 16 bytes as a formatted UUID string with Loxone-specific byte order.
   * First 3 groups: little-endian (4 bytes, 2 bytes, 2 bytes)
   * Last 2 groups: big-endian (2 bytes, 6 bytes)
   * @param {Buffer} buf
   * @param {number} offset
   * @returns {string}
   */
  _uuidFromBuffer(buf, offset) {
    // Group 1: 4 bytes LE
    const g1 = buf.readUInt32LE(offset).toString(16).padStart(8, '0');
    // Group 2: 2 bytes LE
    const g2 = buf.readUInt16LE(offset + 4).toString(16).padStart(4, '0');
    // Group 3: 2 bytes LE
    const g3 = buf.readUInt16LE(offset + 6).toString(16).padStart(4, '0');
    // Group 4: 2 bytes BE
    const g4 = buf.readUInt16BE(offset + 8).toString(16).padStart(4, '0');
    // Group 5: 6 bytes BE -- read as hex string
    const g5 = buf.slice(offset + 10, offset + 16).toString('hex').padStart(12, '0');

    return `${g1}-${g2}-${g3}-${g4}-${g5}`;
  }

  /**
   * Start keepalive interval (sends "keepalive" every 60s).
   */
  _startKeepalive() {
    this._stopTimers();
    this._keepaliveInterval = setInterval(() => {
      this.sendCommand('keepalive');
      this._startKeepaliveWatchdog();
    }, KEEPALIVE_INTERVAL);
  }

  /**
   * Start watchdog timer for keepalive response.
   */
  _startKeepaliveWatchdog() {
    if (this._keepaliveTimeout) clearTimeout(this._keepaliveTimeout);
    this._keepaliveTimeout = setTimeout(() => {
      // No keepalive response -- connection is dead
      if (this._ws) {
        this._ws.close();
      }
    }, KEEPALIVE_TIMEOUT);
  }

  /**
   * Reset the keepalive watchdog (response received).
   */
  _resetKeepaliveWatchdog() {
    if (this._keepaliveTimeout) {
      clearTimeout(this._keepaliveTimeout);
      this._keepaliveTimeout = null;
    }
  }

  /**
   * Stop keepalive and watchdog timers.
   */
  _stopTimers() {
    if (this._keepaliveInterval) {
      clearInterval(this._keepaliveInterval);
      this._keepaliveInterval = null;
    }
    this._resetKeepaliveWatchdog();
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  _scheduleReconnect() {
    const delay = this._calcBackoff(this._reconnectAttempt);
    this._reconnectAttempt++;

    this._reconnectTimer = setTimeout(async () => {
      try {
        await this._doConnect(true);
      } catch {
        // Connection failed, will trigger close event -> reschedule
      }
    }, delay);
  }

  /**
   * Calculate backoff delay with jitter.
   * @param {number} attempt
   * @returns {number} delay in ms
   */
  _calcBackoff(attempt) {
    const base = Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF);
    const jitter = Math.floor(Math.random() * 1000);
    return base + jitter;
  }
}
