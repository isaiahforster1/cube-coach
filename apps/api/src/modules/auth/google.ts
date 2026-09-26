import { createHash, randomBytes } from 'node:crypto';

/** The fields we ask Google for, and the only ones we keep. */
export interface GoogleProfile {
  /** Google's stable subject identifier for this account. */
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string;
}

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GoogleOAuth {
  authorizationUrl(state: string, codeChallenge: string): string;
  fetchProfile(code: string, codeVerifier: string): Promise<GoogleProfile>;
}

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/** A random value tying a callback back to the request that started it. */
export function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A PKCE code verifier (RFC 7636): 32 random bytes, which base64url-encode to 43
 * characters, the minimum the specification allows.
 *
 * PKCE binds the authorization code to whoever started the flow. The code travels through
 * URLs, so it can end up in browser history, proxy logs or a Referer header. The verifier
 * stays in an httpOnly cookie and on this server, and Google will not exchange the code
 * without it — so a leaked code is useless on its own.
 */
export function createPkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** The S256 challenge sent to Google: the verifier's SHA-256, base64url-encoded. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Google sign-in, using the authorization code flow.
 *
 * The exchange happens server-side, so the client secret never reaches the browser and
 * the browser never handles an access token. `fetch` is injectable purely so the flow can
 * be tested without real credentials or a network.
 */
export function createGoogleOAuth(
  config: GoogleOAuthConfig,
  httpFetch: typeof fetch = fetch,
): GoogleOAuth {
  return {
    authorizationUrl(state: string, codeChallenge: string): string {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        // Only what is needed to identify the account. Asking for more would be both
        // intrusive and a reason for someone to decline.
        scope: 'openid email profile',
        state,
        // Only the hash goes in the URL. The verifier itself is presented at the exchange,
        // over a server-to-server request the browser never sees.
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // Google omits a refresh token on repeat consents unless asked; we do not want
        // one, because we never act on the user's behalf after sign-in.
        prompt: 'select_account',
      });

      return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
    },

    async fetchProfile(code: string, codeVerifier: string): Promise<GoogleProfile> {
      const tokenResponse = await httpFetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Google rejected the authorization code (${tokenResponse.status})`);
      }

      const tokens = (await tokenResponse.json()) as { access_token?: string };
      if (typeof tokens.access_token !== 'string') {
        throw new Error('Google did not return an access token');
      }

      const profileResponse = await httpFetch(USERINFO_ENDPOINT, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });

      if (!profileResponse.ok) {
        throw new Error(`Could not read the Google profile (${profileResponse.status})`);
      }

      const profile = (await profileResponse.json()) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
      };

      if (typeof profile.sub !== 'string' || typeof profile.email !== 'string') {
        throw new Error('Google returned an unusable profile');
      }

      return {
        sub: profile.sub,
        email: profile.email.trim().toLowerCase(),
        emailVerified: profile.email_verified === true,
        name: profile.name ?? profile.email,
      };
    },
  };
}
