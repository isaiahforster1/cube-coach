import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

export interface InfoTipProps {
  /** What the term means, in plain language. */
  readonly children: string;
  /** The term being explained, used to label the button for screen readers. */
  readonly term: string;
}

/**
 * A small "what does this mean?" marker next to a statistic.
 *
 * Deliberately a `<button>` rather than the `title` attribute. `title` looks like the
 * easy answer and fails three groups of people: it never appears for keyboard users, it
 * never appears on touch devices, and screen readers treat it inconsistently. A button
 * is focusable, activates on tap, and can be described properly.
 *
 * It opens on hover *and* on focus, closes on Escape, and is linked to the trigger with
 * `aria-describedby` so assistive technology reads the explanation as part of the
 * control rather than as stray text.
 */
/** Keep this much clear of the top of the window before flipping underneath. */
const EDGE_MARGIN = 8;

export function InfoTip({ children, term }: InfoTipProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const id = useId();
  const container = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);

  /**
   * Flip underneath when there is no room above.
   *
   * The scramble's marker sits near the top of the page, so a tip anchored above it ran
   * off the top of the window and lost its first line.
   *
   * This measures rather than guessing from a threshold, because the tip's height
   * depends on how long the explanation is — a rule like "flip if within 150px of the
   * top" would be right for one tip and wrong for the next. `useLayoutEffect` runs
   * before the browser paints, so the flip is never visible as a jump.
   */
  useLayoutEffect(() => {
    if (!open) {
      // Measure from scratch next time: the marker may have moved since.
      setPlacement('above');
      return;
    }
    if (placement === 'below') return;

    const rect = tip.current?.getBoundingClientRect();
    if (rect !== undefined && rect.top < EDGE_MARGIN) setPlacement('below');
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }

    function handlePointerDown(event: PointerEvent): void {
      // Tapping elsewhere dismisses it, which is the only way to close it on a touch
      // screen where there is no hover to leave.
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open]);

  return (
    <span ref={container} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`What is ${term}?`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        // Opens rather than toggles. A mouse user has already hovered by the time the
        // click lands, so toggling would close what they just opened; dismissal is
        // Escape, tapping elsewhere, or moving the pointer away.
        onClick={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`flex size-4 items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none motion-reduce:transition-none ${
          open ? 'text-sky-600' : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        {/*
          An icon rather than a bordered letter. A 16px "i" inside a 16px box never quite
          sits straight across fonts and platforms, and the result reads as unfinished —
          a drawn glyph is the same size everywhere.
        */}
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
          <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 7.1v4.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="4.7" r="0.95" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <span
          ref={tip}
          data-placement={placement}
          className={`pointer-events-none absolute left-1/2 z-20 w-64 -translate-x-1/2 ${
            placement === 'above' ? 'bottom-full mb-2.5' : 'top-full mt-2.5'
          }`}
        >
          <span
            className={`relative block motion-reduce:animate-none ${
              placement === 'above' ? 'animate-tip-up' : 'animate-tip-down'
            }`}
          >
            <span
              id={id}
              role="tooltip"
              className="block rounded-lg bg-slate-800 px-3.5 py-2.5 text-left text-[13px] leading-[1.55] font-normal text-slate-100 shadow-lg ring-1 shadow-slate-900/15 ring-slate-900/5"
            >
              {children}
            </span>

            {/* The pointer back to the marker, so the tip reads as attached to it. */}
            <span
              aria-hidden="true"
              className={`absolute left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-slate-800 ${
                placement === 'above' ? '-bottom-[3px]' : '-top-[3px]'
              }`}
            />
          </span>
        </span>
      )}
    </span>
  );
}
