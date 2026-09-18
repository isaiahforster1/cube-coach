import type { ReactElement } from 'react';
import { formatDuration, type AverageResult, type StatsSummary } from '@cube-coach/shared';
import { AppLayout } from '../../components/AppLayout.js';
import { useStatsSummary } from './use-stats.js';

/** Render the three outcomes of an average distinctly. */
function AverageValue({ result }: { result: AverageResult }): ReactElement {
  switch (result.kind) {
    case 'average':
      return <span className="tabular-nums">{formatDuration(result.milliseconds)}</span>;
    case 'dnf':
      return <span className="text-slate-400">DNF</span>;
    case 'not-enough-solves':
      // An em dash, not a zero. Showing 0.00 for "no data yet" is a lie that looks like
      // a very fast solve.
      return (
        <span className="text-slate-300" title={`Needs ${result.needed} solves`}>
          —
        </span>
      );
    default:
      return <span className="text-slate-300">—</span>;
  }
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: ReactElement | string;
}): ReactElement {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 font-mono text-xl text-slate-900">{children}</dd>
    </div>
  );
}

export function StatsPage(): ReactElement {
  const { data: summary, isPending, isError } = useStatsSummary();

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-slate-900">Statistics</h2>

      {isPending && <p className="mt-6 text-slate-500">Loading…</p>}
      {isError && (
        <p role="alert" className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load your statistics.
        </p>
      )}

      {summary !== undefined && <StatsContent summary={summary} />}
    </AppLayout>
  );
}

function StatsContent({ summary }: { summary: StatsSummary }): ReactElement {
  const { consistency, averages, bestSingleMs, crossInsight } = summary;

  if (consistency.solveCount === 0) {
    return <p className="mt-6 text-slate-500">No solves yet. Record a few and come back.</p>;
  }

  return (
    <div className="mt-6 flex flex-col gap-8">
      <section>
        <h3 className="mb-3 text-sm font-medium text-slate-700">Personal bests</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Best single">
            {bestSingleMs === null ? '—' : formatDuration(bestSingleMs)}
          </Stat>
          <Stat label="Best ao5">
            <AverageValue result={averages.ao5.best} />
          </Stat>
          <Stat label="Best ao12">
            <AverageValue result={averages.ao12.best} />
          </Stat>
        </dl>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium text-slate-700">Current averages</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="ao5">
            <AverageValue result={averages.ao5.current} />
          </Stat>
          <Stat label="ao12">
            <AverageValue result={averages.ao12.current} />
          </Stat>
          <Stat label="ao50">
            <AverageValue result={averages.ao50.current} />
          </Stat>
          <Stat label="ao100">
            <AverageValue result={averages.ao100.current} />
          </Stat>
        </dl>
      </section>

      {/*
        Consistency, not just speed. Two cubers with the same average can need completely
        different advice, and only the spread tells them apart.
      */}
      <section>
        <h3 className="mb-3 text-sm font-medium text-slate-700">Consistency</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Mean">
            {consistency.meanMs === null ? '—' : formatDuration(consistency.meanMs)}
          </Stat>
          <Stat label="Spread">
            {consistency.spreadMs === null ? '—' : formatDuration(consistency.spreadMs)}
          </Stat>
          <Stat label="Deviation">
            {consistency.standardDeviationMs === null
              ? '—'
              : formatDuration(consistency.standardDeviationMs)}
          </Stat>
          <Stat label="Solves">
            {`${consistency.solveCount}${consistency.dnfCount > 0 ? ` (${consistency.dnfCount} DNF)` : ''}`}
          </Stat>
        </dl>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium text-slate-700">Cross difficulty</h3>

        {crossInsight === null ? (
          // Saying nothing is better than saying something unreliable: a cuber who
          // changes their practice because of noise has been harmed by the tool.
          <p className="text-sm text-slate-500">
            Not enough solves yet to say anything reliable. This compares your times on scrambles
            with an easy cross against ones with a hard cross.
          </p>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
            <p className="text-slate-900">
              You average{' '}
              <strong className="font-mono">{formatDuration(crossInsight.easyMeanMs)}</strong> when
              the cross takes {crossInsight.threshold} moves or fewer, and{' '}
              <strong className="font-mono">{formatDuration(crossInsight.hardMeanMs)}</strong> when
              it takes more —{' '}
              <strong className="font-mono">{formatDuration(crossInsight.differenceMs)}</strong>{' '}
              slower.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Based on {crossInsight.easyCount} easy and {crossInsight.hardCount} hard scrambles,
              with the cross solved exactly for each one.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
