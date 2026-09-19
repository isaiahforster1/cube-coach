import { useId, useMemo, useState, type ReactElement } from 'react';
import { movesOf, PLL_CASES, positionOf, type PllCase, type PllFamily } from '@cube-coach/shared';
import { AppLayout } from '../../components/AppLayout.js';
import { Collapse } from '../../components/Collapse.js';
import { ChevronDownIcon } from '../../components/icons.js';
import { InfoTip } from '../../components/InfoTip.js';
import { CubeView } from '../cube/CubeView.js';
import { CasePlayer } from './CasePlayer.js';

/** Looking down at the top, which is the face you read a last-layer case from. */
const CASE_ANGLE = { x: -58, y: -35 };

const FAMILY_LABELS: Record<PllFamily, string> = {
  corners: 'Corners only',
  edges: 'Edges only',
  both: 'Corners and edges',
};

const FAMILY_ORDER: PllFamily[] = ['edges', 'corners', 'both'];

/**
 * The last-layer algorithm library.
 *
 * Every picture on this page is drawn by the engine from the algorithm beside it, so
 * there are no sticker diagrams to get out of step with the moves. A mistyped algorithm
 * would show the wrong cube *and* fail a test, rather than quietly teaching the wrong
 * thing — which is the failure mode that matters for a page whose whole job is to be
 * trusted.
 */
export function AlgorithmsPage(): ReactElement {
  const [query, setQuery] = useState('');
  const searchId = useId();

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return PLL_CASES;

    return PLL_CASES.filter(
      (entry) =>
        entry.id.toLowerCase().includes(needle) ||
        entry.name.toLowerCase().includes(needle) ||
        FAMILY_LABELS[entry.family].toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <AppLayout>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-xl font-semibold text-slate-900">
          Last layer
          <InfoTip term="the last layer">
            The final step of a solve: the top face is already finished and the pieces only need
            moving into place. There are exactly 21 ways they can be arranged, and this is all of
            them.
          </InfoTip>
        </h2>

        <label htmlFor={searchId} className="sr-only">
          Search cases
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
        />
      </div>

      {matches.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">No case matches “{query}”.</p>
      ) : (
        FAMILY_ORDER.map((family) => {
          const cases = matches.filter((entry) => entry.family === family);
          if (cases.length === 0) return null;

          return (
            <section key={family} className="mt-8">
              <h3 className="text-sm font-medium tracking-wide text-slate-500 uppercase">
                {FAMILY_LABELS[family]}
              </h3>

              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {cases.map((entry) => (
                  <li key={entry.id}>
                    <CaseCard algorithmCase={entry} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </AppLayout>
  );
}

function CaseCard({ algorithmCase }: { algorithmCase: PllCase }): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const panelId = useId();

  // Derived from the algorithm, never stored. The picture and the moves are the same
  // fact expressed twice, so they cannot drift apart.
  const position = useMemo(() => positionOf(algorithmCase), [algorithmCase]);
  const moves = useMemo(() => movesOf(algorithmCase), [algorithmCase]);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-4">
        <CubeView
          state={position}
          size={84}
          angle={CASE_ANGLE}
          label={`${algorithmCase.id}: ${algorithmCase.name}`}
        />

        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-slate-900">{algorithmCase.id}</h4>
          <p className="mt-0.5 text-sm text-slate-500">{algorithmCase.name}</p>

          <p className="mt-2 font-mono text-sm break-words text-slate-700">
            {algorithmCase.algorithm}
          </p>

          <p className="mt-1 text-xs text-slate-400">{moves.length} moves</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="mt-3 flex items-center gap-1 rounded text-sm text-slate-500 transition-colors duration-150 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none motion-reduce:transition-none"
      >
        {isOpen ? 'Hide' : 'Watch it'}
        <ChevronDownIcon
          className={`size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      <Collapse open={isOpen} id={panelId}>
        {isOpen && <CasePlayer moves={moves} startFrom={position} angle={CASE_ANGLE} />}
      </Collapse>

      {algorithmCase.source !== undefined && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-400">
          {algorithmCase.source}
        </p>
      )}
    </article>
  );
}
