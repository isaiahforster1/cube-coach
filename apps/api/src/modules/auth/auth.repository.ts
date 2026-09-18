import type { PrismaClient } from '@prisma/client';

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

    createUser(data: { email: string; passwordHash: string; displayName: string }) {
      return prisma.user.create({ data });
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
