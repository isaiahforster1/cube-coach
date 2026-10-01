import { Writable } from 'node:stream';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test/context.js';
import { SESSION_COOKIE } from './auth.cookie.js';
import { pkceChallenge, type GoogleOAuth, type GoogleProfile } from './google.js';

/**
 * The browser side of Google sign-in: the redirect out, the callback, and where the user
 * ends up. Google itself is replaced by a fake that maps an authorization code to a
 * profile, so every branch can be driven without credentials or a network.
 *
 * The fake enforces PKCE the way Google does: it remembers the challenge it was sent and
 * refuses to exchange a code unless the verifier presented hashes to it.
 */
const profilesByCode = new Map<string, GoogleProfile>();
let lastChallenge: string | undefined;

const fakeGoogle: GoogleOAuth = {
  authorizationUrl: (state, codeChallenge) => {
    lastChallenge = codeChallenge;
    return `https://accounts.google.test/auth?state=${state}&code_challenge=${codeChallenge}`;
  },
  fetchProfile: (code, codeVerifier) => {
    if (lastChallenge === undefined || pkceChallenge(codeVerifier) !== lastChallenge) {
      return Promise.reject(new Error('invalid_grant: code_verifier does not match'));
    }
    const profile = profilesByCode.get(code);
    return profile === undefined
      ? Promise.reject(new Error('unknown code'))
      : Promise.resolve(profile);
  },
};

/** Every log line the application writes, so a test can check what reached the logs. */
const logLines: string[] = [];
const logStream = new Writable({
  write(chunk: Buffer, _encoding, done) {
    logLines.push(chunk.toString());
    done();
  },
});

let context: TestContext;

beforeEach(async () => {
  context ??= await createTestContext({ google: fakeGoogle, logStream });
  await context.reset();
  profilesByCode.clear();
  lastChallenge = undefined;
  logLines.length = 0;
});

afterAll(async () => {
  await context?.close();
});

function profile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    sub: 'google-subject-1',
    email: 'cuber@example.com',
    emailVerified: true,
    name: 'Test Cuber',
    ...overrides,
  };
}

/** Walk the whole flow as a browser would, returning the final callback response. */
async function signInThroughBrowser(signedInAs: GoogleProfile) {
  const code = `code-for-${signedInAs.sub}`;
  profilesByCode.set(code, signedInAs);

  const start = await context.app.inject({ method: 'GET', url: '/api/v1/auth/google' });
  const flowCookie = start.cookies.find((cookie) => cookie.name === 'cube_coach_oauth_state');
  if (flowCookie === undefined) throw new Error('No state cookie was set');
  // The state Google hands back is the one in the URL we were sent to.
  const state = new URL(start.headers.location ?? '').searchParams.get('state') ?? '';

  return context.app.inject({
    method: 'GET',
    url: `/api/v1/auth/google/callback?code=${code}&state=${state}`,
    cookies: { cube_coach_oauth_state: flowCookie.value },
  });
}

describe('GET /auth/google/callback', () => {
  it('signs the user in and sets a session cookie', async () => {
    const response = await signInThroughBrowser(profile());

    expect(response.statusCode).toBe(302);
    expect(response.cookies.some((cookie) => cookie.name === SESSION_COOKIE)).toBe(true);
  });

  /**
   * Relative, never built from configuration. One origin serves both halves (ADR-0017),
   * so the browser is already where it needs to be; an absolute URL from config sent
   * production users to `http://localhost:5173` when the variable was left unset.
   */
  it('sends the browser home with a relative redirect', async () => {
    const response = await signInThroughBrowser(profile());

    expect(response.headers.location).toBe('/');
  });

  it('sends a recycled address back to the login page with a specific reason', async () => {
    await signInThroughBrowser(profile({ sub: 'subject-1' }));

    const response = await signInThroughBrowser(profile({ sub: 'subject-2' }));

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login?error=google_account_mismatch');
    expect(response.cookies.some((cookie) => cookie.name === SESSION_COOKIE)).toBe(false);
  });

  it('keeps the PKCE verifier out of the URL the browser is sent to', async () => {
    const start = await context.app.inject({ method: 'GET', url: '/api/v1/auth/google' });
    const flowCookie = start.cookies.find((cookie) => cookie.name === 'cube_coach_oauth_state');
    const location = new URL(start.headers.location ?? '');

    expect(flowCookie?.httpOnly).toBe(true);
    expect(location.searchParams.get('code_challenge')).toBe(lastChallenge);
    // The cookie holds the verifier; the URL holds only its hash.
    expect(start.headers.location).not.toContain(flowCookie?.value.split('.')[1]);
  });

  /**
   * Proxies and log aggregators keep URLs, and this one carries a live authorization code.
   * PKCE makes a leaked code useless, but it should not be leaked in the first place.
   */
  it('keeps the authorization code out of the logs', async () => {
    await signInThroughBrowser(profile());

    const logs = logLines.join('\n');
    expect(logs).toContain('/api/v1/auth/google/callback');
    expect(logs).not.toContain('code-for-google-subject-1');
    expect(logs).not.toContain('code=');
  });

  it('refuses a callback whose cookie carries no verifier', async () => {
    profilesByCode.set('a-code', profile());
    const start = await context.app.inject({ method: 'GET', url: '/api/v1/auth/google' });
    const state = new URL(start.headers.location ?? '').searchParams.get('state') ?? '';

    const response = await context.app.inject({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=a-code&state=${state}`,
      cookies: { cube_coach_oauth_state: state },
    });

    expect(response.headers.location).toBe('/login?error=google_state');
    expect(response.cookies.some((cookie) => cookie.name === SESSION_COOKIE)).toBe(false);
  });

  it('refuses a callback whose state does not match', async () => {
    const start = await context.app.inject({ method: 'GET', url: '/api/v1/auth/google' });
    const stateCookie = start.cookies.find((cookie) => cookie.name === 'cube_coach_oauth_state');

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=anything&state=forged',
      cookies: { cube_coach_oauth_state: stateCookie?.value ?? '' },
    });

    expect(response.headers.location).toBe('/login?error=google_state');
  });
});
