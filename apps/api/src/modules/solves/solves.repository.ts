import type { Penalty as DbPenalty, PrismaClient } from '@prisma/client';

export function createSolvesRepository(prisma: PrismaClient) {
  return {
    /**
     * Insert a solve, or return the existing one if this id has already been stored.
     *
     * `upsert` with an empty update is what makes retrying safe: a second request with
     * the same client-generated id is a no-op that returns the original row, rather than
     * a duplicate or a unique-constraint error the client would have to interpret.
     */
    upsert(data: {
      id: string;
      userId: string;
      practiceSessionId: string;
      scramble: string;
      durationMs: number;
      penalty: DbPenalty;
      solvedAt: Date;
      comment: string | null;
    }) {
      return prisma.solve.upsert({
        where: { id: data.id },
        create: data,
        update: {},
      });
    },

    findById(id: string, userId: string) {
      return prisma.solve.findFirst({
        where: { id, userId, deletedAt: null },
      });
    },

    update(id: string, data: { penalty?: DbPenalty; comment?: string | null }) {
      return prisma.solve.update({ where: { id }, data });
    },

    /** Soft delete, so a mis-tap on a timer can be undone. */
    softDelete(id: string, now: Date) {
      return prisma.solve.update({ where: { id }, data: { deletedAt: now } });
    },

    /**
     * A page of solves, newest first.
     *
     * The cursor comparison is a row-value comparison written out by hand: everything
     * strictly older than the cursor, plus anything at the same instant with a smaller
     * id. The id tiebreak matters — two solves can share a millisecond, and without it
     * one of them would be skipped or repeated at a page boundary.
     */
    listPage(params: {
      userId: string;
      practiceSessionId?: string | undefined;
      limit: number;
      cursor?: { solvedAt: Date; id: string } | undefined;
    }) {
      return prisma.solve.findMany({
        where: {
          userId: params.userId,
          deletedAt: null,
          ...(params.practiceSessionId === undefined
            ? {}
            : { practiceSessionId: params.practiceSessionId }),
          ...(params.cursor === undefined
            ? {}
            : {
                OR: [
                  { solvedAt: { lt: params.cursor.solvedAt } },
                  { solvedAt: params.cursor.solvedAt, id: { lt: params.cursor.id } },
                ],
              }),
        },
        orderBy: [{ solvedAt: 'desc' }, { id: 'desc' }],
        // One extra row, purely to discover whether another page exists without a
        // second COUNT query over the whole table.
        take: params.limit + 1,
      });
    },
  };
}

export type SolvesRepository = ReturnType<typeof createSolvesRepository>;
