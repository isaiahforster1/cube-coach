import type { Penalty, Solve } from '@cube-coach/shared';
import { api } from '../../lib/api-client.js';
import type { SolvePage, SolveStore } from './solve-store.js';

/** Solves belonging to a signed-in user, stored on the server. */
export function createApiStore(practiceSessionId: string | undefined): SolveStore {
  return {
    listPage({ limit, cursor }): Promise<SolvePage> {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor !== null) params.set('cursor', cursor);
      if (practiceSessionId !== undefined) params.set('practiceSessionId', practiceSessionId);

      return api.get<SolvePage>(`/solves?${params.toString()}`);
    },

    async listAll(): Promise<Solve[]> {
      // Paged through rather than requested in one go, so a long history cannot produce a
      // response large enough to be a problem. Statistics need all of it regardless.
      const all: Solve[] = [];
      let cursor: string | null = null;

      do {
        const params = new URLSearchParams({ limit: '100' });
        if (cursor !== null) params.set('cursor', cursor);
        if (practiceSessionId !== undefined) params.set('practiceSessionId', practiceSessionId);

        const page: SolvePage = await api.get<SolvePage>(`/solves?${params.toString()}`);
        all.push(...page.solves);
        cursor = page.nextCursor;
      } while (cursor !== null);

      // The API returns newest first; statistics need oldest first.
      return all.reverse();
    },

    async create(request): Promise<Solve> {
      const { solve } = await api.post<{ solve: Solve }>('/solves', request);
      return solve;
    },

    async setPenalty(id, penalty: Penalty): Promise<Solve> {
      const { solve } = await api.patch<{ solve: Solve }>(`/solves/${id}`, { penalty });
      return solve;
    },

    remove(id): Promise<void> {
      return api.delete<void>(`/solves/${id}`);
    },

    async restore(id): Promise<void> {
      await api.post<{ solve: Solve }>(`/solves/${id}/restore`);
    },
  };
}
