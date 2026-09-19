import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Solve } from '@cube-coach/shared';
import { api } from '../../lib/api-client.js';
import { useSession } from '../auth/use-session.js';
import { clearGuestSolves, guestSolvesForUpload } from '../solves/guest-store.js';
import { SOLVES_KEY, STATS_KEY, useCurrentPracticeSession } from '../solves/use-solves.js';

export type MigrationStatus = 'idle' | 'uploading' | 'done' | 'failed';

/**
 * Move a guest's solves onto their account the moment they sign in.
 *
 * Without this, creating an account would appear to delete everything a guest had done,
 * which punishes exactly the action we want to encourage. The upload is safe to attempt
 * because creating a solve is idempotent on the client-generated id — a half-finished
 * migration resumed later cannot produce duplicates.
 *
 * The local copy is cleared only after every solve has been accepted. If the upload fails
 * part way, the solves stay where they are and it is retried next time.
 */
export function useGuestMigration(): { status: MigrationStatus; migratedCount: number } {
  const { data: user } = useSession();
  const { practiceSessionId } = useCurrentPracticeSession();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<MigrationStatus>('idle');
  const [migratedCount, setMigratedCount] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (user === null || user === undefined) return;
    if (practiceSessionId === undefined) return;
    if (started.current) return;

    const pending = guestSolvesForUpload();
    if (pending.length === 0) return;

    started.current = true;
    setStatus('uploading');

    void (async () => {
      try {
        for (const solve of pending) {
          // The guest store uses a placeholder session id that does not exist on the
          // server, so each solve is re-pointed at the account's real one.
          await api.post<{ solve: Solve }>('/solves', { ...solve, practiceSessionId });
        }

        clearGuestSolves();
        setMigratedCount(pending.length);
        setStatus('done');

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: SOLVES_KEY }),
          queryClient.invalidateQueries({ queryKey: STATS_KEY }),
        ]);
      } catch {
        // Left in local storage deliberately, so nothing is lost and the next sign-in
        // tries again.
        setStatus('failed');
        started.current = false;
      }
    })();
  }, [user, practiceSessionId, queryClient]);

  return { status, migratedCount };
}
