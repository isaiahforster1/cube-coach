import type { CreateSolveRequest, Penalty, Solve } from '@cube-coach/shared';

/**
 * Where solves live.
 *
 * Two implementations: one talking to the API for signed-in users, one using
 * localStorage for guests. Components and hooks depend on this interface and never learn
 * which they have, so the whole application works identically with or without an account.
 *
 * The alternative — checking "am I signed in?" at every call site — would spread that
 * question through the entire feature set and guarantee somewhere gets it wrong.
 */
export interface SolvePage {
  readonly solves: Solve[];
  readonly nextCursor: string | null;
}

export interface SolveStore {
  listPage(options: { limit: number; cursor: string | null }): Promise<SolvePage>;
  /** Every solve, oldest first, for computing statistics. */
  listAll(): Promise<Solve[]>;
  create(request: CreateSolveRequest): Promise<Solve>;
  setPenalty(id: string, penalty: Penalty): Promise<Solve | null>;
  remove(id: string): Promise<void>;
  restore(id: string): Promise<void>;
}
