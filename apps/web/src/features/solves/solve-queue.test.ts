import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateSolveRequest } from '@cube-coach/shared';
import {
  clearPendingSolves,
  enqueueSolve,
  readPendingSolves,
  removePendingSolve,
  updatePendingSolve,
} from './solve-queue.js';

function solve(id: string, overrides: Partial<CreateSolveRequest> = {}): CreateSolveRequest {
  return {
    id,
    practiceSessionId: '00000000-0000-4000-8000-000000000001',
    scramble: "R U R'",
    durationMs: 12_340,
    penalty: 'none',
    solvedAt: '2026-09-18T12:00:00.000Z',
    comment: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('solve queue', () => {
  it('starts empty', () => {
    expect(readPendingSolves()).toEqual([]);
  });

  it('keeps solves in the order they were recorded', () => {
    enqueueSolve(solve('a'));
    enqueueSolve(solve('b'));

    expect(readPendingSolves().map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('survives a reload, because it is on disk rather than in memory', () => {
    enqueueSolve(solve('a'));

    // A fresh read is what a new page load does.
    expect(readPendingSolves()).toHaveLength(1);
    expect(localStorage.getItem('cube-coach.pending-solves')).toContain('"a"');
  });

  it('replaces rather than duplicates when the same id is queued twice', () => {
    enqueueSolve(solve('a', { durationMs: 1_000 }));
    enqueueSolve(solve('a', { durationMs: 2_000 }));

    const pending = readPendingSolves();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.durationMs).toBe(2_000);
  });

  it('removes a solve once it has been accepted', () => {
    enqueueSolve(solve('a'));
    enqueueSolve(solve('b'));
    removePendingSolve('a');

    expect(readPendingSolves().map((s) => s.id)).toEqual(['b']);
  });

  it('corrects a penalty on a solve that has not been sent yet', () => {
    enqueueSolve(solve('a'));

    expect(updatePendingSolve('a', { penalty: 'plus2' })).toBe(true);
    expect(readPendingSolves()[0]?.penalty).toBe('plus2');
  });

  it('reports when there is nothing queued to correct', () => {
    expect(updatePendingSolve('missing', { penalty: 'dnf' })).toBe(false);
  });

  it('clears everything', () => {
    enqueueSolve(solve('a'));
    clearPendingSolves();

    expect(readPendingSolves()).toEqual([]);
  });

  /**
   * localStorage throws in private browsing and when the quota is full. Losing the queue
   * is unfortunate; crashing the timer because of it would be much worse.
   */
  it('returns an empty queue rather than throwing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(readPendingSolves()).toEqual([]);
    vi.restoreAllMocks();
  });

  it('does not throw when a write fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => enqueueSolve(solve('a'))).not.toThrow();
    vi.restoreAllMocks();
  });

  it('ignores corrupted stored data', () => {
    localStorage.setItem('cube-coach.pending-solves', 'not json at all');
    expect(readPendingSolves()).toEqual([]);
  });

  it('ignores stored data that is not a list', () => {
    localStorage.setItem('cube-coach.pending-solves', '{"not":"an array"}');
    expect(readPendingSolves()).toEqual([]);
  });
});
