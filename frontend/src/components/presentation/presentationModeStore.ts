/**
 * presentationModeStore — the two browser-side stores behind D2's middle arms
 * (`presentationModeResolution.ts`), shaped for `useSyncExternalStore`.
 *
 * - **The tab session** (sessionStorage, mirrored in memory) holds the tab's
 *   last explicit choice: a `?present=` the tab was opened with, or a press of
 *   the header toggle. It survives in-app navigation and reloads of THIS tab
 *   and reaches no other tab. The in-memory mirror is what still carries the
 *   choice when sessionStorage is unavailable or refuses a write (a private
 *   window, blocked site data), so following a link never drops the lens.
 * - **The viewer convenience** (localStorage) holds the toggle's remembered
 *   setting for the next tab. Only the toggle writes it: a shared
 *   `?present=1` link must not silently change how its recipient's console
 *   opens tomorrow.
 *
 * Every read and write is guarded: a storage that throws reads as "nothing
 * stored", never as an error. Neither store is authority — the URL beats both
 * (D2) — and neither ever reaches a server.
 *
 * ## Snapshots
 *
 * `getSnapshot` returns a short PRIMITIVE string, so React's `Object.is`
 * comparison is stable while nothing changes. `getServerSnapshot` returns
 * {@link UNREADABLE_SNAPSHOT}: on a server render and during hydration the
 * stores cannot be read, which resolution reports as `unresolved` and fails
 * closed on.
 */

import {
  decodeChoice,
  encodeChoice,
  type StoredChoice,
} from "./presentationModeResolution";

/** The key in BOTH stores. They are separate stores, so one name serves. */
export const PRESENTATION_MODE_STORAGE_KEY = "qontinui.presentation-mode";

/** The server/hydration snapshot: the stores were not readable. */
export const UNREADABLE_SNAPSHOT = "unreadable";

export interface RecordChoiceOptions {
  /**
   * Also write the viewer convenience (localStorage). `true` for the toggle;
   * `false` for a choice that arrived on the URL.
   */
  readonly remember: boolean;
}

export interface PresentationModeStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): string;
  getServerSnapshot(): string;
  /** Record an explicit choice and notify subscribers. */
  recordChoice(presenting: boolean, options: RecordChoiceOptions): void;
}

export interface StoredChoices {
  /** `false` only for {@link UNREADABLE_SNAPSHOT}. */
  readonly readable: boolean;
  readonly session: StoredChoice;
  readonly storage: StoredChoice;
}

/** A getter rather than a value: touching `window.sessionStorage` can itself throw. */
export type StorageGetter = () => Storage | null;

export interface PresentationModeStoreOptions {
  readonly session?: StorageGetter;
  readonly viewer?: StorageGetter;
}

const NO_CHOICE = "-";

function encodeSlot(choice: StoredChoice): string {
  return choice === null ? NO_CHOICE : encodeChoice(choice);
}

function decodeSlot(slot: string | undefined): StoredChoice {
  return slot === NO_CHOICE ? null : decodeChoice(slot);
}

/** The snapshot string back to its two choices. */
export function decodeStoreSnapshot(snapshot: string): StoredChoices {
  if (snapshot === UNREADABLE_SNAPSHOT) {
    return { readable: false, session: null, storage: null };
  }
  const [session, storage] = snapshot.split("|");
  return {
    readable: true,
    session: decodeSlot(session),
    storage: decodeSlot(storage),
  };
}

function browserStorage(pick: (w: Window) => Storage): StorageGetter {
  return () => {
    if (typeof window === "undefined") return null;
    try {
      return pick(window);
    } catch {
      return null;
    }
  };
}

function readChoice(getStorage: StorageGetter): StoredChoice {
  try {
    const storage = getStorage();
    return storage
      ? decodeChoice(storage.getItem(PRESENTATION_MODE_STORAGE_KEY))
      : null;
  } catch {
    return null;
  }
}

function writeChoice(getStorage: StorageGetter, presenting: boolean): void {
  try {
    getStorage()?.setItem(
      PRESENTATION_MODE_STORAGE_KEY,
      encodeChoice(presenting)
    );
  } catch {
    // A refused write is not an error: the in-memory mirror (session) or the
    // URL and the default (viewer) still resolve the mode.
  }
}

export function createPresentationModeStore(
  options: PresentationModeStoreOptions = {}
): PresentationModeStore {
  const sessionStore =
    options.session ?? browserStorage((w) => w.sessionStorage);
  const viewerStore = options.viewer ?? browserStorage((w) => w.localStorage);
  const listeners = new Set<() => void>();
  // The tab's latest choice in THIS JavaScript context. It wins over the
  // sessionStorage copy, which can lag it when a write was refused; after a
  // reload it is empty and the sessionStorage copy carries the choice over.
  let memorySession: StoredChoice = null;

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  // Another tab changing the viewer convenience can change this tab's answer
  // when this tab has made no choice of its own.
  const onStorage = () => emit();

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") {
          window.removeEventListener("storage", onStorage);
        }
      };
    },
    getSnapshot() {
      const session = memorySession ?? readChoice(sessionStore);
      const storage = readChoice(viewerStore);
      return `${encodeSlot(session)}|${encodeSlot(storage)}`;
    },
    getServerSnapshot() {
      return UNREADABLE_SNAPSHOT;
    },
    recordChoice(presenting, { remember }) {
      memorySession = presenting;
      writeChoice(sessionStore, presenting);
      if (remember) writeChoice(viewerStore, presenting);
      emit();
    },
  };
}

/**
 * The store every `PresentationModeProvider` shares by default. Module state,
 * so both lens trees (the console layout and the digital-twin layout) and a
 * client-side navigation between them see one tab session.
 */
export const defaultPresentationModeStore: PresentationModeStore =
  createPresentationModeStore();
