import type { ReactElement } from 'react';
import { formatSolve, type Penalty, type Solve } from '@cube-coach/shared';

export interface SolveRowProps {
  readonly solve: Solve;
  readonly index: number;
  readonly onSetPenalty: (penalty: Penalty) => void;
  readonly onDelete: () => void;
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function SolveRow({ solve, index, onSetPenalty, onDelete }: SolveRowProps): ReactElement {
  const togglePenalty = (penalty: Penalty) =>
    onSetPenalty(solve.penalty === penalty ? 'none' : penalty);

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 py-3">
      <span className="w-10 shrink-0 text-right text-sm text-slate-400 tabular-nums">{index}</span>

      <span
        className={`w-24 shrink-0 font-mono text-lg tabular-nums ${
          solve.penalty === 'dnf' ? 'text-slate-400 line-through' : 'text-slate-900'
        }`}
      >
        {formatSolve(solve.durationMs, solve.penalty)}
      </span>

      <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">
        {solve.scramble}
      </span>

      <time dateTime={solve.solvedAt} className="shrink-0 text-xs text-slate-400">
        {TIME_FORMAT.format(new Date(solve.solvedAt))}
      </time>

      <span className="flex shrink-0 gap-1">
        <SmallButton
          label="+2"
          pressed={solve.penalty === 'plus2'}
          onClick={() => togglePenalty('plus2')}
        />
        <SmallButton
          label="DNF"
          pressed={solve.penalty === 'dnf'}
          onClick={() => togglePenalty('dnf')}
        />
        {/*
          An icon alone would be unreadable to a screen reader, and "delete" alone would
          be ambiguous when the page lists fifty of them.
        */}
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete solve ${index}, ${formatSolve(solve.durationMs, solve.penalty)}`}
          className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:border-red-300 hover:text-red-700"
        >
          Delete
        </button>
      </span>
    </li>
  );
}

function SmallButton({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`rounded border px-2 py-0.5 text-xs font-medium ${
        pressed
          ? 'border-amber-500 bg-amber-50 text-amber-800'
          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}
