import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Build a database client.
 *
 * Prisma 7 talks to Postgres through a driver adapter — here the standard `pg`
 * driver — rather than through its own query engine binary. That means one fewer
 * native binary to ship and a connection pool we can configure directly.
 *
 * A factory rather than a shared singleton: tests create their own client, and
 * nothing has to reach for global state to get a database.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}
