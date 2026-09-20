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

export function installMatchMedia(initialWidth: number): MatchMediaStub {
  const original = window.matchMedia;
  let width = initialWidth;
  const lists = new Set<{
    query: string;
    matches: boolean;
    listeners: Set<Listener>;
  }>();

  const matchMedia = (query: string): MediaQueryList => {
    const entry = {
      query,
      matches: queryMatches(query, width),
      listeners: new Set<Listener>(),
    };
    lists.add(entry);

    const list = {
      get matches() {
        return entry.matches;
      },
      media: query,
      onchange: null,
      addEventListener: (type: string, listener: Listener) => {
        if (type === "change") entry.listeners.add(listener);
      },
      removeEventListener: (type: string, listener: Listener) => {
        if (type === "change") entry.listeners.delete(listener);
      },
      addListener: (listener: Listener) => entry.listeners.add(listener),
      removeListener: (listener: Listener) => entry.listeners.delete(listener),
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
      for (const entry of lists) {
        const matches = queryMatches(entry.query, width);
        if (matches === entry.matches) continue;
        entry.matches = matches;
        const event = { matches, media: entry.query } as MediaQueryListEvent;
        for (const listener of entry.listeners) listener(event);
      }
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
