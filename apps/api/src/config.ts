import { z } from 'zod';

/** A `.env` line like `NAME=` reads as `''`. For an optional variable that means unset. */
const blankAsUnset = (value: unknown) => (value === '' ? undefined : value);

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
   * Email through Resend, used for verification links. Optional: without it, development
   * writes emails to the log, and production offers no verification (see ADR-0019).
   */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** The sender, on a domain verified in Resend, e.g. `CubeCoach <verify@mail.example>`. */
  EMAIL_FROM: z.string().min(1).optional(),

  /**
   * The public address of the app, for building absolute links in emails.
   *
   * Configured rather than taken from the request's Host header, which the client
   * controls: a link built from it would let anyone send our users to their own site.
   */
  APP_URL: z.url().optional(),

  /**
   * Where the built web client lives, for the production server that hosts both.
   *
   * Left unset in development, where Vite serves the client on its own port. See
   * ADR-0017 for why they share an origin in production.
   */
  WEB_ROOT: z.string().optional(),

  /**
   * The model that rewrites each solver step's explanation (ADR-0022 §4). Optional: with
   * no key every step gets the template, which is the whole feature in CI and on a fresh
   * clone. An empty value counts as unset, so `GEMINI_API_KEY=` in a `.env` cannot turn
   * the model on with a blank key.
   *
   * The key's Google Cloud project must have no billing linked. That is what keeps the
   * free tier a hard limit instead of a bill.
   */
  GEMINI_API_KEY: z.preprocess(blankAsUnset, z.string().optional()),
  /** Pinned, not a `-latest` alias, so a measurement can be repeated on the same model. */
  EXPLANATION_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  /**
   * Model calls per process per UTC day. Just under the free tier's 500 a day. Blank means
   * the default: coerced as it is, `''` would become a cap of 0 and turn the model off.
   */
  EXPLANATION_DAILY_CALL_CAP: z.preprocess(
    blankAsUnset,
    z.coerce.number().int().min(0).default(450),
  ),
  /**
   * Model calls any one client may spend per UTC day, out of the cap above, so one client
   * cannot use up everyone's (ADR-0022 §5). About ten solves. At least 1: turning the model
   * off is the global cap's job, or leaving out the key.
   */
  EXPLANATION_CLIENT_DAILY_CALL_CAP: z.preprocess(
    blankAsUnset,
    z.coerce.number().int().min(1).default(50),
  ),

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
const configSchema = environmentSchema
  .superRefine((environment, context) => {
    if (environment.RESEND_API_KEY !== undefined && environment.EMAIL_FROM === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'EMAIL_FROM is required when RESEND_API_KEY is set',
      });
    }
    if (
      environment.NODE_ENV === 'production' &&
      environment.RESEND_API_KEY !== undefined &&
      environment.APP_URL === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'APP_URL is required in production when email is configured',
      });
    }
  })
  .transform((environment) => {
    const developmentDefault =
      environment.NODE_ENV === 'production' ? undefined : DEVELOPMENT_WEB_ORIGIN;
    return {
      ...environment,
      WEB_ORIGIN: environment.WEB_ORIGIN ?? developmentDefault,
      // In development the app is reached through Vite, so that is where links point.
      APP_URL: environment.APP_URL ?? developmentDefault,
    };
  });

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
