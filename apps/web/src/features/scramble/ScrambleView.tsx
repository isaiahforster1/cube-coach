import { useId, type ReactElement } from 'react';
import type { Scramble } from '@cube-coach/shared';
import { Collapse } from '../../components/Collapse.js';
import { InfoTip } from '../../components/InfoTip.js';
import {
  ChevronDownIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RestartIcon,
} from '../../components/icons.js';
import { usePreference } from '../../lib/use-preference.js';
import { CubeView } from '../cube/CubeView.js';
import { useScramblePlayer } from '../cube/use-scramble-player.js';
import { ScrambleDifficultyBadge } from './ScrambleDifficultyBadge.js';
import { useScrambleDifficulty } from './use-scramble-difficulty.js';

const OPEN_KEY = 'cube-coach.show-scramble-cube';
const SPEED_KEY = 'cube-coach.scramble-speed';

/** Quarter turns per second. Slow enough to follow, quick enough not to be tedious. */
const DEFAULT_SPEED = 2;
const MIN_SPEED = 0.5;
const MAX_SPEED = 6;

/**
 * The scramble, and — only if you ask for it — a cube that performs it.
 *
 * Notation is a compressed language for people who already know it. `R U2 F'` tells an
 * experienced cuber precisely what to do and tells a newcomer nothing, which quietly
 * makes a timer unusable for exactly the people most likely to want coaching.
 *
 * The animation is the translation. It is behind a disclosure rather than on screen by
 * default because someone who reads notation fluently would find a cube in the way of
 * the thing they came for, and the choice is remembered so nobody has to keep making
 * it.
 */
export function ScrambleView({ scramble }: { scramble: Scramble | null }): ReactElement {
  const [isOpen, setOpen] = usePreference(OPEN_KEY, false);
  const [speed, setSpeed] = usePreference(SPEED_KEY, DEFAULT_SPEED);
  const panelId = useId();

  const rating = useScrambleDifficulty(scramble?.moves ?? null);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <p className="text-center font-mono text-lg break-words text-slate-700">
          {scramble?.notation ?? 'Generating scramble…'}
        </p>
        {rating !== null && <ScrambleDifficultyBadge rating={rating} />}
      </div>

      {/*
        Say so when the scramble is the weaker kind.

        Random-move scrambles do not produce every position equally often, which is why
        competitions do not use them. That only matters if you know you are getting
        them — presenting one as though it were competition quality is the dishonest
        option, and silence is what makes it dishonest.
      */}
      {scramble?.quality === 'random-move' && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700" role="status">
          Practice scramble
          <InfoTip term="a practice scramble">
            The solver that makes competition-quality scrambles could not start in this browser, so
            these are random turns instead. They are perfectly good to practise on, but some
            positions come up more often than others, so times are not strictly comparable with
            official ones.
          </InfoTip>
        </p>
      )}

      <button
        type="button"
        onClick={(event) => {
          setOpen(!isOpen);
          // Hand the spacebar straight back to the timer, which otherwise keeps
          // pressing this button instead of starting a solve.
          event.currentTarget.blur();
        }}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex items-center gap-1 rounded px-1 text-sm text-slate-500 transition-colors duration-150 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none motion-reduce:transition-none"
      >
        {isOpen ? 'Hide cube' : 'Show me this scramble'}
        <ChevronDownIcon
          className={`size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/*
        The player is mounted only while the panel is open — it holds an animation loop
        and a cube of 26 pieces, and neither should exist for the majority who never open
        it. `Collapse` keeps it mounted until the closing animation finishes, so it
        shrinks away rather than vanishing and leaving an empty box behind.
      */}
      <Collapse open={isOpen} id={panelId}>
        {scramble !== null && (
          <ScramblePlayer
            key={scramble.notation}
            scramble={scramble}
            speed={speed}
            onSpeedChange={setSpeed}
          />
        )}
      </Collapse>
    </div>
  );
}

function ScramblePlayer({
  scramble,
  speed,
  onSpeedChange,
}: {
  scramble: Scramble;
  speed: number;
  onSpeedChange: (value: number) => void;
}): ReactElement {
  const player = useScramblePlayer({
    moves: scramble.moves,
    msPerMove: 1000 / speed,
  });

  const total = scramble.moves.length;

  return (
    <div className="flex flex-col items-center">
      <CubeView
        state={player.state}
        turn={player.turn}
        size={150}
        label={`The scramble after ${player.index} of ${total} moves`}
      />

      {/*
        The notation again, with the move being performed marked. This is the part that
        teaches the notation: you see `R'` light up at the same moment the right-hand
        layer turns backwards, and after a few scrambles you no longer need the cube.
      */}
      <p className="flex flex-wrap justify-center gap-x-1.5 font-mono text-sm">
        {scramble.moves.map((move, position) => (
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

      <div className="mt-3 flex items-center gap-2">
        <ControlButton
          onClick={player.stepBack}
          disabled={!player.canStepBack}
          label="Previous move"
        >
          <PreviousIcon />
        </ControlButton>

        {/*
          The one control most people will reach for, so it is filled rather than
          outlined. Slate rather than the sky accent, which is spoken for by the page's
          own primary actions — two competing "press me" colours in one view and neither
          means anything.
        */}
        <ControlButton
          onClick={player.isPlaying ? player.pause : player.play}
          label={player.isPlaying ? 'Pause' : 'Play the scramble'}
          emphasis="primary"
        >
          {player.isPlaying ? <PauseIcon /> : <PlayIcon />}
        </ControlButton>

        <ControlButton
          onClick={player.stepForward}
          disabled={!player.canStepForward}
          label="Next move"
        >
          <NextIcon />
        </ControlButton>

        <ControlButton onClick={player.reset} disabled={player.index === 0} label="Back to solved">
          <RestartIcon />
        </ControlButton>

        <span className="ml-1 text-sm text-slate-500 tabular-nums" role="status">
          {player.index} / {total}
        </span>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-slate-500">
        Speed
        <input
          type="range"
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={0.5}
          value={speed}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
          /*
            Released, not changed. Blurring on change would make the arrow keys
            unusable, but leaving a slider focused after a drag means the next press of
            space adjusts the speed instead of starting a solve.
          */
          onPointerUp={(event) => event.currentTarget.blur()}
          className="w-32 accent-sky-600"
        />
        <span className="tabular-nums">{speed.toFixed(1)}/s</span>
      </label>
    </div>
  );
}

const CONTROL_STYLES = {
  default: 'border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  primary: 'border-slate-800 bg-slate-800 text-white hover:border-slate-700 hover:bg-slate-700',
} as const;

function ControlButton({
  onClick,
  disabled = false,
  label,
  emphasis = 'default',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  emphasis?: keyof typeof CONTROL_STYLES;
  children: ReactElement;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        onClick();
        // Every control here gives the spacebar back to the timer as soon as it is
        // used, or watching the scramble would quietly break starting a solve.
        event.currentTarget.blur();
      }}
      className={`flex size-9 items-center justify-center rounded-md border transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none disabled:opacity-40 motion-reduce:transition-none ${CONTROL_STYLES[emphasis]}`}
    >
      {children}
    </button>
  );
}
