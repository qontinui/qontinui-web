"use client";

/**
 * Reads the blocks of one document share (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D2).
 *
 * The overview's read hooks — `useResourceList`, `useResourceRecord`, the
 * Timeline's `useForecast`, `overview-kpi`'s work counts — keep no cache of
 * their own. On a page that costs nothing: each read there belongs to one
 * component. A document is different: three `overview-kpi work-*` blocks on
 * the Summary would each read coord's project state, and two forecast
 * figures would each read the forecast.
 *
 * Inside a {@link SharedReadsBoundary} — `MarkdownView` mounts one per
 * document, in the style of `ReportSourceBoundary` — a hook hands its read to
 * {@link useSharedRead}'s `share` under a key naming the whole request, and a
 * read already made for that key is shared instead of made again. N blocks
 * make one read per distinct request.
 *
 * - A read is shared while it is in flight and after it lands, for the life
 *   of the document, as `ReportSourceBoundary` keeps a report.
 * - A read that FAILS is forgotten once it settles: the blocks waiting on it
 *   all see the failure, and the next block that asks reads again rather
 *   than inheriting it.
 * - The key carries everything the read depends on — the route, its
 *   parameters, the project, the hook's reload counter — so a project switch
 *   or a reload is a new read, never a stale one.
 * - Outside a boundary, `share` simply makes the read: a page's own reads are
 *   unchanged.
 */

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/** Make `load`'s read, or share the one already made under `key`. */
export type ShareRead = <T>(
  key: readonly unknown[],
  load: () => Promise<T>
) => Promise<T>;

const readDirectly: ShareRead = (_key, load) => load();

const SharedReadsContext = createContext<ShareRead | null>(null);

function SharedReads({ children }: { children: ReactNode }) {
  const reads = useRef(new Map<string, Promise<unknown>>());
  const share = useMemo<ShareRead>(() => {
    function shareRead<T>(
      key: readonly unknown[],
      load: () => Promise<T>
    ): Promise<T> {
      const id = JSON.stringify(key);
      const known = reads.current.get(id);
      if (known) return known as Promise<T>;
      const read = load();
      reads.current.set(id, read);
      read.catch(() => {
        if (reads.current.get(id) === read) reads.current.delete(id);
      });
      return read;
    }
    return shareRead;
  }, []);
  return (
    <SharedReadsContext.Provider value={share}>
      {children}
    </SharedReadsContext.Provider>
  );
}

/**
 * Lets the reads below it be shared, unless a boundary above already does.
 * `MarkdownView` mounts one per document.
 */
export function SharedReadsBoundary({ children }: { children: ReactNode }) {
  const enclosing = useContext(SharedReadsContext);
  if (enclosing) return <>{children}</>;
  return <SharedReads>{children}</SharedReads>;
}

/** The enclosing document's `share`, or one that reads directly. */
export function useSharedRead(): ShareRead {
  return useContext(SharedReadsContext) ?? readDirectly;
}
