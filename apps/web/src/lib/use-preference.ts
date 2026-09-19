import { useCallback, useState } from 'react';

/**
 * A small setting remembered in this browser.
 *
 * For choices where forgetting is an annoyance rather than a loss: whether a panel is
 * open, how fast an animation runs. Nothing here is worth an account or a round trip,
 * and a guest is entitled to have the interface stay how they left it.
 *
 * Every access is wrapped, because `localStorage` does not merely return nothing when
 * it is unavailable — it throws. Private browsing, blocked site data and storage quotas
 * all reach this code as an exception, and none of them are a reason for the page to
 * fail to render.
 */
export function usePreference<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // The setting still applies for this visit; it just will not be remembered.
      }
    },
    [key],
  );

  return [value, update];
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // Unreadable or corrupt. The default is always a safe answer.
    return fallback;
  }
}
