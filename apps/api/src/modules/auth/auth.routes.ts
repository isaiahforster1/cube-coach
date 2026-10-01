import type { FastifyInstance } from 'fastify';
import { loginRequestSchema, registerRequestSchema } from '@cube-coach/shared';
import { currentUser } from '../../plugins/authenticate.js';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './auth.cookie.js';
import type { AuthService } from './auth.service.js';
import { toPublicUser } from './auth.service.js';
import type { EmailVerificationService } from './email-verification.js';

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  emailVerification: EmailVerificationService | null,
  credentialMax: number,
): void {
  const isProduction = app.config.NODE_ENV === 'production';

  /**
   * Stricter limits on the endpoints that accept credentials.
   *
   * Password hashing is deliberately expensive, which makes these endpoints the most
   * attractive target both for credential stuffing and for simply exhausting the
   * server's CPU. Rate limiting is what stops a slow hash becoming a denial of service.
   */
  const credentialRateLimit = {
    config: {
      rateLimit: {
        max: credentialMax,
        timeWindow: '15 minutes',
      },
    },
  };

  app.post('/auth/register', credentialRateLimit, async (request, reply) => {
    // Parsed rather than trusted. Zod strips unknown fields, so a request cannot smuggle
    // in extra properties, and it normalises the email before it reaches the service.
    const input = registerRequestSchema.parse(request.body);

    const { user, token } = await authService.register(
      input,
      request.headers['user-agent'] ?? null,
    );

    // A failure to send is logged, not returned. The account works without verification
    // (ADR-0012), and a provider outage should not turn new users away; they can ask for
    // the link again.
    if (emailVerification !== null) {
      try {
        await emailVerification.sendLink(user);
      } catch (error) {
        request.log.error({ err: error }, 'Could not send the verification email');
      }
    }

    setSessionCookie(reply, token, isProduction);
    return reply.status(201).send({ user: toPublicUser(user) });
  });

  app.post('/auth/login', credentialRateLimit, async (request, reply) => {
    const input = loginRequestSchema.parse(request.body);

    const { user, token } = await authService.login(input, request.headers['user-agent'] ?? null);

    setSessionCookie(reply, token, isProduction);
    return reply.send({ user: toPublicUser(user) });
  });

  /**
   * Logging out revokes the session server-side, not just in the browser.
   *
   * Clearing the cookie alone would leave a working token in the hands of anyone who
   * had copied it. Because sessions are stored rather than self-contained, revocation
   * is immediate — which is the main practical advantage over a JWT.
   *
   * It responds 204 whether or not the token was valid: there is nothing useful to tell
   * a caller about a token that was already gone, and saying so would leak whether a
   * given token ever existed.
   */
  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];

    if (token !== undefined && token !== '') {
      await authService.logout(token);
    }

    clearSessionCookie(reply, isProduction);
    return reply.status(204).send();
  });

  /**
   * Sign out everywhere: after a lost device or a suspected compromise, end every login
   * the user cannot see.
   *
   * Unlike logout, this requires a valid session. It acts on an account rather than on a
   * token, so it has to know whose — and it must not let anyone sign anyone else out.
   */
  app.post('/auth/logout-all', { preHandler: app.requireAuth }, async (request, reply) => {
    await authService.logoutEverywhere(currentUser(request).id);

    clearSessionCookie(reply, isProduction);
    return reply.status(204).send();
  });

  app.get('/auth/me', { preHandler: app.requireAuth }, (request) => ({
    user: toPublicUser(currentUser(request)),
  }));
}
