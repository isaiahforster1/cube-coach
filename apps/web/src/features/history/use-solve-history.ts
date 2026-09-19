import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Penalty } from '@cube-coach/shared';
import { SOLVES_KEY, STATS_KEY } from '../solves/use-solves.js';
import { useSolveStore } from '../solves/use-solve-store.js';

const PAGE_SIZE = 25;

async function invalidate(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: SOLVES_KEY }),
    queryClient.invalidateQueries({ queryKey: STATS_KEY }),
  ]);
}

/**
 * Pages of history, newest first, from whichever store this user has.
 *
 * The cursor is opaque: the server's is a keyset position, the guest store's is an
 * offset, and this hook hands back whatever it was given without looking inside. That is
 * what lets two very different pagination strategies sit behind one interface.
 */
export function useSolveHistory() {
  const { store, isGuest } = useSolveStore();

  return useInfiniteQuery({
    queryKey: [...SOLVES_KEY, 'history', isGuest ? 'guest' : 'account'],
    queryFn: ({ pageParam }) => store.listPage({ limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useDeleteSolve() {
  const queryClient = useQueryClient();
  const { store } = useSolveStore();

  return useMutation({
    mutationFn: (id: string) => store.remove(id),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useRestoreSolve() {
  const queryClient = useQueryClient();
  const { store } = useSolveStore();

  return useMutation({
    mutationFn: (id: string) => store.restore(id),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useSetSolvePenalty() {
  const queryClient = useQueryClient();
  const { store } = useSolveStore();

  return useMutation({
    mutationFn: ({ id, penalty }: { id: string; penalty: Penalty }) =>
      store.setPenalty(id, penalty),
    onSuccess: () => invalidate(queryClient),
  });
}
