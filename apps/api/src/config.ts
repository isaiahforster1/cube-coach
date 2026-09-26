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

  /**
   * A web client on a different origin, allowed to call the API with credentials.
   *
   * Only needed when the client and the API are served separately, which is development
   * without the Vite proxy. In production they share one origin (ADR-0017), so this is
   * normally unset there and no cross-origin access is granted at all.
   *
   * CORS must name the origin explicitly. The wildcard `*` is forbidden by the spec
   * whenever credentials are involved, and our session cookie is a credential.
   */
  WEB_ORIGIN: z.url().optional(),

  /**
   * Google sign-in credentials, all optional.
   *
   * When they are absent the routes are not registered and the client does not offer the
   * button at all — better than showing an option that fails when pressed. They come from
   * a Google Cloud OAuth client, which has to be created by hand.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  /**
   * Where the built web client lives, for the production server that hosts both.
   *
   * Left unset in development, where Vite serves the client on its own port. See
   * ADR-0017 for why they share an origin in production.
   */
  WEB_ROOT: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/** Where Vite serves the client in development. */
const DEVELOPMENT_WEB_ORIGIN = 'http://localhost:5173';

/**
 * Defaults that depend on the environment, applied after validation.
 *
 * The web origin default is for development only. It used to apply everywhere, so a
 * production deploy that did not set the variable quietly allowed `localhost:5173` to
 * make credentialed requests, and sent Google sign-ins there.
 */
const configSchema = environmentSchema.transform((environment) => ({
  ...environment,
  WEB_ORIGIN:
    environment.WEB_ORIGIN ??
    (environment.NODE_ENV === 'production' ? undefined : DEVELOPMENT_WEB_ORIGIN),
}));

export type Config = z.infer<typeof configSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
