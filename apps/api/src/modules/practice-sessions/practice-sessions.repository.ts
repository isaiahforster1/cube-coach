import type { PrismaClient } from '@prisma/client';

export function createPracticeSessionsRepository(prisma: PrismaClient) {
  return {
    listForUser(userId: string) {
      return prisma.practiceSession.findMany({
        where: { userId, archivedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    },

    findForUser(id: string, userId: string) {
      return prisma.practiceSession.findFirst({ where: { id, userId } });
    },

    create(data: { userId: string; name: string }) {
      return prisma.practiceSession.create({ data });
    },

    archive(id: string, now: Date) {
      return prisma.practiceSession.update({ where: { id }, data: { archivedAt: now } });
    },
  };
}

export type PracticeSessionsRepository = ReturnType<typeof createPracticeSessionsRepository>;
