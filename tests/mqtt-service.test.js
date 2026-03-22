import { describe, it, expect, vi } from 'vitest';
import { MqttService } from '../server/services/mqtt-service.js';

describe('MqttService', () => {
  it('constructor sets initial state', () => {
    const svc = new MqttService('mqtt://localhost:1883');
    expect(svc.brokerUrl).toBe('mqtt://localhost:1883');
    expect(svc.connected).toBe(false);
    expect(svc.client).toBeNull();
  });

  it('connect resolves even without broker', async () => {
    const svc = new MqttService('mqtt://127.0.0.1:19999');
    await svc.connect(); // should resolve within timeout, not throw
    expect(svc.isConnected()).toBe(false);
  }, 10000);

  it('isConnected returns false before connect', () => {
    const svc = new MqttService('mqtt://localhost:1883');
    expect(svc.isConnected()).toBe(false);
  });
});
