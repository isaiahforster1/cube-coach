import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateSolveRequest } from '@cube-coach/shared';
import {
  clearGuestSolves,
  countGuestSolves,
  createGuestStore,
  GUEST_PRACTICE_SESSION_ID,
  guestSolvesForUpload,
} from './guest-store.js';

const store = createGuestStore();

function request(id: string, seconds: number, solvedAt: string): CreateSolveRequest {
  return {
    id,
    practiceSessionId: GUEST_PRACTICE_SESSION_ID,
    scramble: "R U R'",
    durationMs: seconds * 1000,
    penalty: 'none',
    solvedAt,
    comment: null,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('guest store', () => {
  it('starts empty', async () => {
    expect(await store.listAll()).toEqual([]);
    expect(countGuestSolves()).toBe(0);
  });

  it('keeps a solve across a reload, because it is on disk', async () => {
    await store.create(request('a', 12, '2026-09-18T12:00:00.000Z'));

    // A fresh store is what a new page load constructs.
    expect(await createGuestStore().listAll()).toHaveLength(1);
  });

  it('returns solves oldest first for statistics', async () => {
    await store.create(request('a', 10, '2026-09-18T12:00:00.000Z'));
    await store.create(request('b', 20, '2026-09-18T12:00:05.000Z'));

    expect((await store.listAll()).map((s) => s.durationMs)).toEqual([10_000, 20_000]);
  });

  it('returns pages newest first, matching the API', async () => {
    await store.create(request('a', 10, '2026-09-18T12:00:00.000Z'));
    await store.create(request('b', 20, '2026-09-18T12:00:05.000Z'));

    const page = await store.listPage({ limit: 10, cursor: null });
    expect(page.solves.map((s) => s.durationMs)).toEqual([20_000, 10_000]);
    expect(page.nextCursor).toBeNull();
  });

  it('pages through a longer history exactly once', async () => {
    for (let index = 0; index < 7; index += 1) {
      await store.create(request(`s${index}`, 10 + index, `2026-09-18T12:00:0${index}.000Z`));
    }

    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const page = await store.listPage({ limit: 3, cursor });
      seen.push(...page.solves.map((s) => s.durationMs));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  /** Same behaviour as the server, so a retry cannot duplicate a solve. */
  it('replaces rather than duplicates when the same id is created twice', async () => {
    await store.create(request('a', 10, '2026-09-18T12:00:00.000Z'));
    await store.create(request('a', 10, '2026-09-18T12:00:00.000Z'));

    expect(await store.listAll()).toHaveLength(1);
  });

  it('applies a penalty without touching the measurement', async () => {
    await store.create(request('a', 12, '2026-09-18T12:00:00.000Z'));
    const updated = await store.setPenalty('a', 'plus2');

    expect(updated?.penalty).toBe('plus2');
    expect(updated?.durationMs).toBe(12_000);
  });

  it('reports nothing to update for an unknown solve', async () => {
    expect(await store.setPenalty('missing', 'dnf')).toBeNull();
  });

  /** Soft delete, so undo works the same way it does for an account. */
  it('hides a deleted solve but can restore it', async () => {
    await store.create(request('a', 12, '2026-09-18T12:00:00.000Z'));

    await store.remove('a');
    expect(await store.listAll()).toHaveLength(0);

    await store.restore('a');
    expect(await store.listAll()).toHaveLength(1);
  });

  it('offers its solves for upload in the shape the API expects', async () => {
    await store.create(request('a', 12, '2026-09-18T12:00:00.000Z'));

    const [upload] = guestSolvesForUpload();
    expect(upload).toMatchObject({ id: 'a', durationMs: 12_000, penalty: 'none' });
    expect(upload).not.toHaveProperty('deletedAt');
  });

  it('does not offer deleted solves for upload', async () => {
    await store.create(request('a', 12, '2026-09-18T12:00:00.000Z'));
    await store.remove('a');

    expect(guestSolvesForUpload()).toHaveLength(0);
  });

  it('clears everything once migrated', async () => {
    await store.create(request('a', 12, '2026-09-18T12:00:00.000Z'));
    clearGuestSolves();

    expect(await store.listAll()).toEqual([]);
  });

  it('survives storage being unavailable rather than throwing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(await store.listAll()).toEqual([]);
    vi.restoreAllMocks();
  });

  it('ignores corrupted stored data', async () => {
    localStorage.setItem('cube-coach.guest-solves', 'not json');
    expect(await store.listAll()).toEqual([]);
  });
});
