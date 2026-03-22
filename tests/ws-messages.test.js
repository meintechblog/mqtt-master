import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import WebSocket from 'ws';
import wsMessages from '../server/routes/ws-messages.js';

/** Create a mock MqttService (EventEmitter with subscribe/unsubscribe as vi.fn()) */
function createMockMqttService() {
  const mock = new EventEmitter();
  mock.subscribe = vi.fn();
  mock.unsubscribe = vi.fn();
  return mock;
}

/**
 * Connect a WebSocket client that buffers all messages.
 * Returns { ws, messages, waitFor(count), waitForOpen() }.
 */
function createClient(url) {
  const ws = new WebSocket(url);
  const messages = [];
  const waiters = [];

  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (messages.length >= waiters[i].count) {
        waiters[i].resolve([...messages]);
        waiters.splice(i, 1);
      }
    }
  });

  function waitFor(count) {
    if (messages.length >= count) return Promise.resolve([...messages]);
    return new Promise((resolve) => {
      waiters.push({ count, resolve });
    });
  }

  function waitForOpen() {
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
  }

  return { ws, messages, waitFor, waitForOpen };
}

describe('ws-messages', () => {
  let app;
  let mqttService;

  beforeEach(async () => {
    mqttService = createMockMqttService();

    app = Fastify({ logger: false });
    await app.register(fastifyWebSocket);
    app.decorate('mqttService', mqttService);
    await app.register(wsMessages);
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await app.close();
  });

  function wsUrl() {
    const addr = app.server.address();
    return `ws://127.0.0.1:${addr.port}/ws/messages`;
  }

  it('subscribe returns confirmation and calls mqttService.subscribe', async () => {
    const client = createClient(wsUrl());
    await client.waitForOpen();

    client.ws.send(JSON.stringify({ action: 'subscribe', topic: '#' }));
    const msgs = await client.waitFor(1);

    expect(msgs[0]).toEqual({ type: 'subscribed', topic: '#' });
    expect(mqttService.subscribe).toHaveBeenCalledWith('#');
    client.ws.close();
  });

  it('unsubscribe returns confirmation and calls mqttService.unsubscribe', async () => {
    const client = createClient(wsUrl());
    await client.waitForOpen();

    client.ws.send(JSON.stringify({ action: 'subscribe', topic: 'test/#' }));
    await client.waitFor(1);

    client.ws.send(JSON.stringify({ action: 'unsubscribe', topic: 'test/#' }));
    const msgs = await client.waitFor(2);

    expect(msgs[1]).toEqual({ type: 'unsubscribed', topic: 'test/#' });
    expect(mqttService.unsubscribe).toHaveBeenCalledWith('test/#');
    client.ws.close();
  });

  it('forwards matching MQTT messages to subscribed client', async () => {
    const client = createClient(wsUrl());
    await client.waitForOpen();

    client.ws.send(JSON.stringify({ action: 'subscribe', topic: 'test/#' }));
    await client.waitFor(1);

    // Simulate an MQTT message arriving
    mqttService.emit('message', { topic: 'test/foo', payload: 'bar', timestamp: 1234567890 });

    const msgs = await client.waitFor(2);
    expect(msgs[1]).toEqual({
      type: 'message',
      topic: 'test/foo',
      payload: 'bar',
      timestamp: 1234567890,
    });
    client.ws.close();
  });

  it('does not forward messages after unsubscribing', async () => {
    const client = createClient(wsUrl());
    await client.waitForOpen();

    client.ws.send(JSON.stringify({ action: 'subscribe', topic: 'test/#' }));
    await client.waitFor(1);

    client.ws.send(JSON.stringify({ action: 'unsubscribe', topic: 'test/#' }));
    await client.waitFor(2);

    // Emit a message -- client should NOT receive it
    mqttService.emit('message', { topic: 'test/foo', payload: 'bar', timestamp: 999 });

    // Wait a bit and verify no new message arrived
    await new Promise((r) => setTimeout(r, 100));
    expect(client.messages.length).toBe(2); // only subscribed + unsubscribed
    client.ws.close();
  });

  it('client disconnect triggers unsubscribe for all active topics', async () => {
    const client = createClient(wsUrl());
    await client.waitForOpen();

    client.ws.send(JSON.stringify({ action: 'subscribe', topic: 'a/#' }));
    client.ws.send(JSON.stringify({ action: 'subscribe', topic: 'b/#' }));
    await client.waitFor(2);

    client.ws.close();
    await new Promise((r) => setTimeout(r, 100));

    expect(mqttService.unsubscribe).toHaveBeenCalledWith('a/#');
    expect(mqttService.unsubscribe).toHaveBeenCalledWith('b/#');
  });

  it('two clients with different subscriptions get only their own messages', async () => {
    const c1 = createClient(wsUrl());
    const c2 = createClient(wsUrl());
    await c1.waitForOpen();
    await c2.waitForOpen();

    c1.ws.send(JSON.stringify({ action: 'subscribe', topic: 'sensor/#' }));
    c2.ws.send(JSON.stringify({ action: 'subscribe', topic: 'control/#' }));
    await c1.waitFor(1);
    await c2.waitFor(1);

    // Message matching only c1
    mqttService.emit('message', { topic: 'sensor/temp', payload: '22', timestamp: 1 });
    // Message matching only c2
    mqttService.emit('message', { topic: 'control/light', payload: 'on', timestamp: 2 });

    const msgs1 = await c1.waitFor(2);
    const msgs2 = await c2.waitFor(2);

    // c1 got sensor/temp but NOT control/light
    expect(msgs1[1].topic).toBe('sensor/temp');
    expect(msgs1.length).toBe(2);

    // c2 got control/light but NOT sensor/temp
    expect(msgs2[1].topic).toBe('control/light');
    expect(msgs2.length).toBe(2);

    c1.ws.close();
    c2.ws.close();
  });

  it('invalid JSON from client is silently ignored', async () => {
    const client = createClient(wsUrl());
    await client.waitForOpen();

    client.ws.send('not valid json {{{');

    // Should not crash -- send a valid command after
    client.ws.send(JSON.stringify({ action: 'subscribe', topic: 'test' }));
    const msgs = await client.waitFor(1);
    expect(msgs[0].type).toBe('subscribed');
    client.ws.close();
  });

  it('empty topic in subscribe returns error', async () => {
    const client = createClient(wsUrl());
    await client.waitForOpen();

    client.ws.send(JSON.stringify({ action: 'subscribe', topic: '' }));
    const msgs = await client.waitFor(1);

    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message).toBeDefined();
    client.ws.close();
  });

  it('missing topic in subscribe returns error', async () => {
    const client = createClient(wsUrl());
    await client.waitForOpen();

    client.ws.send(JSON.stringify({ action: 'subscribe' }));
    const msgs = await client.waitFor(1);

    expect(msgs[0].type).toBe('error');
    client.ws.close();
  });

  it('MQTT wildcard + matches single level', async () => {
    const client = createClient(wsUrl());
    await client.waitForOpen();

    client.ws.send(JSON.stringify({ action: 'subscribe', topic: 'home/+/temp' }));
    await client.waitFor(1);

    // Should match
    mqttService.emit('message', { topic: 'home/living/temp', payload: '21', timestamp: 1 });
    // Should NOT match (two levels where + expects one)
    mqttService.emit('message', { topic: 'home/living/room/temp', payload: '19', timestamp: 2 });
    // Should NOT match (different suffix)
    mqttService.emit('message', { topic: 'home/living/humidity', payload: '50', timestamp: 3 });

    const msgs = await client.waitFor(2);
    expect(msgs[1].topic).toBe('home/living/temp');

    await new Promise((r) => setTimeout(r, 100));
    expect(client.messages.length).toBe(2); // only subscribed + one match
    client.ws.close();
  });

  it('MQTT wildcard # matches multiple levels', async () => {
    const client = createClient(wsUrl());
    await client.waitForOpen();

    client.ws.send(JSON.stringify({ action: 'subscribe', topic: 'home/#' }));
    await client.waitFor(1);

    mqttService.emit('message', { topic: 'home/living/temp', payload: '21', timestamp: 1 });
    mqttService.emit('message', { topic: 'home/a/b/c', payload: 'deep', timestamp: 2 });
    mqttService.emit('message', { topic: 'office/temp', payload: '20', timestamp: 3 }); // should NOT match

    const msgs = await client.waitFor(3); // subscribed + 2 matches
    expect(msgs[1].topic).toBe('home/living/temp');
    expect(msgs[2].topic).toBe('home/a/b/c');

    await new Promise((r) => setTimeout(r, 100));
    expect(client.messages.length).toBe(3);
    client.ws.close();
  });
});
