"use client";

/**
 * /admin/coord/findings — the reader for coord's findings store.
 *
 * Plan `2026-09-15-the-console-names-a-finding-it-cannot-open`, Phase 2.
 *
 * ## Why this page exists
 *
 * Every agent write to a governance prompt document carries a
 * `notification_ref`: the id of the coord finding where its author recorded
 * WHY. For an EDIT a notification exists, and
 * `/admin/coord/prompt-document-proposals` links to it. For a CREATE (v1)
 * coord deliberately emits no notification — a tenant's first boot would
 * otherwise announce values nobody changed — so that same feed could only
 * print an **inert uuid**: a reference the operator could read and not open.
 * There was no findings route in the console and no proxy onto the store. This
 * page is the other end of that link.
 *
 * ## Three things it must not get wrong
 *
 * 1. **Expiry is shown as a fact, never hidden, and a dossier head is not
 *    "expiring".** A `kind=dossier` row carries a hundred-year TTL, so a
 *    naive "expires in N days" is true of every durable row in the store. The
 *    classification is `_lib/findingStatus.ts`'s, keyed on the distance rather than
 *    on the kind — R8 keeps it out of this file.
 * 2. **`triaged=false` is narrower than the page total BY DESIGN** — coord
 *    excludes durable dossier heads and other tenants' fleet-infrastructure
 *    rows from it. Two numbers disagreeing with no sentence between them is
 *    the defect, so the filter carries its own caveat
 *    (`triageFilterCaveat`).
 * 3. **The deep link expands; it does not scroll.** `?id=<uuid>` runs its own
 *    BY-ID read alongside the filtered list, because coord serves a by-id row
 *    even past `expires_at` and regardless of the filters on screen — the link
 *    has to work from a cold page with a filter already on. Nothing in
 *    `admin/coord/` scrolls, and this page is not going to be the one that
 *    starts.
 *
 * The `?id=` param is read once on mount from `window.location`, not through
 * `useSearchParams` — the same call `/admin/coord/notifications?ref=` makes,
 * and for the same reason: a one-shot read is not worth putting this client
 * page behind a Suspense boundary.
 *
 * ## Console style
 *
 * `<HealthStrip>` opens (R1); rows are `<RecordRow>` inside a `<RecordList>`
 * so an in-flight first read renders skeletons rather than an empty list
 * asserting there is nothing (R2/R6); detail expands in place through
 * `<RecordDetail>`, one open at a time, with the fixed section order and raw
 * ids LAST (R5); and every derivation — retention, triage, the banner, the
 * health strip — lives in `_lib/findingStatus.ts` with a test beside it (R8).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Filter } from "lucide-react";
import {
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  StatusBadge,
  readIsUnknown,
} from "@/components/console";
import { httpClient } from "@/services/service-factory";
import {
  type CoordFindingRow,
  type FindingsResponse,
  type FindingsUnavailableKind,
  FINDING_STATUS_PALETTE,
  deriveFindingStatus,
  deriveFindingsHealth,
  dossierSlug,
  findingLinkNotice,
  isExpired,
  isFindingId,
  isFindingsUnavailableSevere,
  linkedRowFrom,
  triageFilterCaveat,
  triageOf,
  triageSentence,
} from "./_lib/findingStatus";

const API = "/api/v1/operations";
/** Page size asked of coord. Coord owns the clamp; this is a request. */
const PAGE_SIZE = 50;

/** `any` is this page's word for "do not send the key at all". */
type TriageFilter = "any" | "triaged" | "untriaged";

const TRIAGED_BY_FILTER: Record<TriageFilter, boolean | null> = {
  any: null,
  triaged: true,
  untriaged: false,
};

function buildQuery(params: {
  topic: string;
  kind: string;
  resourceKey: string;
  triaged: boolean | null;
}): string {
  const qs = new URLSearchParams();
  qs.set("limit", String(PAGE_SIZE));
  if (params.topic.trim()) qs.set("topic", params.topic.trim());
  if (params.kind.trim()) qs.set("kind", params.kind.trim());
  if (params.resourceKey.trim())
    qs.set("resource_keys", params.resourceKey.trim());
  if (params.triaged !== null) qs.set("triaged", String(params.triaged));
  return qs.toString();
}

/** The envelope, defensively: coord's shape, and nothing assumed present. */
function readBody(body: unknown): FindingsResponse {
  return body && typeof body === "object" ? (body as FindingsResponse) : {};
}

function rowsOf(body: FindingsResponse): CoordFindingRow[] {
  const raw = body.findings;
  return Array.isArray(raw)
    ? raw.filter((r): r is CoordFindingRow => Boolean(r && r.finding_id))
    : [];
}

export default function CoordFindingsPage() {
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState("");
  const [resourceKey, setResourceKey] = useState("");
  const [triageFilter, setTriageFilter] = useState<TriageFilter>("any");
  const triaged = TRIAGED_BY_FILTER[triageFilter];

  const [rows, setRows] = useState<CoordFindingRow[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [truncatedKeys, setTruncatedKeys] = useState(false);
  const [loading, setLoading] = useState(true);
  /**
   * True when the rows and count on screen came from a SUCCESSFUL read of the
   * current query — never merely "a read finished".
   *
   * `loading` settles in a `finally`, so it settles on failure too: right for
   * the skeleton, wrong for a count. Two flags, two questions — the split the
   * notifications page documents and every Wave-2 console surface carries.
   * Anything that discards those rows (a filter change, a degraded read) must
   * reset it too, or a later failure reads as "no findings match".
   */
  const [loaded, setLoaded] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [unavailableKind, setUnavailableKind] =
    useState<FindingsUnavailableKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  /**
   * `?id=<uuid>` — the deep link the landed-write feed uses to reach the
   * finding a CREATED document's author filed instead of a notice.
   */
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [linkedRow, setLinkedRow] = useState<CoordFindingRow | null>(null);
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [linkedFailed, setLinkedFailed] = useState(false);
  /** The BY-ID read itself degraded — separate from the list read's degrade. */
  const [linkedUnavailable, setLinkedUnavailable] = useState(false);
  const [linkedUnavailableKind, setLinkedUnavailableKind] =
    useState<FindingsUnavailableKind | null>(null);
  const [linkedAnswered, setLinkedAnswered] = useState(false);
  const linkedApplied = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setLinkedId(id);
  }, []);

  /**
   * Generation counter for "the query currently on screen". A reply still in
   * flight when the filters change must not prepend the OLD query's rows into
   * the new list, or write the old query's count into the strip.
   */
  const queryGenRef = useRef(0);
  /**
   * Per-REQUEST counter, beside the per-query one: a refresh re-issues the
   * SAME query, so two reads of one generation can be in flight together, and
   * only the newest may land (or clear `loading`).
   */
  const listReqRef = useRef(0);

  const fetchList = useCallback(async () => {
    const gen = queryGenRef.current;
    const req = ++listReqRef.current;
    const current = () =>
      queryGenRef.current === gen && listReqRef.current === req;
    setLoading(true);
    try {
      const body = readBody(
        await httpClient.get<unknown>(
          `${API}/coord/findings?${buildQuery({
            topic,
            kind,
            resourceKey,
            triaged,
          })}`
        )
      );
      if (!current()) return;
      // The proxy degrades a coord that did not answer rather than 502ing, so
      // the honest arm is a BANNER and a dashed count — not an empty list
      // asserting the store is empty.
      if (body.unavailable) {
        setUnavailable(body.unavailable);
        setUnavailableKind(body.unavailable_kind ?? null);
        setRows([]);
        setCount(null);
        // The rows an earlier success produced are gone, so nothing on screen
        // is a successful read any more — see `loaded`.
        setLoaded(false);
        setTruncatedKeys(false);
        setReadFailed(false);
        setError(null);
        return;
      }
      setUnavailable(null);
      setUnavailableKind(null);
      setRows(rowsOf(body));
      setCount(typeof body.count === "number" ? body.count : null);
      setTruncatedKeys(body.resource_keys_truncated === true);
      setLoaded(true);
      setReadFailed(false);
      setError(null);
    } catch (e) {
      if (!current()) return;
      // A throw is a DIFFERENT cause from an earlier degrade of this query;
      // leaving that degrade's text up would put two causes on screen, the
      // strip naming the stale one (it ranks `unavailable` above `failed`).
      // Safe only because a degrade also resets `loaded`: without that, this
      // clear would turn "unknown" into "no findings match".
      setUnavailable(null);
      setUnavailableKind(null);
      setError(`Failed to load: ${e instanceof Error ? e.message : String(e)}`);
      setReadFailed(true);
    } finally {
      if (current()) setLoading(false);
    }
  }, [topic, kind, resourceKey, triaged]);

  /** The linked row's id, readable from the filter effect without a dependency. */
  const linkedRowIdRef = useRef<string | null>(null);

  useEffect(() => {
    queryGenRef.current += 1;
    setRows([]);
    // Everything the list read derives belongs to the query that produced it.
    // A new filter must not show the OLD query's count, its "loaded" verdict
    // or its truncation notice under the new window's name: if the new read
    // then FAILS, the honest state is "could not read" (UNKNOWN), never "no
    // findings match" or "stopped updating" about rows that were just cleared.
    setCount(null);
    setLoaded(false);
    setReadFailed(false);
    setError(null);
    setUnavailable(null);
    setUnavailableKind(null);
    setTruncatedKeys(false);
    // Keep the LINKED row open across a filter change — the banner still says
    // it is expanded below, and it is still on screen (prepended).
    setExpanded((prev) =>
      prev !== null && prev === linkedRowIdRef.current ? prev : null
    );
    void fetchList();
  }, [fetchList]);

  const linkedInvalid = linkedId !== null && !isFindingId(linkedId);
  /** Generation counter for the by-id read, so a stale answer never lands. */
  const linkedGenRef = useRef(0);

  /**
   * The BY-ID read, run separately from the list.
   *
   * It has to be separate: coord serves a by-id row past `expires_at` and
   * outside whatever filter the page happens to carry, so folding this into
   * the list query would make the link work only when the filters already
   * happened to match — which is the same broken promise the inert uuid was.
   */
  const fetchLinked = useCallback(async () => {
    // A mangled id is never sent: coord would 400 it, and that refusal would
    // land in the read-FAILED arm, telling the operator to retry a link that
    // will fail forever. The banner has its own arm for it.
    if (!linkedId || !isFindingId(linkedId)) return;
    const gen = ++linkedGenRef.current;
    setLinkedLoading(true);
    setLinkedFailed(false);
    try {
      const body = readBody(
        await httpClient.get<unknown>(
          `${API}/coord/findings?finding_id=${encodeURIComponent(linkedId.trim())}`
        )
      );
      if (linkedGenRef.current !== gen) return;
      if (body.unavailable) {
        // The BY-ID read's own degrade, kept apart from the list read's, which
        // may not have settled yet — without it the banner would fall through
        // to "no such finding" about a store that did not answer.
        setLinkedUnavailable(true);
        setLinkedUnavailableKind(body.unavailable_kind ?? null);
        setLinkedRow(null);
      } else {
        setLinkedUnavailable(false);
        setLinkedUnavailableKind(null);
        // An empty page is coord ANSWERING — another tenant's id, a superseded
        // head, or no such finding. It is never a 404, so it must never read
        // as a failure. And only the row that IS the id counts: a door that
        // ignored `finding_id` would still answer with a well-formed page.
        setLinkedRow(linkedRowFrom(rowsOf(body), linkedId));
      }
      setLinkedAnswered(true);
    } catch {
      if (linkedGenRef.current !== gen) return;
      // A throw is a different cause from an earlier degrade of this read; the
      // notice ranks `unavailable` above `error`, so a stale degrade left set
      // here would name the wrong cause (the same fix the list read carries).
      setLinkedUnavailable(false);
      setLinkedUnavailableKind(null);
      setLinkedFailed(true);
      setLinkedAnswered(true);
    } finally {
      if (linkedGenRef.current === gen) setLinkedLoading(false);
    }
  }, [linkedId]);

  useEffect(() => {
    void fetchLinked();
  }, [fetchLinked]);

  /**
   * The refresh control re-issues BOTH reads — the banner's "Refresh to
   * retry" is about the by-id one.
   */
  const refreshAll = useCallback(
    () => Promise.all([fetchList(), fetchLinked()]),
    [fetchList, fetchLinked]
  );

  /**
   * The linked row FIRST, then the query's rows with it de-duplicated out.
   *
   * Prepending rather than filtering the list is what lets the deep link work
   * against a filter that excludes the row: the operator sees the finding he
   * clicked through for, and the list he chose, and the banner says which is
   * which.
   */
  const displayRows = useMemo(() => {
    if (!linkedRow) return rows;
    return [
      linkedRow,
      ...rows.filter((r) => r.finding_id !== linkedRow.finding_id),
    ];
  }, [rows, linkedRow]);

  // One-shot: expand the linked row when it first arrives. EXPAND, never
  // scroll — nothing under `admin/coord/` scrolls a row into view, and a page
  // that did would be the odd one out. Guarded so a later read cannot re-open
  // a row the operator has since collapsed.
  useEffect(() => {
    linkedRowIdRef.current = linkedRow?.finding_id ?? null;
    if (!linkedRow || linkedApplied.current) return;
    linkedApplied.current = true;
    setExpanded(linkedRow.finding_id);
  }, [linkedRow]);

  const health = deriveFindingsHealth({
    count,
    loaded,
    failed: readFailed,
    unavailable,
    triaged,
  });

  const caveat = triageFilterCaveat(triaged);
  // `not_deployed` is the one benign reading (this frontend shipped before
  // some coord instance's Phase 1 route); every other cause, including an
  // older backend that omits the kind, is shown as the louder case.
  const unavailableSevere = isFindingsUnavailableSevere(unavailableKind);
  // The list's degrade only speaks for the by-id read until that read has
  // answered for itself — an authoritative empty by-id page is "not found",
  // whatever the list read did. Its kind (and so its severity) follows
  // whichever degrade is speaking. A malformed id is never a degrade: no
  // by-id read is issued, so the list's degrade must not colour its sentence.
  const linkedDegraded =
    !linkedInvalid &&
    (linkedUnavailable || (!linkedAnswered && unavailable !== null));
  const linkedDegradeKind = linkedUnavailable
    ? linkedUnavailableKind
    : unavailableKind;
  const linkedDegradeSevere =
    linkedDegraded && isFindingsUnavailableSevere(linkedDegradeKind);
  // The linked row is prepended even when the filters exclude it, so the
  // banner owes a sentence for why it is on screen but not in the count. Only
  // claimed once the list has actually been read for the current query.
  const linkedNotInList =
    linkedRow !== null &&
    loaded &&
    !loading &&
    !readFailed &&
    unavailable === null &&
    !rows.some((r) => r.finding_id === linkedRow.finding_id);
  // Why the linked row is missing from the list decides what the banner may
  // claim. coord's LIST leaves out expired rows (the by-id read does not), so
  // an expired linked row is missing whatever the filters say. "Outside the
  // current filters" is licensed only when a filter IS set and the page is
  // SHORT — a full page (one page of PAGE_SIZE, no paging) proves nothing
  // about the rows past it. Everything else is "not in the list", no cause.
  const filtersActive =
    topic.trim() !== "" ||
    kind.trim() !== "" ||
    resourceKey.trim() !== "" ||
    triaged !== null;
  const listPageFull = rows.length >= PAGE_SIZE;
  const linkedExpiredNotListed =
    linkedNotInList && linkedRow !== null && isExpired(linkedRow);
  const linkedOutsideFilters =
    linkedNotInList &&
    !linkedExpiredNotListed &&
    filtersActive &&
    !listPageFull;
  const linkedBeyondLoadedPage =
    linkedNotInList && !linkedExpiredNotListed && !linkedOutsideFilters;
  const listUnknown = readIsUnknown(loaded, readFailed);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-findings-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-findings-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Input
          className="h-8 w-[170px] text-xs"
          placeholder="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          aria-label="Filter by topic"
          data-testid="coord-findings-topic"
        />
        <Input
          className="h-8 w-[170px] text-xs"
          placeholder="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Filter by kind"
          data-testid="coord-findings-kind"
        />
        <Input
          className="h-8 w-[200px] text-xs"
          placeholder="resource key"
          value={resourceKey}
          onChange={(e) => setResourceKey(e.target.value)}
          aria-label="Filter by resource key"
          data-testid="coord-findings-resource-key"
        />
        <Select
          value={triageFilter}
          onValueChange={(v) => setTriageFilter(v as TriageFilter)}
        >
          <SelectTrigger
            className="h-8 w-[170px] text-xs"
            data-testid="coord-findings-triaged"
          >
            <SelectValue placeholder="triage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Read or unread</SelectItem>
            <SelectItem value="triaged">Already read</SelectItem>
            <SelectItem value="untriaged">Not yet read</SelectItem>
          </SelectContent>
        </Select>
        <RefreshButton
          onRefresh={refreshAll}
          label="Refresh findings"
          title="Re-read the findings list and the linked finding"
          data-testid="coord-findings-refresh"
        />
      </div>

      {/* Two numbers must never disagree in silence — see `triageFilterCaveat`. */}
      {caveat && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-findings-triage-caveat"
        >
          {caveat}
        </p>
      )}

      {truncatedKeys && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-findings-keys-truncated"
        >
          coord applied only part of the resource-key filter, so this list may
          be wider than what you asked for.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {unavailable && (
        <p
          className={cn(
            "text-sm",
            unavailableSevere
              ? "text-amber-800 dark:text-amber-200"
              : "italic text-muted-foreground"
          )}
          data-testid="coord-findings-unavailable"
          data-severe={unavailableSevere}
        >
          {unavailable}
        </p>
      )}

      {linkedId && (
        <p
          className={cn(
            "text-sm",
            // A by-id degrade can be the ONLY degrade on screen (the list read
            // answered), so it carries the same severity styling as the list
            // banner rather than reading calm.
            linkedDegradeSevere
              ? "text-amber-800 dark:text-amber-200"
              : "text-muted-foreground"
          )}
          data-testid="coord-findings-linked"
          data-severe={linkedDegradeSevere}
        >
          {findingLinkNotice({
            invalid: linkedInvalid,
            found: linkedRow !== null,
            expired: linkedRow ? isExpired(linkedRow) : false,
            outsideFilters: linkedOutsideFilters,
            beyondLoadedPage: linkedBeyondLoadedPage,
            expiredNotListed: linkedExpiredNotListed,
            // `loading` sits above `error` and above the fallback and
            // short-circuits, which is exactly why the FIRST render cannot say
            // "no such finding": nothing has been read yet.
            loading: linkedLoading || !linkedAnswered,
            error: linkedFailed,
            unavailable: linkedDegraded,
            unavailableKind: linkedDegradeKind,
          })}
        </p>
      )}

      <RecordList
        items={displayRows}
        itemKey={(f) => f.finding_id}
        loaded={!(loading && displayRows.length === 0)}
        skeletonRows={6}
        expandedKey={expanded}
        onExpandedKeyChange={setExpanded}
        empty={
          unavailable !== null ? (
            // The banner above already says the findings store could not be
            // read; "no findings match" under it would contradict it.
            <p
              className="text-sm italic text-muted-foreground"
              data-testid="coord-findings-unknown"
            >
              The findings store could not be read, so whether anything matches
              is unknown — not none.
            </p>
          ) : listUnknown ? (
            <p
              className="text-sm italic text-muted-foreground"
              data-testid="coord-findings-unknown"
            >
              Could not read the findings store — whether anything matches is
              unknown, not none.
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              No findings match these filters.
            </p>
          )
        }
        renderRow={(f, ctx) => <FindingRow finding={f} ctx={ctx} />}
      />
    </div>
  );
}

function FindingRow({
  finding,
  ctx,
}: {
  finding: CoordFindingRow;
  ctx: { expanded: boolean; onToggle: () => void };
}) {
  const status = deriveFindingStatus(finding);
  const slug = dossierSlug(finding);
  const title = (finding.title ?? "").trim() || "(untitled finding)";
  const body = (finding.body ?? "").trim();
  const keys = finding.resource_keys ?? [];

  return (
    <RecordRow
      identity={
        // The TOPIC, not the kind and not the id: it is the one field that
        // orients a reader without being internal vocabulary. R8's other half
        // rides here too — the finding's own `kind` enum and its triage state
        // go in `data-*` attributes, in the channel a spec selector or a
        // `/visual-audit` assertion can address, while the screen gets words.
        // Absent rather than `"unknown"` when coord served no kind: "no kind"
        // and "a kind we do not recognise" are different claims.
        <span
          className="max-w-[12rem] truncate"
          title={finding.topic ?? ""}
          data-finding-kind={finding.kind ?? undefined}
          data-finding-triage={triageOf(finding)}
        >
          {(finding.topic ?? "").trim() || "—"}
        </span>
      }
      label={<span title={title}>{title}</span>}
      status={<StatusBadge status={status} palette={FINDING_STATUS_PALETTE} />}
      reason={status.reason}
      time={<RowTime at={finding.created_at} verb="Recorded" />}
      attention={status.attention}
      expanded={ctx.expanded}
      onToggle={ctx.onToggle}
      data-testid="coord-finding-row"
    >
      <RecordDetail
        data-testid={`coord-finding-detail-${finding.finding_id}`}
        why={
          body ? (
            <p className="whitespace-pre-wrap">{body}</p>
          ) : (
            <p className="italic text-muted-foreground">
              This finding carries no body — only its title and where it was
              filed.
            </p>
          )
        }
        problems={
          <p
            className="text-xs text-muted-foreground"
            data-testid={`coord-finding-retention-${finding.finding_id}`}
          >
            {status.reason}
          </p>
        }
        actions={
          slug !== null ? (
            <p
              className="text-xs"
              data-testid={`coord-finding-dossier-${finding.finding_id}`}
            >
              {triageSentence(finding)}
            </p>
          ) : null
        }
        history={
          <p
            className="text-xs text-muted-foreground"
            data-testid={`coord-finding-triage-${finding.finding_id}`}
          >
            {slug !== null ? null : triageSentence(finding)}
            {finding.author_session ? (
              <> Recorded by {finding.author_session}.</>
            ) : null}
          </p>
        }
        raw={
          // R8's last row: every raw id lives here and nowhere else. The
          // finding id is `select-all` because it is the operator's handle on
          // the record — the same reason the landed-write feed made it
          // copyable before this page existed to open it.
          <p className="font-mono text-[10px] text-muted-foreground/60">
            <span
              className="select-all"
              data-testid={`coord-finding-id-${finding.finding_id}`}
            >
              {finding.finding_id}
            </span>
            {finding.kind ? <> · kind {finding.kind}</> : null}
            {finding.scope ? <> · scope {finding.scope}</> : null}
            {finding.expires_at ? (
              <> · expires_at {finding.expires_at}</>
            ) : null}
            {finding.supersedes ? (
              <> · supersedes {finding.supersedes}</>
            ) : null}
            {keys.length > 0 ? <> · {keys.join(" ")}</> : null}
          </p>
        }
      />
    </RecordRow>
  );
}
