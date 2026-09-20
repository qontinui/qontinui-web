"use client";

/**
 * /admin/coord/plans — the plan CORPUS, reconciled three ways.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store`, Phases 1
 * and 2.
 *
 * ## What this replaced, and why a repoint rather than a join
 *
 * This route used to read `coord.work_units` through
 * `/api/v1/operations/plans*` — `updated_at DESC`, clamped at 500. That is a
 * recency window over coord's OPERATIONAL store, not a corpus: rank depends on
 * when a unit was last touched, so stalled work is exactly what falls out of
 * view. An operator who could not find a three-week-old plan on it read "not
 * here" as "absent", and the plan was in the library the whole time with its
 * digest matching `origin/main`. That page is not gone — it moved to
 * `/admin/coord/work-units` (Phase 3), where it answers the question it always
 * actually answered.
 *
 * The join this page needs already existed, twice, with zero frontend
 * consumers: `GET /api/v1/plan-library/reconciliation` returns, per plan stem,
 * coord's stored status (axis A), the document's own stamp from the artifact
 * store (axis B) and coord's derived delivery verdict (axis C), plus a
 * classification, a verdict and a plain sentence naming the values that
 * decided it. Building a third join would have been the exact defect the
 * parent plan documents.
 *
 * **`ordering: slug_asc` is the real fix, not the limit.** Plan stems are
 * date-prefixed, so slug order is chronological order — and stable across
 * requests in a way a mutable timestamp is not. New plans carry today's date
 * and therefore APPEND, which is what makes offset paging over this route
 * sound.
 *
 * ## Five read states, not four
 *
 * The four the old page derived are correct and transfer unchanged — unknown,
 * stale, filtered, genuinely-empty. The fifth is this route's own: when its
 * contract check fails it raises **HTTP 500** with
 * `{"error": "reconciliation_contract_violated", "violations": [...]}` rather
 * than returning a degraded body. That is neither a transport failure nor a
 * stale read — it is the route deliberately refusing to emit a facet block it
 * cannot stand behind, and the violations text is the only description of what
 * broke. `planReconciliationStatus.ts` `parseContractViolation` recovers it.
 *
 * ## The status filter is CLIENT-side here, and says so
 *
 * `/reconciliation` takes `offset`, `limit` and `include_coord` — there is no
 * `status` parameter. So unlike the old page's server-side filter, this one
 * narrows the ROWS ON THIS PAGE and nothing else. A control that silently
 * turned into a page-scoped filter would be the same class of mislabel this
 * plan exists to fix, so the page states the scope wherever the filter is
 * capable of emptying the list.
 *
 * ## The rule that governs the disclosure block
 *
 * **Render the population state before any flag derived from the population.**
 * `document_axis_complete` is not readable on its own: it is
 * `document_missing_count == 0` over whatever population was read, so when
 * coord's work-unit arm fails the population collapses to the artifact store
 * and the flag is vacuously true. Measured 2026-09-20, five of eight live
 * probes took that arm and reported `document_axis_complete: true` with
 * `total 1887`, against `false` / `total 1991` on the three good ones — **the
 * degraded read is the MORE optimistic one.** `deriveDisclosure` therefore
 * suppresses that claim, the document counts and the class histogram on that
 * arm and quotes `work_unit_population_reason` and
 * `facets.corpus_incomplete_reasons` verbatim instead.
 *
 * ## Console style
 *
 * R9 (no page-level card — the coord layout owns the `<h1>`), R1 (a
 * `<HealthStrip>` derived from the response already fetched, no second read),
 * R2/R5 (one stem is one `<ReconciliationRow>`, detail expands in place),
 * R6 (`–`, never `0`, for anything unfetched or inadmissible), R8 (every
 * reading is derived in `planReconciliationStatus.ts`, nothing inline here).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Filter, Rows3 } from "lucide-react";
import { HealthStrip, RecordList, RefreshButton } from "@/components/console";
import { CaptureHealthPanel } from "@/components/admin/coord/CaptureHealthPanel";
import { ReconciliationDisclosure } from "@/components/admin/coord/ReconciliationDisclosure";
import { ReconciliationRow } from "@/components/admin/coord/ReconciliationRow";
import {
  deriveCaptureCensus,
  describeCorpusFreshness,
  type CaptureHealthResponse,
} from "@/components/admin/coord/captureHealthStatus";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  STATUS_FILTERS,
  matchesStatus,
} from "@/components/admin/coord/planReconciliationFilters";
import {
  describeWindow,
  deriveDisclosure,
  deriveReconciliationHealth,
  parseContractViolation,
  type ReconciliationResponse,
} from "@/components/admin/coord/planReconciliationStatus";
import { httpClient } from "@/services/service-factory";

const ENDPOINT = "/api/v1/plan-library/reconciliation";
/**
 * Phase 4a — the capture census, read SEPARATELY and deliberately so.
 *
 * It is a different question about a different store (the artifact store, axis
 * B's source), and it answers on the degraded population arm where the
 * reconciliation's own document flags do not. Folding it into the
 * reconciliation read would tie the two together and lose exactly that.
 */
const CAPTURE_ENDPOINT = "/api/v1/plan-library/capture-health";
const POLL_INTERVAL_MS = 30_000;

export default function CoordPlansListPage() {
  const [status, setStatus] = useState("any");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState<ReconciliationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The route's 500 refusal, held separately from `error`.
   *
   * It is its own read state (see the module docstring), so folding it into
   * the generic error string would render the one failure that describes
   * itself as an anonymous one.
   */
  const [violations, setViolations] = useState<string[] | null>(null);

  /**
   * Phase 4a — the capture census, on its own read state.
   *
   * It is NOT re-read when the window changes: offset and limit are questions
   * about the reconciliation page, and this census is about the whole artifact
   * store. `captureFailed` is kept beside the body rather than replacing it,
   * so a failed refresh leaves the previous census on screen and labelled,
   * never an empty one [policy: `verification-and-evidence`
   * `silent-empty-is-unknown`].
   */
  const [capture, setCapture] = useState<CaptureHealthResponse | null>(null);
  const [captureLoaded, setCaptureLoaded] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);

  /**
   * The two generation counters, for the same reasons the work-unit page
   * documents at length: `questionGen` (bumped once per QUESTION — here,
   * per window) gates the error so an overtaken failure still speaks, and
   * `reqGen` (bumped per call) gates the data so two overlapping reads cannot
   * land out of order. `pollInFlight` keeps same-question ticks from stacking.
   */
  const questionGen = useRef(0);
  const reqGen = useRef(0);
  const pollInFlight = useRef(false);

  const fetchData = useCallback(async () => {
    const question = questionGen.current;
    const req = ++reqGen.current;
    try {
      const qs = new URLSearchParams();
      qs.set("offset", String(offset));
      qs.set("limit", String(limit));
      const body = await httpClient.get<ReconciliationResponse>(
        `${ENDPOINT}?${qs.toString()}`
      );
      if (question !== questionGen.current || req !== reqGen.current) return;
      setData(body);
      setError(null);
      setViolations(null);
    } catch (e) {
      if (question !== questionGen.current) return;
      const contract = parseContractViolation(e);
      if (contract !== null) {
        // A named refusal replaces whatever was on screen: the route is
        // telling us the last body's facets stopped meaning what they say,
        // and continuing to render rows under them would be the defect.
        setViolations(contract);
        setData(null);
        setError(null);
        return;
      }
      setViolations(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [offset, limit]);

  useEffect(() => {
    // The WINDOW is the question. Changing it makes the rows in `data`
    // answers to a question nobody asked, and keeping them would leave every
    // read-state derivation reporting the old window while the new one is in
    // flight.
    questionGen.current += 1;
    const question = questionGen.current;
    const releaseLock = () => {
      if (question === questionGen.current) pollInFlight.current = false;
    };
    setData(null);
    setError(null);
    setViolations(null);
    pollInFlight.current = true;
    void fetchData().finally(releaseLock);
    const id = setInterval(() => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      void fetchData().finally(releaseLock);
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(id);
      pollInFlight.current = false;
    };
  }, [fetchData]);

  const fetchCapture = useCallback(async () => {
    try {
      const body =
        await httpClient.get<CaptureHealthResponse>(CAPTURE_ENDPOINT);
      setCapture(body);
      setCaptureFailed(false);
    } catch {
      // The census could not be read. Which door feeds this corpus is
      // UNKNOWN — it is never "no door does".
      setCaptureFailed(true);
    } finally {
      setCaptureLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchCapture();
  }, [fetchCapture]);

  const refresh = useCallback(() => {
    const tookLock = !pollInFlight.current;
    if (tookLock) pollInFlight.current = true;
    const question = questionGen.current;
    // Both reads, because the control says "refresh" and a stale census
    // beside a fresh reconciliation is the misreading this page exists to
    // stop.
    return Promise.all([fetchData(), fetchCapture()]).finally(() => {
      if (tookLock && question === questionGen.current) {
        pollInFlight.current = false;
      }
    });
  }, [fetchData, fetchCapture]);

  const rows = useMemo(() => data?.items ?? [], [data]);
  const shown = useMemo(
    () => rows.filter((row) => matchesStatus(row, status)),
    [rows, status]
  );
  const statusFiltered = status !== "any";
  const window = useMemo(() => (data ? describeWindow(data) : null), [data]);
  const disclosure = useMemo(
    () => (data ? deriveDisclosure(data) : null),
    [data]
  );
  const loaded = data !== null;
  const readFailed = error !== null;
  // R6 — "not fetched" includes "fetched and FAILED".
  const plansUnknown = readFailed && !loaded;
  const plansStale = readFailed && loaded;
  const health = useMemo(
    () => deriveReconciliationHealth(data, loaded, readFailed, violations),
    [data, loaded, readFailed, violations]
  );
  const census = useMemo(
    () => (capture === null ? null : deriveCaptureCensus(capture)),
    [capture]
  );
  const freshness = useMemo(() => describeCorpusFreshness(capture), [capture]);
  /**
   * Did the reconciliation read suppress its document-layer completeness
   * claim? The census is allowed to render either way — it read a store that
   * answered — but on `true` it must say, in words, that it does not restore
   * that claim. `false` while the reconciliation is unread is not a
   * contradiction: the panel's unsuppressed note claims no restoration
   * either.
   */
  const documentAxisSuppressed =
    disclosure !== null && !disclosure.documentAxisAdmissible;

  const canPageBack = offset > 0;
  const canPageForward = window?.hasMore ?? false;

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-plans-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-plans-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger
            className="w-[200px]"
            data-testid="coord-plans-status-select"
            title={
              "Filters the rows ON THIS PAGE by coord's stored status " +
              "(axis A). The reconciliation route takes no status parameter, " +
              "so this is a client-side filter over the current window — not " +
              "a corpus-wide question."
            }
          >
            <SelectValue placeholder="status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Rows3 className="h-4 w-4 text-muted-foreground ml-1" />
        <Select
          value={String(limit)}
          onValueChange={(v) => {
            setOffset(0);
            setLimit(Number(v));
          }}
        >
          <SelectTrigger
            className="w-[150px]"
            data-testid="coord-plans-page-size-select"
            title="Rows per page. The route caps this at 100, which is why paging is the only way the corpus is reachable."
          >
            <SelectValue placeholder="page size" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} per page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RefreshButton
          key={`${offset}:${limit}`}
          onRefresh={refresh}
          label="Refresh reconciliation"
          title={`Re-reads the reconciliation now; it also refreshes itself every ${POLL_INTERVAL_MS / 1000} s`}
          data-testid="coord-plans-refresh"
        />
      </div>

      {/* Phase 2 — the window as a MEASUREMENT: what was asked for, what came
          back, on which declared axis, and the boundary stems. A disclosure
          without a denominator is a disclaimer. */}
      {window && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-plans-window"
        >
          Showing {window.shown} of{" "}
          {window.total !== null ? (
            window.total
          ) : (
            <span data-testid="coord-plans-window-total-unknown">
              an unknown total — the route served no count
            </span>
          )}{" "}
          plan stems
          {window.firstStem && window.lastStem && (
            <>
              , stems <span className="font-mono">{window.firstStem}</span>…
              <span className="font-mono">{window.lastStem}</span>
            </>
          )}
          , offset {window.offset}, page size {window.limit ?? "unstated"},
          ordered{" "}
          <span
            className="font-mono"
            data-testid="coord-plans-window-ordering"
            title="The route DECLARES its ordering so a consumer can assert it did not silently become something else. Plan stems are date-prefixed, so slug order is chronological order."
          >
            {window.ordering ?? "unstated"}
          </span>
          .
        </p>
      )}

      {/* The population state, and every flag derived from it — in that order,
          and never collapsed behind a click. */}
      {disclosure && <ReconciliationDisclosure lines={disclosure.lines} />}

      {/* Phase 4a — the companion to the document-axis line above: the
          document layer is N% complete BY WHICH DOOR, and is that door still
          alive? A separate read, and it never repairs a suppressed claim. */}
      <CaptureHealthPanel
        census={census}
        freshness={freshness}
        documentAxisSuppressed={documentAxisSuppressed}
        readFailed={captureFailed}
        loaded={captureLoaded}
      />

      {statusFiltered && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-plans-status-filter-scope"
        >
          The status filter narrows the {rows.length} rows on this page only —
          the route takes no status parameter, so a plan with this status on
          another page is not shown and is not absent.
        </p>
      )}

      {violations !== null && (
        <div
          className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100"
          data-testid="coord-plans-contract-violation"
        >
          <p className="font-semibold">
            The reconciliation route refused this read.
          </p>
          <p className="text-xs text-red-100/90 mt-1">
            Its own contract check failed, so it returned no rows rather than a
            facet block that stopped meaning what it says. This is not a failed
            request and not a stale window — nothing here is a count of
            anything.
          </p>
          {violations.length > 0 ? (
            <ul
              className="list-disc pl-5 mt-1.5 space-y-0.5 font-mono text-[11px]"
              data-testid="coord-plans-contract-violation-list"
            >
              {violations.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          ) : (
            <p
              className="text-xs text-red-100/80 mt-1.5"
              data-testid="coord-plans-contract-violation-empty"
            >
              The refusal named no violation, so what failed is unknown.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      <RecordList
        items={shown}
        itemKey={(row) => row.slug}
        // "Has this question been ANSWERED, one way or the other?" — never
        // "is a request outstanding?". A contract refusal is an answer.
        loaded={data !== null || error !== null || violations !== null}
        skeletonRows={6}
        empty={
          // ORDER MATTERS, and the refusal goes first: it is the only state
          // that is neither a window nor a read, and describing it as either
          // would lose the only text that says what broke.
          violations !== null ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-refused"
            >
              No rows — the route refused this read (above). Whether any plan
              matches is unknown, not none.
            </p>
          ) : statusFiltered && rows.length > 0 ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-status-filtered-empty"
            >
              None of the {rows.length} stems on this page has coord status{" "}
              {status}. The filter is page-scoped, so the corpus may hold
              plenty.
            </p>
          ) : plansUnknown ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-unknown"
            >
              Could not read the plan reconciliation — whether the corpus holds
              any plan is unknown, not none.
            </p>
          ) : plansStale ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-stale"
            >
              This window held no plan stem at the last good read — it has not
              refreshed since.
            </p>
          ) : (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-empty"
            >
              No plan stems in this window.
            </p>
          )
        }
        renderRow={(row, ctx) => (
          <ReconciliationRow
            row={row}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
          />
        )}
      />

      <div className="flex items-center gap-2" data-testid="coord-plans-paging">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPageBack}
          onClick={() => setOffset((o) => Math.max(0, o - limit))}
          data-testid="coord-plans-page-prev"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canPageForward}
          onClick={() => setOffset((o) => o + limit)}
          data-testid="coord-plans-page-next"
          title={
            window?.total === null
              ? "The route served no total, so 'more' is inferred from a full page."
              : undefined
          }
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="text-xs text-muted-foreground">
          The route caps a page at 100 rows, so paging is the only way the
          corpus is reachable.
        </span>
      </div>
    </div>
  );
}
