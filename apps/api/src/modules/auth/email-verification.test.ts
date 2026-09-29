import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeEmailSender } from '../../test/fake-email-sender.js';
import { createTestContext, type TestContext } from '../../test/context.js';

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
