import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import {
  applyMoves,
  createSolvedCube,
  FACES,
  formatAlgorithm,
  isMove,
  solverStepsQuerySchema,
  type Face,
  type SolverStep,
} from '@cube-coach/shared';
import { AppLayout } from '../../components/AppLayout.js';
import { CubeView } from '../cube/CubeView.js';
import { FACE_NAMES } from '../cube/colours.js';
import { useSolverSteps, type SolverRequest } from './use-solver-steps.js';

/** The page's link format, so other pages can send a scramble here. */
export function solverPath(scramble: string, crossFace: Face = 'D'): string {
  return `/solver?${new URLSearchParams({ scramble, cross: crossFace }).toString()}`;
}

/**
 * Read the request from the URL. `null` when there is nothing valid to solve, in which
 * case the form shows why and no request is sent: the shared schema is the server's own
 * rule, so a scramble it refuses here would only be refused there too.
 */
function requestFrom(params: URLSearchParams): { request: SolverRequest | null; error?: string } {
  const scramble = params.get('scramble');
  if (scramble === null) return { request: null };

  const parsed = solverStepsQuerySchema.safeParse({
    scramble,
    crossFace: params.get('cross') ?? undefined,
  });
  if (!parsed.success) {
    return { request: null, error: parsed.error.issues[0]?.message ?? 'Invalid scramble' };
  }
  return { request: parsed.data };
}

/**
 * The step solver: a cross and four pairs for any scramble, each with its reasons.
 *
 * The URL holds what is being solved and the text field is only a draft of it. Solving
 * writes the URL, so the back button, a reload and a shared link all show the same steps
 * without any state kept here.
 */
export function SolverPage(): ReactElement {
  const [params, setParams] = useSearchParams();
  const { request, error } = useMemo(() => requestFrom(params), [params]);
  const [draft, setDraft] = useState(params.get('scramble') ?? '');
  const [crossFace, setCrossFace] = useState<Face>(request?.crossFace ?? 'D');
  const steps = useSolverSteps(request);

  const scrambled = useMemo(
    () => (request === null ? null : applyMoves(createSolvedCube(), request.scramble)),
    [request],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setParams({ scramble: draft.trim(), cross: crossFace });
  };

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-slate-900">Step solver</h2>
      <p className="mt-1 text-sm text-slate-500">
        The cross and each F2L pair, the way a person would solve them, and why each step is the one
        it is.
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Scramble
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            spellCheck={false}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : 'scramble-error'}
            className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm font-normal text-slate-900"
          />
        </label>
        {error === undefined ? null : (
          <p id="scramble-error" role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Cross colour
            <select
              value={crossFace}
              onChange={(event) => setCrossFace(event.target.value as Face)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal"
            >
              {FACES.map((face) => (
                <option key={face} value={face}>
                  {FACE_NAMES[face]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
          >
            Solve
          </button>
        </div>
      </form>

      {request === null || scrambled === null ? null : (
        <section aria-label="Solution" className="mt-8">
          <div className="flex justify-center">
            <CubeView state={scrambled} size={150} label="The scrambled cube" />
          </div>
          <p className="mt-3 text-center font-mono text-sm break-words text-slate-600">
            {formatAlgorithm(request.scramble)}
          </p>
          <Steps query={steps} crossFace={request.crossFace} />
        </section>
      )}
    </AppLayout>
  );
}

function Steps({
  query,
  crossFace,
}: {
  query: ReturnType<typeof useSolverSteps>;
  crossFace: Face;
}): ReactElement {
  if (query.isPending) {
    return (
      <p role="status" className="mt-6 text-center text-sm text-slate-500">
        Solving…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="mt-6 text-center text-sm text-red-700">
        {query.error.message}
      </p>
    );
  }

  return (
    <>
      <ol className="mt-6 flex flex-col gap-4">
        {query.data.steps.map((step, index) => (
          <StepCard
            // Steps never reorder within one answer, and a new answer replaces the list.
            key={index}
            step={step}
            title={step.kind === 'cross' ? `${FACE_NAMES[crossFace]} cross` : `Pair ${index}`}
          />
        ))}
      </ol>
      {query.data.status === 'failed' ? (
        <p role="alert" className="mt-4 text-sm text-amber-800">
          The solver could not finish the first two layers for this scramble. The steps above are
          the ones it found.
        </p>
      ) : null}
    </>
  );
}

function StepCard({ step, title }: { step: SolverStep; title: string }): ReactElement {
  // Rotations are shown but not counted, as is conventional (ADR-0021 §4).
  const moveCount = step.tokens.filter(isMove).length;

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-slate-900 first-letter:uppercase">{title}</h3>
        <span className="text-xs text-slate-400">
          {moveCount} {moveCount === 1 ? 'move' : 'moves'}
        </span>
      </div>
      <p className="mt-2 font-mono text-base break-words text-slate-900">
        {step.tokens.length === 0 ? 'Nothing to do' : formatAlgorithm(step.tokens)}
      </p>
      <div className="mt-2 flex flex-col gap-1 text-sm text-slate-600">
        {step.explanation.text.split('\n').map((line, index) => (
          // The text is replaced whole, never edited line by line.
          <p key={index}>{line}</p>
        ))}
      </div>
    </li>
  );
}
