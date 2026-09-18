import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { StatsSummary } from '@cube-coach/shared';
import { renderWithProviders } from '../../test/render.js';
import { StatsPage } from './StatsPage.js';

function summary(overrides: Partial<StatsSummary> = {}): StatsSummary {
  return {
    consistency: {
      meanMs: 14_000,
      bestMs: 11_000,
      worstMs: 18_000,
      spreadMs: 7_000,
      standardDeviationMs: 2_100,
      relativeDeviation: 0.15,
      solveCount: 42,
      dnfCount: 1,
    },
    averages: {
      ao5: {
        current: { kind: 'average', milliseconds: 13_500 },
        best: { kind: 'average', milliseconds: 12_100 },
      },
      ao12: {
        current: { kind: 'average', milliseconds: 14_200 },
        best: { kind: 'average', milliseconds: 13_000 },
      },
      ao50: {
        current: { kind: 'not-enough-solves', needed: 50 },
        best: { kind: 'not-enough-solves', needed: 50 },
      },
      ao100: {
        current: { kind: 'not-enough-solves', needed: 100 },
        best: { kind: 'not-enough-solves', needed: 100 },
      },
    },
    bestSingleMs: 11_000,
    crossInsight: null,
    ...overrides,
  };
}

function mockStats(body: StatsSummary) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ user: { id: '1', email: 'a@b', displayName: 'C', createdAt: '' } }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ summary: body }),
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StatsPage', () => {
  it('shows the personal bests and current averages', async () => {
    mockStats(summary());
    renderWithProviders(<StatsPage />);

    expect(await screen.findByText('11.00')).toBeInTheDocument(); // best single
    expect(screen.getByText('13.50')).toBeInTheDocument(); // current ao5
    expect(screen.getByText('12.10')).toBeInTheDocument(); // best ao5
  });

  /**
   * An em dash, not 0.00. Showing a zero for "no data yet" reads as an impossibly fast
   * solve, which is worse than showing nothing.
   */
  it('shows a dash rather than a zero for an average that is not possible yet', async () => {
    mockStats(summary());
    renderWithProviders(<StatsPage />);

    await screen.findByText('11.00');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it('reports consistency alongside speed', async () => {
    mockStats(summary());
    renderWithProviders(<StatsPage />);

    expect(await screen.findByText('7.00')).toBeInTheDocument(); // spread
    expect(screen.getByText('2.10')).toBeInTheDocument(); // deviation
    expect(screen.getByText('42 (1 DNF)')).toBeInTheDocument();
  });

  it('says nothing about cross difficulty until the evidence supports it', async () => {
    mockStats(summary({ crossInsight: null }));
    renderWithProviders(<StatsPage />);

    expect(
      await screen.findByText(/not enough solves yet to say anything reliable/iu),
    ).toBeInTheDocument();
  });

  it('states the cross difficulty finding in plain language when there is evidence', async () => {
    mockStats(
      summary({
        crossInsight: {
          easyMeanMs: 12_000,
          hardMeanMs: 16_500,
          differenceMs: 4_500,
          easyCount: 30,
          hardCount: 24,
          threshold: 5,
        },
      }),
    );
    renderWithProviders(<StatsPage />);

    expect(await screen.findByText('12.00')).toBeInTheDocument();
    expect(screen.getByText('16.50')).toBeInTheDocument();
    expect(screen.getByText('4.50')).toBeInTheDocument();
    expect(screen.getByText(/30 easy and 24 hard scrambles/iu)).toBeInTheDocument();
  });

  it('invites the user to record solves when there are none', async () => {
    mockStats(
      summary({
        consistency: {
          meanMs: null,
          bestMs: null,
          worstMs: null,
          spreadMs: null,
          standardDeviationMs: null,
          relativeDeviation: null,
          solveCount: 0,
          dnfCount: 0,
        },
        bestSingleMs: null,
      }),
    );
    renderWithProviders(<StatsPage />);

    expect(await screen.findByText(/no solves yet/iu)).toBeInTheDocument();
  });
});
