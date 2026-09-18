import { useMemo, useState, type ReactElement } from 'react';
import type { Penalty } from '@cube-coach/shared';
import { AppLayout } from '../../components/AppLayout.js';
import {
  useDeleteSolve,
  useRestoreSolve,
  useSetSolvePenalty,
  useSolveHistory,
} from './use-solve-history.js';
import { SolveRow } from './SolveRow.js';

export function HistoryPage(): ReactElement {
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSolveHistory();

  const setPenalty = useSetSolvePenalty();
  const deleteSolve = useDeleteSolve();
  const restoreSolve = useRestoreSolve();

  const [lastDeletedId, setLastDeletedId] = useState<string | null>(null);

  // Pages arrive separately; the list is the concatenation of all of them.
  const solves = useMemo(() => data?.pages.flatMap((page) => page.solves) ?? [], [data]);

  function handleDelete(id: string): void {
    setLastDeletedId(id);
    deleteSolve.mutate(id);
  }

  function handleUndo(): void {
    if (lastDeletedId === null) return;
    restoreSolve.mutate(lastDeletedId);
    setLastDeletedId(null);
  }

  return (
    <AppLayout>
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-slate-900">History</h2>
        <p className="text-sm text-slate-500">
          {solves.length} solve{solves.length === 1 ? '' : 's'}
          {hasNextPage ? '+' : ''}
        </p>
      </div>

      {/*
        An undo affordance rather than a confirmation dialogue. Confirmations interrupt
        every delete to guard against the rare mistaken one; undo costs nothing when the
        delete was intended and fixes it when it was not.
      */}
      {lastDeletedId !== null && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between rounded-md bg-slate-800 px-4 py-2 text-sm text-white"
        >
          <span>Solve deleted.</span>
          <button
            type="button"
            onClick={handleUndo}
            className="font-medium text-sky-300 underline hover:text-sky-200"
          >
            Undo
          </button>
        </div>
      )}

      {isPending && <p className="mt-8 text-slate-500">Loading…</p>}

      {isError && (
        <p role="alert" className="mt-8 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load your history.
        </p>
      )}

      {!isPending && !isError && solves.length === 0 && (
        <p className="mt-8 text-slate-500">No solves yet. Head to the timer and record one.</p>
      )}

      {solves.length > 0 && (
        <ul className="mt-4">
          {solves.map((solve, position) => (
            <SolveRow
              key={solve.id}
              solve={solve}
              // Numbered oldest-to-newest the way a cuber counts a session, so the
              // newest solve at the top carries the highest number.
              index={solves.length - position}
              onSetPenalty={(penalty: Penalty) => setPenalty.mutate({ id: solve.id, penalty })}
              onDelete={() => handleDelete(solve.id)}
            />
          ))}
        </ul>
      )}

      {/*
        A button rather than scroll-triggered loading. Infinite scroll makes the footer
        unreachable and takes control away from someone using a keyboard.
      */}
      {hasNextPage && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          className="mt-6 w-full rounded-md border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </AppLayout>
  );
}
