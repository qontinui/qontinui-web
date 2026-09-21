/**
 * A width-driven `window.matchMedia` stub for tests.
 *
 * `src/test/setup.ts` installs a stub that answers `matches: false` to every
 * query and never fires a change event, which is enough for components that
 * only need the call not to throw. Anything that BRANCHES on width — the app
 * shell's three layouts — needs a stub that can actually change, so install
 * this one instead.
 *
 * Only `(min-width: Npx)` and `(max-width: Npx)` are understood; any other
 * query reports `false`, which is the same answer the default stub gives.
 */

type Listener = (event: MediaQueryListEvent) => void;

export interface MatchMediaStub {
  /** Move the viewport. Notifies every list whose match changed. */
  setWidth: (width: number) => void;
  /**
   * How many change listeners are attached for `query`. The only way to tell
   * a detached listener from an attached one: an unmounted hook's last
   * rendered value stays frozen either way.
   */
  listenerCount: (query: string) => number;
  /** Restore whatever `window.matchMedia` was before `installMatchMedia`. */
  restore: () => void;
}

function queryMatches(query: string, width: number): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return width >= Number(min[1]);
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return width <= Number(max[1]);
  return false;
}

interface Entry {
  query: string;
  matches: boolean;
  listeners: Set<Listener>;
}

export function installMatchMedia(initialWidth: number): MatchMediaStub {
  const original = window.matchMedia;
  let width = initialWidth;
  // Keyed by query, because a caller may ask for the same one repeatedly and
  // expect the same list back — the real `matchMedia` returns a live object,
  // and a stub that minted a new entry per call would accumulate dead ones
  // and make `listenerCount` meaningless.
  const lists = new Map<string, Entry>();

  const matchMedia = (query: string): MediaQueryList => {
    let entry = lists.get(query);
    if (!entry) {
      entry = {
        query,
        matches: queryMatches(query, width),
        listeners: new Set<Listener>(),
      };
      lists.set(query, entry);
    }
    const bound = entry;

    const list = {
      get matches() {
        return bound.matches;
      },
      media: query,
      onchange: null,
      addEventListener: (type: string, listener: Listener) => {
        if (type === "change") bound.listeners.add(listener);
      },
      removeEventListener: (type: string, listener: Listener) => {
        if (type === "change") bound.listeners.delete(listener);
      },
      addListener: (listener: Listener) => bound.listeners.add(listener),
      removeListener: (listener: Listener) => bound.listeners.delete(listener),
      dispatchEvent: () => true,
    };
    return list as unknown as MediaQueryList;
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: matchMedia,
  });

  return {
    setWidth(next: number) {
      width = next;
      for (const entry of lists.values()) {
        const matches = queryMatches(entry.query, width);
        if (matches === entry.matches) continue;
        entry.matches = matches;
        const event = { matches, media: entry.query } as MediaQueryListEvent;
        for (const listener of entry.listeners) listener(event);
      }
    },
    listenerCount(query: string) {
      return lists.get(query)?.listeners.size ?? 0;
    },
    restore() {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: original,
      });
    },
  };
}
