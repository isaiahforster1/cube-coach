import { useQuery } from '@tanstack/react-query';
import type { StatsSummary } from '@cube-coach/shared';
import { api } from '../../lib/api-client.js';

export const STATS_KEY = ['stats'] as const;

export function useStatsSummary() {
  return useQuery({
    queryKey: STATS_KEY,
    queryFn: async () => {
      const { summary } = await api.get<{ summary: StatsSummary }>('/stats/summary');
      return summary;
    },
  });
}
