import { useQuery } from '@tanstack/react-query';
import { buildStatsSummary, type StatsSummary } from '@cube-coach/shared';
import { api } from '../../lib/api-client.js';
import { STATS_KEY } from '../solves/use-solves.js';
import { useSolveStore } from '../solves/use-solve-store.js';

export { STATS_KEY };

/**
 * Statistics, computed wherever the solves happen to be.
 *
 * A signed-in user gets the server's authoritative summary. A guest gets the identical
 * calculation run in the browser over their local solves — the same `buildStatsSummary`
 * from the shared package, not a second implementation. That is exactly why the
 * statistics were written as pure functions in `packages/shared`: a guest and an account
 * holder cannot be shown different numbers for the same solves.
 */
export function useStatsSummary() {
  const { store, isGuest } = useSolveStore();

  return useQuery({
    queryKey: [...STATS_KEY, isGuest ? 'guest' : 'account'],
    queryFn: async (): Promise<StatsSummary> => {
      if (isGuest) {
        return buildStatsSummary(await store.listAll());
      }

      const { summary } = await api.get<{ summary: StatsSummary }>('/stats/summary');
      return summary;
    },
  });
}
