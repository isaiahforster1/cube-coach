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
     * The cost still grows with history, so two things keep it bounded. Writes are limited
     * per account (see solves.routes.ts), which keeps growth at the pace of a person; and
     * the cross analysis, the one part that runs the cube engine per solve, only looks at
     * the most recent `CROSS_ANALYSIS_WINDOW` solves. What remains is linear and cheap:
     * under 200ms at fifty thousand solves, measured with worst-case scrambles.
     *
     * When real histories reach hundreds of thousands, the fix is a cached summary updated
     * on write, not a second implementation of the averaging rules in SQL.
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
