import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';

const run = promisify(execFile);

// globalSetup runs before setupFiles, so .env has to be loaded here as well.
try {
  process.loadEnvFile('.env');
} catch {
  // In CI the variables are already in the environment.
}

/**
 * Prepare a real PostgreSQL database for the integration tests, once per run.
 *
 * Tests run against a genuine database rather than a mock. Mocking the database only
 * proves that our assumptions agree with themselves — it cannot catch a wrong query, a
 * missing index, a broken migration, or a constraint that does not behave as expected.
 * Those are precisely the bugs worth catching.
 *
 * A separate database from development, so running the suite never destroys whatever
 * you were working with by hand.
 */
export default async function setup(): Promise<void> {
  const url = process.env['TEST_DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy apps/api/.env.example to .env, and make sure ' +
        'the database is running: `docker compose up -d` from the repository root.',
    );
  }

  await createDatabaseIfMissing(url);

  // `migrate deploy` applies existing migrations without generating new ones, which is
  // what both CI and production do. Using it here means the tests exercise the same
  // migration path that a deployment will.
  // Run the Prisma CLI by handing its JavaScript entry point to Node.
  //
  // The obvious `npx prisma ...` does not work portably here: on Windows the
  // executable is a .cmd shim, which Node refuses to spawn without a shell, and
  // passing arguments through a shell concatenates them unescaped — a command
  // injection risk that Node now warns about. Locating the real entry point avoids
  // both problems and is faster, since it skips npx's resolution step.
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('prisma/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const binary = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['prisma'];
  if (binary === undefined) {
    throw new Error('Could not locate the Prisma CLI entry point');
  }
  const cli = join(dirname(manifestPath), binary);

  await run(process.execPath, [cli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
  });
}

/** Connect to the maintenance database and create the test database if it is absent. */
async function createDatabaseIfMissing(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = target.pathname.replace(/^\//u, '');

  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';

  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();

  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);

    if (existing.rowCount === 0) {
      // Identifiers cannot be parameterised, so the name is quoted instead. It comes
      // from our own configuration rather than from user input.
      await client.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
    }
  } finally {
    await client.end();
  }
}
