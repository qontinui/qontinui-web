"use client";

/**
 * SessionsConsole — the consolidated `/sessions` list, on the console
 * primitives.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 1.
 *
 * ## What this replaces, and what it composes
 *
 * `SessionsList.tsx` renders a 394-line `<Card>` per session grouped under
 * per-machine header cards — the exact record shape R2 was written against,
 * and several screens of scrolling for a 40-session fleet. This is one LINE
 * per session, sorted attention-then-recency, with the machine as a COLUMN and
 * a `FilterChips` facet rather than a grouping container (§4.1's density
 * target). Both are reachable this phase so they can be compared on a live
 * fleet; Phase 3 deletes the old one.
 *
 * Everything visual here comes from `@/components/console` and nothing is
 * re-derived: `HealthStrip` + `StatCluster` (R1), `FilterTabs` (R6, single)
 * and `FilterChips` (R6, multi), `RecordList`/`RecordRow`/`RecordDetail`
 * (R2/R4/R5) over `statusRow`'s atoms (R3), `attention.ts` for the severity
 * vocabulary, `time.ts` for timestamps, and `readFailure.ts` for the read
 * axis. The status derivation itself is a pure module beside this one
 * (`sessionConsoleStatus.ts`, R8) so the words an operator reads are testable
 * without a DOM.
 *
 * ## The two unknowns this surface has to keep apart
 *
 * | Axis | Question | Answered by |
 * |---|---|---|
 * | read | did the list read land? | `readIsUnknown(loaded, readFailed)` |
 * | join | it landed and the row is here — is the other half present? | the wire's `row_class` |
 *
 * `readIsUnknown(loaded=true, readFailed=false)` is `false` for a row whose
 * join half is missing, and it is right to be: that read landed. Conflating
 * the two is the trap plan §4 names in terms. So both are consulted, and
 * separately.
 *
 * ## The WORK axis is a THIRD thing, and it is not liveness
 *
 * Plan `2026-09-01-session-finished-marker-and-unfinished-resume` Phase 4.
 * `coord.sessions.session_status` (`working | blocked | stalled |
 * waiting_human | finished`) answers *has the agent finished its work?*, which
 * the `state` column above does not: a session can be `state=active` and
 * `session_status=finished`, or `state=closed` having never finished. So it
 * gets its own badge beside the status one and its own `FilterChips` facet —
 * never a `?status=` tab, which filters `state`. Keeping the two apart is the
 * feature.
 *
 * ## Absence is not zero (D2)
 *
 * A `lifecycle_only` row renders `–` for transcript/lineage, never "none". An
 * `agent_only` row renders `–` for heartbeat/state, never `false`, `0` or
 * "closed". A row whose `row_class` is `null` renders `–` for BOTH. Each dash
 * carries a `title` saying which unknown it is, because "not applicable",
 * "unknown" and "we did not look" are three different sentences and a bare
 * dash is only honest if the reader can find out which one it means.
 *
 * ## The strip counts coord's answer; the facets narrow only the list
 *
 * Plan `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
 * Phases 2-3. The health strip, the stats and the answered tab's count are
 * derived from `rows` — coord's answer to the status tab and the search, both
 * SERVER filters — and the strip names that question in words
 * (`deriveSessionsHealth`). The client facets narrow only the list, and say so
 * in the scoped line beside them. Before the first answer every count is a
 * dash under an amber "Reading sessions…"; while either half of the read
 * stopped at its 500-row ceiling the counts are floors (`≥n`, one spelling),
 * while either half's size is unknown they are dashes, and a line under the
 * stats names the half and says which. `agent-only` is a set difference, so
 * its bound follows WHICH half stopped (`agentOnlyStat`). A FAILED agent read
 * is not a complete one: rows and machines are floors, and the join classes
 * and the status counts are dashes that say the agent half did not answer.
 *
 * ## Finding a session by name, id or commit trailer — and its account
 *
 * Plan `2026-10-19-session-lookup-by-name-shows-claude-account-in-web`
 * Phase 3. The search box takes a session name, a session id, or a pasted
 * `Session-Id:` / `Session-Name:` trailer line; `sessionQuery.ts` strips the
 * trailer prefix before `?q=` goes on the wire, because neither half of the
 * search would match the literal prefix. A name matching several sessions
 * renders every row — nothing here collapses matches. The **Account** column
 * and facet read the list row's agent half (`row.agent_session`) through
 * `sessionAccount.ts`, whose module doc has the three UNKNOWNs and why they
 * are not one.
 *
 * ## Tenant scoping is coord's (trap 7 / trap 10)
 *
 * Both backend reads forward the caller's bearer and coord scopes by
 * device→tenant. Nothing here filters by tenant. `TenantSwitcher` stays, and
 * renders only for operators in more than one tenant — single-tenant operators
 * see nothing and the choice stays structurally hidden.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import {
  FilterChips,
  FilterTabs,
  HealthStrip,
  RecordList,
  RecordRow,
  RowTime,
  StatCluster,
  StatusBadge,
  UNKNOWN_COUNTS_DETAIL,
  readIsUnknown,
  relativeTime,
  staleDetail,
  type FilterChipOption,
  type HealthBadge,
  type Stat,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import { listConsolidatedSessions } from "@/lib/api/operations/sessions";
import {
  SESSION_STATUS_PALETTE,
  SESSION_WORK_PALETTE,
  STATUSES_UNESTABLISHED,
  agentOnlyStat,
  agentSessionId,
  ceilingDisclosure,
  compareSessionRows,
  countBasis,
  deriveSessionStatus,
  deriveSessionWorkStatus,
  deriveSessionsHealth,
  fleetCount,
  hasAgentHalf,
  hasLifecycleHalf,
  isSessionFinished,
  isSizeUnknown,
  joinClassCount,
  rowTimestamp,
  sessionsCeiling,
  type ConsolidatedSessionRow,
  type ConsolidatedSessionsResponse,
  type CountCell,
  type HalfExtent,
} from "./sessionConsoleStatus";
import {
  SessionRowExpansion,
  useSessionCoordination,
  type CoordinationReaders,
} from "./SessionRowExpansion";
import {
  AccountValue,
  Dash,
  HeartbeatValue,
  KindValue,
  MachineValue,
  accountState,
  machineTitle,
  type MachineLabel,
} from "./SessionRowIdentity";
import type { SessionRevalidationOptions } from "./liveRevalidation";
import {
  ACCOUNT_FACET_UNKNOWN,
  accountFacetValue,
  deriveAccountCell,
  type AccountCell,
} from "./sessionAccount";
import { normalizeSessionQuery } from "./sessionQuery";
import { useTranscriptStores } from "./TranscriptStoresPanel";
import {
  liveTranscriptIndicator,
  type ArtifactLister,
  type OutputReader,
} from "./transcriptStores";

/**
 * **THE list poll. There is exactly one, and 10s is a stated decision — please
 * do not "optimize" it back to 5s.**
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 4. The three
 * surfaces this console replaced ran three independent polls between them —
 * `SessionsList` at 5s, `AgentSessionsDashboard` at 10s for the list plus 5s
 * for an expanded row's lineage, `/environments/sessions` on a 300ms-debounced
 * 200-row fetch. They are collapsed onto this one interval.
 *
 * **Why 10s and not 5s:** coord's session heartbeat cadence is 15s, a session
 * is not called stale until 45s and is not auto-closed until 180s (the numbers
 * `/sessions`' own subtitle states). A 5s poll therefore re-asks the same
 * question three times per heartbeat and cannot surface a state change any
 * sooner than the 15s beat that produces it — it buys latency that does not
 * exist and pays for it with 3x the fleet-wide read volume. 10s is the slower
 * of the two list polls this consolidates, chosen deliberately as the one that
 * still samples faster than the signal it observes.
 *
 * **What does NOT poll:** an open row. It follows that session's existing SSE
 * stream (`liveRevalidation.ts`), because a single session already HAS a live
 * transport and a second timer beside it would only race it.
 */
const POLL_INTERVAL_MS = 10_000;

/** Keystroke settle before `?q=` goes on the wire. Same 300ms
 *  `/environments/sessions` already pays for this read. */
const QUERY_DEBOUNCE_MS = 300;

/** The status filter's vocabulary — coord's own agent-session words. */
export type StatusTab = "all" | "live" | "stale" | "closed";

const STATUS_TABS: ReadonlyArray<{ id: StatusTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "stale", label: "Stale" },
  { id: "closed", label: "Closed" },
];

/**
 * `?status=` off the URL, or `null` for anything this console does not filter
 * on. Deliberately NOT a fallback to `"all"`: an unrecognized value is the
 * caller's problem to notice, and silently widening it to "everything" would
 * make a typo'd deep link look like a working one.
 *
 * Phase 3's `/admin/agent-sessions?live=true` → `/sessions?status=live` 308 is
 * what puts a value here today.
 */
export function parseStatusTab(raw: string | null | undefined): StatusTab | null {
  return STATUS_TABS.some((t) => t.id === raw) ? (raw as StatusTab) : null;
}

export interface SessionsConsoleProps {
  /** device_id → hostname, from the live device-status stream. */
  hostnameFor?: (deviceId: string) => string | undefined;
  /** Initial `?device=` deep link — `/environments/sessions?device=` maps here. */
  initialDevice?: string;
  /**
   * Initial status tab. `/admin/agent-sessions?live=true` 308s to
   * `/sessions?status=live`, and without this the mapped param would land on a
   * page that ignores it — a redirect that looks like it preserved the filter
   * and did not.
   */
  initialStatus?: StatusTab;
  pollEnabled?: boolean;
  /** Injected for tests. Defaults to the real API client. */
  fetcher?: typeof listConsolidatedSessions;
  /** Injected for tests so `relativeTime` and the heartbeat bands are stable. */
  now?: number;
  /**
   * The three coordination reads an OPEN row makes. Injected for tests; the
   * defaults are the real proxy clients. Nothing fetches while a row is shut.
   */
  coordinationReaders?: CoordinationReaders;
  /** Injected for tests — coord's transcript-stream read. */
  readOutput?: OutputReader;
  /** Injected for tests — the permanent archive's list read. */
  listArtifacts?: ArtifactLister;
  /**
   * Injected for tests — the per-session SSE an OPEN row revalidates on. The
   * default is the shipped `subscribeSessionEvents`; there is no second
   * transport to configure here.
   */
  revalidation?: SessionRevalidationOptions;
}

export function SessionsConsole({
  hostnameFor,
  initialDevice,
  initialStatus,
  pollEnabled = true,
  fetcher,
  now,
  coordinationReaders,
  readOutput,
  listArtifacts,
  revalidation,
}: SessionsConsoleProps) {
  const doFetch = fetcher ?? listConsolidatedSessions;

  const [payload, setPayload] = useState<ConsolidatedSessionsResponse | null>(
    null
  );
  // `loaded` is "coord has answered at least once", NOT "the last poll
  // succeeded" — `console/readFailure.ts` is explicit that keying the unknown
  // predicate on the list being empty flickers a genuinely-empty list between
  // "nothing matches" and "unknown" on a single blipped poll.
  const [loaded, setLoaded] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusTab>(initialStatus ?? "all");
  // The question `payload` ANSWERED — its tab and its search. The strip and
  // the tab counts name this, not the controls: between a click and coord's
  // answer the rows on screen still answer the previous question, and a strip
  // keyed on the controls would put the new referent's words on the old rows.
  const [answered, setAnswered] = useState<{
    status: StatusTab;
    query: string;
  }>({ status: initialStatus ?? "all", query: "" });
  // Two query states, not one. `query` is what the operator is typing;
  // `appliedQuery` is what has been sent. `?q=` is a SERVER filter (coord runs
  // the full-text half), so binding the fetch to `query` directly would issue
  // one request per keystroke — the 300ms debounce `/environments/sessions`
  // already pays for exactly this read.
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  // The WORK axis facet (`coord.sessions.session_status`) — plan
  // `2026-09-01-session-finished-marker-and-unfinished-resume` Phase 4. A
  // fourth CLIENT facet, deliberately NOT a fifth `FilterTabs` tab:
  //
  // 1. The marker is already on every row coord served, so narrowing on it
  //    needs no refetch — a server tab would pay a round trip to filter data
  //    the browser is holding.
  // 2. The `?status=` axis those tabs drive filters `state` — LIVENESS. Adding
  //    `finished` there would make one control mean two orthogonal things, and
  //    keeping liveness and work apart is the entire point of this feature: a
  //    live session can be finished, and a closed one can be unfinished.
  //
  // NOT PERSISTED, deliberately. This console has no `localStorage` and no URL
  // writeback for ANY facet — `?status=` is read once on mount via
  // `parseStatusTab` and never written back. A sticky one here would be the
  // only control on the page that remembered itself, and a filter an operator
  // does not remember setting is a filter that silently hides rows on the next
  // visit. Match the surface's idiom; do not add persistence here alone.
  const [work, setWork] = useState<string[]>([]);
  // The Claude-account facet — a CLIENT facet over the agent half's account
  // stamp, like `machine`. Not persisted, for the reason `work` gives above.
  const [accounts, setAccounts] = useState<string[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // `?device=` is a deep link, so it is a SERVER filter (it narrows both halves
  // of the join coord-side) while the machine chips are a client facet over
  // what came back. Held in a ref because it never changes after mount today —
  // Phase 3's redirect is what supplies it.
  const deviceRef = useRef(initialDevice);
  deviceRef.current = initialDevice;

  // What the box holds, as the wire will see it: a pasted `Session-Id:` /
  // `Session-Name:` trailer line is reduced to its value (`sessionQuery.ts`).
  const normalizedQuery = useMemo(() => normalizeSessionQuery(query), [query]);

  useEffect(() => {
    const id = window.setTimeout(
      () => setAppliedQuery(normalizedQuery.query),
      QUERY_DEBOUNCE_MS
    );
    return () => window.clearTimeout(id);
  }, [normalizedQuery.query]);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await doFetch({
          device: deviceRef.current,
          q: appliedQuery || undefined,
          status: status === "all" ? undefined : status,
          signal,
        });
        setPayload(data);
        setAnswered({ status, query: appliedQuery });
        setLoaded(true);
        setReadFailed(false);
        setError(null);
        setLastUpdated(new Date().toISOString());
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setReadFailed(true);
        setError(err instanceof Error ? err.message : "failed to load sessions");
      }
    },
    [doFetch, appliedQuery, status]
  );

  // The one poll (Phase 4). Every read this effect issues carries the SAME
  // abort signal, so teardown cancels the in-flight one too — an interval
  // cleared while its fetch is still open would still resolve and set state on
  // an unmounted console.
  useEffect(() => {
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    if (!pollEnabled) return () => ctrl.abort();

    let timer: number | null = null;
    const start = () => {
      // Idempotent: a `visibilitychange` that fires twice must not leave two
      // intervals racing each other over one list.
      if (timer !== null) return;
      timer = window.setInterval(
        () => void refresh(ctrl.signal),
        POLL_INTERVAL_MS
      );
    };
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };

    // A hidden tab STOPS the timer rather than skipping its body. Skipping
    // still wakes the event loop every 10s forever on a console an operator
    // left open in a background tab — 8,640 wake-ups a day to do nothing — and
    // "the interval is still registered" is exactly the leak this phase is
    // about. Coming back visible reads ONCE immediately, because the numbers
    // on screen are by then up to a poll old and making the operator wait out
    // a tick to find that out is the worse half of the trade.
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      void refresh(ctrl.signal);
      start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      ctrl.abort();
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh, pollEnabled]);

  const rows = useMemo(() => payload?.sessions ?? [], [payload]);
  const agentHalfFailed = payload?.agent_half?.read === "failed";
  // Each half's extent against its 500-row ceiling — complete, FULL (a
  // floor), or of UNKNOWN size (no number at all) — and so how every fleet
  // count may be stated (plan
  // `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
  // Phase 3). A backend that reports no bound is read as complete: exact
  // counts and no disclosure, the claim the page made before the field
  // existed — kept for deploy skew only.
  const ceiling = useMemo(() => sessionsCeiling(payload), [payload]);
  const basis = countBasis(ceiling);
  const disclosure = ceilingDisclosure(ceiling);
  // Sessions the server-side status/machine filter hid although their agent
  // half matched — the halves disagree. Counted so a narrowed tab never loses
  // a session silently (`withheld_by_filter` on the envelope).
  const withheld = payload?.withheld_by_filter ?? 0;

  // The READ axis. Keyed on `loaded`, per `readFailure.ts`.
  const unknown = readIsUnknown(loaded, readFailed);
  // A read that landed once and then failed is STALE, not unknown — the counts
  // are real, just old, and saying so beats throwing them away.
  const stale = readFailed && loaded;

  const machineLabel = useCallback(
    (deviceId: string | null | undefined) =>
      deviceId
        ? (hostnameFor?.(deviceId) ?? `${String(deviceId).slice(0, 8)}…`)
        : null,
    [hostnameFor]
  );

  // ---- the Account column (one derivation per row, shared with its facet) ---
  const accountCells = useMemo(() => {
    const ctx = { machineLabel, agentHalf: payload?.agent_half };
    const cells = new Map<ConsolidatedSessionRow, AccountCell>();
    for (const row of rows) cells.set(row, deriveAccountCell(row, ctx));
    return {
      // Every row on the page is in the map (`visible` filters `rows`, it
      // does not copy them); deriving on a miss keeps the accessor total.
      of: (row: ConsolidatedSessionRow): AccountCell =>
        cells.get(row) ?? deriveAccountCell(row, ctx),
    };
  }, [rows, machineLabel, payload]);

  // ---- the client-side facets ------------------------------------------
  const kindOptions = useMemo(
    () => facetOptions(rows, (r) => r.session_kind ?? null),
    [rows]
  );
  const providerOptions = useMemo(
    () => facetOptions(rows, (r) => r.provider ?? null),
    [rows]
  );
  const machineOptions = useMemo(
    () =>
      facetOptions(rows, (r) =>
        r.device_id ? String(r.device_id) : null
      ).map((o) => ({ ...o, label: machineLabel(o.value) ?? o.value })),
    [rows, machineLabel]
  );

  /**
   * The account facet. Every UNKNOWN shares ONE chip — whatever its reason, it
   * answers "which sessions do we not know the account of?" — and a session
   * with no Claude session id at all (a shell) belongs to no chip, so picking
   * an account narrows to sessions that ran on it rather than counting shells
   * as unknown. Counts are measured over the rows on the page.
   */
  const accountOptions = useMemo<FilterChipOption<string>[]>(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = accountFacetValue(accountCells.of(row));
      if (value === null) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) =>
        // UNKNOWN last: it is the absence of an answer, not an account.
        a === ACCOUNT_FACET_UNKNOWN
          ? 1
          : b === ACCOUNT_FACET_UNKNOWN
            ? -1
            : a.localeCompare(b)
      )
      .map(([value, count]) =>
        value === ACCOUNT_FACET_UNKNOWN
          ? {
              value,
              label: "UNKNOWN",
              count,
              testId: "sessions-console-account-unknown",
              title:
                "sessions whose account is not known — the agent half was unread, coord does not report the account yet, or no device has reported it. Hover a row's Account cell for which.",
            }
          : { value, label: value, count, title: `Claude account ${value}` }
      );
  }, [rows, accountCells]);

  /**
   * The work facet's vocabulary — AUTHORED (two members), not derived from the
   * rows, so `maxVisible` is omitted and both chips render even at count `0`.
   *
   * Both counts are MEASURED over the rows already on the page once coord has
   * answered, so R6's `0` is honest then — `–` would be the lie. Before the
   * first answer nothing is on the page to count, and the `0` would be the lie
   * instead, so both are `null` (`–`) until `loaded`. What is deliberately NOT
   * offered is a third "never reported" chip: `isSessionFinished` is total by
   * design (see its doc), and splitting unknown out would put a chip on the
   * page whose selection asserts something about rows nobody has heard from.
   */
  const workOptions = useMemo<FilterChipOption<string>[]>(() => {
    let finished = 0;
    for (const r of rows) if (isSessionFinished(r)) finished += 1;
    return [
      {
        value: "finished",
        label: "finished",
        count: loaded ? finished : null,
        title:
          "sessions that reported session_status=finished — the WORK axis. Orthogonal to live/stale/closed.",
      },
      {
        value: "unfinished",
        label: "unfinished",
        count: loaded ? rows.length - finished : null,
        title:
          "everything else — including sessions that have never reported a work status at all. Select this to HIDE finished sessions; a row we have heard nothing from stays visible, because absence is unknown, not a measured 'not finished'.",
      },
    ];
  }, [rows, loaded]);

  const visible = useMemo(() => {
    const filtered = rows.filter((r) => {
      // EMPTY selection means NO filter — never a synthetic "any" option.
      if (kinds.length && !kinds.includes(String(r.session_kind ?? ""))) {
        return false;
      }
      if (providers.length && !providers.includes(String(r.provider ?? ""))) {
        return false;
      }
      if (machines.length && !machines.includes(String(r.device_id ?? ""))) {
        return false;
      }
      // Same rule, same shape: an empty `work` selection filters nothing. A row
      // coord served no `session_status` for lands in `unfinished` and is
      // therefore SHOWN whenever finished rows are being hidden — the safe
      // direction for an unknown (`isSessionFinished`'s doc has the reasoning).
      if (
        work.length &&
        !work.includes(isSessionFinished(r) ? "finished" : "unfinished")
      ) {
        return false;
      }
      if (accounts.length) {
        const value = accountFacetValue(accountCells.of(r));
        if (value === null || !accounts.includes(value)) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => compareSessionRows(a, b, { now }));
  }, [rows, kinds, providers, machines, work, accounts, accountCells, now]);

  // The client facets holding a selection, in the order they render — what
  // the scoped line names when they narrow the list below the strip.
  const facetSelections: ReadonlyArray<[string, readonly string[]]> = [
    ["kind", kinds],
    ["provider", providers],
    ["machine", machines],
    ["work", work],
    ["account", accounts],
  ];
  const narrowedBy = facetSelections
    .filter(([, selected]) => selected.length > 0)
    .map(([name]) => name);

  // The strip answers for `rows` — coord's answer to the tab and the search —
  // and NEVER for `visible`. The client facets narrow the list below it, not
  // the fleet's numbers: deriving the strip from `visible` made one machine
  // chip turn "31 rows across 3 machines" into "1 row across 1 machine" under
  // a headline still saying "on the fleet". What the facets leave is the
  // scoped line's job (`sessions-console-scope`).
  const health = useMemo(
    () =>
      deriveSessionsHealth(rows, {
        readUnknown: unknown,
        loaded,
        agentHalfFailed,
        referent: {
          status: answered.status === "all" ? null : answered.status,
          query: answered.query,
          // `?device=` is a SERVER filter too, fixed at mount: the strip
          // names that machine rather than "the fleet".
          machine: machineLabel(deviceRef.current),
        },
        ceiling,
        // Matches the server filter hid because their halves disagree: an
        // empty tab holding them is not a green, empty fleet.
        withheld,
        options: { now },
      }),
    [
      rows,
      unknown,
      loaded,
      agentHalfFailed,
      answered,
      machineLabel,
      ceiling,
      withheld,
      now,
    ]
  );

  // ---- R6: counts are `null` until coord has answered, NEVER 0 ----------
  //
  // Keyed on `loaded`, not on `unknown`: before the FIRST answer nothing is
  // known either, and a `0` then is the `silent-empty-is-unknown` mistake with
  // a number attached (`unknown` is the failed half of the same window). So
  // every count slot is `–` until coord answers, keeping its own title; after
  // that it reads its `CountCell` — exact; a floor (`≥n`, and a floor of zero
  // as words where the slot has room, a bare `0` in a tab, titled either way);
  // `–` over a half of unknown size.
  const unread = (cell: CountCell): CountCell =>
    loaded ? cell : { value: null, title: cell.title };
  const fleet = (
    n: number | null,
    opts: { compact?: boolean; title?: string } = {}
  ): CountCell =>
    n === null
      ? { value: null, title: opts.title }
      : unread(fleetCount(n, basis, opts));

  // The status tabs are a SERVER filter, so only the answered tab's count is
  // measured; the others have not been fetched and a `0` on them would be the
  // same mistake. `FilterTabs` renders `null` as `–`. The answered tab shows
  // coord's count for it (`rows`), never what the facets left — that is the
  // scoped line's number — spelled like every other fleet count, in the
  // slot's compact form: a floor of zero is a bare `0` whose title says what
  // it counted.
  const answeredCount = fleet(rows.length, { compact: true });
  const tabs = STATUS_TABS.map((t) => {
    const answeredTab = loaded && t.id === answered.status;
    return {
      id: t.id,
      label: t.label,
      count: answeredTab ? answeredCount.value : null,
      title: answeredTab ? answeredCount.title : undefined,
      attention: t.id === answered.status && (health.attention ?? 0) > 0,
    };
  });

  // A set difference, so its bound follows WHICH half stopped — and a FAILED
  // agent half establishes no class at all.
  const agentOnly = agentOnlyStat(countClass(rows, "agent_only"), ceiling);
  // A failed agent read establishes no row's status, so the strip's two
  // status counts are `–` (`deriveSessionsHealth` returns them null) and say
  // why.
  const statusTitle = agentHalfFailed ? STATUSES_UNESTABLISHED : undefined;
  const attentionCount = fleet(health.attention, { title: statusTitle });
  const activeCount = fleet(health.active, { title: statusTitle });

  const stats: Stat[] = [
    { key: "rows", label: "rows ", ...fleet(rows.length) },
    { key: "machines", label: "machines ", ...fleet(health.machines) },
    {
      key: "linked",
      label: "linked ",
      ...unread(
        joinClassCount(
          countClass(rows, "linked"),
          ceiling,
          "coord.sessions row bridged to its coord.agent_sessions row"
        )
      ),
    },
    {
      key: "lifecycle",
      label: "lifecycle-only ",
      ...unread(
        joinClassCount(
          countClass(rows, "lifecycle_only"),
          ceiling,
          "no Claude Code session id, so no agent-session row can exist — transcript and lineage are not applicable"
        )
      ),
      tone: "muted",
    },
    {
      key: "agent",
      label: "agent-only ",
      // NOT a fleet floor. The class is the agent rows read less those a
      // lifecycle row READ bridges, so a full lifecycle half can only have
      // made it too big (`≤n`), a full agent half too small (`≥n`), and both
      // at once leaves a count of rows read that is neither.
      ...unread(agentOnly),
      tone: "muted",
    },
    {
      key: "unresolved",
      label: "unresolved ",
      // Exact even over a capped read: it counts rows of THIS read whose other
      // half did not answer, not a fleet total a larger read could only add to.
      value: loaded ? countClass(rows, null) : null,
      title:
        "the read landed but the agent half did not answer for these rows — unknown, not zero",
      tone: (health.unknownJoin ?? 0) > 0 ? "warning" : "muted",
    },
  ];

  const badges: HealthBadge[] = [
    {
      key: "attention",
      label: `needs a person ${attentionCount.value ?? "–"}`,
      title: attentionCount.title,
      tone: (health.attention ?? 0) > 0 ? "attention" : "muted",
    },
    {
      key: "active",
      label: `active ${activeCount.value ?? "–"}`,
      title: activeCount.title,
      tone: "muted",
    },
    {
      key: "updated",
      label: `updated ${relativeTime(lastUpdated, { absent: "never", now })}`,
      tone: "muted",
      title: stale ? "the last refresh failed" : undefined,
    },
  ];

  return (
    // `@container` (inline-size containment) is what stops the console from
    // widening to its longest row. It sits inside the page's Radix ScrollArea,
    // whose `display: table` wrapper grows to the widest MIN-CONTENT child —
    // and a row's min-content holds its whole unwrapped purpose label. A
    // container's intrinsic width ignores its content, so the console takes
    // its column's width and every `truncate` / `flex-wrap` inside engages.
    // It is also the root the row's `@min-[…]` column thresholds query.
    <div className="@container space-y-3" data-ui-bridge-id="sessions.console">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={
          unknown
            ? UNKNOWN_COUNTS_DETAIL
            : stale
              ? staleDetail(health.detail)
              : health.detail
        }
        badges={badges}
        data-testid="sessions-console-health"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatCluster
          stats={stats}
          data-testid="sessions-console-stats"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          aria-label="Refresh sessions"
          data-testid="sessions-console-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
      {/* U4: the strip and the stats above count what coord SERVED, and each
          half stops at a ceiling. Said in words, naming only the halves that
          reached one — or whose size is unknown — so a sample is never
          presented as the fleet. */}
      {loaded && disclosure && (
        <p
          className="text-xs text-amber-300/90"
          data-testid="sessions-console-truncated"
          title={
            isSizeUnknown(ceiling)
              ? "A half whose size is unknown supports no number — not a total and not a floor — so the fleet counts above are dashes; the rows below are what did arrive."
              : "Each half of this read stops at a ceiling and nothing past it was read, so the fleet counts above are floors, not totals — except agent-only, whose own title says which way it can be off."
          }
        >
          {disclosure}
        </p>
      )}

      <FilterTabs
        tabs={tabs}
        active={status}
        onChange={setStatus}
        testIdPrefix="sessions-console-status"
        query={query}
        onQueryChange={setQuery}
        queryPlaceholder="Name, id, or Session-Id: line…"
        queryTestId="sessions-console-query"
      />
      {normalizedQuery.trailer && (
        <p
          className="text-[11px] text-muted-foreground"
          data-testid="sessions-console-query-trailer"
        >
          {normalizedQuery.query ? (
            <>
              Searching the {normalizedQuery.trailer} value{" "}
              <span className="font-mono break-all text-foreground/90">
                {normalizedQuery.query}
              </span>{" "}
              — the trailer prefix is not part of the search.
            </>
          ) : (
            <>
              A {normalizedQuery.trailer}: line with no value yet — paste the
              whole trailer line and the value after the colon is searched.
            </>
          )}
        </p>
      )}

      {/* `hideWhenEmpty` on the four facets whose options are DERIVED FROM THE
          ROWS (kind, provider, machine, account): there an empty vocabulary
          means no row carries the field, so the strip would be a lone `all`
          chip that can narrow nothing. `work` is authored and always shown. */}
      <div className="flex flex-col gap-1">
        <FilterChips
          label="kind"
          options={kindOptions}
          selected={kinds}
          onToggle={(v) => setKinds(toggle(kinds, v))}
          onClear={() => setKinds([])}
          maxVisible={8}
          hideWhenEmpty
          testIdPrefix="sessions-console-kind"
        />
        <FilterChips
          label="provider"
          options={providerOptions}
          selected={providers}
          onToggle={(v) => setProviders(toggle(providers, v))}
          onClear={() => setProviders([])}
          maxVisible={8}
          hideWhenEmpty
          testIdPrefix="sessions-console-provider"
        />
        <FilterChips
          label="machine"
          options={machineOptions}
          selected={machines}
          onToggle={(v) => setMachines(toggle(machines, v))}
          onClear={() => setMachines([])}
          // A server vocabulary with no ceiling this page controls — one chip
          // per machine on the fleet.
          maxVisible={6}
          hideWhenEmpty
          testIdPrefix="sessions-console-machine"
        />
        <FilterChips
          label="work"
          options={workOptions}
          selected={work}
          onToggle={(v) => setWork(toggle(work, v))}
          onClear={() => setWork([])}
          // No `maxVisible`: an AUTHORED two-member vocabulary, not a server
          // list — the cap exists for vocabularies this page does not control.
          testIdPrefix="sessions-console-work"
          title="coord.sessions.session_status — the WORK axis, orthogonal to the live/stale/closed tabs above"
        />
        <FilterChips
          label="account"
          options={accountOptions}
          selected={accounts}
          onToggle={(v) => setAccounts(toggle(accounts, v))}
          onClear={() => setAccounts([])}
          // A server vocabulary (one chip per Claude account home the fleet
          // reported), so capped like `machine`.
          maxVisible={8}
          hideWhenEmpty
          testIdPrefix="sessions-console-account"
          title="the Claude account each session ran on — coord's durable account stamp, read off the agent half"
        />
        {/* What the facets left of coord's answer — beside the facets that
            did it, so the strip above keeps the tab's numbers and this line
            carries the narrowed count. Nothing when no facet narrows. */}
        {loaded && narrowedBy.length > 0 && (
          <p
            className="text-[11px] text-muted-foreground"
            data-testid="sessions-console-scope"
          >
            showing {visible.length} of {rows.length}{" "}
            {rows.length === 1 ? "row" : "rows"} — filtered by{" "}
            {joinNames(narrowedBy)}
          </p>
        )}
      </div>

      {withheld > 0 && visible.length > 0 && (
        <WithheldNote count={withheld} testId="sessions-console-withheld" />
      )}

      <RecordList
        items={visible}
        itemKey={(r, i) => r.id || `row-${i}`}
        // `loaded || readFailed`, not `loaded`. `RecordList`'s skeleton arm
        // means "the data has not arrived YET", and after a failed first read
        // that is no longer true — it is not coming until the next poll. Left
        // at `loaded` the page skeletons forever and never says why, which is
        // the one thing `readIsUnknown` exists to make sayable. The `empty`
        // slot below distinguishes the two: unknown vs measured-empty.
        loaded={loaded || readFailed}
        expandedKey={expandedKey}
        onExpandedKeyChange={setExpandedKey}
        empty={
          <EmptyState
            unknown={unknown}
            error={error}
            withheld={withheld}
            // `work` counts here for the same reason every other facet does:
            // a list emptied by "hide finished" must say a FILTER emptied it,
            // not report an idle fleet. That is the same
            // `silent-empty-is-unknown` reading the rest of this page applies —
            // "nothing matched your filter" and "there are no sessions" are
            // different sentences and the operator has to be told which.
            //
            // The server half is the question the rows ANSWERED (`answered`),
            // never the controls: between a tab click and coord's answer the
            // rows still answer the previous question, and so must this — the
            // same reading the strip and the tab counts take.
            filtered={
              answered.status !== "all" ||
              answered.query !== "" ||
              narrowedBy.length > 0
            }
          />
        }
        renderRow={(row, ctx) => (
          <SessionConsoleRow
            row={row}
            account={accountCells.of(row)}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
            rowKey={ctx.rowKey}
            machineLabel={machineLabel}
            lifecycleHalf={ceiling.lifecycle}
            now={now}
            coordinationReaders={coordinationReaders}
            readOutput={readOutput}
            listArtifacts={listArtifacts}
            revalidation={revalidation}
          />
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

function SessionConsoleRow({
  row,
  account,
  expanded,
  onToggle,
  rowKey,
  machineLabel,
  lifecycleHalf,
  now,
  coordinationReaders,
  readOutput,
  listArtifacts,
  revalidation,
}: {
  row: ConsolidatedSessionRow;
  /** The row's Account cell — derived once in the console, shared with the facet. */
  account: AccountCell;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
  machineLabel: MachineLabel;
  /** The lifecycle half's extent — what an `agent_only` row was compared against. */
  lifecycleHalf: HalfExtent;
  now?: number;
  coordinationReaders?: CoordinationReaders;
  readOutput?: OutputReader;
  listArtifacts?: ArtifactLister;
  revalidation?: SessionRevalidationOptions;
}) {
  const status = deriveSessionStatus(row, { now });
  // The WORK axis, rendered BESIDE the liveness badge rather than folded into
  // it. `null` for every row that has not declared itself finished — including
  // the ones coord served no `session_status` for, which get no marker at all
  // rather than a fabricated "unfinished" one.
  const workStatus = deriveSessionWorkStatus(row);
  const purpose = sessionPurpose(row);
  const lineage = hasAgentHalf(row);
  const timestamp = rowTimestamp(row);
  const agentId = agentSessionId(row);

  // Both stores, probed ONLY while the row is open. A 40-row fleet must not
  // issue 80 requests to draw two five-character labels — and the plan is
  // explicit that an unprobed row reads `–` because *a row that has not been
  // probed has not answered*, which is unknown, never "no transcript".
  const stores = useTranscriptStores({
    liveSessionId: row.id,
    sessionClosed: status.kind === "closed",
    claudeSessionId: agentId,
    coordSessionId: hasLifecycleHalf(row) === true ? row.id : null,
    liveApplicable: lineage,
    enabled: expanded,
    read: readOutput,
    list: listArtifacts,
  });
  const transcriptTier = liveTranscriptIndicator(stores.live);

  // Open ⇒ read once, then follow THIS session's SSE stream. No timer: the
  // console's single 10s poll refreshes the list, and a second one here would
  // race it for the same rows (Phase 4).
  const coordination = useSessionCoordination(
    row.id,
    expanded,
    coordinationReaders ?? {},
    revalidation ?? {}
  );

  return (
    <RecordRow
      identity={<span title={row.id}>{row.id.slice(0, 8)}</span>}
      rowKey={rowKey}
      attention={status.attention}
      expanded={expanded}
      onToggle={onToggle}
      data-testid="sessions-console-row"
      label={
        // The optional columns answer to the CONSOLE's width, not the
        // viewport's: beside the 256 px sidebar a 1280 px viewport leaves a
        // 976 px (61rem) console, where `md:`–`xl:` switched all six on and
        // the row outgrew its column. Budget, worst case from `lg` up: the
        // row's fixed parts ≈ 719 px (chrome 26, gaps 60, identity ~76, two
        // status badges ~170, reason ≤ 40ch ~305, time ~70, chevron 14) plus
        // the purpose's 12rem floor, then each column adds its width and a
        // 12 px gap — machine 66rem, account 78, kind 86, lineage 92,
        // transcript 98, heartbeat 105. Heartbeat goes first (it repeats the
        // time slot whenever a heartbeat exists) and machine last; none shows
        // at 61rem, and the expansion names them all (`SessionRowIdentity`).
        // The floor engages with the first column, so a row over budget clips
        // its rightmost column — the next to drop — instead of the purpose,
        // and below 66rem the purpose still truncates with an ellipsis.
        <span className="flex items-baseline gap-3 min-w-0">
          <span
            className="truncate min-w-0 @min-[66rem]:min-w-[12rem] flex-1"
            title={purpose}
            data-testid="sessions-console-row-purpose"
          >
            {purpose}
          </span>
          {/* Machine is a COLUMN, not a grouping container (§4.1). */}
          <span
            className="hidden @min-[66rem]:inline shrink-0 w-32 truncate text-xs text-muted-foreground"
            title={machineTitle(row)}
            data-testid="sessions-console-row-machine"
          >
            <MachineValue row={row} machineLabel={machineLabel} />
          </span>
          {/* The Claude account — never blank (`AccountValue`); the full
              sentence is always in the title. */}
          <span
            className="hidden @min-[78rem]:inline shrink-0 w-44 truncate text-xs"
            title={account.title}
            data-testid="sessions-console-row-account"
            data-account-state={accountState(account)}
          >
            <AccountValue account={account} />
          </span>
          <span
            className="hidden @min-[86rem]:inline shrink-0 w-28 truncate text-xs text-muted-foreground"
            data-testid="sessions-console-row-kind"
          >
            <KindValue row={row} />
          </span>
          {/* D2's cells. Each dash carries the sentence that says which
              unknown it is — "not applicable", "unknown" and "we did not look"
              are three different claims. */}
          <span
            className="hidden @min-[92rem]:inline shrink-0 w-24 truncate text-xs text-muted-foreground"
            data-testid="sessions-console-row-lineage"
          >
            {lineage === true ? (
              "lineage"
            ) : (
              <Dash
                title={
                  lineage === false
                    ? "no Claude Code session id — a transcript is not applicable to this session, not missing"
                    : "the agent half did not answer for this row — unknown, not absent"
                }
              />
            )}
          </span>
          {/* The per-row transcript indicator (Phase 2): `warm` | `cold` | `–`.
              The dash is UNKNOWN, never "no transcript" — warm rows are
              garbage-collected 7 days after a session ends and the cold object
              is the durable copy, and a row nobody probed has not answered. */}
          <span
            className="hidden @min-[98rem]:inline shrink-0 w-20 truncate text-xs text-muted-foreground"
            data-testid="sessions-console-row-transcript"
          >
            {transcriptTier.unknown ? (
              <Dash title={transcriptTier.title} />
            ) : (
              <span title={transcriptTier.title}>{transcriptTier.label}</span>
            )}
          </span>
          <span
            className="hidden @min-[105rem]:inline shrink-0 w-24 truncate text-xs text-muted-foreground tabular-nums"
            data-testid="sessions-console-row-heartbeat"
          >
            <HeartbeatValue row={row} now={now} />
          </span>
        </span>
      }
      status={
        // R2's status slot carries BOTH axes — two badges, never one merged
        // word. `closed` (liveness, muted) and `finished` (work, green ✓) are
        // the terminal words of different questions, and a row that is one and
        // not the other has to be able to say so.
        // `shrink-0` because this is a direct child of `RecordRow`'s flex row,
        // where the truncating label owns the flex — without it a narrow
        // viewport squeezes the two badges instead of the label.
        <span className="flex items-center gap-1 shrink-0">
          <StatusBadge status={status} palette={SESSION_STATUS_PALETTE} />
          {workStatus && (
            <span data-testid="sessions-console-row-work">
              <StatusBadge
                status={workStatus}
                palette={SESSION_WORK_PALETTE}
              />
            </span>
          )}
        </span>
      }
      reason={status.reason}
      time={
        <RowTime
          at={timestamp}
          verb="Last seen"
          absent={{
            label: "–",
            title: "coord recorded no timestamp for this row — unknown",
          }}
        />
      }
    >
      {/* R5 / D3: the detail expands IN PLACE, sharing this row's border.
          It names every identity column a narrow console hides, so it gets
          the same account cell and machine label the columns render. */}
      <SessionRowExpansion
        row={row}
        account={account}
        machineLabel={machineLabel}
        lifecycleHalf={lifecycleHalf}
        coordination={coordination}
        stores={stores}
        now={now}
      />
    </RecordRow>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The honest empty state — it has to name WHICH question came back empty,
 * which is exactly why `RecordList` makes the caller supply it.
 *
 * It names it by its NARROWING and its next step, and nothing else: what
 * coord's answer held is the strip's sentence, directly above ("No live
 * sessions on the fleet", "0 sessions match “q”"). Saying it here too was the
 * same fact in two places (`ux-priorities` `a-control-belongs-with-what-it-governs`,
 * the duplication tell), so an unnarrowed empty list says only how a session
 * gets here.
 */
function EmptyState({
  unknown,
  error,
  withheld,
  filtered,
}: {
  unknown: boolean;
  error: string | null;
  /** Sessions the server filter hid although their agent half matched. */
  withheld: number;
  filtered: boolean;
}) {
  if (unknown) {
    return (
      <div
        className="py-10 text-center text-sm text-muted-foreground"
        data-testid="sessions-console-unknown-state"
      >
        <p className="font-medium">Sessions could not be read</p>
        <p className="text-xs mt-1 max-w-md mx-auto">
          {error ?? "coord did not answer."} This is not a claim that there are
          no sessions.
        </p>
      </div>
    );
  }
  return (
    <div
      className="py-10 text-center text-sm text-muted-foreground"
      data-testid="sessions-console-empty"
    >
      {filtered && <p className="font-medium">No sessions match this filter</p>}
      <p className="text-xs mt-1 max-w-md mx-auto">
        {filtered
          ? "Clear a filter to widen the question."
          : "Start a session from any runner and it will surface here."}
      </p>
      {withheld > 0 && (
        <div className="mt-2 flex justify-center">
          <WithheldNote count={withheld} testId="sessions-console-empty-withheld" />
        </div>
      )}
    </div>
  );
}

/**
 * "N matches hidden by this filter" — sessions the status/machine filter
 * removed although coord's agent half matched it. Without this a session whose
 * two halves disagree (lifecycle `active`, agent `stale`) would vanish from
 * every narrowed tab with nothing counted.
 */
function WithheldNote({ count, testId }: { count: number; testId: string }) {
  return (
    <p
      className="text-xs text-amber-300/90"
      data-testid={testId}
      title="coord's agent-session half matched this filter, but the session's lifecycle half (its coord.sessions row) did not — the two halves disagree on status or machine. Widen the status tab or clear the machine filter to see them."
    >
      {count} {count === 1 ? "match" : "matches"} hidden by this filter — the
      session&apos;s two halves disagree on status or machine
    </p>
  );
}

/** The row's primary label — its declared purpose, else what identifies it. */
function sessionPurpose(row: ConsolidatedSessionRow): string {
  const intent = row.intent;
  if (intent && typeof intent === "object" && "purpose" in intent) {
    const purpose = (intent as { purpose?: unknown }).purpose;
    if (typeof purpose === "string" && purpose.trim()) return purpose.trim();
  }
  const agentName = row.agent_session?.name ?? row.agent_session?.derived_name;
  if (agentName) return agentName;
  if (row.repo) return row.branch ? `${row.repo} @ ${row.branch}` : row.repo;
  return row.id;
}

/**
 * Distinct values of one field, as `FilterChips` options with live counts.
 *
 * No `count: null` arises here: every option is derived from rows already on
 * the page, so every count IS measured. R6's dash lives in the primitive for
 * the strips whose counts are not.
 */
function facetOptions(
  rows: ConsolidatedSessionRow[],
  pick: (row: ConsolidatedSessionRow) => string | null
): FilterChipOption<string>[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = pick(row);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, count]) => ({ value, label: value, count }));
}

function countClass(
  rows: ConsolidatedSessionRow[],
  cls: ConsolidatedSessionRow["row_class"]
): number {
  return rows.filter((r) => (r.row_class ?? null) === (cls ?? null)).length;
}

/** `a`, `a and b`, `a, b and c`. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function toggle(selected: string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value];
}
