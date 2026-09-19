import { createHash } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test/context.js';
import { SESSION_COOKIE } from './auth.cookie.js';

let context: TestContext;

beforeEach(async () => {
  context ??= await createTestContext();
  await context.reset();
});

afterAll(async () => {
  await context?.close();
});

const CREDENTIALS = {
  email: 'cuber@example.com',
  password: 'a-long-enough-password',
  displayName: 'Test Cuber',
};

function register(overrides: Record<string, unknown> = {}) {
  return context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { ...CREDENTIALS, ...overrides },
  });
}

function login(overrides: Record<string, unknown> = {}) {
  return context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: CREDENTIALS.email, password: CREDENTIALS.password, ...overrides },
  });
}

/**
 * The inject response type comes from light-my-request, which is Fastify's transitive
 * dependency rather than ours. Describing only the shape actually used avoids taking a
 * direct dependency on a package we do not otherwise import.
 */
interface ResponseWithCookies {
  readonly cookies: readonly { readonly name: string; readonly value: string }[];
}

function sessionCookie(response: ResponseWithCookies): string {
  const cookie = response.cookies.find((candidate) => candidate.name === SESSION_COOKIE);
  if (cookie === undefined) throw new Error('No session cookie was set');
  return cookie.value;
}

describe('POST /auth/register', () => {
  it('creates a user and returns it without the password hash', async () => {
    const response = await register();

    expect(response.statusCode).toBe(201);
    expect(response.json().user).toMatchObject({
      email: 'cuber@example.com',
      displayName: 'Test Cuber',
    });
    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain(CREDENTIALS.password);
  });

  it('sets an httpOnly session cookie', async () => {
    const response = await register();
    const cookie = response.cookies.find((candidate) => candidate.name === SESSION_COOKIE);

    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/');
  });

  it('normalises the email, so casing cannot create a second account', async () => {
    const response = await register({ email: '  CUBER@Example.COM ' });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe('cuber@example.com');
  });

  it('never stores the password in plain text', async () => {
    await register();
    const user = await context.prisma.user.findUniqueOrThrow({
      where: { email: CREDENTIALS.email },
    });

    expect(user.passwordHash).not.toBe(CREDENTIALS.password);
    expect(user.passwordHash).not.toContain(CREDENTIALS.password);
    // Non-null for an account registered with a password; Google-only accounts have none.
    expect(user.passwordHash).not.toBeNull();
    expect(user.passwordHash?.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects an email that is already registered', async () => {
    await register();
    const response = await register();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects a password that is too short', async () => {
    const response = await register({ password: 'short' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(await context.prisma.user.count()).toBe(0);
  });

  it('rejects a malformed email', async () => {
    const response = await register({ email: 'not-an-email' });

    expect(response.statusCode).toBe(400);
    expect(await context.prisma.user.count()).toBe(0);
  });

  it('ignores unknown fields rather than storing them', async () => {
    const response = await register({ isAdmin: true });

    expect(response.statusCode).toBe(201);
    expect(response.json().user).not.toHaveProperty('isAdmin');
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('accepts correct credentials and sets a session cookie', async () => {
    const response = await login();

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe(CREDENTIALS.email);
    expect(sessionCookie(response)).toBeTruthy();
  });

  it('accepts the email in any casing', async () => {
    expect((await login({ email: 'CUBER@EXAMPLE.COM' })).statusCode).toBe(200);
  });

  it('rejects a wrong password', async () => {
    const response = await login({ password: 'definitely-not-correct' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  // The important one. An unknown email and a wrong password must be indistinguishable,
  // or the endpoint becomes a way to discover which addresses have accounts: both a
  // privacy leak and the first step of a targeted attack.
  it('gives an identical response for an unknown email and a wrong password', async () => {
    const unknownEmail = await login({ email: 'nobody@example.com' });
    const wrongPassword = await login({ password: 'definitely-not-correct' });

    expect(unknownEmail.statusCode).toBe(wrongPassword.statusCode);
    expect(unknownEmail.json()).toEqual(wrongPassword.json());
  });

  it('starts a separate session for each login', async () => {
    const first = sessionCookie(await login());
    const second = sessionCookie(await login());

    expect(first).not.toBe(second);
    expect(await context.prisma.authSession.count()).toBe(3);
  });
});

describe('session storage', () => {
  it('stores only a hash of the token, never the token itself', async () => {
    const token = sessionCookie(await register());
    const stored = await context.prisma.authSession.findFirstOrThrow();

    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('gives the session an expiry roughly 30 days out', async () => {
    await register();
    const stored = await context.prisma.authSession.findFirstOrThrow();

    const days = (stored.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });
});

describe('GET /auth/me', () => {
  it('returns the signed-in user', async () => {
    const token = sessionCookie(await register());

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [SESSION_COOKIE]: token },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe(CREDENTIALS.email);
  });

  it('rejects a request with no cookie', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('NOT_AUTHENTICATED');
  });

  it('rejects a token that was never issued', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [SESSION_COOKIE]: 'entirely-made-up' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('SESSION_INVALID');
  });

  it('rejects an expired session', async () => {
    const token = sessionCookie(await register());

    await context.prisma.authSession.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [SESSION_COOKIE]: token },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  // The practical advantage of storing sessions rather than using self-contained
  // tokens: revocation takes effect on the very next request. A JWT would stay valid
  // until it expired, whatever the server did.
  it('invalidates the token immediately, not just in the browser', async () => {
    const token = sessionCookie(await register());

    const before = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(before.statusCode).toBe(200);

    const logout = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(logout.statusCode).toBe(204);

    // The same token, replayed by someone who had copied it. It must no longer work.
    const after = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(after.statusCode).toBe(401);
  });

  it('marks the session revoked rather than deleting the row', async () => {
    const token = sessionCookie(await register());

    await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { [SESSION_COOKIE]: token },
    });

    const stored = await context.prisma.authSession.findFirstOrThrow();
    expect(stored.revokedAt).not.toBeNull();
  });

  it('succeeds even with no session, and says nothing about the token', async () => {
    const response = await context.app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(response.statusCode).toBe(204);
  });
});

describe('rate limiting', () => {
  it('rejects repeated credential attempts with 429', async () => {
    const limited = await createTestContext({ rateLimit: { credentialMax: 3 } });

    try {
      await limited.reset();

      const attempt = () =>
        limited.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'nobody@example.com', password: 'wrong-password-here' },
        });

      expect((await attempt()).statusCode).toBe(401);
      expect((await attempt()).statusCode).toBe(401);
      expect((await attempt()).statusCode).toBe(401);
      // Password hashing is deliberately expensive, so an unthrottled login endpoint is
      // both a credential-stuffing target and a way to exhaust the server's CPU.
      expect((await attempt()).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('accounts without a password', () => {
  /**
   * An account created through Google has no password hash at all. Signing in with a
   * password must fail the same way a wrong password does — same status, same message,
   * and the same work done, so the response cannot be used to discover which accounts
   * use Google.
   */
  it('cannot be signed into with a password, and says nothing about why', async () => {
    await context.prisma.user.create({
      data: {
        email: 'google-user@example.com',
        displayName: 'Google User',
        googleId: 'google-subject-123',
        passwordHash: null,
      },
    });

    const googleOnly = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'google-user@example.com', password: 'any-password-at-all' },
    });

    const noSuchUser = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'any-password-at-all' },
    });

    expect(googleOnly.statusCode).toBe(401);
    expect(googleOnly.json()).toEqual(noSuchUser.json());
  });
});
