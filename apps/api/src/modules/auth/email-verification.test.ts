import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeEmailSender } from '../../test/fake-email-sender.js';
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

function register(overrides: Record<string, unknown> = {}, app = context.app) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { ...CREDENTIALS, ...overrides },
  });
}

/** The token from the link in the most recent email. */
function tokenFromLatestEmail(): string {
  const text = context.emails.sent.at(-1)?.text ?? '';
  const match = /\/verify-email#token=([\w-]+)/u.exec(text);
  if (match === null) throw new Error('No verification link in the latest email');
  return match[1]!;
}

describe('the verification email sent at registration', () => {
  it('goes to the registered address', async () => {
    await register();

    expect(context.emails.sent).toHaveLength(1);
    expect(context.emails.sent[0]?.to).toBe('cuber@example.com');
  });

  /**
   * In the fragment, not the query string. A browser never sends the fragment to a
   * server, so the token stays out of access logs, proxies and Referer headers.
   */
  it('carries a link to the app with the token in the URL fragment', async () => {
    await register();

    const message = context.emails.sent[0]!;
    expect(message.text).toMatch(/http:\/\/localhost:5173\/verify-email#token=[\w-]{43}/u);
    expect(message.html).toContain(`/verify-email#token=${tokenFromLatestEmail()}`);
  });

  /**
   * The registrant may be an attacker using someone else's address, and anything they
   * typed would arrive in the victim's inbox from our domain. A display name like "Your
   * prize is at evil.example" is a phishing email we would be sending for them.
   */
  it('contains nothing the registrant wrote except the address', async () => {
    await register({ displayName: 'Claim your prize at evil.example' });

    const message = context.emails.sent[0]!;
    expect(message.text).not.toContain('evil.example');
    expect(message.html).not.toContain('evil.example');
  });

  it('stores only a hash of the token, expiring within the hour', async () => {
    const before = Date.now();
    await register();
    const token = tokenFromLatestEmail();

    const stored = await context.prisma.emailVerificationToken.findFirstOrThrow();
    expect(stored.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(stored.tokenHash).not.toContain(token);
    expect(stored.email).toBe('cuber@example.com');
    expect(stored.usedAt).toBeNull();

    const lifetime = stored.expiresAt.getTime() - before;
    expect(lifetime).toBeGreaterThan(59 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(61 * 60 * 1000);
  });

  /**
   * The account is worth having without verification (ADR-0012), and a provider outage
   * should not turn away new users. The link can be sent again later.
   */
  it('does not stop registration when the email cannot be sent', async () => {
    const failing = createFakeEmailSender();
    failing.failFromNowOn();
    const broken = await createTestContext({ emailSender: failing });

    try {
      const response = await register({}, broken.app);
      expect(response.statusCode).toBe(201);
    } finally {
      await broken.close();
    }
  });
});

interface ResponseWithCookies {
  readonly cookies: readonly { readonly name: string; readonly value: string }[];
}

function sessionCookie(response: ResponseWithCookies): string {
  const cookie = response.cookies.find((candidate) => candidate.name === SESSION_COOKIE);
  if (cookie === undefined) throw new Error('No session cookie was set');
  return cookie.value;
}

/** Register and return the session cookie and the token from the emailed link. */
async function registerAndReadLink(email = CREDENTIALS.email) {
  const response = await register({ email });
  return { cookie: sessionCookie(response), token: tokenFromLatestEmail() };
}

function verify(token: string, cookie: string | undefined, app = context.app) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/verify-email',
    payload: { token },
    ...(cookie === undefined ? {} : { cookies: { [SESSION_COOKIE]: cookie } }),
  });
}

async function isVerified(email: string): Promise<boolean> {
  const user = await context.prisma.user.findUniqueOrThrow({ where: { email } });
  return user.emailVerifiedAt !== null;
}

describe('POST /auth/verify-email', () => {
  it('verifies the address and returns the updated user', async () => {
    const { cookie, token } = await registerAndReadLink();

    const response = await verify(token, cookie);

    expect(response.statusCode).toBe(200);
    expect(response.json().user.emailVerified).toBe(true);
    expect(await isVerified(CREDENTIALS.email)).toBe(true);
  });

  /**
   * The link proves the inbox; the session proves the password. Together they show the
   * person who chose the password also receives mail at the address.
   *
   * Without the session, pre-hijacking survives verification: an attacker registers the
   * victim's address, the victim gets a "confirm your email" message and clicks it, and
   * the attacker's password becomes a verified one that outlives a later Google link.
   */
  it('requires the account to be signed in', async () => {
    const { token } = await registerAndReadLink();

    const response = await verify(token, undefined);

    expect(response.statusCode).toBe(401);
    expect(await isVerified(CREDENTIALS.email)).toBe(false);
  });

  it('works once', async () => {
    const { cookie, token } = await registerAndReadLink();

    expect((await verify(token, cookie)).statusCode).toBe(200);
    const again = await verify(token, cookie);

    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('VERIFICATION_LINK_INVALID');
  });

  it('refuses an expired link', async () => {
    const { cookie, token } = await registerAndReadLink();
    await context.prisma.emailVerificationToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await verify(token, cookie);

    expect(response.statusCode).toBe(400);
    expect(await isVerified(CREDENTIALS.email)).toBe(false);
  });

  /** Rule 1 of ADR-0018: a token is looked up together with the caller, never alone. */
  it("refuses another account's link, verifying neither", async () => {
    const victim = await registerAndReadLink('victim@example.com');
    const attacker = await registerAndReadLink('attacker@example.com');

    const response = await verify(victim.token, attacker.cookie);

    expect(response.statusCode).toBe(400);
    expect(await isVerified('victim@example.com')).toBe(false);
    expect(await isVerified('attacker@example.com')).toBe(false);
  });

  /** A link proves only the address it was delivered to. */
  it('refuses a link sent to an address the account no longer has', async () => {
    const { cookie, token } = await registerAndReadLink();
    await context.prisma.user.update({
      where: { email: CREDENTIALS.email },
      data: { email: 'changed@example.com' },
    });

    expect((await verify(token, cookie)).statusCode).toBe(400);
    expect(await isVerified('changed@example.com')).toBe(false);
  });

  /**
   * Unknown, used, expired and someone else's all look the same, so the response says
   * nothing about which tokens exist or whose they are.
   */
  it('gives one response for every kind of bad link', async () => {
    const { cookie, token } = await registerAndReadLink();
    const unknown = await verify('A'.repeat(43), cookie);

    await verify(token, cookie);
    const used = await verify(token, cookie);

    expect(used.statusCode).toBe(unknown.statusCode);
    expect(used.body).toBe(unknown.body);
  });

  it('rejects a token that is not the right shape before looking it up', async () => {
    const { cookie } = await registerAndReadLink();

    const response = await verify('not a token', cookie);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('is rate limited per account', async () => {
    const limited = await createTestContext({ rateLimit: { verificationMax: 2 } });

    try {
      await limited.reset();
      const cookie = sessionCookie(await register({}, limited.app));
      const attempt = () => verify('A'.repeat(43), cookie, limited.app);

      expect((await attempt()).statusCode).toBe(400);
      expect((await attempt()).statusCode).toBe(400);
      expect((await attempt()).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

function resend(cookie: string | undefined, app = context.app, payload: object = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/resend-verification',
    payload,
    ...(cookie === undefined ? {} : { cookies: { [SESSION_COOKIE]: cookie } }),
  });
}

describe('POST /auth/resend-verification', () => {
  it('sends a fresh link to the signed-in account', async () => {
    const { cookie } = await registerAndReadLink();

    const response = await resend(cookie);

    expect(response.statusCode).toBe(204);
    expect(context.emails.sent).toHaveLength(2);
    expect(context.emails.sent[1]?.to).toBe(CREDENTIALS.email);
    expect((await verify(tokenFromLatestEmail(), cookie)).statusCode).toBe(200);
  });

  it('makes the earlier link useless', async () => {
    const { cookie, token: first } = await registerAndReadLink();

    await resend(cookie);

    expect((await verify(first, cookie)).statusCode).toBe(400);
    expect(await context.prisma.emailVerificationToken.count()).toBe(1);
  });

  /**
   * It takes no address, only the session, so it cannot be pointed at anyone else's inbox
   * and cannot be used to ask which addresses have accounts.
   */
  it('ignores any address in the request and sends only to the account', async () => {
    const { cookie } = await registerAndReadLink();

    await resend(cookie, context.app, { email: 'someone-else@example.com' });

    expect(context.emails.sent.map((message) => message.to)).toEqual([
      CREDENTIALS.email,
      CREDENTIALS.email,
    ]);
  });

  it('sends nothing once the address is verified', async () => {
    const { cookie, token } = await registerAndReadLink();
    await verify(token, cookie);

    const response = await resend(cookie);

    expect(response.statusCode).toBe(204);
    expect(context.emails.sent).toHaveLength(1);
  });

  it('requires a signed-in user', async () => {
    expect((await resend(undefined)).statusCode).toBe(401);
    expect(context.emails.sent).toHaveLength(0);
  });

  /** Asked for directly, so unlike at registration, a failure is the answer. */
  it('says so when the email cannot be sent', async () => {
    const failing = createFakeEmailSender();
    const broken = await createTestContext({ emailSender: failing });

    try {
      await broken.reset();
      const cookie = sessionCookie(await register({}, broken.app));
      failing.failFromNowOn();

      const response = await resend(cookie, broken.app);

      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('EMAIL_NOT_SENT');
    } finally {
      await broken.close();
    }
  });

  /** Each request sends an email from our domain, so it is limited per account. */
  it('is rate limited per account', async () => {
    const limited = await createTestContext({ rateLimit: { resendMax: 2 } });

    try {
      await limited.reset();
      const cookie = sessionCookie(await register({}, limited.app));

      expect((await resend(cookie, limited.app)).statusCode).toBe(204);
      expect((await resend(cookie, limited.app)).statusCode).toBe(204);
      expect((await resend(cookie, limited.app)).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

/** The client offers verification only when the server can actually send the email. */
describe('GET /auth/providers', () => {
  it('reports email verification when email can be sent', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/v1/auth/providers' });

    expect(response.json()).toMatchObject({ emailVerification: true });
  });

  it('reports none in production without an email provider', async () => {
    const production = await createTestContext({
      production: true,
      env: { RESEND_API_KEY: undefined, EMAIL_FROM: undefined, APP_URL: undefined },
    });

    try {
      const response = await production.app.inject({
        method: 'GET',
        url: '/api/v1/auth/providers',
      });
      expect(response.json()).toMatchObject({ emailVerification: false });
    } finally {
      await production.close();
    }
  });
});
