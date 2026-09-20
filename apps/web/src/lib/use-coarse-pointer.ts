import { useEffect, useState } from 'react';

/**
 * A finger is a coarse pointer; a mouse and a trackpad are fine ones. This is the
 * standard way to ask, and `pointer` describes the *primary* input rather than every
 * input available — so a laptop with a touchscreen still reports fine, which is right:
 * it has a keyboard, and its owner will use it.
 */
const COARSE_POINTER = '(pointer: coarse)';

/**
 * Whether this device is driven by a finger rather than a mouse.
 *
 * Used to choose what the timer tells someone to do. "Hold space" is useless advice on
 * a phone, and there is no honest way to ask a browser whether a keyboard exists — the
 * platform deliberately does not expose that. The primary pointer is the closest
 * available proxy and it is the one the platform intends for this purpose.
 *
 * It is a subscription rather than a single reading because the answer changes: a
 * tablet gains a keyboard case, a laptop is folded into a tablet. Reading it once at
 * mount would leave the wrong instructions on screen until a reload.
 */
export function useCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState(false);

  useEffect(() => {
    // Not every environment has it — jsdom-style test environments and old browsers.
    // Its absence is not a reason to fail; it just means we keep the keyboard default.
    if (typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(COARSE_POINTER);
    const update = (): void => {
      setIsCoarse(query.matches);
    };

    update();
    query.addEventListener('change', update);

    return () => {
      query.removeEventListener('change', update);
    };
  }, []);

  return isCoarse;
}
