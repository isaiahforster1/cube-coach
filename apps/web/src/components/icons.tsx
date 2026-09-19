import type { ReactElement } from 'react';

/**
 * The interface's icons, drawn rather than typed.
 *
 * Characters like `▶` and `↺` are tempting because they cost nothing, and they are a
 * trap: several of them have an emoji presentation, so the browser may quietly swap in a
 * colour glyph from the system font. The play control arrived as a bright blue emoji
 * triangle in the middle of an otherwise slate interface, and no amount of `text-slate-700`
 * would change it — the colour is baked into the glyph.
 *
 * Drawn icons take `currentColor`, so they inherit whatever the control around them is
 * using, and they are the same size and weight on every platform.
 */

interface IconProps {
  /** Tailwind sizing, since these are always used inside a sized control. */
  readonly className?: string;
}

function Icon({
  className = 'size-4',
  children,
}: IconProps & { children: ReactElement | readonly ReactElement[] }): ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

export function PlayIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path
        d="M5.6 3.7a.6.6 0 0 1 .92-.5l6 4.3a.6.6 0 0 1 0 1l-6 4.3a.6.6 0 0 1-.92-.5z"
        fill="currentColor"
      />
    </Icon>
  );
}

export function PauseIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <rect x="4.6" y="3.6" width="2.4" height="8.8" rx="1" fill="currentColor" />
      <rect x="9" y="3.6" width="2.4" height="8.8" rx="1" fill="currentColor" />
    </Icon>
  );
}

export function PreviousIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path
        d="M10.2 3.6 5.8 8l4.4 4.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

export function NextIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path
        d="M5.8 3.6 10.2 8l-4.4 4.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

/** An arrow curling anticlockwise: back to the beginning. */
export function RestartIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path
        d="M3.3 8a4.7 4.7 0 1 0 1.5-3.45L3 6.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.7 3.1v3.3h3.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path
        d="M4 6.5 8 10.5 12 6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}
