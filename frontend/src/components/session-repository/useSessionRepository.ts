"use client";

/**
 * The Session Repository list read.
 *
 * Copies three idioms from `usePlanLibrary` (the sibling web-owned corpus)
 * because they are already proven here: debounced text filters, a monotonic
 * request-id gate instead of `AbortController` (http-client overwrites the
 * caller's signal with its own timeout controller, so an abort never reaches
 * the request), and "no rows WITH an error is UNKNOWN, not empty".
 *
 * What is NEW is {@link FilterHonesty}. Three of this page's filters —
 * attribution source, body source, and the secret-detector audit bucket — are
 * the ones the plan requires to be queryable (§3.6 rule 2, §5, §4.1). Rather
 * than trusting that a 200 means the server applied them, every load CHECKS
 * the returned rows against what was asked for. If a param was ignored, the
 * hook filters the loaded page itself and reports that it did so, in those
 * words. A filter chip that silently filtered nothing is the "guessed renders
 * like declared" failure class one level up.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listSessionArtifacts, listUnfinishedSessions } from "./api";
import type { CoordSignal, SessionArtifactSummary } from "./types";

export const PAGE_SIZE = 50;

/** `all` = the filtered corpus; `unfinished` = the derived never-closed list. */
export type RepositoryView = "all" | "unfinished";

/**
 * The secret-detector audit bucket. Four values because the column carries
 * three distinguishable states and collapsing any two of them destroys the
 * signal: NULL kinds = never scanned, `[]` = scanned and clean, count > 0 =
 * findings. "Never scanned" is emphatically not "clean".
 */
export type SecretAudit = "" | "findings" | "scanned_clean" | "never_scanned";

export interface SessionRepositoryFilters {
  /** Full-text over title, session name and the first/last prompts. */
  q: string;
  /** Account home the transcript was found in. Free text — no vocabulary. */
  account: string;
  repo: string;
  /** Closed vocabulary (`open|closed|abandoned`); "" = any. */
  state: string;
  /** Closed vocabulary (`clean|unfinished|unknown`); "" = any. */
  closeoutState: string;
  /** Closed vocabulary (see `SESSION_TENANT_SOURCES`); "" = any. */
  tenantSource: string;
  /** `disk_verbatim` | `coord_redacted`; "" = any. */
  bodySource: string;
  /** Audit signal, NOT a visibility gate and NOT a mask. */
  secretAudit: SecretAudit;
  /** `YYYY-MM-DD`; sessions with activity at or after that day (UTC). */
  since: string;
}

export const EMPTY_FILTERS: SessionRepositoryFilters = {
  q: "",
  account: "",
  repo: "",
  state: "",
  closeoutState: "",
  tenantSource: "",
  bodySource: "",
  secretAudit: "",
  since: "",
};

/** Which requested filters the SERVER did not apply, per the rows it sent. */
export interface FilterHonesty {
  /** `null` when the filter was not requested at all. */
  tenantSourceServerSide: boolean | null;
  bodySourceServerSide: boolean | null;
  secretAuditServerSide: boolean | null;
  /** True when at least one filter had to be applied on the loaded page. */
  degraded: boolean;
  /** Rows dropped locally because the server did not drop them. */
  droppedLocally: number;
  /** Human-readable names of the filters the server ignored. */
  ignored: string[];
}

const NO_DEGRADATION: FilterHonesty = {
  tenantSourceServerSide: null,
  bodySourceServerSide: null,
  secretAuditServerSide: null,
  degraded: false,
  droppedLocally: 0,
  ignored: [],
};

/** Does one row satisfy the chosen audit bucket? */
function matchesSecretAudit(
  row: SessionArtifactSummary,
  bucket: SecretAudit
): boolean {
  switch (bucket) {
    case "findings":
      return row.secret_finding_count > 0;
    case "scanned_clean":
      return row.secret_finding_kinds !== null && row.secret_finding_count === 0;
    case "never_scanned":
      return row.secret_finding_kinds === null;
    case "":
      return true;
  }
}

/** The query params one audit bucket sends. */
function secretAuditQuery(bucket: SecretAudit): {
  hasSecretFindings?: boolean;
  detectorRan?: boolean;
} {
  switch (bucket) {
    case "findings":
      return { hasSecretFindings: true };
    case "scanned_clean":
      return { hasSecretFindings: false, detectorRan: true };
    case "never_scanned":
      return { detectorRan: false };
    case "":
      return {};
  }
}

const TEXT_FILTER_DEBOUNCE_MS = 300;

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function hasActiveFilters(f: SessionRepositoryFilters): boolean {
  return (
    f.q.trim() !== "" ||
    f.account.trim() !== "" ||
    f.repo.trim() !== "" ||
    f.state !== "" ||
    f.closeoutState !== "" ||
    f.tenantSource !== "" ||
    f.bodySource !== "" ||
    f.secretAudit !== "" ||
    f.since.trim() !== ""
  );
}

/** Counts that only `GET /unfinished` reports, and what coord could say. */
export interface UnfinishedContext {
  unknownCount: number;
  cleanCount: number;
  coordOutstanding: CoordSignal | null;
}

export function useSessionRepository() {
  const [view, setView] = useState<RepositoryView>("all");
  //: What the inputs show — updates on every keystroke.
  const [filters, setFilters] = useState<SessionRepositoryFilters>(EMPTY_FILTERS);
  //: What has actually been sent — trails `filters` by the debounce.
  const [applied, setApplied] = useState<SessionRepositoryFilters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<SessionArtifactSummary[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [honesty, setHonesty] = useState<FilterHonesty>(NO_DEGRADATION);
  const [unfinished, setUnfinished] = useState<UnfinishedContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Settle the typed filters before they become a query. The dropdowns and
  // paging are single discrete actions — delaying those by 300ms reads as a
  // bug, so they apply immediately.
  useEffect(() => {
    const discreteChanged =
      filters.state !== applied.state ||
      filters.closeoutState !== applied.closeoutState ||
      filters.tenantSource !== applied.tenantSource ||
      filters.bodySource !== applied.bodySource ||
      filters.secretAudit !== applied.secretAudit ||
      filters.since !== applied.since;
    if (discreteChanged) {
      setApplied(filters);
      return;
    }
    if (
      filters.q === applied.q &&
      filters.account === applied.account &&
      filters.repo === applied.repo
    ) {
      return;
    }
    const id = setTimeout(() => setApplied(filters), TEXT_FILTER_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [filters, applied]);

  /**
   * Monotonic id of the newest list request. EVERY write below is gated on
   * still owning it — an ungated late failure paints "couldn't load" over
   * rows that are in fact fresh, and an ungated late success clears a banner
   * that was telling the truth. `AbortController` cannot do this job here:
   * `http-client.ts` overwrites the caller's signal with its own timeout
   * controller, so the abort never reaches the request.
   */
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    try {
      if (view === "unfinished") {
        const data = await listUnfinishedSessions({
          offset,
          limit: PAGE_SIZE,
        });
        if (reqId !== requestIdRef.current) return;
        setItems(data.items ?? []);
        setServerTotal(data.total ?? 0);
        setHonesty(NO_DEGRADATION);
        setUnfinished({
          unknownCount: data.unknown_count ?? 0,
          cleanCount: data.clean_count ?? 0,
          coordOutstanding: data.coord_outstanding ?? null,
        });
        setError(null);
        return;
      }

      const data = await listSessionArtifacts({
        q: applied.q,
        account: applied.account,
        repo: applied.repo,
        state: applied.state,
        closeoutState: applied.closeoutState,
        tenantSource: applied.tenantSource,
        bodySource: applied.bodySource,
        ...secretAuditQuery(applied.secretAudit),
        since: applied.since,
        offset,
        limit: PAGE_SIZE,
      });
      // Superseded: write NOTHING — not the rows, not the error state, and
      // not `loading`; the live request owns that.
      if (reqId !== requestIdRef.current) return;

      const returned = data.items ?? [];

      // Did the server actually apply the three plan-mandated filters? Asked
      // of the rows, not assumed from a 200.
      const wantTenantSource = applied.tenantSource || null;
      const wantBodySource = applied.bodySource || null;
      const wantAudit = applied.secretAudit;

      const tenantSourceServerSide =
        wantTenantSource === null
          ? null
          : returned.every((r) => r.tenant_source === wantTenantSource);
      const bodySourceServerSide =
        wantBodySource === null
          ? null
          : returned.every((r) => r.body_source === wantBodySource);
      const secretAuditServerSide =
        wantAudit === ""
          ? null
          : returned.every((r) => matchesSecretAudit(r, wantAudit));

      let visible = returned;
      const ignored: string[] = [];
      if (wantTenantSource !== null && tenantSourceServerSide === false) {
        visible = visible.filter((r) => r.tenant_source === wantTenantSource);
        ignored.push("the attribution filter");
      }
      if (wantBodySource !== null && bodySourceServerSide === false) {
        visible = visible.filter((r) => r.body_source === wantBodySource);
        ignored.push("the body-source filter");
      }
      if (wantAudit !== "" && secretAuditServerSide === false) {
        visible = visible.filter((r) => matchesSecretAudit(r, wantAudit));
        ignored.push("the secret-detector filter");
      }

      setItems(visible);
      setServerTotal(data.total ?? returned.length);
      setUnfinished(null);
      setHonesty({
        tenantSourceServerSide,
        bodySourceServerSide,
        secretAuditServerSide,
        degraded: ignored.length > 0,
        droppedLocally: returned.length - visible.length,
        ignored,
      });
      setError(null);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setError(message(err, "Failed to load the session repository"));
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [view, applied, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Change a filter and return to the first page — page 3 of a new query is
   *  a different (and usually empty) result set. */
  const updateFilter = useCallback(
    <K extends keyof SessionRepositoryFilters>(
      key: K,
      value: SessionRepositoryFilters[K]
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

  const changeView = useCallback((next: RepositoryView) => {
    setOffset(0);
    setView(next);
  }, []);

  /** Distinct accounts/repos on the LOADED page — suggestions, not a ceiling. */
  const seen = useMemo(() => {
    const accounts = new Set<string>();
    const repos = new Set<string>();
    for (const item of items) {
      if (item.account_label) accounts.add(item.account_label);
      if (item.repo) repos.add(item.repo);
    }
    return {
      accounts: [...accounts].sort(),
      repos: [...repos].sort(),
    };
  }, [items]);

  /**
   * How many rows on this page carry a tenant nobody declared. Surfaced as a
   * standing count as well as per-row, so an operator sees the size of the
   * guessed bucket without opening anything.
   */
  const guessedTenantCount = useMemo(
    () => items.filter((i) => i.tenant_source !== "declared").length,
    [items]
  );

  return {
    view,
    changeView,
    filters,
    updateFilter,
    resetFilters,
    hasFilters: hasActiveFilters(filters),
    seen,
    items,
    /**
     * The server's count for the applied query. When {@link FilterHonesty}
     * reports a degraded filter this describes MORE rows than are shown, and
     * the list says so rather than printing it as the result count.
     */
    serverTotal,
    guessedTenantCount,
    honesty,
    /** Only populated in the `unfinished` view. */
    unfinished,
    offset,
    setOffset,
    loading,
    error,
    reload: load,
  };
}
