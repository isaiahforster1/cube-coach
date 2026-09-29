import type { PrismaClient } from '@prisma/client';
import { DEFAULT_PRACTICE_SESSION_NAME } from '../practice-sessions/practice-sessions.service.js';

/**
 * Database access for authentication. This layer contains queries and nothing else —
 * no rules, no hashing, no HTTP. Keeping it that thin is what lets the service above it
 * be reasoned about without thinking in SQL.
 */
export function createAuthRepository(prisma: PrismaClient) {
  return {
    findUserByEmail(email: string) {
      return prisma.user.findUnique({ where: { email } });
    },

    /**
     * Create the user and their first practice session together, in one transaction.
     *
     * A user with no practice session has nowhere to save a solve, so the timer would
     * fail on the very first use. Doing both in a transaction means an account can never
     * exist in that half-configured state — either both rows are written or neither is.
     */
    findUserByGoogleId(googleId: string) {
      return prisma.user.findUnique({ where: { googleId } });
    },

    /**
     * Attach a Google identity to an existing account, discarding every credential that
     * was never proved: the password is cleared and all existing sessions are revoked.
     *
     * One transaction, because the order of failure matters. Linking and then failing to
     * revoke would leave exactly the state this exists to prevent — the account now holds
     * the real owner's identity while a stranger's session still works.
     */
    async linkGoogleAccount(userId: string, googleId: string, now: Date) {
      const [user] = await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          // Google's verified email is proof of the address, so the account is now verified.
          data: { googleId, passwordHash: null, emailVerifiedAt: now },
        }),
        prisma.authSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        }),
      ]);
      return user;
    },

    /** A Google account has no password, so it is created without one. */
    createGoogleUser(data: {
      email: string;
      displayName: string;
      googleId: string;
      emailVerifiedAt: Date;
    }) {
      return prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data });

        await tx.practiceSession.create({
          data: { userId: user.id, name: DEFAULT_PRACTICE_SESSION_NAME },
        });

        return user;
      });
    },

    createUser(data: { email: string; passwordHash: string; displayName: string }) {
      return prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data });

        await tx.practiceSession.create({
          data: { userId: user.id, name: DEFAULT_PRACTICE_SESSION_NAME },
        });

        return user;
      });
    },

    /**
     * Store a new verification token, deleting any the user already had.
     *
     * One outstanding link per user: asking for another makes the old one useless, and
     * the table cannot grow with how often someone presses "resend".
     */
    replaceVerificationToken(data: {
      userId: string;
      email: string;
      tokenHash: string;
      expiresAt: Date;
    }) {
      return prisma.$transaction([
        prisma.emailVerificationToken.deleteMany({ where: { userId: data.userId } }),
        prisma.emailVerificationToken.create({ data }),
      ]);
    },

    createSession(data: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      userAgent: string | null;
    }) {
      return prisma.authSession.create({ data });
    },

    /**
     * Look up a session by token hash, rejecting expired and revoked ones in the query
     * rather than in application code.
     *
     * Doing it here means there is no window where a caller forgets to check, and the
     * database never hands back a session that should not be usable.
     */
    findActiveSession(tokenHash: string, now: Date) {
      return prisma.authSession.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        include: { user: true },
      });
    },

    revokeSession(tokenHash: string, now: Date) {
      return prisma.authSession.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: now },
      });
    },

    touchSession(id: string, now: Date) {
      return prisma.authSession.update({
        where: { id },
        data: { lastUsedAt: now },
      });
    },

    /** Used by "log out everywhere" and after a password change. */
    revokeAllSessionsForUser(userId: string, now: Date) {
      return prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    },
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
