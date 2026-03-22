import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebSocket from '@fastify/websocket';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConfigService } from './services/config-service.js';
import { MqttService } from './services/mqtt-service.js';
import { SysBrokerService } from './services/sys-broker-service.js';
import wsDashboard from './routes/ws-dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function start(opts = {}) {
  const configPath = opts.configPath || '/opt/mqtt-master/config.json';
  const config = new ConfigService(configPath);
  await config.load();

  const app = Fastify({
    logger: {
      level: config.get('logLevel', 'info'),
    },
  });

  // Static files -- serve webapp/
  await app.register(fastifyStatic, {
    root: join(__dirname, '..', 'webapp'),
    prefix: '/',
  });

  // WebSocket support (registered early, used in Phase 2+)
  await app.register(fastifyWebSocket);

  // MQTT service -- connect to broker
  const mqttService = new MqttService(config.get('mqtt.broker', 'mqtt://localhost:1883'));
  await mqttService.connect();

  // Decorate Fastify with shared services
  app.decorate('mqttService', mqttService);
  app.decorate('configService', config);

  // SysBrokerService -- aggregates $SYS metrics from broker
  const sysBrokerService = new SysBrokerService(mqttService);
  app.decorate('sysBrokerService', sysBrokerService);

  // WebSocket routes
  await app.register(wsDashboard);

  // SPA fallback: serve index.html for unmatched routes
  app.setNotFoundHandler((request, reply) => {
    return reply.sendFile('index.html');
  });

  const port = opts.port || config.get('web.port', 3000);
  const host = opts.host || '0.0.0.0';
  await app.listen({ port, host });

  return app;
}

// Auto-start when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}
