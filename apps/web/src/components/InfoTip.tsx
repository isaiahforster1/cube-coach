import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

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
export function InfoTip({ children, term }: InfoTipProps): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  const container = useRef<HTMLSpanElement>(null);

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
    <span ref={container} className="relative inline-flex">
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
        className="flex size-4 items-center justify-center rounded-full border border-slate-300 text-[10px] leading-none font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
      >
        i
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-md bg-slate-800 px-3 py-2 text-xs leading-relaxed font-normal text-slate-100 shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}
