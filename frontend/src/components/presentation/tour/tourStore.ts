/**
 * tourStore — whether this browser tab is on the tour, kept the way the
 * presentation mode keeps the tab's choice (`presentationModeStore.ts`), and
 * shaped for `useSyncExternalStore` (plan
 * `2026-10-23-console-presentation-spaces` Phase 8).
 *
 * Two facts, both TAB-scoped:
 *
 * - **on tour** — set when the tab arrives on a URL carrying the tour marker
 *   (`?tour=1`, which every tour link carries beside `?present=1`), cleared
 *   by End tour. It survives in-app navigation and reloads of THIS tab, so a
 *   link that carries no marker keeps the tour bar, and it reaches no other
 *   tab;
 * - **the last stop** — the last presentable stop the tab visited, which the
 *   tour bar offers as the way back from a page off the tour route. That is
 *   all it is for: the current stop is read from the path, never from here.
 *
 * sessionStorage, mirrored in memory: the mirror carries the state when
 * sessionStorage is unavailable or refuses a write (a private window, blocked
 * site data). Every read and write is guarded, so a storage that throws reads
 * as "not on tour", never as an error. A convenience, never an authority —
 * the URL's marker wins over it, `?present=0` turns the bar off whatever it
 * says, and it never touches localStorage: the tour is never a remembered
 * preference, and no server ever sees it.
 *
 * `getSnapshot` returns a short primitive string (stable under `Object.is`);
 * `getServerSnapshot` returns "not on tour", so a server or hydration render
 * shows no tour bar — the bar is navigation chrome, and showing none is the
 * safe arm.
 */

import { LENS_SURFACES, type LensSurfaceId } from "../lensSurfaces";

/** The sessionStorage key. */
export const TOUR_STORAGE_KEY = "qontinui.presentation-tour";

export interface TourState {
  readonly onTour: boolean;
  readonly lastStopId: LensSurfaceId | null;
}

export interface TourStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): string;
  getServerSnapshot(): string;
  /** The tab is on the tour (a tour link brought it here). */
  startTour(): void;
  /** The tab is showing this presentable stop. */
  recordStop(id: LensSurfaceId): void;
  /** End tour: off the tour, and nothing remembered. */
  endTour(): void;
}

/** A getter rather than a value: touching `window.sessionStorage` can itself throw. */
export type TourStorageGetter = () => Storage | null;

export interface TourStoreOptions {
  readonly session?: TourStorageGetter;
}

const OFF: TourState = { onTour: false, lastStopId: null };
const NO_STOP = "-";
/** The snapshot of a tab that is not on the tour. */
export const OFF_TOUR_SNAPSHOT = "0|-";

const STOP_IDS: ReadonlySet<string> = new Set(LENS_SURFACES.map((s) => s.id));

function isStopId(value: string): value is LensSurfaceId {
  return STOP_IDS.has(value);
}

/** The state as a snapshot string: `<1|0>|<stop id or ->`. */
export function encodeTourState(state: TourState): string {
  return `${state.onTour ? "1" : "0"}|${state.lastStopId ?? NO_STOP}`;
}

/**
 * A snapshot string (or a stored value) back to the state. Anything not
 * written by {@link encodeTourState} reads as not on the tour; a stop id this
 * build does not know reads as no stop.
 */
export function decodeTourState(raw: string | null | undefined): TourState {
  if (typeof raw !== "string") return OFF;
  const parts = raw.split("|");
  if (parts.length !== 2) return OFF;
  const [flag, stop] = parts as [string, string];
  if (flag !== "1" && flag !== "0") return OFF;
  return {
    onTour: flag === "1",
    lastStopId: isStopId(stop) ? stop : null,
  };
}

function browserSession(): TourStorageGetter {
  return () => {
    if (typeof window === "undefined") return null;
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  };
}

export function createTourStore(options: TourStoreOptions = {}): TourStore {
  const session = options.session ?? browserSession();
  const listeners = new Set<() => void>();
  // The tab's latest state in THIS JavaScript context. It wins over the
  // sessionStorage copy, which lags it when a write was refused; after a
  // reload it is empty and the sessionStorage copy carries the state over.
  let memory: TourState | null = null;

  const read = (): TourState => {
    if (memory !== null) return memory;
    try {
      return decodeTourState(session()?.getItem(TOUR_STORAGE_KEY));
    } catch {
      return OFF;
    }
  };

  const write = (next: TourState): void => {
    const current = read();
    if (
      current.onTour === next.onTour &&
      current.lastStopId === next.lastStopId &&
      memory !== null
    ) {
      return;
    }
    memory = next;
    try {
      session()?.setItem(TOUR_STORAGE_KEY, encodeTourState(next));
    } catch {
      // A refused write is not an error: the in-memory mirror carries it.
    }
    for (const listener of [...listeners]) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return encodeTourState(read());
    },
    getServerSnapshot() {
      return OFF_TOUR_SNAPSHOT;
    },
    startTour() {
      write({ ...read(), onTour: true });
    },
    recordStop(id) {
      write({ ...read(), lastStopId: id });
    },
    endTour() {
      write(OFF);
    },
  };
}

/**
 * The store every tour bar shares by default. Module state, so both lens
 * trees (the console and the digital twin) and a client-side navigation
 * between them see one tab's tour.
 */
export const defaultTourStore: TourStore = createTourStore();
