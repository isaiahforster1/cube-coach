import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../plugins/error-handler.js';
import { setSessionCookie } from './auth.cookie.js';
import type { AuthService } from './auth.service.js';
import { createOAuthState, createPkceVerifier, pkceChallenge, type GoogleOAuth } from './google.js';

const OAUTH_STATE_COOKIE = 'cube_coach_oauth_state';

/**
 * The flow cookie holds the state and the PKCE verifier together, as `state.verifier`.
 * Both are base64url, whose alphabet has no `.`, so the split is unambiguous.
 */
function readFlowCookie(value: string | undefined): { state: string; verifier: string } | null {
  const parts = value?.split('.');
  if (parts?.length !== 2 || parts[0] === '' || parts[1] === '') return null;
  return { state: parts[0]!, verifier: parts[1]! };
}

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
    const verifier = createPkceVerifier();

    void reply.setCookie(OAUTH_STATE_COOKIE, `${state}.${verifier}`, {
      httpOnly: true,
      secure: isProduction,
      // Google's redirect back to us is a cross-site navigation, and a Lax cookie is sent
      // on top-level GET navigations — which this is. Strict would not come back.
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });

    return reply.redirect(google.authorizationUrl(state, pkceChallenge(verifier)));
  });

  /** Google sends the browser back here with a code. */
  app.get('/auth/google/callback', async (request, reply) => {
    const flow = readFlowCookie(request.cookies[OAUTH_STATE_COOKIE]);
    const parsed = callbackSchema.safeParse(request.query);

    // Clear it either way: a state value is good for exactly one attempt.
    void reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    if (!parsed.success || flow === null || parsed.data.state !== flow.state) {
      return reply.redirect('/login?error=google_state');
    }

    try {
      const profile = await google.fetchProfile(parsed.data.code, flow.verifier);
      const { token } = await authService.signInWithGoogle(
        profile,
        request.headers['user-agent'] ?? null,
      );

      setSessionCookie(reply, token, isProduction);
      // Relative, so the browser stays on the origin it is already on. That is the one
      // origin serving both halves (ADR-0017), and in development it is the Vite proxy.
      // Building this from configuration is how production users were once sent to
      // localhost.
      return reply.redirect('/');
    } catch (error) {
      request.log.error({ err: error }, 'Google sign-in failed');
      // Back to the login page with a marker rather than an API error page: the browser
      // is mid-navigation here, and a JSON body would be shown to the user raw.
      return reply.redirect(`/login?error=${callbackErrorMarker(error)}`);
    }
  });
}

/**
 * The marker the login page turns into a message. Only refusals the user can act on get
 * their own; anything unexpected stays generic, so internals are never described.
 */
function callbackErrorMarker(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'GOOGLE_ACCOUNT_MISMATCH') return 'google_account_mismatch';
    if (error.code === 'GOOGLE_EMAIL_UNVERIFIED') return 'google_unverified';
  }
  return 'google_failed';
}

/** Lets the client know which sign-in options actually exist. */
export function registerAuthProviderRoutes(app: FastifyInstance, googleEnabled: boolean): void {
  app.get('/auth/providers', () => ({ password: true, google: googleEnabled }));
}
