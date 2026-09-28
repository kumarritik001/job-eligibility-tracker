/**
 * Server entry point.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config, isAllowedOrigin } from './config.js';
import { registerRoutes } from './routes/api.js';
import { configureCrawler } from './research/http.js';
import { db, closeDb } from './db/index.js';
import { startScheduler, stopScheduler } from './scheduler.js';

export async function buildServer() {
  // Pretty logs are opt-in via LOG_PRETTY=true because the transport needs
  // pino-pretty installed; a missing optional dev dependency must not stop the
  // server from booting.
  const prettyLogs = process.env.LOG_PRETTY === 'true';
  const base = Fastify({
    logger: {
      level: config.isProd ? 'info' : 'warn',
      transport: prettyLogs ? { target: 'pino-pretty' } : undefined,
    },
    trustProxy: config.isProd,
    bodyLimit: 1_048_576,
  });
  const app = base as typeof base & { jwt: { sign: (payload: object, opts?: object) => string } };

  await app.register(cors, {
    // A function, not a string: the API and the web app are deployed separately,
    // so the allowed set is a list plus optional Vercel preview subdomains.
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: false,
  });

  await app.register(fastifyJwt, { secret: config.jwtSecret, sign: { expiresIn: '30d' } });

  await app.register(rateLimit, {
    max: config.isProd ? 120 : 2000,
    timeWindow: '1 minute',
    keyGenerator: (req) => `${req.ip}:${req.headers.authorization ?? 'anon'}`,
  });

  configureCrawler({ delayMs: config.crawl.requestDelayMs });

  app.setErrorHandler((err: unknown, req, reply) => {
    const fastifyError = err as { statusCode?: number; message?: string };
    const status = typeof fastifyError.statusCode === 'number' && fastifyError.statusCode >= 400
      ? fastifyError.statusCode
      : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    // Never leak internals: the client gets a message it can show the user.
    reply.code(status).send({
      error: status >= 500
        ? 'Something went wrong on the server. Please try again.'
        : (fastifyError.message ?? 'Request failed.'),
    });
  });

  await registerRoutes(app);

  app.get('/', async () => ({
    name: 'Job Eligibility Tracker API',
    health: '/api/health',
    docs: 'See README.md for the endpoint list.',
  }));

  return app;
}

async function main(): Promise<void> {
  // Open the database and apply the schema before accepting traffic.
  db();
  const app = await buildServer();
  startScheduler();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`API on http://localhost:${config.port} (auth: ${config.auth.mode})`);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    stopScheduler();
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const invokedDirectly = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
