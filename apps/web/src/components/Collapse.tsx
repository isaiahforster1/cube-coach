import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface CollapseProps {
  readonly open: boolean;
  readonly id?: string;
  readonly durationMs?: number;
  readonly children: ReactNode;
}

const DEFAULT_DURATION_MS = 260;

/**
 * Make the browser work out the style that was just set.
 *
 * Two style changes in the same task are collapsed into one: the browser only ever sees
 * the second, so there is no old value to transition from and the element jumps. Reading
 * a layout property forces the first one to be resolved, which gives the transition a
 * starting point.
 *
 * Deliberately not `requestAnimationFrame`, which is the other common way to do this.
 * Animation frames do not run in a background or hidden tab, so a panel toggled there
 * would be left holding its starting height until something else nudged it. Reading a
 * layout property always works.
 */
function forceStyleResolution(element: HTMLElement): void {
  void element.offsetHeight;
}

/**
 * Expands and collapses its contents smoothly, without being told their height.
 *
 * CSS cannot interpolate `height` to `auto`, so the height has to come from somewhere.
 * The fashionable answer is to put the content in a single-row grid and transition the
 * track from `0fr` to `1fr`, which needs no measuring at all. That was the first
 * implementation here, and in the browser it does not work: the transition is created
 * and runs for its full duration while the row stays at its old size, then snaps. For an
 * auto-height grid there is no free space for the `fr` factor to divide up, so every
 * positive value resolves to the same thing and only exactly `0fr` collapses it. It
 * looks correct in the DOM and animates nothing.
 *
 * So the height is measured instead. `scrollHeight` on the content gives the number,
 * and the panel animates between that and zero.
 *
 * Two details that are easy to get wrong:
 *
 * - The starting height has to be resolved before the ending one is applied, or the
 *   browser collapses both changes into one and there is nothing to transition. See
 *   {@link forceStyleResolution}.
 * - Once open, the height goes back to `auto`. Leaving a pixel height there would freeze
 *   the panel at whatever size it happened to be when it opened, so content that reflows
 *   — a scramble wrapping onto another line, a window resize — would be clipped.
 *
 * Children stay mounted until the collapse finishes, so the panel animates *out* rather
 * than vanishing and leaving an empty box to shrink.
 */
export function Collapse({
  open,
  id,
  durationMs = DEFAULT_DURATION_MS,
  children,
}: CollapseProps): ReactElement {
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [isCollapsing, setCollapsing] = useState(false);

  /**
   * The previous value of `open`.
   *
   * Updated by the passive effect below, which React runs *after* every layout effect in
   * the same commit — so the layout effect still sees the old value and can tell an
   * actual toggle apart from an unrelated re-render.
   */
  const previousOpen = useRef(open);

  /**
   * The commit in which `open` has just become false.
   *
   * Worked out during the render rather than from state, because state set in an effect
   * arrives a beat too late: the children would already have been removed by the time
   * the height is measured, leaving nothing to measure and nothing to watch shrink. This
   * keeps them for the one render that matters, and `isCollapsing` takes over afterwards.
   */
  const isClosingNow = !open && previousOpen.current;

  useLayoutEffect(() => {
    const element = panel.current;
    if (element === null) return;

    // Not a toggle: settle into the resting state without animating. This is also the
    // first render, where a remembered "open" preference must not play an animation
    // nobody asked for.
    if (previousOpen.current === open) {
      element.style.height = open ? 'auto' : '0px';
      return;
    }

    const measured = content.current?.scrollHeight ?? 0;

    if (open) {
      element.style.height = '0px';
      forceStyleResolution(element);
      element.style.height = `${measured}px`;

      // Hand the height back to the content once it has arrived, so the panel can grow
      // and shrink with whatever is inside it.
      const settle = setTimeout(() => {
        element.style.height = 'auto';
      }, durationMs);

      return () => clearTimeout(settle);
    }

    // Closing. `auto` has to become a real number first, or there is nothing to animate
    // away from.
    element.style.height = `${measured}px`;
    forceStyleResolution(element);
    element.style.height = '0px';

    return;
  }, [open, durationMs]);

  useEffect(() => {
    const changed = previousOpen.current !== open;
    previousOpen.current = open;
    if (!changed) return;

    if (open) {
      setCollapsing(false);
      return;
    }

    setCollapsing(true);
    const timer = setTimeout(() => setCollapsing(false), durationMs);
    return () => clearTimeout(timer);
  }, [open, durationMs]);

  return (
    <div
      ref={panel}
      id={id}
      // `inert` rather than `hidden`: the panel is still on screen while it shrinks, but
      // nothing inside it should be focusable or reachable by a screen reader once it
      // has been closed.
      inert={!open}
      className="overflow-hidden transition-[height,opacity] ease-out motion-reduce:transition-none"
      /*
        `height` is deliberately absent, and owned entirely by the layout effect above.
        Listing it here as well means React reapplies it on every re-render — including
        the one that follows this component's own state changes — which lands in the
        middle of the animation and overwrites it. The transition then never runs, and
        the cause is invisible, because the markup looks exactly right.
      */
      style={{
        opacity: open ? 1 : 0,
        transitionDuration: `${durationMs}ms`,
      }}
    >
      <div ref={content}>{(open || isClosingNow || isCollapsing) && children}</div>
    </div>
  );
}
