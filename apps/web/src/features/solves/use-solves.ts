import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSolveRequest, Penalty, PracticeSession, Solve } from '@cube-coach/shared';
import { api, ApiError } from '../../lib/api-client.js';
import {
  enqueueSolve,
  readPendingSolves,
  removePendingSolve,
  updatePendingSolve,
} from './solve-queue.js';

export const PRACTICE_SESSIONS_KEY = ['practice-sessions'] as const;
export const SOLVES_KEY = ['solves'] as const;

export function usePracticeSessions() {
  return useQuery({
    queryKey: PRACTICE_SESSIONS_KEY,
    queryFn: async () => {
      const { practiceSessions } = await api.get<{ practiceSessions: PracticeSession[] }>(
        '/practice-sessions',
      );
      return practiceSessions;
    },
  });
}

/**
 * Whether a failure is worth retrying.
 *
 * A 4xx means the server understood and refused — a malformed payload will be refused
 * forever, so retrying is an infinite loop that never delivers the solve. The exceptions
 * are 401 (sign in again and it will work), 408 and 429 (explicitly "try later").
 */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.status === 0) return true; // network failure
  if (error.status === 401 || error.status === 408 || error.status === 429) return true;
  return error.status >= 500;
}

/**
 * Sends queued solves, and keeps trying until they land.
 *
 * Returns the number still waiting, so the interface can be honest about it rather than
 * showing a reassuring tick over a solve that only exists in this browser.
 */
export function useSolveSync() {
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(() => readPendingSolves().length);
  const [isSyncing, setIsSyncing] = useState(false);

  const flush = useCallback(async () => {
    const pending = readPendingSolves();
    if (pending.length === 0) {
      setPendingCount(0);
      return;
    }

    setIsSyncing(true);
    try {
      for (const solve of pending) {
        try {
          await api.post<{ solve: Solve }>('/solves', solve);
          removePendingSolve(solve.id);
        } catch (error) {
          if (isRetryable(error)) {
            // Stop at the first retryable failure rather than hammering a server that
            // is down or a network that is gone. The rest stay queued in order.
            break;
          }
          // Permanently rejected. Dropping it is unpleasant, but keeping it would retry
          // forever and block every solve behind it.
          removePendingSolve(solve.id);
        }
      }
    } finally {
      setPendingCount(readPendingSolves().length);
      setIsSyncing(false);
      // Statistics are derived from solves, so they are stale the moment one changes.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SOLVES_KEY }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
      ]);
    }
  }, [queryClient]);

  // Try on mount (solves left over from a previous visit) and whenever the browser says
  // the connection is back.
  useEffect(() => {
    void flush();

    function handleOnline(): void {
      void flush();
    }

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [flush]);

  return { pendingCount, isSyncing, flush };
}

export function useSaveSolve() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (solve: CreateSolveRequest) => {
      // Persist locally first, so the solve survives a crash between here and the
      // server's acknowledgement.
      enqueueSolve(solve);

      const response = await api.post<{ solve: Solve }>('/solves', solve);
      removePendingSolve(solve.id);
      return response.solve;
    },
    onSuccess: async () => {
      // Statistics are derived from solves, so they are stale the moment one changes.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SOLVES_KEY }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
      ]);
    },
    // The request is idempotent by design, so retrying cannot duplicate a solve.
    retry: 2,
  });
}

export function useUpdateSolvePenalty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, penalty }: { id: string; penalty: Penalty }) => {
      // If the solve has not been sent yet, correct it in the queue instead of asking
      // the server about a solve it has never heard of.
      if (updatePendingSolve(id, { penalty })) return null;

      const { solve } = await api.patch<{ solve: Solve }>(`/solves/${id}`, { penalty });
      return solve;
    },
    onSuccess: async () => {
      // Statistics are derived from solves, so they are stale the moment one changes.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SOLVES_KEY }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
      ]);
    },
  });
}

/**
 * The practice session solves are saved into, creating one if the account has none.
 *
 * New accounts get a session when they register, so this normally just returns the
 * first one. It matters for two cases: accounts created before that behaviour existed,
 * and a user who has archived every session they had.
 *
 * Without it the timer silently fails to save — the worst possible failure, because it
 * looks exactly like success.
 */
export function useCurrentPracticeSession() {
  const queryClient = useQueryClient();
  const { data: sessions, isPending } = usePracticeSessions();

  const create = useMutation({
    mutationFn: async () => {
      const { practiceSession } = await api.post<{ practiceSession: PracticeSession }>(
        '/practice-sessions',
        { name: 'Main session' },
      );
      return practiceSession;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PRACTICE_SESSIONS_KEY });
    },
  });

  useEffect(() => {
    if (isPending || sessions === undefined) return;
    if (sessions.length > 0) return;
    if (create.isPending || create.isSuccess) return;

    create.mutate();
  }, [isPending, sessions, create]);

  return { practiceSessionId: sessions?.[0]?.id, isPending };
}
