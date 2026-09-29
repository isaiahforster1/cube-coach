import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useLogout } from '../features/auth/use-session.js';

/**
 * The signed-in user's actions, behind one button.
 *
 * One button rather than two because of the phone header: the page navigation takes
 * whatever width is left, and a second button beside "Sign out" squeezed it to nothing.
 *
 * A disclosure, not an ARIA `menu`: the button says whether the panel is open with
 * `aria-expanded`, and the panel holds ordinary buttons reached with Tab. The `menu` role
 * promises arrow-key navigation, and claiming it without providing that is worse than not
 * claiming it at all.
 */
export function AccountMenu({ displayName }: { displayName: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const logout = useLogout();
  const logoutEverywhere = useLogout({ everywhere: true });

  // Close on Escape and on any press outside, as a popover is expected to. Listening
  // only while open keeps a closed menu from costing anything.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    function onPointerDown(event: PointerEvent): void {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  function signOut(): void {
    setOpen(false);
    logout.mutate();
  }

  // A native confirm: this also signs out the device in front of the user, which is
  // surprising enough to ask about first, and the browser's dialog is accessible for free.
  function signOutEverywhere(): void {
    setOpen(false);
    if (window.confirm('Sign out on every device, including this one?')) {
      logoutEverywhere.mutate();
    }
  }

  return (
    <div ref={container} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Account
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute right-0 z-10 mt-2 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          <p className="truncate px-3 py-2 text-xs text-slate-500">Signed in as {displayName}</p>
          <button
            type="button"
            onClick={signOut}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={signOutEverywhere}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Sign out everywhere
          </button>
        </div>
      )}
    </div>
  );
}
