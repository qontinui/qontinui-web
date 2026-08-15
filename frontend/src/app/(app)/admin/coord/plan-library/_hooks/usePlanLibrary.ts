"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type {
  CaptureHealthResponse,
  DivergentResponse,
  WorkArtifactDetail,
  WorkArtifactKind,
  WorkArtifactListResponse,
  WorkArtifactSummary,
} from "../types";

const API = "/api/v1/plan-library";

export const PAGE_SIZE = 50;

export interface PlanLibraryFilters {
  /** Closed vocabulary — the schema backs it with a Postgres CHECK. */
  kind: WorkArtifactKind | "";
  /** OPAQUE free text. Exact match; an unknown value is an empty page, never
   *  an error. Deliberately not a dropdown — there is no status vocabulary. */
  status: string;
  /** Matches the `repos[]` array OR `source_repo`. */
  repo: string;
  /** Full-text over title + body. */
  q: string;
}

export const EMPTY_FILTERS: PlanLibraryFilters = {
  kind: "",
  status: "",
  repo: "",
  q: "",
};

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function toQuery(filters: PlanLibraryFilters, offset: number): string {
  const qs = new URLSearchParams();
  if (filters.kind) qs.set("kind", filters.kind);
  if (filters.status.trim()) qs.set("status", filters.status.trim());
  if (filters.repo.trim()) qs.set("repo", filters.repo.trim());
  if (filters.q.trim()) qs.set("q", filters.q.trim());
  qs.set("offset", String(offset));
  qs.set("limit", String(PAGE_SIZE));
  return qs.toString();
}

/**
 * How long a typed filter sits still before it is sent.
 *
 * The three text filters (`q`, `status`, `repo`) are typed a character at a
 * time and `q` runs a Postgres full-text query over title+body, so firing per
 * keystroke would put ~20 tsquery scans behind one search. The dropdown and
 * paging are NOT debounced — they are single discrete actions and delaying
 * them would just feel broken.
 */
const TEXT_FILTER_DEBOUNCE_MS = 300;

/**
 * The filtered corpus list, plus the single-artifact read and the inline kind
 * correction.
 *
 * A note on the facets. `kind` is a real closed vocabulary (a Postgres CHECK
 * backs it), so it is a dropdown. `status` and `repo` are NOT — status mirrors
 * whatever an operator typed in a plan's front-matter and repo is any string
 * — so they are free-text inputs with the values *seen on the loaded page*
 * offered as one-click chips. A dropdown built from the loaded page would
 * quietly cap the operator at what page 1 happens to contain, which is the
 * kind of invisible ceiling that makes a filter untrustworthy.
 */
export function usePlanLibrary() {
  //: What the inputs show — updates on every keystroke.
  const [filters, setFilters] = useState<PlanLibraryFilters>(EMPTY_FILTERS);
  //: What has actually been sent — trails `filters` by the debounce.
  const [applied, setApplied] = useState<PlanLibraryFilters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<WorkArtifactSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Settle the typed filters before they become a query. `kind` is a dropdown
  // and is applied immediately — a 300ms lag on a single click reads as a bug.
  useEffect(() => {
    if (filters.kind !== applied.kind) {
      setApplied(filters);
      return;
    }
    if (
      filters.q === applied.q &&
      filters.status === applied.status &&
      filters.repo === applied.repo
    ) {
      return;
    }
    const id = setTimeout(() => setApplied(filters), TEXT_FILTER_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [filters, applied]);

  /**
   * Monotonic id of the newest list request. EVERY write in [`load`] — the
   * rows, the total, both branches of the error state and `loading` — is
   * gated on still owning it.
   *
   * `load` is recreated on `[applied, offset]` and fired by the effect below,
   * so overlapping filter or page changes are ordinary, not exotic. Ungated,
   * all four writes race:
   *
   * * Next then Prev, and the offset-50 response can land last — page 2's rows
   *   rendered under "1–50 of 200".
   * * An honesty INVERSION on the error state, which is the worst of the four.
   *   A late failure runs `setError(...)` and paints the amber "these may be
   *   out of date" banner over rows that are in fact fresh; a late success
   *   runs `setError(null)` and clears a banner that was telling the truth.
   * * `finally { setLoading(false) }` re-enables the pager while the live
   *   request is still out.
   *
   * An `AbortController` cannot do this job here: `http-client.ts` overwrites
   * the caller's `signal` with its own timeout controller, so the abort never
   * reaches the request. This is the same counter pattern
   * `ArtifactDetailDialog` uses, for the same reason.
   */
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    try {
      const data = await httpClient.get<WorkArtifactListResponse>(
        `${API}?${toQuery(applied, offset)}`
      );
      // Superseded: write NOTHING. Not the rows, not the error state, and not
      // `loading` — the live request owns that and clears it when it lands.
      if (reqId !== requestIdRef.current) return;
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setError(null);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setError(message(err, "Failed to load the plan library"));
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [applied, offset]);

  useEffect(() => {
    load();
  }, [load]);

  /** Change a filter and return to the first page — page 3 of a new query is
   *  a different (and usually empty) result set. */
  const updateFilter = useCallback(
    <K extends keyof PlanLibraryFilters>(
      key: K,
      value: PlanLibraryFilters[K]
    ) => {
      setOffset(0);
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const resetFilters = useCallback(() => {
    setOffset(0);
    setFilters(EMPTY_FILTERS);
    // Clearing is a discrete action, so it skips the debounce entirely.
    setApplied(EMPTY_FILTERS);
  }, []);

  /** Distinct statuses/repos on the LOADED page — suggestions, not a ceiling. */
  const seen = useMemo(() => {
    const statuses = new Set<string>();
    const repos = new Set<string>();
    for (const item of items) {
      if (item.status) statuses.add(item.status);
      if (item.source_repo) repos.add(item.source_repo);
      for (const r of item.repos ?? []) repos.add(r);
    }
    return {
      statuses: [...statuses].sort(),
      repos: [...repos].sort(),
    };
  }, [items]);

  const fetchDetail = useCallback(
    async (id: string): Promise<WorkArtifactDetail | null> => {
      try {
        return await httpClient.get<WorkArtifactDetail>(`${API}/${id}`);
      } catch (err) {
        toast.error(message(err, "Failed to load the artifact"));
        return null;
      }
    },
    []
  );

  /**
   * Correct one artifact's kind. The write also LOCKS the kind, so the next
   * runner scan cannot silently put its guess back — and because `kind` is
   * part of the artifact's identity, an un-locked correction would fork the
   * document into a second row rather than merely re-label it.
   *
   * A 409 here is a genuine identity collision (another artifact already
   * occupies `(kind, slug, source_repo)`); merging the two is an operator
   * decision, so this surfaces the error rather than guessing.
   */
  const correctKind = useCallback(
    async (id: string, kind: WorkArtifactKind): Promise<boolean> => {
      try {
        await httpClient.patch<WorkArtifactSummary>(`${API}/${id}/kind`, {
          kind,
        });
        toast.success(`Kind set to "${kind}" and locked against re-scans.`);
        await load();
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to correct the kind"));
        return false;
      }
    },
    [load]
  );

  return {
    filters,
    updateFilter,
    resetFilters,
    seen,
    items,
    total,
    offset,
    setOffset,
    loading,
    error,
    reload: load,
    fetchDetail,
    correctKind,
  };
}

/**
 * The two divergence classes, side by side.
 *
 * `groups` is same-`(kind, slug)` content drift. `kind_forks` is a *different*
 * failure — same `(slug, source_repo)` with disagreeing kinds — that grouping
 * by `(kind, slug)` structurally cannot see, which is why the API reports it
 * separately and why this hook keeps it separate too.
 */
export function useDivergentArtifacts() {
  const [data, setData] = useState<DivergentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setData(await httpClient.get<DivergentResponse>(`${API}/divergent`));
      setError(null);
    } catch (err) {
      setError(message(err, "Failed to load divergent copies"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

/** Corpus census by capture door — is the agent door being used at all? */
export function useCaptureHealth() {
  const [data, setData] = useState<CaptureHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setData(
        await httpClient.get<CaptureHealthResponse>(`${API}/capture-health`)
      );
      setError(null);
    } catch (err) {
      setError(message(err, "Failed to load capture health"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
