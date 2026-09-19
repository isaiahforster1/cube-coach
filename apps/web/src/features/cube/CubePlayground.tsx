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

const scrambles = createRandomStateScrambleProvider();

/**
 * A place to turn the cube by hand and watch the engine respond.
 *
 * Useful as a feature, and useful as a check: the engine is verified by tests, but seeing
 * a scramble render and unwind correctly is the kind of confirmation no assertion gives.
 */
export function CubePlayground(): ReactElement {
  const [history, setHistory] = useState<Move[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Derived, not stored. Keeping the move list as the single source of truth means undo
  // is just dropping the last move, and the state can never disagree with the history
  // that produced it.
  const state: CubeState = useMemo(() => applyMoves(createSolvedCube(), history), [history]);

  const push = useCallback((move: Move) => {
    setHistory((current) => [...current, move]);
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => current.slice(0, -1));
  }, []);

  const reset = useCallback(() => {
    setHistory([]);
  }, []);

  const scramble = useCallback(async () => {
    setIsGenerating(true);
    try {
      const next = await scrambles.generate();
      setHistory([...next.moves]);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const last = history.at(-1);

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-slate-900">Cube</h2>

      <div className="mt-4 flex flex-col items-center gap-6">
        <CubeView state={state} size={190} />

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
            disabled={history.length === 0}
            className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Reset
          </button>
        </div>

        <div className="w-full text-center">
          <p className="font-mono text-sm break-words text-slate-600">
            {history.length === 0 ? '—' : formatAlgorithm(history)}
          </p>
          <p className="mt-1 text-sm text-slate-400" role="status">
            {isSolved(state)
              ? 'Solved'
              : `${history.length} move${history.length === 1 ? '' : 's'} applied`}
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
