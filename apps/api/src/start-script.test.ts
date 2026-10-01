import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The container's start script: migrate, then serve.
 *
 * Migrations need to create and alter tables; the running application never should. So
 * the migrate step can use a separate, more privileged connection, and the server must
 * not be handed it. These run the real script against a stand-in for Prisma and for the
 * server, each of which records the environment it was given.
 */
const SCRIPT = resolve(import.meta.dirname, '../scripts/start.sh');

function runStartScript(env: Record<string, string>, { migrationFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cube-coach-start-'));
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  mkdirSync(join(root, 'dist'));

  const fakePrisma = join(root, 'node_modules/.bin/prisma');
  writeFileSync(
    fakePrisma,
    `#!/bin/sh\nprintf '%s' "$DATABASE_URL" > migrated-with\n${migrationFails ? 'exit 1\n' : ''}`,
  );
  chmodSync(fakePrisma, 0o755);

  writeFileSync(
    join(root, 'dist/server.js'),
    `require('node:fs').writeFileSync('served-with', JSON.stringify({
      database: process.env.DATABASE_URL,
      migration: process.env.MIGRATION_DATABASE_URL ?? null,
    }));`,
  );
  writeFileSync(join(root, 'package.json'), '{"type":"commonjs"}');

  const result = spawnSync('sh', [SCRIPT], {
    cwd: root,
    env: { PATH: process.env['PATH'] ?? '', ...env },
    encoding: 'utf8',
  });

  const read = (file: string) => {
    try {
      return readFileSync(join(root, file), 'utf8');
    } catch {
      return null;
    }
  };

  return {
    status: result.status,
    migratedWith: read('migrated-with'),
    servedWith: read('served-with'),
  };
}

describe('scripts/start.sh', () => {
  it('migrates with the migration connection when one is given', () => {
    const run = runStartScript({
      DATABASE_URL: 'postgresql://app@db/cubecoach',
      MIGRATION_DATABASE_URL: 'postgresql://owner@db/cubecoach',
    });

    expect(run.status).toBe(0);
    expect(run.migratedWith).toBe('postgresql://owner@db/cubecoach');
  });

  /** The server runs with the restricted role and never holds the privileged one. */
  it('serves with the application connection, and without the migration one', () => {
    const run = runStartScript({
      DATABASE_URL: 'postgresql://app@db/cubecoach',
      MIGRATION_DATABASE_URL: 'postgresql://owner@db/cubecoach',
    });

    expect(JSON.parse(run.servedWith ?? '{}')).toEqual({
      database: 'postgresql://app@db/cubecoach',
      migration: null,
    });
  });

  /** Existing deployments with a single connection string keep working unchanged. */
  it('falls back to DATABASE_URL for migrations', () => {
    const run = runStartScript({ DATABASE_URL: 'postgresql://app@db/cubecoach' });

    expect(run.status).toBe(0);
    expect(run.migratedWith).toBe('postgresql://app@db/cubecoach');
  });

  it('does not start serving if migration fails', () => {
    const run = runStartScript(
      { DATABASE_URL: 'postgresql://app@db/cubecoach' },
      { migrationFails: true },
    );

    expect(run.status).not.toBe(0);
    expect(run.servedWith).toBeNull();
  });
});
