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
const app = await buildApp({ config, prisma });

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
