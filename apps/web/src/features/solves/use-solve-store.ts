import { useMemo } from 'react';
import { useSession } from '../auth/use-session.js';
import { createApiStore } from './api-store.js';
import { createGuestStore } from './guest-store.js';
import type { SolveStore } from './solve-store.js';

export interface SolveStoreContext {
  readonly store: SolveStore;
  /** True when nobody is signed in and solves are kept in this browser only. */
  readonly isGuest: boolean;
  /** Undefined until the session check finishes, so callers can wait rather than guess. */
  readonly isPending: boolean;
}

/**
 * The store to use, decided once from the session.
 *
 * Everything else in the application asks for a store and gets on with it. That is the
 * whole point of the interface: guest mode is one branch here rather than a condition
 * threaded through every hook and component.
 */
export function useSolveStore(practiceSessionId?: string): SolveStoreContext {
  const { data: user, isPending } = useSession();
  const isGuest = user === null;

  const store = useMemo(
    () => (isGuest ? createGuestStore() : createApiStore(practiceSessionId)),
    [isGuest, practiceSessionId],
  );

  return { store, isGuest, isPending };
}
