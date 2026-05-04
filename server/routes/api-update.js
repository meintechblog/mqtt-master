import { getCurrentVersion } from '../services/version-service.js';

export default async function apiUpdate(app) {
  // Lightweight identity endpoint used by the updater script's health probe.
  // Must always answer 200 with a stable shape so `run-update.sh` can compare
  // SHAs after a restart.
  app.get('/api/version', async () => {
    const v = await getCurrentVersion();
    return {
      sha: v.sha,
      shortSha: v.shortSha,
      tag: v.tag,
      version: v.version,
      isDev: v.isDev,
      isDirty: v.isDirty,
      commitDate: v.commitDate || null,
      commitSubject: v.commitSubject || null,
    };
  });

  app.get('/api/update/status', async () => {
    return await app.updateService.getStatus();
  });

  app.post('/api/update/check', async () => {
    return await app.updateService.checkNow({ manual: true });
  });

  app.post('/api/update/run', async (request, reply) => {
    try {
      const result = await app.updateService.runUpdate({ reason: 'manual' });
      return { ok: true, ...result };
    } catch (err) {
      return reply.status(409).send({ ok: false, error: err.message });
    }
  });

  app.get('/api/update/log', async (request) => {
    const lines = Math.min(Math.max(Number(request.query?.lines) || 200, 1), 5000);
    const content = await app.updateService.readUpdaterJournal({ lines });
    return { content, lines };
  });

  app.put('/api/update/settings', async (request, reply) => {
    const { autoApply, autoUpdateHour } = request.body || {};
    try {
      if (autoApply !== undefined) await app.updateService.setAutoApply(!!autoApply);
      if (autoUpdateHour !== undefined) await app.updateService.setAutoUpdateHour(autoUpdateHour);
      return await app.updateService.getStatus();
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
