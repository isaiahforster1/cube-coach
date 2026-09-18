import type { CreatePracticeSessionRequest } from '@cube-coach/shared';
import { ApiError } from '../../plugins/error-handler.js';
import { toPracticeSessionResponse } from '../solves/solve.mapper.js';
import type { PracticeSessionsRepository } from './practice-sessions.repository.js';

/** Every account starts with one of these, so the timer always has somewhere to save. */
export const DEFAULT_PRACTICE_SESSION_NAME = 'Main session';

export function createPracticeSessionsService(repository: PracticeSessionsRepository) {
  return {
    async list(userId: string) {
      const sessions = await repository.listForUser(userId);
      return sessions.map(toPracticeSessionResponse);
    },

    async create(userId: string, input: CreatePracticeSessionRequest) {
      const session = await repository.create({ userId, name: input.name });
      return toPracticeSessionResponse(session);
    },

    async archive(userId: string, id: string) {
      const existing = await repository.findForUser(id, userId);
      if (existing === null) {
        throw new ApiError(404, 'PRACTICE_SESSION_NOT_FOUND', 'No such practice session');
      }

      // Archived, not deleted: the solves inside it are still the user's history, and
      // deleting a session would silently take their records with it.
      const session = await repository.archive(id, new Date());
      return toPracticeSessionResponse(session);
    },
  };
}

export type PracticeSessionsService = ReturnType<typeof createPracticeSessionsService>;
