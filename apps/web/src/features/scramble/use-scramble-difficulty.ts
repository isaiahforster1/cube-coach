import { useEffect, useState } from 'react';
import { rateScramble, type Move, type ScrambleRating } from '@cube-coach/shared';

/**
 * Rate a scramble, without making the page wait for it.
 *
 * Rating a scramble means asking for the optimal cross length, and the first such
 * question builds a search over every reachable cross position — around a tenth of a
 * second of solid computation. Every question after that is a table lookup and
 * effectively free.
 *
 * A tenth of a second is short, and it is still too long to spend before showing
 * someone their scramble: that work would land in the middle of the first paint. So the
 * rating is computed after the render instead, and the label appears a moment later. The
 * scramble is readable the whole time, which is what actually matters.
 *
 * A web worker would keep it off the main thread entirely. That is the right answer if
 * this ever grows, and it is more machinery than a one-off tenth of a second deserves.
 */
export function useScrambleDifficulty(moves: readonly Move[] | null): ScrambleRating | null {
  const [rating, setRating] = useState<ScrambleRating | null>(null);

  useEffect(() => {
    if (moves === null) {
      setRating(null);
      return;
    }

    // Drop the previous rating first. Leaving it on screen would label the new
    // scramble with the last one's difficulty for a frame, which is worse than a
    // moment with no label at all.
    setRating(null);

    let cancelled = false;
    const id = setTimeout(() => {
      if (!cancelled) setRating(rateScramble(moves));
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [moves]);

  return rating;
}
