import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCoarsePointer } from './use-coarse-pointer.js';

/**
 * A media query list we can change, so the subscription can be tested rather than only
 * its first reading.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );

  return {
    query,
    change(next: boolean): void {
      query.matches = next;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
    get listenerCount(): number {
      return listeners.size;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCoarsePointer', () => {
  it('reports a finger', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useCoarsePointer());

    expect(result.current).toBe(true);
  });

  it('reports a mouse', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useCoarsePointer());

    expect(result.current).toBe(false);
  });

  /** A tablet gains a keyboard case; a laptop is folded into a tablet. */
  it('follows the device changing', () => {
    const media = stubMatchMedia(true);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(true);

    media.change(false);
    expect(result.current).toBe(false);
  });

  it('stops listening once unmounted', () => {
    const media = stubMatchMedia(true);
    const { unmount } = renderHook(() => useCoarsePointer());
    expect(media.listenerCount).toBe(1);

    unmount();
    expect(media.listenerCount).toBe(0);
  });

  /** Its absence is not a reason to fail to render. */
  it('falls back to the keyboard default where matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useCoarsePointer());

    expect(result.current).toBe(false);
  });
});
