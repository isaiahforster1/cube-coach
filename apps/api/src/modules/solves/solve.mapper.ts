import type { Penalty as DbPenalty, PracticeSession, Solve } from '@prisma/client';
import type { Penalty } from '@cube-coach/shared';

/**
 * The wire format and the database use different spellings for the same three values.
 *
 * Keeping them separate is deliberate. The database enum is a storage detail that a
 * migration could change; the wire format is a contract with clients that cannot change
 * without breaking them. Translating in one place means neither leaks into the other.
 */
const TO_DB: Record<Penalty, DbPenalty> = {
  none: 'NONE',
  plus2: 'PLUS_TWO',
  dnf: 'DNF',
};

const FROM_DB: Record<DbPenalty, Penalty> = {
  NONE: 'none',
  PLUS_TWO: 'plus2',
  DNF: 'dnf',
};

export function toDbPenalty(penalty: Penalty): DbPenalty {
  return TO_DB[penalty];
}

export function fromDbPenalty(penalty: DbPenalty): Penalty {
  return FROM_DB[penalty];
}

/** A solve as the API returns it. Internal columns stay internal. */
export function toSolveResponse(solve: Solve) {
  return {
    id: solve.id,
    practiceSessionId: solve.practiceSessionId,
    scramble: solve.scramble,
    durationMs: solve.durationMs,
    penalty: fromDbPenalty(solve.penalty),
    comment: solve.comment,
    solvedAt: solve.solvedAt.toISOString(),
  };
}

export function toPracticeSessionResponse(session: PracticeSession) {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt.toISOString(),
    archivedAt: session.archivedAt?.toISOString() ?? null,
  };
}

/**
 * Keyset pagination cursor: the sort key of the last row already seen.
 *
 * Offset pagination would be simpler, and wrong here. History is ordered newest first
 * and new solves arrive constantly, so an offset shifts under the reader — they see a
 * duplicate or miss a row. It also degrades on deep pages, because the database must
 * count past every skipped row. A cursor names a position instead of a distance.
 */
export function encodeCursor(solvedAt: Date, id: string): string {
  return Buffer.from(`${solvedAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { solvedAt: Date; id: string } | null {
  try {
    const [timestamp, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (timestamp === undefined || id === undefined) return null;

    const solvedAt = new Date(timestamp);
    if (Number.isNaN(solvedAt.getTime())) return null;

    return { solvedAt, id };
  } catch {
    // A cursor comes from the client and can be anything. A malformed one is a bad
    // request, not a crash.
    return null;
  }
}
