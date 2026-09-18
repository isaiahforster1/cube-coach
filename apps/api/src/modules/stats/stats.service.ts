import { buildStatsSummary, type StatsSummary } from '@cube-coach/shared';
import { fromDbPenalty } from '../solves/solve.mapper.js';
import type { SolvesRepository } from '../solves/solves.repository.js';

export function createStatsService(solves: SolvesRepository) {
  return {
    /**
     * Compute statistics over a user's whole history.
     *
     * Every solve is loaded rather than aggregated in SQL, because the rules that matter
     * — trimmed averages, DNFs ranking as the worst time, cross difficulty per scramble —
     * are awkward in SQL and already implemented, tested and shared with the client. One
     * implementation that both sides run is worth more here than a faster query.
     *
     * This is fine for a personal history of a few thousand solves and would not be for a
     * hundred thousand. When that becomes real, the fix is a cached summary updated on
     * write, not a second implementation of the averaging rules in SQL.
     */
    async summary(userId: string, practiceSessionId?: string): Promise<StatsSummary> {
      const rows = await solves.listAllForStats(userId, practiceSessionId);

      return buildStatsSummary(
        rows.map((row) => ({
          scramble: row.scramble,
          durationMs: row.durationMs,
          penalty: fromDbPenalty(row.penalty),
        })),
      );
    },
  };
}

export type StatsService = ReturnType<typeof createStatsService>;
