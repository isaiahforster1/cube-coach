import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSolveRequest, Penalty, PracticeSession, Solve } from '@cube-coach/shared';
import { api, ApiError } from '../../lib/api-client.js';
import { useSession } from '../auth/use-session.js';
import { GUEST_PRACTICE_SESSION_ID } from './guest-store.js';
import {
  enqueueSolve,
  readPendingSolves,
  removePendingSolve,
  updatePendingSolve,
} from './solve-queue.js';
import { useSolveStore } from './use-solve-store.js';

export const PRACTICE_SESSIONS_KEY = ['practice-sessions'] as const;
export const SOLVES_KEY = ['solves'] as const;
export const STATS_KEY = ['stats'] as const;

/** Everything derived from solves is stale the moment one changes. */
async function invalidateSolveData(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: SOLVES_KEY }),
    queryClient.invalidateQueries({ queryKey: STATS_KEY }),
  ]);
}

export function usePracticeSessions() {
  const { data: user } = useSession();

  return useQuery({
    queryKey: [...PRACTICE_SESSIONS_KEY, user?.id ?? 'guest'],
    queryFn: async () => {
      const { practiceSessions } = await api.get<{ practiceSessions: PracticeSession[] }>(
        '/practice-sessions',
      );
      return practiceSessions;
    },
    enabled: user !== null && user !== undefined,
  });
}

/**
 * The practice session solves are saved into.
 *
 * A guest gets a fixed local one, so the timer never has to care whether an account
 * exists. A signed-in user gets their first session, and one is created if the account
 * somehow has none — which covers accounts made before sessions were created on
 * registration, and anyone who has archived every session they had.
 */
export function useCurrentPracticeSession() {
  const queryClient = useQueryClient();
  const { data: user } = useSession();
  const isGuest = user === null;
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
    if (isGuest || isPending || sessions === undefined) return;
    if (sessions.length > 0) return;
    if (create.isPending || create.isSuccess) return;

    create.mutate();
  }, [isGuest, isPending, sessions, create]);

  return {
    practiceSessionId: isGuest ? GUEST_PRACTICE_SESSION_ID : sessions?.[0]?.id,
    isPending: isGuest ? false : isPending,
  };
}

/**
 * Whether a failure is worth retrying.
 *
 * A 4xx means the server understood and refused — a malformed payload will be refused
 * forever, so retrying is a loop that never delivers. The exceptions are 401 (sign in and
 * it works), 408 and 429 (explicitly "try later").
 */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.status === 0) return true;
  if (error.status === 401 || error.status === 408 || error.status === 429) return true;
  return error.status >= 500;
}

/**
 * Sends queued solves, and keeps trying until they land.
 *
 * Only meaningful for a signed-in user: a guest's solves are already at their
 * destination, so there is nothing to sync and nothing to warn about.
 */
export function useSolveSync() {
  const queryClient = useQueryClient();
  const { isGuest } = useSolveStore();
  const [pendingCount, setPendingCount] = useState(() =>
    isGuest ? 0 : readPendingSolves().length,
  );
  const [isSyncing, setIsSyncing] = useState(false);

  const flush = useCallback(async () => {
    if (isGuest) {
      setPendingCount(0);
      return;
    }

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
          if (isRetryable(error)) break;
          // Permanently rejected. Keeping it would retry forever and block everything
          // queued behind it.
          removePendingSolve(solve.id);
        }
      }
    } finally {
      setPendingCount(readPendingSolves().length);
      setIsSyncing(false);
      await invalidateSolveData(queryClient);
    }
  }, [queryClient, isGuest]);

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
  const { store, isGuest } = useSolveStore();

  return useMutation({
    mutationFn: async (solve: CreateSolveRequest) => {
      // A guest's store is the destination, so there is nothing to queue against.
      if (isGuest) return store.create(solve);

      // Persist locally first, so the solve survives a crash between here and the
      // server's acknowledgement.
      enqueueSolve(solve);
      const saved = await store.create(solve);
      removePendingSolve(solve.id);
      return saved;
    },
    onSuccess: () => invalidateSolveData(queryClient),
    // Creation is idempotent by design, so retrying cannot duplicate a solve.
    retry: 2,
  });
}

export function useUpdateSolvePenalty() {
  const queryClient = useQueryClient();
  const { store, isGuest } = useSolveStore();

  return useMutation({
    mutationFn: async ({ id, penalty }: { id: string; penalty: Penalty }) => {
      // If the solve has not reached the server yet, correct it in the queue rather than
      // asking about a solve the server has never heard of.
      if (!isGuest && updatePendingSolve(id, { penalty })) return null;
      return store.setPenalty(id, penalty);
    },
    onSuccess: () => invalidateSolveData(queryClient),
  });
}
