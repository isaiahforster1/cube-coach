import { z } from 'zod';

/**
 * The environment this service needs, described as a schema.
 *
 * Validating here means a missing or malformed variable fails immediately at startup
 * with a message naming the variable — rather than surfacing as a confusing error on
 * the first request that happens to need it, possibly hours later in production.
 *
 * It also gives the rest of the codebase a typed config object instead of
 * `process.env.SOMETHING` returning `string | undefined` everywhere.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Ports arrive as strings; coerce so the rest of the code sees a number. */
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),

  HOST: z.string().default('127.0.0.1'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof environmentSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
