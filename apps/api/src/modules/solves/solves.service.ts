import type { CreateSolveRequest, ListSolvesQuery, UpdateSolveRequest } from '@cube-coach/shared';
import { ApiError } from '../../plugins/error-handler.js';
import type { PracticeSessionsRepository } from '../practice-sessions/practice-sessions.repository.js';
import { decodeCursor, encodeCursor, toDbPenalty, toSolveResponse } from './solve.mapper.js';
import type { SolvesRepository } from './solves.repository.js';

export function createSolvesService(
  solves: SolvesRepository,
  practiceSessions: PracticeSessionsRepository,
) {
  return {
    async create(userId: string, input: CreateSolveRequest) {
      /**
       * Check the practice session belongs to this user before writing anything.
       *
       * Without it, anyone could post solves into someone else's session by guessing an
       * id. This is the most common shape of authorisation bug: authentication proves
       * who you are, and is then mistaken for permission to touch a particular row.
       */
      const session = await practiceSessions.findForUser(input.practiceSessionId, userId);
      if (session === null) {
        // Deliberately "not found" rather than "forbidden". Saying "forbidden" would
        // confirm that the id exists and belongs to someone, which is itself a leak.
        throw new ApiError(404, 'PRACTICE_SESSION_NOT_FOUND', 'No such practice session');
      }

      const solve = await solves.upsert({
        id: input.id,
        userId,
        practiceSessionId: input.practiceSessionId,
        scramble: input.scramble,
        durationMs: input.durationMs,
        penalty: toDbPenalty(input.penalty),
        solvedAt: new Date(input.solvedAt),
        comment: input.comment,
      });

      return toSolveResponse(solve);
    },

    async update(userId: string, id: string, input: UpdateSolveRequest) {
      // Scoped to the user, so one person cannot edit another's solve by id.
      const existing = await solves.findById(id, userId);
      if (existing === null) {
        throw new ApiError(404, 'SOLVE_NOT_FOUND', 'No such solve');
      }

      const solve = await solves.update(id, {
        ...(input.penalty === undefined ? {} : { penalty: toDbPenalty(input.penalty) }),
        ...(input.comment === undefined ? {} : { comment: input.comment }),
      });

      return toSolveResponse(solve);
    },

    async remove(userId: string, id: string) {
      const existing = await solves.findById(id, userId);
      if (existing === null) {
        throw new ApiError(404, 'SOLVE_NOT_FOUND', 'No such solve');
      }

      await solves.softDelete(id, new Date());
    },

    /**
     * Undo a delete.
     *
     * This is what makes the soft delete worth having: without a way back, `deletedAt`
     * is just a more complicated `DELETE`. Deleting a solve is a one-click action on a
     * touch screen next to a running timer, so it needs to be reversible.
     */
    async restore(userId: string, id: string) {
      const existing = await solves.findByIdIncludingDeleted(id, userId);
      if (existing === null) {
        throw new ApiError(404, 'SOLVE_NOT_FOUND', 'No such solve');
      }

      const solve = await solves.restore(id);
      return toSolveResponse(solve);
    },

    async list(userId: string, query: ListSolvesQuery) {
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      if (query.cursor !== undefined && cursor === null) {
        throw new ApiError(400, 'INVALID_CURSOR', 'That page cursor is not valid');
      }

      const rows = await solves.listPage({
        userId,
        practiceSessionId: query.practiceSessionId,
        limit: query.limit,
        cursor: cursor ?? undefined,
      });

      // The repository fetched one more row than asked for. If it came back, there is
      // another page — and the extra row is dropped rather than returned.
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);

      return {
        solves: page.map(toSolveResponse),
        nextCursor: hasMore && last !== undefined ? encodeCursor(last.solvedAt, last.id) : null,
      };
    },
  };
}

export type SolvesService = ReturnType<typeof createSolvesService>;
