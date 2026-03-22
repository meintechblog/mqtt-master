import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '../server/services/config-service.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const TMP_DIR = '/tmp/mqtt-master-test';

describe('ConfigService', () => {
  beforeEach(async () => {
    await mkdir(TMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  it('returns defaults when config file does not exist', async () => {
    const svc = new ConfigService(join(TMP_DIR, 'nonexistent.json'));
    await svc.load();
    expect(svc.get('mqtt.broker')).toBe('mqtt://localhost:1883');
    expect(svc.get('web.port')).toBe(3000);
  });

  it('merges file config over defaults', async () => {
    const cfgPath = join(TMP_DIR, 'config.json');
    await writeFile(cfgPath, JSON.stringify({ mqtt: { broker: 'mqtt://other:1883' } }));
    const svc = new ConfigService(cfgPath);
    await svc.load();
    expect(svc.get('mqtt.broker')).toBe('mqtt://other:1883');
    expect(svc.get('web.port')).toBe(3000); // default preserved
  });

  it('handles invalid JSON gracefully', async () => {
    const cfgPath = join(TMP_DIR, 'bad.json');
    await writeFile(cfgPath, 'not json');
    const svc = new ConfigService(cfgPath);
    await svc.load(); // should not throw
    expect(svc.get('web.port')).toBe(3000);
  });

  it('get() returns fallback for missing keys', async () => {
    const svc = new ConfigService(join(TMP_DIR, 'nonexistent.json'));
    await svc.load();
    expect(svc.get('nonexistent', 'fallback')).toBe('fallback');
  });

  it('get() traverses nested keys', async () => {
    const svc = new ConfigService(join(TMP_DIR, 'nonexistent.json'));
    await svc.load();
    expect(svc.get('mqtt.broker')).toBe('mqtt://localhost:1883');
  });
});
