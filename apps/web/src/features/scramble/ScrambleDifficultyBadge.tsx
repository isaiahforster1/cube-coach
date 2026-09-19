import type { ReactElement } from 'react';
import type { ScrambleDifficulty, ScrambleRating } from '@cube-coach/shared';
import { InfoTip } from '../../components/InfoTip.js';
import { FACE_NAMES } from '../cube/colours.js';

const LABELS: Record<ScrambleDifficulty, string> = {
  easy: 'Easy',
  standard: 'Standard',
  hard: 'Hard',
};

/**
 * Colour carries no information that the word does not. Someone who cannot distinguish
 * amber from green reads "Hard" and loses nothing.
 */
const STYLES: Record<ScrambleDifficulty, string> = {
  easy: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  standard: 'border-slate-300 bg-slate-50 text-slate-600',
  hard: 'border-amber-400 bg-amber-50 text-amber-800',
};

/**
 * How much of a head start this scramble gives you.
 *
 * Worth showing because a time means nothing on its own. Two solves ten seconds apart
 * can be the same quality of solve if one scramble handed over a three-move cross and
 * the other a seven-move one — and until now the only way to know that was to be good
 * enough to see it.
 *
 * The claim is deliberately narrow, and the tooltip says exactly what was measured
 * rather than leaving "hard" to mean whatever the reader assumes.
 */
export function ScrambleDifficultyBadge({ rating }: { rating: ScrambleRating }): ReactElement {
  const { difficulty, crossMoves, face } = rating;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[difficulty]}`}>
        {LABELS[difficulty]}
      </span>

      <InfoTip term="the scramble difficulty">
        {`Measured by the cross: this scramble needs ${crossMoves} ${
          crossMoves === 1 ? 'move' : 'moves'
        } at minimum to solve the ${FACE_NAMES[face]} cross, worked out exactly. Most need 5 or 6, so fewer is a friendly start and 7 or more is real work before the solve has begun. It says nothing about the rest of the solve.`}
      </InfoTip>
    </span>
  );
}
