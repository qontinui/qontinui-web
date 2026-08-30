"use client";

/**
 * Prompt-injection audit-log dashboard.
 *
 * Phase 4 of the "Unified Coord Prompt-Injection Audit Log" plan.
 *
 * A read-only table of every coord-originated prompt injection with the
 * session name per row. Click a row to expand a detail panel that lazily
 * fetches the full event and shows TWO labeled blocks: the output that
 * triggered the injection (`trigger_text`) and the exact prompt that was
 * injected (`injected_prompt`).
 *
 * Mirrors `AgentSessionsDashboard`'s expandable-rows structure: each row is
 * a <Fragment> with a clickable <TableRow> chevron toggle plus a second
 * colSpan <TableRow> for the detail panel.
 *
 * Filter bar: source dropdown (All + the 6 values) + session-name search +
 * a live-poll toggle. Full list refreshes every 10s when polling is on.
 *
 * ## Console style (Phase 3 Wave 5)
 *
 * `/admin/coord/prompt-injections` landed after the console plan was authored
 * and was missing from its census (§4 correction). It takes **R9 only**: the
 * table already does what D2 asks of Family C — a clickable row plus a
 * full-width `colSpan` detail row — so R5 was satisfied before this plan
 * touched it, and a read-only audit log of events that already happened has no
 * severity to encode (R3's palette answers "who must act", and the answer here
 * is nobody on every row).
 *
 * What R9 removed: the two `<Card><CardHeader><CardTitle>` wrappers. One
 * restated "Prompt Injections" — the page heading, one line above it — and the
 * other put a ~72px card header on the word "Filters". Between them they cost
 * ~144px above the table on the page whose entire purpose is the table.
 *
 * ## R6's failed-read arms (post-merge follow-up to #1036)
 *
 * Wave 5 classed this route **R9 only** and that classification stands for the
 * layout — but R9-only was read as "nothing else applies", and R6 did. This
 * surface shipped all three of the arms R6 enumerates, on a page whose sibling
 * in the SAME PR (`/plan-library`) already produced the right OUTPUT for the
 * two it can have — it renders no count badge at all, so arm 2 does not arise
 * there, and it reaches its unknown/stale/empty split by hand-spelling
 * `items.length === 0 && !error` rather than importing the shared predicate,
 * which is the form R6 explicitly forbids. Right answers, wrong derivation:
 * copy its wording, not its spelling.
 *
 *  1. **A failed FIRST read said the corpus was empty.** `error` set, `rows`
 *     still at its `useState([])`, `loading` already false — so the page
 *     rendered *"No prompt injections matching the current filters"* directly
 *     under its own *"Failed to load"* line. That is a claim about coord's
 *     corpus made from a read that answered nothing, in the same viewport as
 *     the admission that nothing was read.
 *  2. **The count badge rendered `0`.** R6: a count that has not been fetched
 *     renders `–`, never `0`. This is `deriveNotificationsHealth`'s `?? 0`
 *     (fixed in #1136) wearing a different spelling.
 *  3. **A failed REFETCH presented stale rows as current.** The `catch` keeps
 *     the last good rows, which is right — but nothing said they were old, so
 *     a poll failing at 03:00 left 03:00's list looking live indefinitely.
 *
 * Fixed with the shipped predicate — `console/readFailure.ts`'s
 * `readIsUnknown`, keyed on whether coord has answered rather than on the list
 * being empty (which cannot tell a confirmed-empty window from one that never
 * arrived). `staleDetail` is NOT used: it is the health-strip detail line and
 * says "these counts are stale", and what goes stale here is a list of rows.
 *
 * **What "has coord answered" means here is the filter-keyed `answer`, not a
 * boolean.** A global `loaded` flag is the shape this file shipped first and
 * it re-opened arm 1 on every filter change: `unknown` stayed false across the
 * change, so a read failing under the NEW filters took the stale arm and
 * rendered the PREVIOUS filters' rows beneath filter chrome that said
 * otherwise. See the `answer` declaration for why the keyed form makes that
 * unrepresentable instead of merely unlikely.
 *
 * **`isNotFoundError` is deliberately NOT used here, and that is not an
 * oversight.** That predicate recovers a status by parsing the message
 * `httpClient.get` formats. This surface does not use `httpClient.get`: it
 * goes through `prompt-injections-api.ts`, which wraps `httpClient.fetch` and
 * raises a `PromptInjectionsApiError` carrying `status` as a real field. The
 * structured status is strictly better evidence than a parsed string, so the
 * detail panel branches on `err.status === 404`. Using the primitive here
 * would silently never match — a 404 split that always takes the outage arm.
 *
 * ## Two wire fields that read as totals and are not
 *
 * **`count` in the list envelope is `events.len()`, not a corpus total**
 * (coord `prompt_injections.rs:415` — `let count = events.len()` over rows
 * already `LIMIT`ed). It is the length of what you were handed, so rendering
 * it instead of `rows.length` would change nothing and would MISLEAD the next
 * reader into thinking the badge shows a total. Left unread on purpose.
 *
 * Because no total exists on the wire, truncation is derived the only way it
 * honestly can be: coord orders `created_at DESC LIMIT n`, so a full page is
 * evidence there may be more. `rows.length === LIST_LIMIT` says so in words
 * rather than letting the badge imply the corpus is 200 events.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Filter,
  RefreshCw,
  ScrollText,
} from "lucide-react";

import {
  relativeTime as consoleRelativeTime,
  readIsUnknown,
} from "@/components/console";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getPromptInjection,
  listPromptInjections,
  PromptInjectionsApiError,
  type PromptInjectionDetail,
  type PromptInjectionRow,
  type PromptInjectionSource,
} from "@/services/prompt-injections-api";

const POLL_MS = 10_000;

/**
 * Rows requested per read. Coord clamps to 1..500 and orders `created_at
 * DESC`, so this is "the newest 200", not "all of them" — see the module doc's
 * note on why no corpus total is available to say otherwise.
 */
const LIST_LIMIT = 200;

/**
 * The identity of a filter SET, used to stamp a read's rows and its failures
 * so neither can be shown against filters they were not fetched under.
 *
 * `JSON.stringify` of the pair rather than a joined string: a session name is
 * free text and may contain whatever separator character one picks, and two
 * different filter sets colliding onto one key would resurrect exactly the
 * cross-query bleed the key exists to prevent.
 */
function filterKeyOf(source: string, sessionName: string): string {
  return JSON.stringify([source, sessionName.trim()]);
}

/**
 * One frozen array for "no rows in hand", so the derived `rows` keeps a stable
 * identity across renders that answer nothing.
 */
const EMPTY_ROWS: readonly PromptInjectionRow[] = Object.freeze([]);

// The six coord injection origins (SHARED WIRE CONTRACT `source` values).
const SOURCE_VALUES: PromptInjectionSource[] = [
  "question_auto_answer",
  "regex_submit_prompt",
  "regex_resolve_scoring",
  "session_bus_message",
  "continuation_dispatch",
  "spawned_session_initial",
];

const ALL_SOURCES = "__all__";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * This surface's relative timestamps, rendered through the console primitive.
 *
 * Was a fourth byte-identical private copy of the same function. `absent: "—"`
 * is this surface's choice; the console's own default is `never`.
 */
function relativeTime(iso?: string | null): string {
  return consoleRelativeTime(iso, { absent: "—" });
}

function shortId(id?: string | null): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** Session display: session_name, else short agent_session_id, else terminal_id. */
function sessionLabel(row: PromptInjectionRow): string {
  if (row.session_name) return row.session_name;
  if (row.agent_session_id) return shortId(row.agent_session_id);
  if (row.terminal_id) return shortId(row.terminal_id);
  return "—";
}

// ---------------------------------------------------------------------------
// Detail panel — lazily fetches the full event for a single event id.
// ---------------------------------------------------------------------------

function DetailPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<PromptInjectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * R6's 404 split, carried as its own flag rather than sniffed back out of
   * `error`. Coord ANSWERING "no such event" and coord not answering at all
   * are different facts, and the audit log is exactly where conflating them
   * misleads: an event can be absent because the tenant's retention window
   * rolled past it, which is a real answer, not an outage.
   */
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPromptInjection(eventId)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
        setNotFound(false);
      })
      .catch((e) => {
        if (cancelled) return;
        // `console/readFailure.ts`'s `isNotFoundError` parses `httpClient.get`'s
        // message; this client raises a status-carrying error instead, so the
        // structured field is both available and better. See the module doc.
        const is404 = e instanceof PromptInjectionsApiError && e.status === 404;
        setNotFound(is404);
        setError(
          e instanceof PromptInjectionsApiError
            ? `${e.status}: ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e)
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (loading && !data) {
    return (
      <Skeleton className="h-24 w-full" data-testid="pinj-detail-loading" />
    );
  }
  if (notFound) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="pinj-detail-not-found"
      >
        Coord has no event with this id. It may have aged out of the audit
        log&apos;s retention window — this is an answer, not a failed read.
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-destructive" data-testid="pinj-detail-error">
        Failed to load detail: {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p
        className="text-sm text-muted-foreground italic"
        data-testid="pinj-detail-empty"
      >
        No detail available.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="pinj-detail">
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Output that triggered the injection
        </p>
        <pre
          className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-words"
          data-testid="pinj-trigger-text"
        >
          {data.trigger_text ?? "—"}
        </pre>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Prompt injected
        </p>
        <pre
          className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-words"
          data-testid="pinj-injected-prompt"
        >
          {data.injected_prompt}
        </pre>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          source: <span className="font-mono">{data.source}</span>
        </span>
        {/* `trigger_kind` was fetched by both endpoints and rendered by
            neither. It is the one field that says WHAT coord was watching when
            it injected — the companion to `source`, which says which pathway
            did the injecting — so its absence left the metadata line naming
            every id and no cause. */}
        <span>
          trigger: <span className="font-mono">{data.trigger_kind}</span>
        </span>
        <span>
          rule: <span className="font-mono">{data.rule_id ?? "—"}</span>
        </span>
        <span>
          policy: <span className="font-mono">{data.policy_id ?? "—"}</span>
        </span>
        <span>
          terminal: <span className="font-mono">{data.terminal_id ?? "—"}</span>
        </span>
        <span>
          device: <span className="font-mono">{data.device_id ?? "—"}</span>
        </span>
        <span>
          created: <span className="font-mono">{data.created_at}</span>
        </span>
      </div>

      {/* `metadata` is the detail endpoint's only field the list does not
          carry, and it was the only one nothing rendered — so the lazy fetch
          that exists to show you MORE than the row was dropping the one thing
          the row could never have shown. Rendered only when non-empty: an
          absent or `{}` bag is not a section worth a heading. */}
      {data.metadata && Object.keys(data.metadata).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Metadata
          </p>
          <pre
            className="max-h-40 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-words"
            data-testid="pinj-metadata"
          >
            {JSON.stringify(data.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Injections table with expansion to the DetailPanel
// ---------------------------------------------------------------------------

function InjectionsTable({
  rows,
  loading,
  loaded,
  error,
  filtered,
  onRefresh,
}: {
  rows: readonly PromptInjectionRow[];
  loading: boolean;
  /**
   * Has coord answered THIS filter set? R6 keys UNKNOWN on this, not on
   * `rows` — and not on "has coord ever answered", which is a different and
   * weaker question. See the caller's `answer` for why.
   */
  loaded: boolean;
  error: string | null;
  /** Is any filter narrowing the read? Changes what an honest empty MEANS. */
  filtered: boolean;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // R6's two arms. `unknown` FIRST: a first load that errors leaves `loaded`
  // false too, so a `!loaded`-first reading renders "loading" over a request
  // that is never arriving.
  // The stale arm needs no flag of its own: inside `error && …` it is exactly
  // `!unknown`, and deriving it a second way is how the two spellings drift.
  const unknown = readIsUnknown(loaded, error !== null);
  // Coord `ORDER BY created_at DESC LIMIT n` — a full page is the only
  // evidence on the wire that older events exist. See the module doc.
  const capped = !unknown && rows.length === LIST_LIMIT;

  return (
    <section
      data-testid="prompt-injections-table-section"
      className="space-y-2"
    >
      <div className="flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Prompt Injections
        </h2>
        {/* R6: a count nobody managed to fetch is `–`, never `0`. */}
        <Badge
          variant="outline"
          className="font-mono text-[11px]"
          data-testid="prompt-injections-count"
          title={
            unknown
              ? "coord did not answer; this is a dash, not a zero"
              : capped
                ? `the newest ${LIST_LIMIT} events — there may be more`
                : undefined
          }
        >
          {unknown ? "–" : capped ? `${rows.length}+` : rows.length}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={onRefresh}
          disabled={loading}
          data-testid="prompt-injections-refresh"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
      </div>
      {error && (
        <p
          className="text-sm text-destructive"
          data-testid="prompt-injections-error"
        >
          {/*
            Three sentences, because the stale arm splits on whether there is
            anything to BE stale: "showing the last rows loaded" printed above
            zero rows is its own small lie.

            `staleDetail` is deliberately not reused — it is the health-STRIP
            detail line and says "these counts are stale", and what is stale
            here is a list of rows.
          */}
          {unknown
            ? `Couldn't load prompt injections: ${error}. Nothing could be read — this is unknown, not empty.`
            : rows.length > 0
              ? `Last refresh failed: ${error}. Showing the last rows loaded — they may be out of date.`
              : `Last refresh failed: ${error}. The last successful read found none, and that answer may be out of date.`}
        </p>
      )}
      {capped && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="prompt-injections-capped"
        >
          These are the newest {LIST_LIMIT} events. Older ones are not listed —
          narrow the filters to reach them.
        </p>
      )}
      {loading && rows.length === 0 ? (
        /*
         * A read is in flight and nothing is in hand — including a RETRY after
         * a failure, which is why this is not gated on `!error`. Gating it
         * there left the table area completely blank during a retry, with only
         * the button spinner to say anything was happening.
         */
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 && (unknown || error !== null) ? (
        /*
         * No empty state whenever a read failed — on EITHER arm.
         *
         * Unknown is the obvious case: "No prompt injections matching the
         * current filters" under a banner admitting nothing was read is a
         * claim about coord's corpus drawn from silence.
         *
         * The stale-with-zero-rows case is the subtle one and was wrong in
         * this file's first cut: coord confirmed empty, a later refresh
         * failed, and the page went on asserting the emptiness in the present
         * tense beneath its own failure line. The banner above now carries
         * that fact in the past tense instead, which is the only tense the
         * evidence supports.
         *
         * `PlanLibraryList.tsx:337` gates on `items.length === 0 && !error`
         * for the same reason. This spelling differs from it deliberately —
         * see the module doc on why plan-library is the right OUTPUT and the
         * wrong predicate.
         *
         * Note the `rows.length === 0` guard: this branch suppresses the EMPTY
         * STATE, never the table. Rows in hand keep rendering through a
         * failure — that is the stale arm's whole point, and dropping the
         * guard blanks a list the operator can still act on the moment a poll
         * blips.
         */
        null
      ) : rows.length === 0 ? (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="prompt-injections-empty"
        >
          {filtered
            ? "No prompt injections matching the current filters."
            : /*
               * "Coord returned none", not "coord has recorded none".
               *
               * Coord answers a MISSING `coord.prompt_injection_events` table
               * with `200 {"events":[],"count":0}` (`prompt_injections.rs:363`,
               * documented at `:301`) — an unprovisioned schema is
               * indistinguishable on this wire from a genuinely empty one. So
               * the strongest honest sentence describes the READ, not the
               * corpus. This is R6's own failure class one layer down, where
               * the client cannot see it.
               */
              "Coord returned no prompt injections for this workspace."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]"></TableHead>
              <TableHead>session</TableHead>
              <TableHead className="w-[180px]">source</TableHead>
              <TableHead>trigger</TableHead>
              <TableHead className="w-[120px]">when</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isExpanded = expanded === row.event_id;
              return (
                <Fragment key={row.event_id}>
                  <TableRow
                    data-testid="prompt-injections-row"
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() =>
                      setExpanded((cur) =>
                        cur === row.event_id ? null : row.event_id
                      )
                    }
                  >
                    <TableCell>
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      {sessionLabel(row)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="font-mono text-[10px]"
                      >
                        {row.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[420px] text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">
                          {row.trigger_preview ?? (
                            <span className="italic">—</span>
                          )}
                        </span>
                        {/*
                          `truncated` was on the wire and nothing read it.
                          Without it the operator cannot tell text the SERVER
                          cut from text this cell is merely clipping with CSS —
                          the first has more behind the chevron, the second
                          does not. It is the affordance that says opening the
                          row is worth it.

                          It is ONE flag for the EVENT, not for this column:
                          coord sets it when either preview overran its
                          200-char cut (`prompt_injections.rs` `row_previews`
                          returns `trig_trunc || inj_trunc`). So the marker
                          must not claim the trigger was cut — with a two-word
                          trigger and a 500-char injected prompt it is true of
                          the event and false of the cell it sits in. It sits
                          here because this is the only preview column the
                          table has; the wording is what keeps it honest.
                        */}
                        {row.truncated && (
                          <span
                            className="shrink-0 font-mono text-[10px] text-muted-foreground/70"
                            title="Coord cut this event's preview text (the trigger, the injected prompt, or both) — expand the row for the full text"
                            data-testid="pinj-row-truncated"
                          >
                            cut
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {relativeTime(row.created_at)}
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow data-testid="prompt-injections-detail-row">
                      <TableCell colSpan={5} className="bg-muted/10 p-4">
                        <DetailPanel eventId={row.event_id} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Top-level dashboard
// ---------------------------------------------------------------------------

interface InjectionFilters {
  source: string;
  session_name: string;
  polling: boolean;
}

export default function PromptInjectionsDashboard() {
  const [filters, setFilters] = useState<InjectionFilters>({
    source: ALL_SOURCES,
    session_name: "",
    polling: true,
  });
  const [loading, setLoading] = useState(true);

  /**
   * The filter set this surface is currently asking about. Rows and failures
   * are both stamped with it.
   */
  const filterKey = filterKeyOf(filters.source, filters.session_name);
  const filtered =
    filters.source !== ALL_SOURCES || filters.session_name.trim() !== "";

  /**
   * The last successful read, WITH the filter set it answered — not a bare
   * row array beside a bare `loaded` boolean.
   *
   * This shape is load-bearing, and the boolean version of it was wrong. R6's
   * `loaded` means *"has coord answered THIS question"*, and the question
   * changes when the filters do. A global "coord has answered at some point"
   * flag keeps `unknown` false across a filter change, so a read that fails
   * under the NEW filters takes the stale arm and renders the PREVIOUS
   * filters' rows under filter chrome that says otherwise — an answer to a
   * different question, presented as a stale answer to this one. That is
   * worse than the defect this file set out to fix, because the old banner at
   * least made no claim about the rows' provenance.
   *
   * Keying the answer instead makes that state unrepresentable rather than
   * merely unlikely: `rows` is DERIVED from whether the stored key still
   * matches, so there is no code path that can display a row fetched under
   * other filters. It is the list analogue of the style guide's *"reset the
   * record where the route param changes"* — the filter set is this
   * surface's param.
   */
  const [answer, setAnswer] = useState<{
    key: string;
    rows: PromptInjectionRow[];
  } | null>(null);
  /** Failures are keyed for the same reason: an error about the OLD query is not about this one. */
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);

  const answered = answer !== null && answer.key === filterKey;
  const rows = answered ? answer.rows : EMPTY_ROWS;
  const error =
    failure !== null && failure.key === filterKey ? failure.message : null;

  /**
   * Guards against a superseded read landing after a newer one.
   *
   * Not a nicety: the session-name input has no debounce, so typing three
   * characters issues three overlapping list reads. Without this, a slow
   * FIRST request rejecting after a fast second one succeeded paints
   * "these rows are stale" over rows that are current — the mirror image of
   * the arm this file exists to fix — and a slow success can overwrite newer
   * rows. `DetailPanel` already had a `cancelled` guard; the list did not.
   */
  const seq = useRef(0);

  const fetchInjections = useCallback(async () => {
    const mine = ++seq.current;
    const key = filterKeyOf(filters.source, filters.session_name);
    try {
      const body = await listPromptInjections({
        limit: LIST_LIMIT,
        source: filters.source === ALL_SOURCES ? undefined : filters.source,
        session_name: filters.session_name.trim() || undefined,
      });
      if (seq.current !== mine) return;
      setAnswer({ key, rows: body.events });
      setFailure(null);
    } catch (e) {
      if (seq.current !== mine) return;
      setFailure({
        key,
        message:
          e instanceof PromptInjectionsApiError
            ? `${e.status}: ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e),
      });
    } finally {
      // Only the newest read owns the spinner, or a poll tick completing
      // mid-refresh un-spins a button whose read is still in flight.
      if (seq.current === mine) setLoading(false);
    }
  }, [filters.source, filters.session_name]);

  // The read. Split from the poll below so that toggling polling does not
  // fire an extra request for filters that were already answered.
  useEffect(() => {
    setLoading(true);
    void fetchInjections();
  }, [fetchInjections]);

  useEffect(() => {
    if (!filters.polling) return;
    const interval = setInterval(fetchInjections, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchInjections, filters.polling]);

  /** The manual refresh: shows it is working, which the bare call did not. */
  const refresh = useCallback(() => {
    setLoading(true);
    void fetchInjections();
  }, [fetchInjections]);

  const sourceOptions = useMemo(() => SOURCE_VALUES, []);

  return (
    <div className="space-y-4">
      <div
        data-testid="prompt-injections-filters"
        className="flex flex-wrap items-center gap-4"
      >
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select
          value={filters.source}
          onValueChange={(v) => setFilters((f) => ({ ...f, source: v }))}
        >
          <SelectTrigger
            className="w-[240px]"
            data-testid="prompt-injections-source-select"
          >
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SOURCES}>All sources</SelectItem>
            {sourceOptions.map((s) => (
              <SelectItem key={s} value={s} className="font-mono text-xs">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="session name"
          value={filters.session_name}
          onChange={(e) =>
            setFilters((f) => ({ ...f, session_name: e.target.value }))
          }
          className="max-w-xs text-xs"
          data-testid="prompt-injections-session-input"
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={filters.polling}
            onCheckedChange={(v) =>
              setFilters((f) => ({ ...f, polling: Boolean(v) }))
            }
            data-testid="prompt-injections-poll-toggle"
          />
          Live poll (10s)
        </label>
      </div>

      <InjectionsTable
        rows={rows}
        loading={loading}
        loaded={answered}
        error={error}
        filtered={filtered}
        onRefresh={refresh}
      />
    </div>
  );
}
