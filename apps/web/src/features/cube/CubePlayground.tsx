import { useCallback, useMemo, useState, type ReactElement } from 'react';
import {
  applyMove,
  applyMoves,
  createRandomStateScrambleProvider,
  createSolvedCube,
  formatAlgorithm,
  FACES,
  invertMove,
  isSolved,
  TURNS,
  type CubeState,
  type Move,
} from '@cube-coach/shared';
import { AppLayout } from '../../components/AppLayout.js';
import { CubeView } from './CubeView.js';
import { fullAngle } from './geometry.js';
import { useTurnAnimation } from './use-turn-animation.js';

const scrambles = createRandomStateScrambleProvider();

/**
 * Quick enough to feel like a button press, slow enough to see which layer moved.
 *
 * Shorter than the scramble player's default because this is hands-on: you are turning
 * the cube yourself and waiting a third of a second per press would be tiresome.
 */
const MOVE_MS = 220;

/**
 * A place to turn the cube by hand and watch the engine respond.
 *
 * Useful as a feature, and useful as a check: the engine is verified by tests, but seeing
 * a scramble render and unwind correctly is the kind of confirmation no assertion gives.
 */
export function CubePlayground(): ReactElement {
  const [history, setHistory] = useState<readonly Move[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const animation = useTurnAnimation<readonly Move[]>({
    msPerMove: MOVE_MS,
    onSettled: setHistory,
  });

  /**
   * The move list including a turn still in the air.
   *
   * A turn that is visibly under way has already happened as far as the user is
   * concerned, so pressing another button must build on it rather than discard it. Every
   * action starts by committing this, which is what makes rapid pressing work.
   */
  const committed = animation.pending ?? history;

  // Derived, not stored. Keeping the move list as the single source of truth means undo
  // is just dropping the last move, and the position can never disagree with the history
  // that produced it.
  const state: CubeState = useMemo(() => applyMoves(createSolvedCube(), history), [history]);

  /** What the cube will show once everything in flight has landed. */
  const destination: CubeState = useMemo(
    () => applyMoves(createSolvedCube(), committed),
    [committed],
  );

  const { start, cancel } = animation;

  const push = useCallback(
    (move: Move) => {
      setHistory(committed);
      start({ move, from: 0, to: fullAngle(move), payload: [...committed, move] });
    },
    [committed, start],
  );

  /**
   * Undo plays the move backwards.
   *
   * The position drops back immediately and the move is drawn fully turned, then unwound
   * to nothing — so the cube looks unchanged at the moment of the swap and then visibly
   * reverses. Snapping straight to the previous position would leave you guessing which
   * layer had moved, which is the whole thing this page exists to show.
   */
  const undo = useCallback(() => {
    const last = committed.at(-1);
    if (last === undefined) return;

    const next = committed.slice(0, -1);
    setHistory(next);
    start({ move: last, from: fullAngle(last), to: 0, payload: next });
  }, [committed, start]);

  const reset = useCallback(() => {
    cancel();
    setHistory([]);
  }, [cancel]);

  const scramble = useCallback(async () => {
    setIsGenerating(true);
    try {
      const next = await scrambles.generate();
      cancel();
      // Twenty moves animated one after another belongs to the scramble player, not
      // here. This page is for turning the cube yourself.
      setHistory(next.moves);
    } finally {
      setIsGenerating(false);
    }
  }, [cancel]);

  const last = committed.at(-1);

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-slate-900">Cube</h2>

      <div className="mt-4 flex flex-col items-center gap-6">
        {/*
          The description follows where the cube is *going*, not where it is mid-turn.
          Announcing "solved" and then "scrambled" a fifth of a second later would be
          noise to anyone listening to it, and the destination is the useful fact.
        */}
        <CubeView
          state={state}
          turn={animation.turn}
          size={190}
          label={isSolved(destination) ? 'Solved cube' : 'Scrambled cube'}
        />

        <div className="flex flex-wrap justify-center gap-2">
          {FACES.map((face) => (
            <div key={face} className="flex overflow-hidden rounded-md border border-slate-300">
              {TURNS.map((turn) => {
                const move = `${face}${turn}` as Move;
                return (
                  <button
                    key={move}
                    type="button"
                    onClick={() => push(move)}
                    className="border-r border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-800 last:border-r-0 hover:bg-slate-100"
                  >
                    {move}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => void scramble()}
            disabled={isGenerating}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {isGenerating ? 'Scrambling…' : 'Scramble'}
          </button>

          <button
            type="button"
            onClick={undo}
            disabled={last === undefined}
            className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Undo {last === undefined ? '' : invertMove(last)}
          </button>

          <button
            type="button"
            onClick={reset}
            disabled={committed.length === 0}
            className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Reset
          </button>
        </div>

        <div className="w-full text-center">
          <p className="font-mono text-sm break-words text-slate-600">
            {committed.length === 0 ? '—' : formatAlgorithm(committed)}
          </p>
          <p className="mt-1 text-sm text-slate-400" role="status">
            {isSolved(destination)
              ? 'Solved'
              : `${committed.length} move${committed.length === 1 ? '' : 's'} applied`}
          </p>
        </div>
      </div>
    </AppLayout>
  );
}

/** Exported for tests: apply one move to a state without going through the component. */
export function applySingleMove(state: CubeState, move: Move): CubeState {
  return applyMove(state, move);
}
