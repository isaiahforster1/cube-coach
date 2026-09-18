import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Penalty, Solve } from '@cube-coach/shared';
import { api } from '../../lib/api-client.js';
import { SOLVES_KEY } from '../solves/use-solves.js';

interface SolvePage {
  readonly solves: Solve[];
  readonly nextCursor: string | null;
}

const PAGE_SIZE = 25;

/**
 * Pages of history, newest first.
 *
 * `useInfiniteQuery` is built for exactly this shape: it keeps the pages already
 * fetched, asks for the next one on demand, and hands back the cursor the API returned.
 * The client never constructs a cursor itself — it is an opaque string whose format is
 * the server's business, which is what allows the pagination strategy to change later
 * without touching the client.
 */
export function useSolveHistory(practiceSessionId?: string) {
  return useInfiniteQuery({
    queryKey: [...SOLVES_KEY, 'history', practiceSessionId ?? 'all'],

    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (practiceSessionId !== undefined) params.set('practiceSessionId', practiceSessionId);
      if (pageParam !== null) params.set('cursor', pageParam);

      return api.get<SolvePage>(`/solves?${params.toString()}`);
    },

    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useDeleteSolve() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/solves/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SOLVES_KEY });
    },
  });
}

export function useRestoreSolve() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.post<{ solve: Solve }>(`/solves/${id}/restore`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SOLVES_KEY });
    },
  });
}

export function useSetSolvePenalty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, penalty }: { id: string; penalty: Penalty }) =>
      api.patch<{ solve: Solve }>(`/solves/${id}`, { penalty }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SOLVES_KEY });
    },
  });
}
