"use client";

/**
 * Where report blocks get their data, and which stop they show (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D2,
 * D10).
 *
 * ## Report blocks never fetch
 *
 * A report block reads its report from this context and nothing else, so the
 * same component serves every surface that can supply a report's view:
 *
 * - **in the app**, {@link ReportSourceBoundary} (mounted by `MarkdownView`)
 *   loads a report a block names — `report: <slug>` — from the overview's own
 *   reads: the `reports` list filtered by slug, then
 *   `GET /reports/{id}/view`. One boundary per rendered document, so every
 *   block naming the same report shares one read;
 * - **a page that already holds the view** — the Reports section's report
 *   page, or the public share's frozen document — mounts
 *   {@link ReportProvider} with it, which binds that report: a report block
 *   inside it needs no `report:` line (D3 "Binding").
 *
 * A report the project does not have is `missing`, and is said as "No report
 * named `<slug>` in this project". A list the store answered without being
 * able to see its data (`degraded`) is NOT missing — it is a failure to read,
 * since an empty list there means "cannot see", not "none".
 *
 * ## The selected stop lives in the URL
 *
 * Choosing a stop on a `report-timeline` drives every other block of that
 * report on the page. The selection is the URL's `?at.<slug>=<seq>` — one key
 * PER REPORT, so two reports embedded in one document never fight over one
 * key — read through one store every block subscribes to, so all of a
 * report's blocks on the page agree whichever source each was rendered under.
 * No key, or one naming a stop this view does not show, selects the newest
 * stop. The stop it is compared with is the one before it in time order,
 * as the server computed its changes (D10: v1 compares each stop with the
 * previous one).
 *
 * The URL is written with `history.replaceState`, forwarding the history
 * state Next.js put there, so Next takes it for the native call it is and
 * does not navigate (see `admin/coord/onboarding-status/page.tsx`).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  fetchReportView,
  listResource,
} from "@/components/overview/editing/api";
import type { components } from "@/lib/api-client/generated-types";

type Schemas = components["schemas"];

export type ReportView = Schemas["ReportView"];
export type ReportRead = Schemas["ReportRead"];
export type ViewSnapshot = Schemas["ViewSnapshot"];
export type SnapshotDoc = Schemas["ReportSnapshotDoc"];
export type SnapshotChanges = Schemas["SnapshotChanges"];
export type WithheldEntry = Schemas["WithheldEntry"];

/** One report, as a source holds it. */
export type ReportLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "missing" }
  | { state: "ready"; view: ReportView };

interface ReportSource {
  get(slug: string): ReportLoad;
  /** Ask for a report; idempotent. */
  request(slug: string): void;
}

const LOADING: ReportLoad = { state: "loading" };
const MISSING: ReportLoad = { state: "missing" };

const SourceContext = createContext<ReportSource | null>(null);
const BindingContext = createContext<string | null>(null);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A report by its slug, from the overview's own reads. */
export async function loadReportBySlug(slug: string): Promise<ReportLoad> {
  const list = await listResource<ReportRead>("reports", { slug });
  const report = list.items.find((r) => r.slug === slug);
  if (report) {
    return {
      state: "ready",
      view: await fetchReportView<ReportView>(report.id),
    };
  }
  // The store answered but cannot see its data: "none" would be a guess.
  if (list.degraded) return { state: "error", message: list.degraded };
  return MISSING;
}

/** Reports loaded on demand, each once. */
function useLoadedReports() {
  const [loads, setLoads] = useState<Record<string, ReportLoad>>({});
  const asked = useRef(new Set<string>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const request = useCallback((slug: string) => {
    if (asked.current.has(slug)) return;
    asked.current.add(slug);
    loadReportBySlug(slug).then(
      (load) => live.current && setLoads((prev) => ({ ...prev, [slug]: load })),
      (err: unknown) =>
        live.current &&
        setLoads((prev) => ({
          ...prev,
          [slug]: { state: "error", message: errorMessage(err) },
        }))
    );
  }, []);
  return { loads, request };
}

function InAppReportSource({ children }: { children: ReactNode }) {
  const { loads, request } = useLoadedReports();
  const source = useMemo<ReportSource>(
    () => ({ get: (slug) => loads[slug] ?? LOADING, request }),
    [loads, request]
  );
  return (
    <SourceContext.Provider value={source}>{children}</SourceContext.Provider>
  );
}

/**
 * Gives the blocks below it a way to load the reports they name, unless a
 * source above already does. `MarkdownView` mounts one per document.
 */
export function ReportSourceBoundary({ children }: { children: ReactNode }) {
  const enclosing = useContext(SourceContext);
  if (enclosing) return <>{children}</>;
  return <InAppReportSource>{children}</InAppReportSource>;
}

/**
 * Supplies reports whose views a page already holds, and binds one of them:
 * a report block below names it by default.
 *
 * - `bound` defaults to the only view's slug, and to none when there are
 *   several (each block then names its report).
 * - A report not among `views` is loaded as the in-app source would — unless
 *   `fetchOthers` is false (a public page, which reads nothing live), where
 *   it is `missing`.
 */
export function ReportProvider({
  views,
  bound,
  fetchOthers = true,
  children,
}: {
  views: readonly ReportView[];
  bound?: string | null;
  fetchOthers?: boolean;
  children: ReactNode;
}) {
  const enclosing = useContext(SourceContext);
  const own = useLoadedReports();
  const known = useMemo(
    () => new Map(views.map((v) => [v.report.slug, v] as const)),
    [views]
  );
  const { loads, request: requestOwn } = own;
  const source = useMemo<ReportSource>(
    () => ({
      get: (slug) => {
        const view = known.get(slug);
        if (view) return { state: "ready", view };
        if (!fetchOthers) return MISSING;
        if (enclosing) return enclosing.get(slug);
        return loads[slug] ?? LOADING;
      },
      request: (slug) => {
        if (known.has(slug) || !fetchOthers) return;
        if (enclosing) enclosing.request(slug);
        else requestOwn(slug);
      },
    }),
    [known, fetchOthers, enclosing, loads, requestOwn]
  );
  const binding =
    bound !== undefined
      ? bound
      : views.length === 1
        ? views[0]!.report.slug
        : null;
  return (
    <SourceContext.Provider value={source}>
      <BindingContext.Provider value={binding}>
        {children}
      </BindingContext.Provider>
    </SourceContext.Provider>
  );
}

/** The report this part of the page is bound to, if any (D3 "Binding"). */
export function useBoundReport(): string | null {
  return useContext(BindingContext);
}

// ---------------------------------------------------------------------------
// The selected stop: `?at.<slug>=<seq>`
// ---------------------------------------------------------------------------

/** The URL key holding a report's selected stop. */
export function stopParamKey(slug: string): string {
  return `at.${slug}`;
}

const stopListeners = new Set<() => void>();

function subscribeStops(listener: () => void): () => void {
  stopListeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    stopListeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function readStopParam(slug: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get(
    stopParamKey(slug)
  );
  return raw !== null && /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : null;
}

function writeStopParam(slug: string, seq: number): void {
  const url = new URL(window.location.href);
  url.searchParams.set(stopParamKey(slug), String(seq));
  window.history.replaceState(window.history.state, "", url.toString());
  for (const listener of [...stopListeners]) listener();
}

function useStopParam(slug: string): [number | null, (seq: number) => void] {
  const getSnapshot = useCallback(() => readStopParam(slug), [slug]);
  const value = useSyncExternalStore(subscribeStops, getSnapshot, () => null);
  const set = useCallback((seq: number) => writeStopParam(slug, seq), [slug]);
  return [value, set];
}

// ---------------------------------------------------------------------------
// What a report block reads
// ---------------------------------------------------------------------------

export interface ReadyReport {
  slug: string;
  view: ReportView;
  /** The stops shown, oldest first, in the server's `(as_of, seq)` order. */
  stops: readonly ViewSnapshot[];
  /** The stop on screen: the URL's, else the newest; null with no stops. */
  selected: ViewSnapshot | null;
  /** The stop `selected` is compared with; null for the first stop. */
  comparedSeq: number | null;
  /** That stop, when this view shows it (a truncated page may not). */
  compared: ViewSnapshot | null;
  /** The URL named this stop, but the view does not show it. */
  unmatchedSeq: number | null;
  select: (seq: number) => void;
}

export type ReportState =
  | { status: "loading"; slug: string }
  | { status: "error"; slug: string; message: string }
  | { status: "missing"; slug: string }
  | ({ status: "ready" } & ReadyReport);

/** A report and its selected stop, as every report block reads them. */
export function useReport(slug: string): ReportState {
  const source = useContext(SourceContext);
  if (source === null) {
    throw new Error(
      "useReport needs a report source: render report blocks through MarkdownView, or inside ReportProvider"
    );
  }
  const { request } = source;
  useEffect(() => request(slug), [request, slug]);
  const [param, setParam] = useStopParam(slug);
  const load = source.get(slug);
  return useMemo<ReportState>(() => {
    if (load.state === "loading") return { status: "loading", slug };
    if (load.state === "missing") return { status: "missing", slug };
    if (load.state === "error") {
      return { status: "error", slug, message: load.message };
    }
    const stops = load.view.snapshots;
    const pinned =
      param === null ? null : (stops.find((s) => s.seq === param) ?? null);
    const selected = pinned ?? stops[stops.length - 1] ?? null;
    const comparedSeq = selected?.changes_since_previous?.previous_seq ?? null;
    return {
      status: "ready",
      slug,
      view: load.view,
      stops,
      selected,
      comparedSeq,
      compared:
        comparedSeq === null
          ? null
          : (stops.find((s) => s.seq === comparedSeq) ?? null),
      unmatchedSeq: param !== null && pinned === null ? param : null,
      select: setParam,
    };
  }, [load, slug, param, setParam]);
}

// ---------------------------------------------------------------------------
// Reading a stop's document
// ---------------------------------------------------------------------------

/**
 * A stop's `report-snapshot/v1` document. The server validated it against
 * the contract before serving it; this only confirms the shape the blocks
 * read, so a document that is not one renders as unreadable, never as empty.
 */
export function snapshotDoc(
  snapshot: ViewSnapshot | null | undefined
): SnapshotDoc | null {
  const d = snapshot?.data as Partial<SnapshotDoc> | undefined;
  if (!d || d.schema !== "report-snapshot/v1") return null;
  const lists = [d.tables, d.figures, d.items, d.groups, d.notes];
  if (!lists.every(Array.isArray)) return null;
  if (!d.method || typeof d.method !== "object") return null;
  return d as SnapshotDoc;
}

/** The stops the server withheld whole: listed in `withheld`, not shown. */
export function stopsWithheldWhole(view: ReportView): number[] {
  const shown = new Set(view.snapshots.map((s) => s.seq));
  return [
    ...new Set(
      view.withheld.filter((w) => !shown.has(w.seq)).map((w) => w.seq)
    ),
  ];
}
