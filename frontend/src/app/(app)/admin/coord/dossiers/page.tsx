"use client";

/**
 * /admin/coord/dossiers — every dossier, filterable, sortable and paged.
 *
 * Plan `2026-10-03-dossier-query-door-filters-sort-cursor`, Phase 5. Reads
 * coord's dossier door (`GET /coord/dossiers`, qontinui-coord#3421) through
 * the `/operations/coord/dossiers` proxy.
 *
 * ## Why this page exists
 *
 * Before the door, the only list of dossiers was the findings feed filtered to
 * `kind=dossier`: one 100-row window, newest first, that read as the whole
 * corpus when it held under 40% of it, with readiness and recurrence buried in
 * `artifact_refs` and no way to sort by either. The question an operator asks
 * here is "which recurring defects have nobody working on them yet?", and the
 * "No plan yet" preset is that question as one click: `readiness=ready_for_pvi`
 * plus `remediation_state=none`, most recurrences first.
 *
 * ## Three things it must not get wrong
 *
 * 1. **The badge is the LIVE plan state** (`remediation_state`, coord's join
 *    against work units), never the ledger's lagging text. The detail shows
 *    both, so a disagreement is visible. Derivations: `_lib/dossierStatus.ts`.
 * 2. **UNKNOWN is never none.** A `null` readiness or recurrence renders as
 *    "unknown"; a remediation coord could not resolve is amber, never folded
 *    into "no plan yet"; a facet coord did not serve is a dash, not a zero.
 * 3. **One page is not the corpus.** coord's answer is a keyset page; "Load
 *    more" follows `next_cursor`, and the count badge is the ONE bound
 *    derivation the findings page uses (`deriveFindingsBound`). The walk is the
 *    findings page's `loadOlder`: generation-guarded, deduped by id, ended by a
 *    page that adds nothing, reset by any filter or sort change or a Refresh.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Filter } from "lucide-react";
import {
  BackendErrorMessage,
  FilterChips,
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  StatusBadge,
  readIsUnknown,
} from "@/components/console";
import { operationsErrorReading } from "@/lib/api/operations/base";
import type { BackendErrorReading } from "@/lib/errors/backend-error-message";
import {
  fetchCoordDossiers,
  type DossierSort,
  type DossiersQuery,
} from "@/lib/api/operations/coordDossiers";
import {
  deriveFindingsBound,
  findingHref,
} from "../findings/_lib/findingStatus";
import {
  type CoordDossierRow,
  type DossiersResponse,
  type ServedRemediationState,
  DOSSIER_STATUS_PALETTE,
  REMEDIATION_FILTER_LABEL,
  REMEDIATION_STATES,
  deriveDossierStatus,
  deriveDossiersHealth,
  readinessLabel,
  readinessOptions,
  recurrenceLabel,
  remediationFacetCount,
  remediationHref,
} from "./_lib/dossierStatus";

/** Page size asked of coord. Coord owns the clamp (1..=100); this is a request. */
const PAGE_SIZE = 50;

/** The sortable keys, in the order the sort bar shows them. */
const SORTS: { value: DossierSort; label: string }[] = [
  { value: "recurrence_count", label: "Recurrences" },
  { value: "last_seen", label: "Last seen" },
  { value: "updated", label: "Updated" },
  { value: "first_seen", label: "First seen" },
  { value: "slug", label: "Slug" },
];

type OpenFilter = "any" | "open" | "none";

const OPEN_BY_FILTER: Record<OpenFilter, boolean | null> = {
  any: null,
  open: true,
  none: false,
};

/** How long a typed filter must settle before it re-queries. */
const DEBOUNCE_MS = 300;

/** `value`, once it has held still for `ms`. The first value is immediate. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** A non-negative integer from an input, or `null` for blank or junk. */
function intOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!/^[0-9]{1,9}$/.test(t)) return null;
  return Number(t);
}

function readBody(body: unknown): DossiersResponse {
  return body && typeof body === "object" ? (body as DossiersResponse) : {};
}

/** Both keys required — see the findings page's `cursorOf`. */
function cursorOf(body: DossiersResponse): string | null {
  return body.truncated === true &&
    typeof body.next_cursor === "string" &&
    body.next_cursor !== ""
    ? body.next_cursor
    : null;
}

function rowsOf(body: DossiersResponse): CoordDossierRow[] {
  const raw = body.dossiers;
  return Array.isArray(raw)
    ? raw.filter((r): r is CoordDossierRow => Boolean(r && r.finding_id))
    : [];
}

/** A cursor, bound to the head read that started its walk. */
interface WalkCursor {
  cursor: string;
  gen: number;
  req: number;
}

interface LastPage {
  boundKind: string | null | undefined;
  truncated: boolean | null | undefined;
  limit: number | null | undefined;
  lastPageRows: number;
  total: number | null | undefined;
}

function lastPageOf(body: DossiersResponse, pageRows: number): LastPage {
  return {
    boundKind: body.bound_kind,
    truncated: body.truncated,
    limit: body.limit,
    lastPageRows: pageRows,
    total: body.total,
  };
}

function toggle<V>(list: readonly V[], value: V): V[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export default function CoordDossiersPage() {
  const [readiness, setReadiness] = useState<string[]>([]);
  const [remediation, setRemediation] = useState<ServedRemediationState[]>([]);
  const [q, setQ] = useState("");
  const [recurrenceMin, setRecurrenceMin] = useState("");
  const [recurrenceMax, setRecurrenceMax] = useState("");
  const [lastSeenSince, setLastSeenSince] = useState("");
  const [lastSeenUntil, setLastSeenUntil] = useState("");
  const [openFilter, setOpenFilter] = useState<OpenFilter>("any");
  const [sort, setSort] = useState<DossierSort>("last_seen");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  const [rows, setRows] = useState<CoordDossierRow[]>([]);
  const [facets, setFacets] = useState<DossiersResponse["facets"]>(null);
  const [lastPage, setLastPage] = useState<LastPage | null>(null);
  const [nextCursor, setNextCursor] = useState<WalkCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [walkStalled, setWalkStalled] = useState(false);
  const [pagingError, setPagingError] = useState<BackendErrorReading | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  /** True only when the rows on screen came from a SUCCESSFUL read. */
  const [loaded, setLoaded] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<BackendErrorReading | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Typed filters settle for DEBOUNCE_MS before they re-query, so a word typed
  // into the search box is one read, not one per keystroke (each read resets
  // the walk and blanks the list).
  const debouncedText = useDebounced(
    [q, recurrenceMin, recurrenceMax, lastSeenSince, lastSeenUntil].join(
      "\u0000"
    ),
    DEBOUNCE_MS
  );
  const [dq, dRecMin, dRecMax, dSince, dUntil] = debouncedText.split("\u0000");
  const recMin = intOrNull(dRecMin ?? "");
  const recMax = intOrNull(dRecMax ?? "");
  // A recurrence bound that is not a whole number is NOT sent — say so on the
  // field rather than show a list that looks filtered and is not.
  const recMinInvalid =
    recurrenceMin.trim() !== "" && intOrNull(recurrenceMin) === null;
  const recMaxInvalid =
    recurrenceMax.trim() !== "" && intOrNull(recurrenceMax) === null;
  const hasOpen = OPEN_BY_FILTER[openFilter];
  const qTrim = (dq ?? "").trim();
  const sinceTrim = (dSince ?? "").trim();
  const untilTrim = (dUntil ?? "").trim();
  const readinessKey = readiness.join(",");
  const remediationKey = remediation.join(",");

  const buildQuery = useCallback(
    (cursor?: string | null): DossiersQuery => ({
      limit: PAGE_SIZE,
      readiness: readinessKey === "" ? [] : readinessKey.split(","),
      remediationState: remediationKey === "" ? [] : remediationKey.split(","),
      q: qTrim || undefined,
      recurrenceMin: recMin,
      recurrenceMax: recMax,
      lastSeenSince: sinceTrim || undefined,
      lastSeenUntil: untilTrim || undefined,
      hasOpenRemediation: hasOpen,
      sort,
      order,
      cursor,
    }),
    [
      readinessKey,
      remediationKey,
      qTrim,
      recMin,
      recMax,
      sinceTrim,
      untilTrim,
      hasOpen,
      sort,
      order,
    ]
  );

  const queryGenRef = useRef(0);
  const listReqRef = useRef(0);

  const fetchList = useCallback(async () => {
    const gen = queryGenRef.current;
    const req = ++listReqRef.current;
    const current = () =>
      queryGenRef.current === gen && listReqRef.current === req;
    setLoading(true);
    setLoadingMore(false);
    setNextCursor(null);
    setWalkStalled(false);
    try {
      const body = readBody(await fetchCoordDossiers(buildQuery()));
      if (!current()) return;
      if (body.unavailable) {
        setUnavailable(body.unavailable);
        setRows([]);
        setFacets(null);
        setLastPage(null);
        setPagingError(null);
        setLoaded(false);
        setReadFailed(false);
        setError(null);
        return;
      }
      setUnavailable(null);
      const head = rowsOf(body);
      setRows(head);
      setFacets(body.facets ?? null);
      setLastPage(lastPageOf(body, head.length));
      const minted = cursorOf(body);
      setNextCursor(minted === null ? null : { cursor: minted, gen, req });
      setPagingError(null);
      setLoaded(true);
      setReadFailed(false);
      setError(null);
    } catch (e) {
      if (!current()) return;
      setUnavailable(null);
      setError(operationsErrorReading(e));
      setReadFailed(true);
    } finally {
      if (current()) setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    queryGenRef.current += 1;
    // A cursor is only meaningful for the query that minted it, so any filter
    // or sort change resets the walk, and nothing the old query derived may
    // speak for the new one if its read then fails.
    setRows([]);
    setFacets(null);
    setLastPage(null);
    setNextCursor(null);
    setLoadingMore(false);
    setWalkStalled(false);
    setPagingError(null);
    setLoaded(false);
    setReadFailed(false);
    setError(null);
    setUnavailable(null);
    setExpanded(null);
    void fetchList();
  }, [fetchList]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const { cursor, gen, req } = nextCursor;
    const current = () =>
      queryGenRef.current === gen && listReqRef.current === req;
    if (!current()) return;
    setLoadingMore(true);
    setPagingError(null);
    try {
      const body = readBody(await fetchCoordDossiers(buildQuery(cursor)));
      if (!current()) return;
      if (body.unavailable) {
        setPagingError({ kind: "unstructured", sentence: body.unavailable });
        return;
      }
      const page = rowsOf(body);
      const seen = new Set(rows.map((r) => r.finding_id));
      const fresh = page.filter((r) => !seen.has(r.finding_id));
      setRows((prev) => {
        const have = new Set(prev.map((r) => r.finding_id));
        return [...prev, ...fresh.filter((r) => !have.has(r.finding_id))];
      });
      setLastPage(lastPageOf(body, page.length));
      const minted = cursorOf(body);
      setNextCursor(
        fresh.length === 0 || minted === null
          ? null
          : { cursor: minted, gen, req }
      );
      setWalkStalled(fresh.length === 0);
    } catch (e) {
      if (!current()) return;
      setPagingError(operationsErrorReading(e));
    } finally {
      if (current()) setLoadingMore(false);
    }
  }, [buildQuery, nextCursor, rows]);

  const applyNoPlanPreset = useCallback(() => {
    setReadiness(["ready_for_pvi"]);
    setRemediation(["none"]);
    setSort("recurrence_count");
    setOrder("desc");
  }, []);

  const onSort = useCallback(
    (value: DossierSort) => {
      if (value === sort) {
        setOrder((o) => (o === "desc" ? "asc" : "desc"));
      } else {
        setSort(value);
        setOrder(value === "slug" ? "asc" : "desc");
      }
    },
    [sort]
  );

  const bound =
    loaded && lastPage !== null
      ? deriveFindingsBound({ ...lastPage, rowsLoaded: rows.length })
      : null;
  const health = deriveDossiersHealth({
    bound,
    loaded,
    failed: readFailed,
    unavailable,
  });
  const listUnknown = readIsUnknown(loaded, readFailed);
  const readinessFacet = loaded ? (facets?.readiness ?? null) : null;
  const remediationFacet = loaded ? (facets?.remediation_state ?? null) : null;
  const presetActive =
    readiness.length === 1 &&
    readiness[0] === "ready_for_pvi" &&
    remediation.length === 1 &&
    remediation[0] === "none";

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-dossiers-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-dossiers-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={presetActive ? "default" : "outline"}
          size="sm"
          onClick={applyNoPlanPreset}
          title="Ready for /pvi, with no remediation plan yet, most recurrences first"
          data-testid="coord-dossiers-preset-no-plan"
        >
          No plan yet
        </Button>
        <RefreshButton
          onRefresh={fetchList}
          label="Refresh dossiers"
          title="Re-read the dossier list from the first page"
          data-testid="coord-dossiers-refresh"
        />
      </div>

      <FilterChips
        label="readiness:"
        options={readinessOptions(readinessFacet, readiness).map((o) => ({
          value: o.value,
          label: o.value === "none" ? "unknown" : readinessLabel(o.value),
          count: o.count,
        }))}
        selected={readiness}
        onToggle={(v) => setReadiness((prev) => toggle(prev, v))}
        onClear={() => setReadiness([])}
        maxVisible={8}
        testIdPrefix="coord-dossiers-readiness"
        title={
          readinessFacet === null
            ? "coord has not served the readiness vocabulary for this query yet"
            : "Counts are over every dossier matching the other filters"
        }
      />

      <FilterChips
        label="plan:"
        options={REMEDIATION_STATES.map((s) => ({
          value: s,
          label: REMEDIATION_FILTER_LABEL[s],
          count: remediationFacetCount(remediationFacet, s),
        }))}
        selected={remediation}
        onToggle={(v) => setRemediation((prev) => toggle(prev, v))}
        onClear={() => setRemediation([])}
        testIdPrefix="coord-dossiers-remediation"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Input
          className="h-8 w-[200px] text-xs"
          placeholder="slug or title contains"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter by slug or title"
          data-testid="coord-dossiers-q"
        />
        <Input
          placeholder="min recurrences"
          inputMode="numeric"
          value={recurrenceMin}
          onChange={(e) => setRecurrenceMin(e.target.value)}
          aria-label="Minimum recurrences"
          aria-invalid={recMinInvalid}
          title={
            recMinInvalid
              ? "Not a whole number, so this bound is not applied"
              : undefined
          }
          className={cn(
            "h-8 w-[110px] text-xs",
            recMinInvalid && "border-destructive"
          )}
          data-testid="coord-dossiers-recurrence-min"
        />
        <Input
          placeholder="max recurrences"
          inputMode="numeric"
          value={recurrenceMax}
          onChange={(e) => setRecurrenceMax(e.target.value)}
          aria-label="Maximum recurrences"
          aria-invalid={recMaxInvalid}
          title={
            recMaxInvalid
              ? "Not a whole number, so this bound is not applied"
              : undefined
          }
          className={cn(
            "h-8 w-[110px] text-xs",
            recMaxInvalid && "border-destructive"
          )}
          data-testid="coord-dossiers-recurrence-max"
        />
        <Input
          type="date"
          className="h-8 w-[150px] text-xs"
          value={lastSeenSince}
          onChange={(e) => setLastSeenSince(e.target.value)}
          aria-label="Last seen on or after"
          title="Last seen on or after"
          data-testid="coord-dossiers-last-seen-since"
        />
        <Input
          type="date"
          className="h-8 w-[150px] text-xs"
          value={lastSeenUntil}
          onChange={(e) => setLastSeenUntil(e.target.value)}
          aria-label="Last seen on or before"
          title="Last seen on or before"
          data-testid="coord-dossiers-last-seen-until"
        />
        <Select
          value={openFilter}
          onValueChange={(v) => setOpenFilter(v as OpenFilter)}
        >
          <SelectTrigger
            className="h-8 w-[200px] text-xs"
            data-testid="coord-dossiers-open"
          >
            <SelectValue placeholder="open remediation" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any remediation (ledger)</SelectItem>
            <SelectItem value="open">Ledger: open remediation</SelectItem>
            <SelectItem value="none">Ledger: none open</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        className="flex flex-wrap items-center gap-1 text-xs"
        data-testid="coord-dossiers-sort"
      >
        <span className="text-muted-foreground mr-1">Sort by:</span>
        {SORTS.map((s) => {
          const active = s.value === sort;
          return (
            <Button
              key={s.value}
              variant={active ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onSort(s.value)}
              aria-pressed={active}
              data-testid={`coord-dossiers-sort-${s.value}`}
              data-order={active ? order : undefined}
            >
              {s.label}
              {active &&
                (order === "desc" ? (
                  <ArrowDown className="ml-1 h-3 w-3" />
                ) : (
                  <ArrowUp className="ml-1 h-3 w-3" />
                ))}
            </Button>
          );
        })}
        <span className="text-muted-foreground ml-2">
          Dossiers with no value for the sort key are listed last.
        </span>
      </div>

      {error && (
        <p
          className="text-sm text-destructive"
          data-testid="coord-dossiers-error"
        >
          Failed to load: <BackendErrorMessage error={error} />
        </p>
      )}

      {unavailable && (
        <p
          className={cn("text-sm text-amber-800 dark:text-amber-200")}
          data-testid="coord-dossiers-unavailable"
        >
          {unavailable}
        </p>
      )}

      <RecordList
        items={rows}
        itemKey={(d) => d.finding_id}
        loaded={!(loading && rows.length === 0)}
        skeletonRows={6}
        expandedKey={expanded}
        onExpandedKeyChange={setExpanded}
        empty={
          unavailable !== null || listUnknown ? (
            <p
              className="text-sm italic text-muted-foreground"
              data-testid="coord-dossiers-unknown"
            >
              The dossiers could not be read, so whether any match is unknown —
              not none.
            </p>
          ) : (
            <p
              className="text-sm italic text-muted-foreground"
              data-testid="coord-dossiers-empty"
            >
              No dossiers match these filters.
            </p>
          )
        }
        renderRow={(d, ctx) => <DossierRow dossier={d} ctx={ctx} />}
      />

      {nextCursor !== null && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadMore()}
            disabled={loadingMore || loading}
            data-testid="coord-dossiers-load-more"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Paging is not a snapshot: a dossier folded while you page can move.
            Refresh restarts from the first page.
          </span>
        </div>
      )}

      {walkStalled && bound?.kind === "at_least" && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-dossiers-walk-stalled"
        >
          coord offered more, but the next page added nothing new — Refresh to
          restart from the first page.
        </p>
      )}

      {pagingError !== null && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="coord-dossiers-paging-error"
        >
          <div className="text-sm text-destructive">
            <p>
              Could not load more dossiers:{" "}
              <BackendErrorMessage error={pagingError} />
            </p>
            <p>The dossiers above are still what coord returned.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchList()}
            data-testid="coord-dossiers-restart"
          >
            Restart from the first page
          </Button>
        </div>
      )}
    </div>
  );
}

function DossierRow({
  dossier,
  ctx,
}: {
  dossier: CoordDossierRow;
  ctx: { expanded: boolean; onToggle: () => void };
}) {
  const status = deriveDossierStatus(dossier);
  const slug = (dossier.slug ?? "").trim();
  const title = (dossier.title ?? "").trim() || "(untitled dossier)";
  const remediations = Array.isArray(dossier.remediations)
    ? dossier.remediations
    : [];
  const id = dossier.finding_id;

  return (
    <RecordRow
      identity={
        <span
          className="max-w-[16rem] truncate"
          title={slug || "no slug"}
          data-readiness={dossier.readiness ?? undefined}
          data-remediation-state={dossier.remediation_state ?? undefined}
        >
          {slug || "—"}
        </span>
      }
      label={
        <span title={title}>
          {title}{" "}
          <span
            className="text-xs text-muted-foreground"
            data-testid={`coord-dossier-recurrence-${id}`}
          >
            · {recurrenceLabel(dossier.recurrence_count)} ·{" "}
            {readinessLabel(dossier.readiness)}
          </span>
        </span>
      }
      status={<StatusBadge status={status} palette={DOSSIER_STATUS_PALETTE} />}
      reason={status.reason}
      time={<RowTime at={dossier.updated_at ?? null} verb="Folded" />}
      attention={status.attention}
      expanded={ctx.expanded}
      onToggle={ctx.onToggle}
      data-testid="coord-dossier-row"
    >
      <RecordDetail
        data-testid={`coord-dossier-detail-${id}`}
        why={
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Readiness</dt>
            <dd>{readinessLabel(dossier.readiness)}</dd>
            <dt className="text-muted-foreground">Recurrences</dt>
            <dd>{recurrenceLabel(dossier.recurrence_count)}</dd>
            <dt className="text-muted-foreground">First seen</dt>
            <dd>{dossier.first_seen ?? "unknown"}</dd>
            <dt className="text-muted-foreground">Last seen</dt>
            <dd>{dossier.last_seen ?? "unknown"}</dd>
          </dl>
        }
        problems={
          remediations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              The ledger names no remediation plan.
            </p>
          ) : (
            <ul
              className="space-y-1 text-xs"
              data-testid={`coord-dossier-remediations-${id}`}
            >
              {remediations.map((r, i) => {
                const href = remediationHref(r);
                const plan = (r.plan ?? "").trim() || "(unnamed plan)";
                return (
                  <li key={`${plan}-${i}`}>
                    {href ? (
                      <Link className="underline" href={href}>
                        {plan}
                      </Link>
                    ) : (
                      <span>{plan}</span>
                    )}
                    {" — live: "}
                    <span data-testid={`coord-dossier-live-${id}-${i}`}>
                      {r.live_status ?? "no work unit found (unknown)"}
                    </span>
                    {r.ledger_status ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · ledger says: {r.ledger_status}
                      </span>
                    ) : null}
                    {r.held === true ? (
                      <span className="text-muted-foreground"> · held</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        }
        actions={
          <p className="text-xs">
            <Link
              className="underline"
              href={findingHref(id)}
              data-testid={`coord-dossier-open-${id}`}
            >
              Open the dossier head
            </Link>
            {slug ? (
              <span className="text-muted-foreground">
                {" "}
                · implement with <code>/pvi dossier:{slug}</code>
              </span>
            ) : null}
          </p>
        }
        raw={
          <p className="font-mono text-[10px] text-muted-foreground/60">
            <span className="select-all">{id}</span>
            {dossier.scope ? <> · scope {dossier.scope}</> : null}
            {dossier.remediation_state ? (
              <> · remediation_state {dossier.remediation_state}</>
            ) : null}
          </p>
        }
      />
    </RecordRow>
  );
}
