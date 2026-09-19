import { type ReactElement } from 'react';
import type { CubeState, Move } from '@cube-coach/shared';
import {
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RestartIcon,
} from '../../components/icons.js';
import { CubeView } from '../cube/CubeView.js';
import { useScramblePlayer } from '../cube/use-scramble-player.js';

/** Slow enough to follow a move you are trying to learn. */
const MS_PER_MOVE = 420;

/**
 * Watch an algorithm solve its case.
 *
 * The same player the scramble uses, started from the case instead of from a solved
 * cube — which is the whole benefit of the position being derived from the algorithm.
 * Reading `R U R' U'` teaches you nothing about which pieces it moves; watching it
 * finish the cube in front of you does.
 */
export function CasePlayer({
  moves,
  startFrom,
  angle,
}: {
  moves: readonly Move[];
  startFrom: CubeState;
  angle?: { readonly x: number; readonly y: number };
}): ReactElement {
  const player = useScramblePlayer({ moves, msPerMove: MS_PER_MOVE, from: startFrom });

  return (
    <div className="mt-3 flex flex-col items-center gap-3 border-t border-slate-100 pt-4">
      <CubeView
        state={player.state}
        turn={player.turn}
        size={120}
        {...(angle === undefined ? {} : { angle })}
        label={`The case after ${player.index} of ${moves.length} moves`}
      />

      <p className="flex flex-wrap justify-center gap-x-1 font-mono text-xs">
        {moves.map((move, position) => (
          <span
            key={`${position}-${move}`}
            className={
              position === player.currentMove
                ? 'rounded bg-sky-100 px-1 font-semibold text-sky-900'
                : position < player.index
                  ? 'px-1 text-slate-400'
                  : 'px-1 text-slate-600'
            }
          >
            {move}
          </span>
        ))}
      </p>

      <div className="flex items-center gap-1.5">
        <Control onClick={player.stepBack} disabled={!player.canStepBack} label="Previous move">
          <PreviousIcon className="size-3.5" />
        </Control>

        <Control
          onClick={player.isPlaying ? player.pause : player.play}
          label={player.isPlaying ? 'Pause' : 'Play the algorithm'}
          primary
        >
          {player.isPlaying ? (
            <PauseIcon className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
        </Control>

        <Control onClick={player.stepForward} disabled={!player.canStepForward} label="Next move">
          <NextIcon className="size-3.5" />
        </Control>

        <Control onClick={player.reset} disabled={player.index === 0} label="Back to the case">
          <RestartIcon className="size-3.5" />
        </Control>

        <span className="ml-1 text-xs text-slate-500 tabular-nums" role="status">
          {player.index} / {moves.length}
        </span>
      </div>
    </div>
  );
}

function Control({
  onClick,
  disabled = false,
  label,
  primary = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  primary?: boolean;
  children: ReactElement;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        onClick();
        event.currentTarget.blur();
      }}
      className={`flex size-7 items-center justify-center rounded-md border transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none disabled:opacity-40 motion-reduce:transition-none ${
        primary
          ? 'border-slate-800 bg-slate-800 text-white hover:border-slate-700 hover:bg-slate-700'
          : 'border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}
