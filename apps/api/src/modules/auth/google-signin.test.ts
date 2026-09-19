import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test/context.js';
import { createAuthRepository } from './auth.repository.js';
import { createAuthService, type AuthService } from './auth.service.js';
import type { GoogleProfile } from './google.js';

let context: TestContext;
let authService: AuthService;

beforeEach(async () => {
  context ??= await createTestContext();
  await context.reset();
  authService = createAuthService(createAuthRepository(context.prisma));
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

describe('signing in with Google', () => {
  it('creates an account the first time', async () => {
    const { user } = await authService.signInWithGoogle(profile(), null);

    expect(user.email).toBe('cuber@example.com');
    expect(user.googleId).toBe('google-subject-1');
    // No password at all, rather than an unusable placeholder that could be attacked.
    expect(user.passwordHash).toBeNull();
  });

  it('gives the new account a practice session, like any other', async () => {
    const { user } = await authService.signInWithGoogle(profile(), null);

    const sessions = await context.prisma.practiceSession.findMany({
      where: { userId: user.id },
    });
    expect(sessions).toHaveLength(1);
  });

  it('signs the same person back in without creating a second account', async () => {
    const first = await authService.signInWithGoogle(profile(), null);
    const second = await authService.signInWithGoogle(profile(), null);

    expect(second.user.id).toBe(first.user.id);
    expect(await context.prisma.user.count()).toBe(1);
  });

  it('issues a fresh session each time', async () => {
    const first = await authService.signInWithGoogle(profile(), null);
    const second = await authService.signInWithGoogle(profile(), null);

    expect(first.token).not.toBe(second.token);
    expect(await context.prisma.authSession.count()).toBe(2);
  });

  /**
   * Someone who registered with a password and later uses Google is the same person, so
   * the accounts are joined rather than duplicated — which would otherwise split their
   * solve history in two.
   */
  it('links Google to an account that already has that email', async () => {
    await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'cuber@example.com',
        password: 'a-long-enough-password',
        displayName: 'Password Cuber',
      },
    });

    const { user } = await authService.signInWithGoogle(profile(), null);

    expect(await context.prisma.user.count()).toBe(1);
    expect(user.googleId).toBe('google-subject-1');
    // The password still works afterwards; linking adds a way in, it does not replace one.
    expect(user.passwordHash).not.toBeNull();
  });

  it('keeps the original display name when linking', async () => {
    await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'cuber@example.com',
        password: 'a-long-enough-password',
        displayName: 'Password Cuber',
      },
    });

    const { user } = await authService.signInWithGoogle(profile({ name: 'Google Cuber' }), null);
    expect(user.displayName).toBe('Password Cuber');
  });

  /**
   * The security check the whole linking design rests on. Without it, anyone able to
   * create a Google account claiming someone else's address could take over their
   * CubeCoach account — the classic way this integration is got wrong.
   */
  it('refuses an unverified Google email outright', async () => {
    await expect(
      authService.signInWithGoogle(profile({ emailVerified: false }), null),
    ).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_UNVERIFIED' });

    expect(await context.prisma.user.count()).toBe(0);
  });

  it('will not link an unverified email to an existing account', async () => {
    await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'cuber@example.com',
        password: 'a-long-enough-password',
        displayName: 'Password Cuber',
      },
    });

    await expect(
      authService.signInWithGoogle(profile({ emailVerified: false }), null),
    ).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_UNVERIFIED' });

    const user = await context.prisma.user.findFirstOrThrow();
    expect(user.googleId).toBeNull();
  });

  /** Matching on the subject, not the email, so a reassigned address cannot hijack a login. */
  it('recognises the account by Google subject even if the email changed', async () => {
    const first = await authService.signInWithGoogle(profile(), null);

    const second = await authService.signInWithGoogle(
      profile({ email: 'new-address@example.com' }),
      null,
    );

    expect(second.user.id).toBe(first.user.id);
    expect(await context.prisma.user.count()).toBe(1);
  });
});
