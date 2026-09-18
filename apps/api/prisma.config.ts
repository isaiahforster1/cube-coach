import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads the connection URL from schema.prisma. The CLI gets it
// here; the application gets it through a driver adapter in src/db.ts.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file. Fine in CI and in production, where variables come from the
  // environment itself.
}

const databaseUrl = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Spread conditionally rather than passing `url: undefined`. With
  // exactOptionalPropertyTypes, "absent" and "present but undefined" are different
  // things, and this option is declared as optional, not as accepting undefined.
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
});
