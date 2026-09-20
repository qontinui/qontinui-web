"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query.
 *
 * `useSyncExternalStore` rather than `useState` + an effect, so the first
 * client render already reports the real width instead of flashing the
 * server snapshot for a frame.
 *
 * `serverSnapshot` is what the hook reports when there is no `window` — on
 * the server and during hydration. Inside the authenticated shell it is never
 * observed: `AppAuthGate` withholds the whole tree until `useAuth()` resolves
 * on the client (see `app/(app)/layout.tsx`), so nothing that calls this hook
 * takes part in the server or hydration render. It is still defined, and
 * defaults to "matches", because a caller outside that gate would otherwise
 * get an undefined answer rather than a declared one.
 */
export function useMediaQuery(query: string, serverSnapshot = true): boolean {
  // ONE `MediaQueryList` per query, not one per snapshot read. `getSnapshot`
  // runs on every render and on React's own consistency checks, so calling
  // `matchMedia` inside it allocates a fresh list each time — and, more to
  // the point, would subscribe to and unsubscribe from different objects.
  // `.matches` on a retained list is live, so reading it is still current.
  const list = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return null;
    return window.matchMedia(query);
  }, [query]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!list) return () => {};
      // `addEventListener` on MediaQueryList is the modern spelling; the
      // deprecated `addListener` is kept as a fallback because jsdom's
      // default stub in `src/test/setup.ts` and older Safari only have that.
      if (typeof list.addEventListener === "function") {
        list.addEventListener("change", onStoreChange);
        return () => list.removeEventListener("change", onStoreChange);
      }
      list.addListener(onStoreChange);
      return () => list.removeListener(onStoreChange);
    },
    [list]
  );

  const getSnapshot = useCallback(
    () => (list ? list.matches : serverSnapshot),
    [list, serverSnapshot]
  );

  const getServerSnapshot = useCallback(() => serverSnapshot, [serverSnapshot]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
