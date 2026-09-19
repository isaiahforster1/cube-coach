import type { CreateSolveRequest, Penalty, Solve } from '@cube-coach/shared';
import type { SolvePage, SolveStore } from './solve-store.js';

const STORAGE_KEY = 'cube-coach.guest-solves';

/** The practice session a guest's solves belong to, so the shape matches the API's. */
export const GUEST_PRACTICE_SESSION_ID = '00000000-0000-4000-8000-000000000000';

interface StoredSolve extends Solve {
  /** Soft delete, mirroring the server, so undo works the same way for guests. */
  readonly deletedAt: string | null;
}

/**
 * Every read and write is wrapped, because localStorage throws rather than returning
 * undefined in private browsing and when the quota is exhausted. A guest losing their
 * solves is bad; the timer crashing because storage is unavailable is worse.
 */
function read(): StoredSolve[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredSolve[]) : [];
  } catch {
    return [];
  }
}

function write(solves: StoredSolve[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(solves));
  } catch {
    // Nothing useful to do. The session continues in memory.
  }
}

/** Oldest first, which is the order statistics need. */
function living(): StoredSolve[] {
  return read()
    .filter((solve) => solve.deletedAt === null)
    .sort((a, b) => a.solvedAt.localeCompare(b.solvedAt));
}

function toSolve({ deletedAt: _deletedAt, ...solve }: StoredSolve): Solve {
  return solve;
}

export function countGuestSolves(): number {
  return living().length;
}

/** Read every guest solve in the shape the API expects, for uploading on sign-up. */
export function guestSolvesForUpload(): CreateSolveRequest[] {
  return living().map((solve) => ({
    id: solve.id,
    practiceSessionId: solve.practiceSessionId,
    scramble: solve.scramble,
    durationMs: solve.durationMs,
    penalty: solve.penalty,
    solvedAt: solve.solvedAt,
    comment: solve.comment,
  }));
}

export function clearGuestSolves(): void {
  write([]);
}

export function createGuestStore(): SolveStore {
  return {
    listPage({ limit, cursor }): Promise<SolvePage> {
      // Newest first, matching the API. The cursor is simply an offset here: a guest's
      // history is small and held in memory, so the reasons for keyset pagination on the
      // server — stability under concurrent inserts, index-friendliness — do not apply.
      const all = [...living()].reverse();
      const start = cursor === null ? 0 : Number.parseInt(cursor, 10);
      const page = all.slice(start, start + limit);
      const next = start + limit;

      return Promise.resolve({
        solves: page.map(toSolve),
        nextCursor: next < all.length ? String(next) : null,
      });
    },

    listAll(): Promise<Solve[]> {
      return Promise.resolve(living().map(toSolve));
    },

    create(request): Promise<Solve> {
      const solve: StoredSolve = {
        id: request.id,
        practiceSessionId: GUEST_PRACTICE_SESSION_ID,
        scramble: request.scramble,
        durationMs: request.durationMs,
        penalty: request.penalty,
        comment: request.comment,
        solvedAt: request.solvedAt,
        deletedAt: null,
      };

      // Replace rather than append on a repeated id, so a retry behaves the same way it
      // does against the server.
      write([...read().filter((existing) => existing.id !== solve.id), solve]);
      return Promise.resolve(toSolve(solve));
    },

    setPenalty(id, penalty: Penalty): Promise<Solve | null> {
      const solves = read();
      const match = solves.find((solve) => solve.id === id);
      if (match === undefined) return Promise.resolve(null);

      const updated = { ...match, penalty };
      write(solves.map((solve) => (solve.id === id ? updated : solve)));
      return Promise.resolve(toSolve(updated));
    },

    remove(id): Promise<void> {
      write(
        read().map((solve) =>
          solve.id === id ? { ...solve, deletedAt: new Date().toISOString() } : solve,
        ),
      );
      return Promise.resolve();
    },

    restore(id): Promise<void> {
      write(read().map((solve) => (solve.id === id ? { ...solve, deletedAt: null } : solve)));
      return Promise.resolve();
    },
  };
}
