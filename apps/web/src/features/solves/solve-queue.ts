import type { CreateSolveRequest } from '@cube-coach/shared';

const STORAGE_KEY = 'cube-coach.pending-solves';

/**
 * A durable queue of solves that have not yet reached the server.
 *
 * A solve is written here *before* the request is attempted, not after it fails. That
 * ordering is the whole point: if the browser is closed, the tab crashes, or the laptop
 * sleeps mid-request, the solve is already on disk and will be sent next time. Queueing
 * only on failure would lose exactly the cases that are hardest to reproduce.
 *
 * Every read and write is wrapped, because localStorage throws rather than returning
 * undefined in private browsing and when the quota is exhausted. Losing the queue is
 * unfortunate; crashing the timer because of it would be worse.
 */
export function readPendingSolves(): CreateSolveRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CreateSolveRequest[]) : [];
  } catch {
    return [];
  }
}

function write(solves: CreateSolveRequest[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(solves));
  } catch {
    // Nothing useful to do. The solve is still in memory and the request is still going
    // to be attempted; only the durability guarantee is lost.
  }
}

export function enqueueSolve(solve: CreateSolveRequest): void {
  write([...readPendingSolves().filter((pending) => pending.id !== solve.id), solve]);
}

export function removePendingSolve(id: string): void {
  write(readPendingSolves().filter((pending) => pending.id !== id));
}

/** Apply a penalty correction to a solve that has not been sent yet. */
export function updatePendingSolve(id: string, changes: Partial<CreateSolveRequest>): boolean {
  const pending = readPendingSolves();
  const match = pending.find((solve) => solve.id === id);
  if (match === undefined) return false;

  write(pending.map((solve) => (solve.id === id ? { ...solve, ...changes } : solve)));
  return true;
}

export function clearPendingSolves(): void {
  write([]);
}
