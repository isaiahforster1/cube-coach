import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test/context.js';
import { SESSION_COOKIE } from './auth.cookie.js';
import type { GoogleOAuth, GoogleProfile } from './google.js';

/**
 * The browser side of Google sign-in: the redirect out, the callback, and where the user
 * ends up. Google itself is replaced by a fake that maps an authorization code to a
 * profile, so every branch can be driven without credentials or a network.
 */
const profilesByCode = new Map<string, GoogleProfile>();

const fakeGoogle: GoogleOAuth = {
  authorizationUrl: (state) => `https://accounts.google.test/auth?state=${state}`,
  fetchProfile: (code) => {
    const profile = profilesByCode.get(code);
    return profile === undefined
      ? Promise.reject(new Error('unknown code'))
      : Promise.resolve(profile);
  },
};

let context: TestContext;

beforeEach(async () => {
  context ??= await createTestContext({ google: fakeGoogle });
  await context.reset();
  profilesByCode.clear();
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
  const stateCookie = start.cookies.find((cookie) => cookie.name === 'cube_coach_oauth_state');
  if (stateCookie === undefined) throw new Error('No state cookie was set');

  return context.app.inject({
    method: 'GET',
    url: `/api/v1/auth/google/callback?code=${code}&state=${stateCookie.value}`,
    cookies: { cube_coach_oauth_state: stateCookie.value },
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
