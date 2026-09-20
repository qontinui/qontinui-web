"use client";

import { useCallback, useSyncExternalStore } from "react";

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
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) {
        return () => {};
      }
      const list = window.matchMedia(query);
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
    [query]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return serverSnapshot;
    }
    return window.matchMedia(query).matches;
  }, [query, serverSnapshot]);

  const getServerSnapshot = useCallback(() => serverSnapshot, [serverSnapshot]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
