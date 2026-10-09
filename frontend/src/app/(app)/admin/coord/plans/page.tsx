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
 * **`ordering: stem_date_asc` is the real fix, not the limit.** Each stem's
 * position is a pure function of the stem (its date prefix, then a uuid5
 * tiebreak), so it is chronological by authoring day and IMMUTABLE. The route
 * pages by an opaque keyset cursor over it (plan
 * `2026-09-05-every-bounded-read-is-a-page-that-reads-as-a-corpus` Phase 4):
 * a stem added or removed between two reads can no longer shift the window,
 * which `offset` paging — now deleted — could.
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
 * `/reconciliation` takes `cursor`, `limit` and `include_coord` — there is no
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
 * ## The Plan Browser (plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next`)
 *
 * Phases 1-6 made this the ONE plan page. `/admin/coord/plan-library`
 * redirects here; its two policy dials live at
 * `/admin/coord/plan-library/settings`; its scan-source and coverage panels
 * are collapsed into the corpus-health strip (`CorpusHealthPanel`); its
 * divergence panel is gone in favour of `/admin/coord/plan-forks`. Added on
 * top of the reconciliation:
 *
 * - **Search** (`q`) — the only SERVER-side filter. The route filters the
 *   population before paging, so `total` is the match count, and it echoes
 *   `q`; a backend that does not echo it is said to have ignored it.
 * - **Status class, "needs a /vet-imp", document-only, difficulty** —
 *   CLIENT-side over this page, composed in `rowFilters.ts` and labelled
 *   "filters this page only" wherever they can empty the list.
 * - **Live custody** (`include_custody=true`) — `custody.ts`, never a guessed
 *   name. Asked for only on the reads an operator causes (first read of a
 *   window, refresh, paging, search), and on the 30 s poll only until one
 *   custody read has succeeded for the current window/search, because coord
 *   resolves it for the whole tenant. A poll answer re-applies the last
 *   reading with its age stated (`custodyHold.ts`).
 * - **Other artifact kinds** — this page reads `kind='plan'` only; every kind
 *   is listed at `/admin/coord/plan-library/artifacts`.
 * - **Throughput** — coord's server-side day buckets, never a client reduce.
 * - **The document** — `ArtifactDetailPanel`, opened in place in a row.
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
import Link from "next/link";
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
} from "@/components/admin/coord/planReconciliationFilters";
import {
  describeWindow,
  deriveDisclosure,
  deriveReconciliationHealth,
  parseContractViolation,
  type ReconciliationResponse,
} from "@/components/admin/coord/planReconciliationStatus";
import {
  useGuardedPoll,
  type ReadGuard,
} from "@/components/admin/coord/useGuardedPoll";
import { httpClient } from "@/services/service-factory";
import { usePlanDifficulty } from "../work-units/usePlanDifficulty";
import { CorpusHealthPanel } from "./CorpusHealthPanel";
import { PlanPageFilters, PAGE_ONLY_NOTE } from "./PlanPageFilters";
import { PlanRowBadges } from "./PlanRowBadges";
import {
  PlanDocumentPanel,
  PlanShippedBy,
  PlanTriageDetail,
} from "./PlanRowDetail";
import { PlanSearchBox, SearchEcho } from "./PlanSearchBox";
import { ThroughputPanel } from "./ThroughputPanel";
import { pageForkCount } from "./corpusHealth";
import {
  applyHeldCustody,
  captureCustody,
  describeCustodyAge,
  holdCarriesCustody,
  type CustodyHold,
  type CustodySource,
} from "./custodyHold";
import { describeDeriveMode } from "./deriveMode";
import {
  NO_PAGE_FILTERS,
  activeFilterNames,
  axisAFilterActive,
  matchesPageFilters,
  pageChipCounts,
  pageFiltersActive,
  type PageFilters,
} from "./rowFilters";
import { useCursorPager } from "@/components/admin/coord/cursorPager";
import { DEFAULT_THROUGHPUT_DAYS } from "./throughput";
import { useArtifactDocument } from "./useArtifactDocument";
import { useDeriveMode } from "./useDeriveMode";
import { useThroughput } from "./useThroughput";

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

/**
 * The contract refusal is a 500 — and it is DETERMINISTIC.
 *
 * `httpClient` retries every 5xx on a GET, so without this the route's own
 * "I checked my facet block and it no longer means what it says" costs five
 * requests and ~7 s of backoff per poll tick, against a route computing a
 * three-way join over ~1,991 stems, every 30 s. The route will refuse
 * identically on each one: nothing about it is transient.
 *
 * `http-client.ts` documents `noRetryStatuses` for exactly this shape. The
 * generic-500 path loses nothing — `parseContractViolation` returns `null`
 * and the page degrades to the ordinary error state either way, one request
 * sooner.
 */
const RECONCILIATION_REQUEST_OPTIONS: { noRetryStatuses: number[] } = {
  noRetryStatuses: [500],
};

export default function CoordPlansListPage() {
  const [filters, setFilters] = useState<PageFilters>(NO_PAGE_FILTERS);
  /** The search in force — sent to the route, so it is part of the QUESTION. */
  const [q, setQ] = useState("");
  const [throughputDays, setThroughputDays] = useState(DEFAULT_THROUGHPUT_DAYS);
  const pager = useCursorPager();
  const { cursor, start, reset: resetPager } = pager;
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
   * The last live-custody reading, held across polls (`custodyHold.ts`). The
   * ref is what the read consults — putting the state in `fetchData`'s deps
   * would change the QUESTION every time custody was read. The state copy is
   * what renders the "custody as of" line.
   */
  const custodyHoldRef = useRef<CustodyHold | null>(null);
  const [custodyHold, setCustodyHold] = useState<CustodyHold | null>(null);
  /**
   * Where the custody on screen came from: this read (`fresh`), a held
   * earlier reading actually applied to a row (`held`), or nowhere (`none` —
   * no age line is shown, so a reading no row carries is never dated).
   */
  const [custodySource, setCustodySource] = useState<CustodySource>("none");
  /**
   * Has a custody read succeeded for the CURRENT question (window + search)?
   * Until one has, a poll asks for custody too — otherwise one failed
   * operator-caused read would leave custody dark until a manual refresh.
   */
  const custodyReadForQuestion = useRef(false);

  /**
   * Phase 4a — the capture census, on its own read state.
   *
   * It is NOT re-read when the window changes: cursor and limit are questions
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
   * The two generation counters and the in-flight lock now live in
   * `useGuardedPoll` — one spelling for every coord console list, after a
   * review found the guard implemented twice in this change and then dropped
   * on the three surfaces added beside it. The reasoning is in that hook's
   * docstring; what stays here is which state each arm may set, which is this
   * page's own business (the contract refusal is a third read state).
   */
  const fetchData = useCallback(
    async (guard: ReadGuard) => {
      try {
        const qs = new URLSearchParams();
        // Keyset paging: the previous page's `next_cursor`, verbatim. A cursor
        // is bound to `q`, so a new search always restarts at page one.
        if (cursor !== null) qs.set("cursor", cursor);
        qs.set("limit", String(limit));
        if (q !== "") qs.set("q", q);
        // Phase 6 — custody makes coord resolve live sessions for the whole
        // tenant, so it is asked for on reads an operator caused (a new window
        // or search, a refresh), and on a background poll ONLY until one
        // custody read has succeeded for this window/search. After that a poll
        // answer re-applies the held reading, and the page says how old it is.
        const withCustody =
          guard.trigger !== "poll" || !custodyReadForQuestion.current;
        if (withCustody) qs.set("include_custody", "true");
        const body = await httpClient.get<ReconciliationResponse>(
          `${ENDPOINT}?${qs.toString()}`,
          RECONCILIATION_REQUEST_OPTIONS
        );
        if (!guard.isNewest()) return;
        if (withCustody) {
          const hold = captureCustody(body, Date.now());
          custodyHoldRef.current = hold;
          custodyReadForQuestion.current = true;
          setCustodyHold(hold);
          // A custody read whose rows carry no custody (all unreadable, an
          // empty page, a backend that ignored include_custody) is not a
          // reading anything on screen shows — so no age line dates it.
          setCustodySource(holdCarriesCustody(hold) ? "fresh" : "none");
          setData(body);
        } else {
          const merged = applyHeldCustody(body, custodyHoldRef.current);
          // Only claim a held reading when one was actually applied to a row.
          setCustodySource(merged.applied ? "held" : "none");
          setData(merged.body);
        }
        setError(null);
        setViolations(null);
      } catch (e) {
        if (!guard.isCurrentQuestion()) return;
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
    },
    [cursor, limit, q]
  );

  // The WINDOW is the question. Changing it makes the rows in `data` answers
  // to a question nobody asked, and keeping them would leave every read-state
  // derivation reporting the old window while the new one is in flight.
  const resetWindow = useCallback(() => {
    setData(null);
    setError(null);
    setViolations(null);
    // A held custody reading answers the OLD window; never re-apply it, or
    // date it, against a new one.
    custodyReadForQuestion.current = false;
    custodyHoldRef.current = null;
    setCustodyHold(null);
    setCustodySource("none");
  }, []);

  const { refresh: refreshReconciliation } = useGuardedPoll({
    read: fetchData,
    intervalMs: POLL_INTERVAL_MS,
    onQuestionChange: resetWindow,
  });

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

  // The plan-browser reads (2026-09-19 plan): each is its own question, so
  // none rides the reconciliation's 30 s poll — see each hook's docstring.
  const { index: difficulty, refresh: refreshDifficulty } = usePlanDifficulty();
  const { state: deriveModeState, refresh: refreshDeriveMode } =
    useDeriveMode();
  const deriveMode = useMemo(
    () => describeDeriveMode(deriveModeState),
    [deriveModeState]
  );
  const {
    reading: throughput,
    refreshFailure: throughputRefreshFailure,
    refresh: refreshThroughput,
  } = useThroughput(throughputDays);
  const refreshAfterKindCorrection = useCallback(
    () => refreshReconciliation(),
    [refreshReconciliation]
  );
  const documentActions = useArtifactDocument(refreshAfterKindCorrection);

  // Every read, because the control says "refresh" and a stale census beside
  // a fresh reconciliation is the misreading this page exists to stop.
  const refresh = useCallback(
    () =>
      refreshReconciliation(() =>
        Promise.all([
          fetchCapture(),
          refreshDifficulty(),
          refreshDeriveMode(),
          refreshThroughput(),
        ])
      ),
    [
      refreshReconciliation,
      fetchCapture,
      refreshDifficulty,
      refreshDeriveMode,
      refreshThroughput,
    ]
  );

  // A new search is a new population: page 1 of it, not page N of the old.
  const onSearch = useCallback(
    (next: string) => {
      resetPager();
      setQ(next);
    },
    [resetPager]
  );

  const rows = useMemo(() => data?.items ?? [], [data]);
  const shown = useMemo(
    () => rows.filter((row) => matchesPageFilters(row, filters, difficulty)),
    [rows, filters, difficulty]
  );
  const statusFiltered = pageFiltersActive(filters, difficulty);
  const filterNames = useMemo(
    () => activeFilterNames(filters, difficulty),
    [filters, difficulty]
  );
  const chipCounts = useMemo(() => pageChipCounts(rows), [rows]);
  /**
   * Nothing on this page has a READABLE coord status.
   *
   * The filter narrows on axis A, and an unreadable axis A matches nothing but
   * `any`. When every row is unreadable — the degraded population arm — the
   * empty list is the absence of a measurement, not a measured zero, so the
   * empty slot says that instead of "none of them has status X".
   */
  const statusAxisAllUnreadable = useMemo(
    () =>
      axisAFilterActive(filters) &&
      rows.length > 0 &&
      rows.every((row) => !row.axis_a.readable),
    [rows, filters]
  );
  const window = useMemo(
    () => (data ? describeWindow(data, start) : null),
    [data, start]
  );
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

  // Computed every render, not memoised: every poll re-renders, so the age
  // wording (which switches to a dated form past six hours) is evaluated
  // against the current time rather than frozen at the first render.
  const custodyAge = describeCustodyAge(custodyHold, custodySource, Date.now());

  const canPageBack = pager.canPrev;
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

      {/* Design decision 4b — the trust signals about whether this list can
          be believed, collapsed to one line each, at the top. */}
      <CorpusHealthPanel
        pageForks={data ? pageForkCount(rows) : null}
        pageRowCount={data ? rows.length : null}
      />
      <ThroughputPanel
        reading={throughput}
        days={throughputDays}
        onDaysChange={setThroughputDays}
        refreshFailure={throughputRefreshFailure}
      />

      <div className="flex flex-wrap items-center gap-2">
        <PlanSearchBox applied={q} onSearch={onSearch} />
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select
          value={filters.status}
          onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}
        >
          <SelectTrigger
            className="w-[200px]"
            data-testid="coord-plans-status-select"
            title={
              "Filters the rows ON THIS PAGE by coord's stored status " +
              "(axis A) — " +
              PAGE_ONLY_NOTE +
              ". The reconciliation route takes no status parameter, so " +
              "this is a client-side filter over the current window — not " +
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
            resetPager();
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
          key={`${cursor ?? ""}:${limit}:${q}`}
          onRefresh={refresh}
          label="Refresh reconciliation"
          title={`Re-reads the reconciliation now; it also refreshes itself every ${POLL_INTERVAL_MS / 1000} s`}
          data-testid="coord-plans-refresh"
        />
        <Link
          href="/admin/coord/plan-library/artifacts"
          className="ml-auto text-xs text-muted-foreground underline hover:text-foreground"
          data-testid="coord-plans-all-kinds-link"
          title="This page lists plans only (kind = plan). Every captured artifact kind is listed on the artifact library page."
        >
          All artifact kinds
        </Link>
      </div>

      {data && <SearchEcho sent={q} echoed={data.q} />}

      <PlanPageFilters
        filters={filters}
        onChange={setFilters}
        counts={chipCounts}
        difficulty={difficulty}
        deriveMode={deriveMode}
      />

      {/* The population state, and every flag derived from it — in that order,
          and never collapsed behind a click.

          It renders ABOVE the window line, and the order is STRUCTURAL rather
          than a convention to be careful about: the window's denominator is
          one of the figures derived from the population, so a reader who has
          not yet met "coord's work-unit list could not be read" has no way to
          read `1887 plan stems` correctly. The general rule this page states
          in its docstring — render the population state before any flag
          derived from the population — is now enforced by the JSX order and
          not only by `deriveDisclosure`'s internal ordering. */}
      {disclosure && <ReconciliationDisclosure lines={disclosure.lines} />}

      {/* Phase 2 — the window as a MEASUREMENT: what was asked for, what came
          back, on which declared axis, and the boundary stems. A disclosure
          without a denominator is a disclaimer. */}
      {window && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-plans-window"
        >
          Showing {window.shown} of{" "}
          {window.totalAdmissible && window.total !== null ? (
            window.total
          ) : (
            /* R6, one widget up. `total` on the degraded arm is 1887 against
               a real corpus of 1991 — the health strip dashes it, and
               reprinting it here as a bare count of "plan stems" republishes
               exactly what the strip refused. */
            <span data-testid="coord-plans-window-total-unknown">
              {window.total === null
                ? "an unknown total — the route served no count"
                : `a total (${window.total}) that is not a corpus count on this read — coord's work-unit population was not read`}
            </span>
          )}{" "}
          plan stems
          {window.firstStem && window.lastStem && (
            <>
              , stems <span className="font-mono">{window.firstStem}</span>…
              <span className="font-mono">{window.lastStem}</span>
            </>
          )}
          {window.shown > 0 && (
            <>
              {" "}
              (rows {window.start + 1}–{window.start + window.shown})
            </>
          )}
          , page size {window.limit ?? "unstated"}, ordered{" "}
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

      {data && custodyAge && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-plans-custody-as-of"
          data-held={custodySource === "held" ? "true" : "false"}
        >
          Live {custodyAge}.
        </p>
      )}

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
          {filterNames.join(", ")} — {PAGE_ONLY_NOTE}: these narrow the{" "}
          {rows.length} rows on this page, showing {shown.length}. The route
          takes none of these parameters, so a matching plan on another page is
          not shown and is not absent.
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
              {/* Keyed by INDEX: these are route-supplied strings with no
                  uniqueness guarantee, and two identical violations would
                  collide on a value key. The list is static per render and
                  never reordered, so the index is the stable identity. */}
              {violations.map((v, i) => (
                <li key={i}>{v}</li>
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
          ) : statusFiltered && rows.length > 0 && statusAxisAllUnreadable ? (
            // `matchesStatus` returns false for an unreadable axis A — which
            // is right — but on the degraded population arm EVERY row is
            // unreadable, so "none of them has status X" is a negative
            // MEASUREMENT of something nothing measured. The filter's own
            // docstring names this exact situation; stating it as a finding
            // about the corpus is the collapse this page exists to refuse.
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-status-unreadable-empty"
            >
              coord&rsquo;s stored status is unreadable for every stem on this
              page, so whether any matches {filterNames.join(", ")} is unknown —
              not none.
            </p>
          ) : statusFiltered && rows.length > 0 ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-status-filtered-empty"
            >
              None of the {rows.length} stems on this page matches{" "}
              {filterNames.join(", ")}. The filters are page-scoped, so the
              corpus may hold plenty.
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
          ) : q !== "" && data?.q === q ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-plans-search-empty"
            >
              No plan stem matches &ldquo;{q}&rdquo; in this window.
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
            badges={<PlanRowBadges row={row} difficulty={difficulty} />}
            detailExtra={
              <>
                <PlanTriageDetail row={row} />
                <PlanShippedBy row={row} />
              </>
            }
            actions={<PlanDocumentPanel row={row} actions={documentActions} />}
          />
        )}
      />

      <div className="flex items-center gap-2" data-testid="coord-plans-paging">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPageBack}
          onClick={pager.prev}
          data-testid="coord-plans-page-prev"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canPageForward}
          onClick={() => {
            if (window?.nextCursor) pager.next(window.nextCursor, window.shown);
          }}
          data-testid="coord-plans-page-next"
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
