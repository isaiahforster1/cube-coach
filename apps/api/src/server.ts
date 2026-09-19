import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrismaClient } from './db.js';

/**
 * Process entry point: load configuration, wire dependencies, listen, and shut down
 * cleanly. All the interesting logic lives in buildApp, which this file only starts.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: variables come from the environment, as they do in production.
}

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
/**
 * In production this process serves the web client as well, from one origin, so the
 * session cookie stays same-site and CORS is not involved at all. The default path is
 * resolved from this file rather than from the working directory, which a platform may
 * set to anything.
 */
const webRoot =
  config.WEB_ROOT ??
  (config.NODE_ENV === 'production'
    ? fileURLToPath(new URL('../../web/dist', import.meta.url))
    : undefined);

const app = await buildApp({
  config,
  prisma,
  ...(webRoot === undefined ? {} : { webRoot }),
});

/**
 * On SIGTERM a platform gives the process a few seconds before killing it. Using them
 * to finish in-flight requests and close the connection pool is the difference between
 * a clean deploy and a handful of users seeing a dropped request.
 */
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  try {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'Failed to shut down cleanly');
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal));
}

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error({ err: error }, 'Failed to start');
  process.exit(1);
}
