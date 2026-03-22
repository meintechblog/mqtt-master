import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoxoneWs } from '../plugins/loxone/loxone-ws.js';

describe('LoxoneWs', () => {
  let ws;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    ws = new LoxoneWs({ host: '192.168.1.10', port: 80, user: 'admin', pass: 'secret' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('UUID binary-to-string conversion', () => {
    it('converts 16-byte buffer to formatted UUID with correct Loxone endianness', () => {
      // Loxone UUID format: first 3 groups little-endian, last 2 big-endian
      // Target UUID: 0fc319af-018e-1139-ffff-b0365ca76014
      // Group 1 (4 bytes LE): 0fc319af -> stored as af 19 c3 0f
      // Group 2 (2 bytes LE): 018e -> stored as 8e 01
      // Group 3 (2 bytes LE): 1139 -> stored as 39 11
      // Group 4 (2 bytes BE): ffff -> stored as ff ff
      // Group 5 (6 bytes BE): b0365ca76014 -> stored as b0 36 5c a7 60 14
      const buf = Buffer.from([
        0xaf, 0x19, 0xc3, 0x0f, // group 1 LE
        0x8e, 0x01,             // group 2 LE
        0x39, 0x11,             // group 3 LE
        0xff, 0xff,             // group 4 BE
        0xb0, 0x36, 0x5c, 0xa7, 0x60, 0x14, // group 5 BE
      ]);

      const uuid = ws._uuidFromBuffer(buf, 0);
      expect(uuid).toBe('0fc319af-018e-1139-ffff-b0365ca76014');
    });

    it('reads UUID at non-zero offset', () => {
      const prefix = Buffer.alloc(4, 0x00);
      const uuidBytes = Buffer.from([
        0xaf, 0x19, 0xc3, 0x0f,
        0x8e, 0x01,
        0x39, 0x11,
        0xff, 0xff,
        0xb0, 0x36, 0x5c, 0xa7, 0x60, 0x14,
      ]);
      const buf = Buffer.concat([prefix, uuidBytes]);

      const uuid = ws._uuidFromBuffer(buf, 4);
      expect(uuid).toBe('0fc319af-018e-1139-ffff-b0365ca76014');
    });
  });

  describe('header parsing', () => {
    it('parses 8-byte header extracting identifier and payload length', () => {
      // Header: byte 0 = 0x03 (fixed), byte 1 = identifier, bytes 2-3 = flags/reserved
      // bytes 4-7 = payload length (uint32 LE)
      const header = Buffer.alloc(8);
      header[0] = 0x03; // fixed type indicator
      header[1] = 0x02; // value event identifier
      header.writeUInt32LE(48, 4); // payload length = 48 bytes (2 value events)

      const parsed = ws._processHeader(header);
      expect(parsed).toEqual({ identifier: 0x02, length: 48 });
    });

    it('parses keepalive response header (identifier 0x06)', () => {
      const header = Buffer.alloc(8);
      header[0] = 0x03;
      header[1] = 0x06;
      header.writeUInt32LE(0, 4);

      const parsed = ws._processHeader(header);
      expect(parsed).toEqual({ identifier: 0x06, length: 0 });
    });

    it('parses text event header (identifier 0x03)', () => {
      const header = Buffer.alloc(8);
      header[0] = 0x03;
      header[1] = 0x03;
      header.writeUInt32LE(100, 4);

      const parsed = ws._processHeader(header);
      expect(parsed).toEqual({ identifier: 0x03, length: 100 });
    });
  });

  describe('value event parsing', () => {
    it('parses 24-byte value event chunks into uuid + value pairs', () => {
      const events = [];
      ws.on('valueEvent', (ev) => events.push(ev));

      // Build a buffer with 2 value events (24 bytes each = 48 bytes)
      const buf = Buffer.alloc(48);

      // Event 1: UUID 0fc319af-018e-1139-ffff-b0365ca76014, value = 23.5
      // UUID bytes (LE for first 3 groups, BE for last 2)
      buf[0] = 0xaf; buf[1] = 0x19; buf[2] = 0xc3; buf[3] = 0x0f; // group 1 LE
      buf[4] = 0x8e; buf[5] = 0x01; // group 2 LE
      buf[6] = 0x39; buf[7] = 0x11; // group 3 LE
      buf[8] = 0xff; buf[9] = 0xff; // group 4 BE
      buf[10] = 0xb0; buf[11] = 0x36; buf[12] = 0x5c; buf[13] = 0xa7; buf[14] = 0x60; buf[15] = 0x14; // group 5 BE
      // Value: 23.5 as float64 LE
      const dv = new DataView(buf.buffer, buf.byteOffset);
      dv.setFloat64(16, 23.5, true); // littleEndian

      // Event 2: UUID 12345678-abcd-ef01-2345-678901234567, value = 1.0
      buf[24] = 0x78; buf[25] = 0x56; buf[26] = 0x34; buf[27] = 0x12; // group 1 LE
      buf[28] = 0xcd; buf[29] = 0xab; // group 2 LE
      buf[30] = 0x01; buf[31] = 0xef; // group 3 LE
      buf[32] = 0x23; buf[33] = 0x45; // group 4 BE
      buf[34] = 0x67; buf[35] = 0x89; buf[36] = 0x01; buf[37] = 0x23; buf[38] = 0x45; buf[39] = 0x67; // group 5 BE
      dv.setFloat64(40, 1.0, true);

      ws._parseValueEvents(buf);

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ uuid: '0fc319af-018e-1139-ffff-b0365ca76014', value: 23.5 });
      expect(events[1]).toEqual({ uuid: '12345678-abcd-ef01-2345-678901234567', value: 1.0 });
    });

    it('handles single value event (24 bytes)', () => {
      const events = [];
      ws.on('valueEvent', (ev) => events.push(ev));

      const buf = Buffer.alloc(24);
      buf[0] = 0x01; buf[1] = 0x00; buf[2] = 0x00; buf[3] = 0x00; // group 1 LE -> 00000001
      buf[4] = 0x02; buf[5] = 0x00; // group 2 LE -> 0002
      buf[6] = 0x03; buf[7] = 0x00; // group 3 LE -> 0003
      buf[8] = 0x00; buf[9] = 0x04; // group 4 BE -> 0004
      buf[10] = 0x00; buf[11] = 0x00; buf[12] = 0x00; buf[13] = 0x00; buf[14] = 0x00; buf[15] = 0x05; // group 5 BE
      const dv = new DataView(buf.buffer, buf.byteOffset);
      dv.setFloat64(16, 42.0, true);

      ws._parseValueEvents(buf);

      expect(events).toHaveLength(1);
      expect(events[0].uuid).toBe('00000001-0002-0003-0004-000000000005');
      expect(events[0].value).toBe(42.0);
    });
  });

  describe('text event parsing', () => {
    it('parses text event: 16-byte UUID + 4-byte padding + 4-byte textLen + UTF-8 text', () => {
      const events = [];
      ws.on('textEvent', (ev) => events.push(ev));

      const textContent = 'Hello Loxone';
      const textBytes = Buffer.from(textContent, 'utf-8');

      // 16 UUID + 4 padding + 4 textLen + text bytes
      const buf = Buffer.alloc(16 + 4 + 4 + textBytes.length);

      // UUID: 0fc319af-018e-1139-ffff-b0365ca76014
      buf[0] = 0xaf; buf[1] = 0x19; buf[2] = 0xc3; buf[3] = 0x0f;
      buf[4] = 0x8e; buf[5] = 0x01;
      buf[6] = 0x39; buf[7] = 0x11;
      buf[8] = 0xff; buf[9] = 0xff;
      buf[10] = 0xb0; buf[11] = 0x36; buf[12] = 0x5c; buf[13] = 0xa7; buf[14] = 0x60; buf[15] = 0x14;

      // 4 bytes padding (icon UUID ref -- unused)
      // Already zeroed

      // 4 bytes text length (LE uint32)
      buf.writeUInt32LE(textBytes.length, 20);

      // Text content
      textBytes.copy(buf, 24);

      ws._parseTextEvents(buf);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        uuid: '0fc319af-018e-1139-ffff-b0365ca76014',
        text: 'Hello Loxone',
      });
    });
  });

  describe('state machine', () => {
    it('transitions from HEADER to PAYLOAD on binary message', () => {
      const events = [];
      ws.on('valueEvent', (ev) => events.push(ev));

      // First message: 8-byte header for value event, payload length = 24
      const header = Buffer.alloc(8);
      header[0] = 0x03;
      header[1] = 0x02; // value event
      header.writeUInt32LE(24, 4); // 24 bytes payload

      // Second message: 24-byte value event payload
      const payload = Buffer.alloc(24);
      payload[0] = 0x01; payload[1] = 0x00; payload[2] = 0x00; payload[3] = 0x00;
      payload[4] = 0x02; payload[5] = 0x00;
      payload[6] = 0x03; payload[7] = 0x00;
      payload[8] = 0x00; payload[9] = 0x04;
      payload[10] = 0x00; payload[11] = 0x00; payload[12] = 0x00; payload[13] = 0x00; payload[14] = 0x00; payload[15] = 0x05;
      const dv = new DataView(payload.buffer, payload.byteOffset);
      dv.setFloat64(16, 99.9, true);

      // Process header first
      ws._onMessage(header, true);
      expect(ws._state).toBe('PAYLOAD');

      // Process payload
      ws._onMessage(payload, true);
      expect(ws._state).toBe('HEADER');
      expect(events).toHaveLength(1);
      expect(events[0].value).toBe(99.9);
    });

    it('emits textMessage for non-binary messages', () => {
      const messages = [];
      ws.on('textMessage', (msg) => messages.push(msg));

      const textData = Buffer.from(JSON.stringify({ LL: { control: 'test', code: 200 } }));
      ws._onMessage(textData, false);

      expect(messages).toHaveLength(1);
    });
  });

  describe('keepalive response handling', () => {
    it('handles keepalive header (identifier 0x06) without expecting payload when length=0', () => {
      const header = Buffer.alloc(8);
      header[0] = 0x03;
      header[1] = 0x06; // keepalive response
      header.writeUInt32LE(0, 4); // no payload

      ws._onMessage(header, true);
      // Should stay in HEADER state (no payload expected)
      expect(ws._state).toBe('HEADER');
    });
  });

  describe('reconnect backoff calculation', () => {
    it('calculates exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s', () => {
      const expected = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
      for (let i = 0; i < expected.length; i++) {
        const delay = ws._calcBackoff(i);
        // Allow jitter of up to 1000ms
        expect(delay).toBeGreaterThanOrEqual(expected[i]);
        expect(delay).toBeLessThanOrEqual(expected[i] + 1000);
      }
    });
  });

  describe('connection URL', () => {
    it('builds correct WebSocket URL with credentials', () => {
      expect(ws._buildUrl()).toBe('ws://admin:secret@192.168.1.10:80/ws/rfc6455');
    });

    it('uses custom port', () => {
      const ws2 = new LoxoneWs({ host: '10.0.0.1', port: 8080, user: 'u', pass: 'p' });
      expect(ws2._buildUrl()).toBe('ws://u:p@10.0.0.1:8080/ws/rfc6455');
    });
  });

  describe('constructor defaults', () => {
    it('initializes in HEADER state', () => {
      expect(ws._state).toBe('HEADER');
    });

    it('starts with reconnect attempt 0', () => {
      expect(ws._reconnectAttempt).toBe(0);
    });

    it('is not connected initially', () => {
      expect(ws._connected).toBe(false);
    });
  });
});
