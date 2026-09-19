import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { setSessionCookie } from './auth.cookie.js';
import type { AuthService } from './auth.service.js';
import { createOAuthState, type GoogleOAuth } from './google.js';

const OAUTH_STATE_COOKIE = 'cube_coach_oauth_state';

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export function registerGoogleRoutes(
  app: FastifyInstance,
  authService: AuthService,
  google: GoogleOAuth,
): void {
  const isProduction = app.config.NODE_ENV === 'production';

  /**
   * Start the flow: remember a random value, then send the browser to Google.
   *
   * The state is the CSRF defence. Without it, an attacker could send someone a crafted
   * callback URL carrying their own authorization code, and the victim would silently end
   * up signed into the attacker's account — and then save their solves there.
   */
  app.get('/auth/google', (_request, reply) => {
    const state = createOAuthState();

    void reply.setCookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProduction,
      // Google's redirect back to us is a cross-site navigation, and a Lax cookie is sent
      // on top-level GET navigations — which this is. Strict would not come back.
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });

    return reply.redirect(google.authorizationUrl(state));
  });

  /** Google sends the browser back here with a code. */
  app.get('/auth/google/callback', async (request, reply) => {
    const expected = request.cookies[OAUTH_STATE_COOKIE];
    const parsed = callbackSchema.safeParse(request.query);

    // Clear it either way: a state value is good for exactly one attempt.
    void reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    if (!parsed.success || expected === undefined || parsed.data.state !== expected) {
      return reply.redirect(`${app.config.WEB_ORIGIN}/login?error=google_state`);
    }

    try {
      const profile = await google.fetchProfile(parsed.data.code);
      const { token } = await authService.signInWithGoogle(
        profile,
        request.headers['user-agent'] ?? null,
      );

      setSessionCookie(reply, token, isProduction);
      return reply.redirect(app.config.WEB_ORIGIN);
    } catch (error) {
      request.log.error({ err: error }, 'Google sign-in failed');
      // Back to the login page with a marker rather than an API error page: the browser
      // is mid-navigation here, and a JSON body would be shown to the user raw.
      return reply.redirect(`${app.config.WEB_ORIGIN}/login?error=google_failed`);
    }
  });
}

/** Lets the client know which sign-in options actually exist. */
export function registerAuthProviderRoutes(app: FastifyInstance, googleEnabled: boolean): void {
  app.get('/auth/providers', () => ({ password: true, google: googleEnabled }));
}
