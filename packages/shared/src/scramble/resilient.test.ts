import { describe, expect, it, vi } from 'vitest';
import { createResilientScrambleProvider } from './resilient.js';
import type { Scramble, ScrambleProvider } from './types.js';

const GOOD: Scramble = { moves: ['R'], notation: 'R', quality: 'random-state' };
const WEAK: Scramble = { moves: ['U'], notation: 'U', quality: 'random-move' };

function provider(
  generate: () => Promise<Scramble>,
  quality: Scramble['quality'],
): ScrambleProvider {
  return { quality, generate };
}

const working = () => provider(() => Promise.resolve(GOOD), 'random-state');
const failing = () => provider(() => Promise.reject(new Error('no worker')), 'random-state');
const hanging = () => provider(() => new Promise<Scramble>(() => {}), 'random-state');
const weak = () => provider(() => Promise.resolve(WEAK), 'random-move');

/** Resolve immediately, so a timeout test takes microseconds rather than five seconds. */
const instantly = () => Promise.resolve();

describe('createResilientScrambleProvider', () => {
  it('uses the good scrambles when they work', async () => {
    const scrambles = createResilientScrambleProvider({
      primary: working(),
      fallback: weak(),
    });

    expect(await scrambles.generate()).toEqual(GOOD);
  });

  /**
   * The failure this exists for: a worker that a browser or a content security policy
   * refuses to start. An empty timer is not an honest answer to that — a weaker scramble
   * is, as long as the interface says which it is.
   */
  it('falls back when the good ones are unavailable', async () => {
    const scrambles = createResilientScrambleProvider({
      primary: failing(),
      fallback: weak(),
    });

    const scramble = await scrambles.generate();
    expect(scramble).toEqual(WEAK);
    expect(scramble.quality).toBe('random-move');
  });

  /** A hung worker never rejects; it simply never answers. */
  it('falls back when the good ones never arrive', async () => {
    const scrambles = createResilientScrambleProvider({
      primary: hanging(),
      fallback: weak(),
      timeoutMs: 10,
      delay: instantly,
    });

    expect(await scrambles.generate()).toEqual(WEAK);
  });

  /**
   * Retrying a broken solver on every solve would add the timeout to every scramble,
   * which is worse than the fallback it is trying to avoid.
   */
  it('stops retrying a solver that has already failed', async () => {
    const primary = vi.fn(() => Promise.reject(new Error('no worker')));
    const scrambles = createResilientScrambleProvider({
      primary: provider(primary, 'random-state'),
      fallback: weak(),
    });

    await scrambles.generate();
    await scrambles.generate();
    await scrambles.generate();

    expect(primary).toHaveBeenCalledTimes(1);
  });

  it('keeps asking the good source while it is working', async () => {
    const primary = vi.fn(() => Promise.resolve(GOOD));
    const scrambles = createResilientScrambleProvider({
      primary: provider(primary, 'random-state'),
      fallback: weak(),
    });

    await scrambles.generate();
    await scrambles.generate();

    expect(primary).toHaveBeenCalledTimes(2);
  });

  /** Each scramble carries its own quality, which is what the interface reports. */
  it('reports the quality of the scramble it actually produced', async () => {
    const scrambles = createResilientScrambleProvider({
      primary: failing(),
      fallback: weak(),
    });

    expect((await scrambles.generate()).quality).toBe('random-move');
  });
});
