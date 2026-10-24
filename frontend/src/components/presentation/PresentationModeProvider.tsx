"use client";

/**
 * PresentationModeProvider / usePresentationMode — the presentation lens's one
 * piece of state (plan `2026-10-23-console-presentation-spaces` D1, D2).
 *
 * D1: a presentation view is a LENS over the console, never a fork. The routes
 * and the data hooks are the operator's own; this provider only says whether
 * the browser is presenting, and the primitives in this folder (`Caption`,
 * `Provenance`, `OperatorOnly`, `RedactedText`, `MachineName`, `CostFigure`)
 * change what they RENDER on that answer. It fetches nothing and holds no
 * server state.
 *
 * D2's order — `?present=` wins, then the tab's last choice, then the viewer's
 * remembered setting, then off — lives in `resolvePresentationMode`; the two
 * stores live in `presentationModeStore`. This file wires them to React:
 *
 * - the URL through `useSearchParams()`, which Next keeps in step with both
 *   router navigation and `window.history.replaceState`, so a `?present=`
 *   change re-resolves without a reload;
 * - the stores through `useSyncExternalStore`, whose server snapshot is
 *   "unreadable", so a server render and the hydration render resolve to
 *   `unresolved` — presenting, fail closed — and never mismatch the HTML;
 * - a `?present=` the tab arrives with is recorded as the tab's choice, so
 *   following a link that carries none keeps the presentation on;
 * - so is a presentation the tab OPENED on the viewer's remembered setting:
 *   the setting applies when a tab opens, never live, so another tab pressing
 *   the toggle off cannot drop the lens in front of this tab's audience.
 *
 * Where NO provider is mounted the mode is `source: "absent"`, `presenting:
 * false`: there is no lens on that page, so its controls are the operator's.
 * The lens is mounted by `PresentationLens` in the console layout and the
 * digital-twin layout; `lensSurfaces.test.ts` fails if a lens route is not
 * covered by one.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { createLogger } from "@/lib/logger";
import {
  PRESENT_PARAM,
  encodeChoice,
  parsePresentParam,
  resolvePresentationMode,
  type PresentationModeSource,
} from "./presentationModeResolution";
import {
  decodeStoreSnapshot,
  defaultPresentationModeStore,
  type PresentationModeStore,
} from "./presentationModeStore";

const log = createLogger("PresentationMode");

export interface PresentationModeValue {
  /**
   * Whether the lens renders the presentation view. TRUE while the mode is
   * `unresolved` — every guard fails closed until the client knows.
   */
  readonly presenting: boolean;
  /**
   * Where the answer came from. `"fixed"` is a `FixedPresentationMode`;
   * `"absent"` means no lens is mounted above this component.
   */
  readonly source: PresentationModeSource | "fixed" | "absent";
  /**
   * Set the mode: records the choice for this tab and as the viewer's
   * remembered setting, and rewrites `?present=` when the URL carries one (the
   * URL wins, so leaving it would undo the press). `null` where the mode
   * cannot be changed — no lens, or a fixed one.
   */
  readonly setPresenting: ((next: boolean) => void) | null;
}

const ABSENT: PresentationModeValue = {
  presenting: false,
  source: "absent",
  setPresenting: null,
};

const PresentationModeContext = createContext<PresentationModeValue>(ABSENT);

/** The lens's answer for the component calling it. */
export function usePresentationMode(): PresentationModeValue {
  return useContext(PresentationModeContext);
}

/**
 * Point a `?present=` already on the URL at the new choice. A URL without the
 * key is left alone — the recorded choice resolves it.
 */
function rewritePresentParam(presenting: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PRESENT_PARAM)) return;
    url.searchParams.set(PRESENT_PARAM, encodeChoice(presenting));
    // Next's app router keeps `useSearchParams` in step with the native
    // history API, so this re-resolves the mode without a navigation.
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch (err) {
    // The URL keeps its old value and still wins; the toggle shows the mode
    // the page is really in rather than the one that was asked for.
    log.warn("could not rewrite ?present= on the URL", err);
  }
}

export interface PresentationModeProviderProps {
  children: ReactNode;
  /**
   * The stores behind D2's middle arms. Defaults to the module-wide store, so
   * every lens tree in the tab shares one session; a test passes its own.
   */
  store?: PresentationModeStore;
}

export function PresentationModeProvider({
  children,
  store = defaultPresentationModeStore,
}: PresentationModeProviderProps) {
  const searchParams = useSearchParams();
  const urlChoice = parsePresentParam(searchParams?.get(PRESENT_PARAM));
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
  const stored = decodeStoreSnapshot(snapshot);
  const resolved = resolvePresentationMode({
    url: urlChoice,
    session: stored.session,
    storage: stored.storage,
    storesReadable: stored.readable,
  });

  // A `?present=` this tab arrived with becomes the tab's choice, so a link
  // that carries none keeps the presentation on. Not the viewer's remembered
  // setting: a shared link must not change how its recipient's console opens
  // next time.
  useEffect(() => {
    if (urlChoice !== null) store.recordChoice(urlChoice, { remember: false });
  }, [urlChoice, store]);

  // A tab presenting on the viewer's remembered setting makes it the tab's own
  // choice. Left unlatched, the setting would be live authority across tabs in
  // the fail-OPEN direction: the operator pressing the toggle off in another
  // tab rewrites it, and this tab would reveal every control and name to the
  // audience with nobody touching it. Only `true` is latched — a remembered
  // setting turning ON reaches a tab that made no choice, which fails closed.
  const latchRemembered = resolved.source === "storage" && resolved.presenting;
  useEffect(() => {
    if (latchRemembered) store.recordChoice(true, { remember: false });
  }, [latchRemembered, store]);

  const setPresenting = useCallback(
    (next: boolean) => {
      store.recordChoice(next, { remember: true });
      rewritePresentParam(next);
    },
    [store]
  );

  const value = useMemo<PresentationModeValue>(
    () => ({
      presenting: resolved.presenting,
      source: resolved.source,
      setPresenting,
    }),
    [resolved.presenting, resolved.source, setPresenting]
  );

  return (
    <PresentationModeContext.Provider value={value}>
      {children}
    </PresentationModeContext.Provider>
  );
}

export interface FixedPresentationModeProps {
  presenting: boolean;
  children: ReactNode;
}

/**
 * A lens whose mode is decided by its parent, not by the URL or the stores —
 * an embedded preview, or a test rendering a surface in one mode. It offers
 * no toggle (`setPresenting: null`).
 */
export function FixedPresentationMode({
  presenting,
  children,
}: FixedPresentationModeProps) {
  const value = useMemo<PresentationModeValue>(
    () => ({ presenting, source: "fixed", setPresenting: null }),
    [presenting]
  );
  return (
    <PresentationModeContext.Provider value={value}>
      {children}
    </PresentationModeContext.Provider>
  );
}
