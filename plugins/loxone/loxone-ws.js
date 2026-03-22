/**
 * Loxone WebSocket client with token-based authentication, binary protocol
 * parser, and reconnection.
 *
 * Implements the full Loxone v16.x auth flow:
 *   1. Fetch RSA public key via HTTP
 *   2. Open WebSocket (no auth headers)
 *   3. Generate AES-256-CBC session key + IV
 *   4. RSA-encrypt and exchange session key
 *   5. Request getkey2 for user
 *   6. Compute password hash (SHA1/SHA256)
 *   7. Compute HMAC token hash
 *   8. Request JWT via AES-encrypted command
 *   9. Enable binary status updates
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import http from 'node:http';
import WebSocket from 'ws';

const HEADER_SIZE = 8;
const VALUE_EVENT_SIZE = 24;
const KEEPALIVE_INTERVAL = 60_000;
const KEEPALIVE_TIMEOUT = 15_000;
const MAX_BACKOFF = 30_000;
const CONNECT_TIMEOUT = 30_000;
const CMD_TIMEOUT = 10_000;

const CLIENT_UUID = '098802e1-02b4-603c-ffffeee000d80cfd';
const CLIENT_INFO = 'mqtt-master';

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
    this._authenticated = false;
    this._reconnectAttempt = 0;
    this._shouldReconnect = true;

    // AES session key material
    this._aesKey = null;   // Buffer, 32 bytes
    this._aesIv = null;    // Buffer, 16 bytes
    this._currentSalt = null;
    this._nextSalt = null;
    this._saltUsed = false; // tracks whether the first encrypted cmd has been sent

    // RSA public key (PEM)
    this._publicKey = null;

    // Pending text responses: resolve/reject waiting for LL response
    this._pendingCmd = null;

    // Timers
    this._keepaliveInterval = null;
    this._keepaliveTimeout = null;
    this._reconnectTimer = null;
  }

  /**
   * Build WebSocket URL.
   * @returns {string}
   */
  _buildUrl() {
    return `ws://${this._host}:${this._port}/ws/rfc6455`;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Connect to the Miniserver WebSocket with full token-based auth.
   * @returns {Promise<void>}
   */
  async connect() {
    this._shouldReconnect = true;
    return this._doConnect(false);
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
   * Send a plain text command to the Miniserver (after auth, most commands
   * can be sent unencrypted).
   * @param {string} cmd
   */
  sendCommand(cmd) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(cmd);
    }
  }

  // ---------------------------------------------------------------------------
  // Connection and authentication
  // ---------------------------------------------------------------------------

  /**
   * @param {boolean} isReconnect
   * @returns {Promise<void>}
   */
  async _doConnect(isReconnect) {
    // Step 1: fetch public key via HTTP
    this._publicKey = await this._fetchPublicKey();

    // Step 2: open WebSocket (NO auth headers)
    await this._openWebSocket(isReconnect);

    // Steps 3-9: authenticate
    await this._authenticate();
  }

  /**
   * Fetch the RSA public key from the Miniserver via HTTP.
   * GET /jdev/sys/getPublicKey -- returns X.509/PKCS8 PEM certificate.
   * @returns {Promise<string>} PEM-formatted public key
   */
  _fetchPublicKey() {
    return new Promise((resolve, reject) => {
      const req = http.get(
        `http://${this._host}:${this._port}/jdev/sys/getPublicKey`,
        { timeout: CMD_TIMEOUT },
        (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(body);
              // Response: { LL: { control: "dev/sys/getPublicKey", value: "-----BEGIN CERTIFICATE-----\n...", code: 200 } }
              let pem = json.LL?.value || '';

              // The Miniserver returns the key in various forms. Normalize it.
              // Strip any surrounding quotes
              pem = pem.replace(/^"/, '').replace(/"$/, '');

              // If it's a certificate, extract the public key portion
              // Some firmware returns the raw base64 without headers
              if (!pem.includes('-----BEGIN')) {
                // Raw base64 -- wrap as PKCS8 public key
                const b64 = pem.replace(/\s/g, '');
                pem = `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
              } else if (pem.includes('CERTIFICATE')) {
                // It's an X.509 certificate; Node can extract the public key
                // by using createPublicKey
                pem = pem.replace(/\\n/g, '\n');
              } else {
                pem = pem.replace(/\\n/g, '\n');
              }

              resolve(pem);
            } catch (err) {
              reject(new Error(`Failed to parse public key response: ${err.message}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Public key request timeout')); });
    });
  }

  /**
   * Open the raw WebSocket connection (no auth headers).
   * @param {boolean} isReconnect
   * @returns {Promise<void>}
   */
  _openWebSocket(isReconnect) {
    return new Promise((resolve, reject) => {
      const url = this._buildUrl();
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, CONNECT_TIMEOUT);

      try {
        this._ws = new WebSocket(url, 'remotecontrol');
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
        resolve();
      });

      this._ws.on('message', (data, isBinary) => {
        this._onMessage(data, isBinary);
      });

      this._ws.on('close', (code, _reason) => {
        clearTimeout(timeout);
        const wasConnected = this._connected;
        this._connected = false;
        this._authenticated = false;
        this._stopTimers();
        this.emit('disconnected');

        if (!wasConnected) {
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
        if (!this._connected) {
          reject(err);
        }
      });
    });
  }

  /**
   * Perform the full authentication handshake on an already-open WebSocket.
   * Steps 3-9 from the Loxone token auth spec.
   * @returns {Promise<void>}
   */
  async _authenticate() {
    // Step 3: generate AES session key and IV
    this._aesKey = crypto.randomBytes(32);
    this._aesIv = crypto.randomBytes(16);
    const sessionKeyStr = `${this._aesKey.toString('hex')}:${this._aesIv.toString('hex')}`;

    // Step 4: RSA-encrypt session key and exchange
    const publicKey = crypto.createPublicKey(this._publicKey);
    const encrypted = crypto.publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(sessionKeyStr, 'utf-8'),
    );
    const b64Key = encrypted.toString('base64');

    const keyExResp = await this._sendAndWait(`jdev/sys/keyexchange/${b64Key}`);
    if (keyExResp.code !== '200' && keyExResp.code !== 200) {
      throw new Error(`Key exchange failed: code ${keyExResp.code}`);
    }

    // Step 5: generate salt
    this._currentSalt = crypto.randomBytes(2).toString('hex');
    this._saltUsed = false;

    // Step 6: get key2 (plaintext, NOT encrypted)
    const key2Resp = await this._sendAndWait(`jdev/sys/getkey2/${this._user}`);
    if (key2Resp.code !== '200' && key2Resp.code !== 200) {
      throw new Error(`getkey2 failed: code ${key2Resp.code}`);
    }

    let key2Data;
    if (typeof key2Resp.value === 'string') {
      key2Data = JSON.parse(key2Resp.value);
    } else {
      key2Data = key2Resp.value;
    }

    const serverKey = key2Data.key;    // hex-encoded, decode to ASCII = HMAC key
    const userSalt = key2Data.salt;    // hex-encoded, decode to ASCII
    const hashAlg = (key2Data.hashAlg || 'SHA1').toUpperCase();

    // Decode hex to ASCII strings
    const hmacKeyBuf = Buffer.from(serverKey, 'hex');
    const userSaltStr = Buffer.from(userSalt, 'hex').toString('utf-8');

    // Step 7: compute password hash
    const nodeHashAlg = hashAlg === 'SHA1' ? 'sha1' : 'sha256';
    const pwCombined = `${this._pass}:${userSaltStr}`;
    const pwHash = crypto.createHash(nodeHashAlg)
      .update(pwCombined, 'utf-8')
      .digest('hex')
      .toUpperCase();

    // Step 8: compute HMAC hash
    const hmacInput = `${this._user}:${pwHash}`;
    const hash = crypto.createHmac(nodeHashAlg, hmacKeyBuf)
      .update(hmacInput, 'utf-8')
      .digest('hex');
    // Leave case as-is (do NOT uppercase or lowercase)

    // Step 9: request JWT token (AES-encrypted)
    const permission = 4; // App permission
    const info = encodeURIComponent(CLIENT_INFO);
    const jwtCmd = `jdev/sys/getjwt/${hash}/${this._user}/${permission}/${CLIENT_UUID}/${info}`;

    const jwtResp = await this._sendEncrypted(jwtCmd);
    if (jwtResp.code !== '200' && jwtResp.code !== 200) {
      throw new Error(`getjwt failed: code ${jwtResp.code} — ${JSON.stringify(jwtResp.value)}`);
    }

    this._authenticated = true;

    // Step 10: enable binary status updates
    this.sendCommand('jdev/sps/enablebinstatusupdate');

    // Start keepalive
    this._startKeepalive();

    this.emit('connected');
  }

  // ---------------------------------------------------------------------------
  // AES encryption (ZeroBytePadding, AES-256-CBC)
  // ---------------------------------------------------------------------------

  /**
   * AES-256-CBC encrypt with ZeroBytePadding.
   * @param {string} plaintext
   * @returns {string} base64 ciphertext
   */
  _aesEncrypt(plaintext) {
    const buf = Buffer.from(plaintext, 'utf-8');
    // Pad to multiple of 16 with 0x00
    const padLen = (16 - (buf.length % 16)) % 16;
    const padded = padLen > 0
      ? Buffer.concat([buf, Buffer.alloc(padLen, 0x00)])
      : buf;

    const cipher = crypto.createCipheriv('aes-256-cbc', this._aesKey, this._aesIv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    return encrypted.toString('base64');
  }

  /**
   * Send an AES-encrypted command with salt prefix.
   * First command:  salt/{currentSalt}/{cmd}
   * Subsequent:     nextSalt/{currentSalt}/{nextSalt}/{cmd}
   *
   * After sending, rotate salt.
   *
   * @param {string} cmd
   * @returns {Promise<{code: string|number, value: any}>}
   */
  async _sendEncrypted(cmd) {
    let plaintext;
    if (!this._saltUsed) {
      plaintext = `salt/${this._currentSalt}/${cmd}`;
      this._saltUsed = true;
    } else {
      this._nextSalt = crypto.randomBytes(2).toString('hex');
      plaintext = `nextSalt/${this._currentSalt}/${this._nextSalt}/${cmd}`;
    }

    const cipher = this._aesEncrypt(plaintext);
    const encoded = encodeURIComponent(cipher);
    const resp = await this._sendAndWait(`jdev/sys/enc/${encoded}`);

    // Rotate salt
    if (this._nextSalt) {
      this._currentSalt = this._nextSalt;
      this._nextSalt = null;
    }

    return resp;
  }

  // ---------------------------------------------------------------------------
  // Command send/wait (text responses)
  // ---------------------------------------------------------------------------

  /**
   * Send a text command and wait for the JSON text response from the Miniserver.
   * Loxone sends text responses as JSON: { LL: { control: "...", code: "200", value: ... } }
   * @param {string} cmd
   * @returns {Promise<{code: string|number, value: any, control: string}>}
   */
  _sendAndWait(cmd) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingCmd = null;
        reject(new Error(`Command timeout: ${cmd}`));
      }, CMD_TIMEOUT);

      this._pendingCmd = { resolve, reject, timeout };
      this._ws.send(cmd);
    });
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  /**
   * Handle incoming WebSocket message.
   * Routes binary messages through the state machine, text to response or event.
   * @param {Buffer} data
   * @param {boolean} isBinary
   */
  _onMessage(data, isBinary) {
    if (!isBinary) {
      const text = data.toString();

      // Try to parse as JSON response for pending command
      try {
        const json = JSON.parse(text);
        if (json.LL && this._pendingCmd) {
          const { resolve, timeout } = this._pendingCmd;
          this._pendingCmd = null;
          clearTimeout(timeout);
          resolve({
            control: json.LL.control,
            code: json.LL.code,
            value: json.LL.value,
          });
          return;
        }
      } catch {
        // Not JSON -- fall through
      }

      this.emit('textMessage', text);
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
          this._state = 'HEADER';
          this._pendingHeader = null;
          return;
        }
      }

      if (header.length === 0) {
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

  // ---------------------------------------------------------------------------
  // Keepalive
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Reconnect
  // ---------------------------------------------------------------------------

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  _scheduleReconnect() {
    const delay = this._calcBackoff(this._reconnectAttempt);
    this._reconnectAttempt++;

    this._reconnectTimer = setTimeout(async () => {
      try {
        await this._doConnect(true);
        this.emit('reconnected');
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
