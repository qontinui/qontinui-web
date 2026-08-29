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
 * ## Absence is not zero (D2)
 *
 * A `lifecycle_only` row renders `–` for transcript/lineage, never "none". An
 * `agent_only` row renders `–` for heartbeat/state, never `false`, `0` or
 * "closed". A row whose `row_class` is `null` renders `–` for BOTH. Each dash
 * carries a `title` saying which unknown it is, because "not applicable",
 * "unknown" and "we did not look" are three different sentences and a bare
 * dash is only honest if the reader can find out which one it means.
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
  rowAccentClass,
  staleDetail,
  type FilterChipOption,
  type HealthBadge,
  type Stat,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import { listConsolidatedSessions } from "./api";
import {
  SESSION_STATUS_PALETTE,
  agentSessionId,
  compareSessionRows,
  deriveSessionStatus,
  deriveSessionsHealth,
  hasAgentHalf,
  hasLifecycleHalf,
  lastHeartbeatAt,
  lifecycleState,
  rowTimestamp,
  type ConsolidatedSessionRow,
  type ConsolidatedSessionsResponse,
} from "./sessionConsoleStatus";
import {
  SessionRowExpansion,
  useSessionCoordination,
  type CoordinationReaders,
} from "./SessionRowExpansion";
import { useTranscriptStores } from "./TranscriptStores";
import {
  liveTranscriptIndicator,
  type ArtifactLister,
  type OutputReader,
} from "./transcriptStores";

/**
 * One list poll, and the cadence is a stated decision rather than an accident:
 * a 15s heartbeat that goes stale at 45s does not need a 5s poll, and the
 * three surfaces this consolidates ran 5s / 10s / debounced-300ms between
 * them. 10s is the slower of the two list polls. Plan Phase 4 collapses the
 * remaining pollers onto this one.
 */
const POLL_INTERVAL_MS = 10_000;

/** Keystroke settle before `?q=` goes on the wire. Same 300ms
 *  `/environments/sessions` already pays for this read. */
const QUERY_DEBOUNCE_MS = 300;

/** The status filter's vocabulary — coord's own agent-session words. */
type StatusTab = "all" | "live" | "stale" | "closed";

const STATUS_TABS: ReadonlyArray<{ id: StatusTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "stale", label: "Stale" },
  { id: "closed", label: "Closed" },
];

/** The dash D2 requires, with the sentence that says WHICH unknown it is. */
function Dash({ title }: { title: string }) {
  return (
    <span
      className="text-muted-foreground/70 tabular-nums"
      title={title}
      data-testid="sessions-console-unknown"
    >
      –
    </span>
  );
}

export interface SessionsConsoleProps {
  /** device_id → hostname, from the live device-status stream. */
  hostnameFor?: (deviceId: string) => string | undefined;
  /** Initial `?device=` deep link — `/environments/sessions?device=` maps here. */
  initialDevice?: string;
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
}

export function SessionsConsole({
  hostnameFor,
  initialDevice,
  pollEnabled = true,
  fetcher,
  now,
  coordinationReaders,
  readOutput,
  listArtifacts,
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

  const [status, setStatus] = useState<StatusTab>("all");
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
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // `?device=` is a deep link, so it is a SERVER filter (it narrows both halves
  // of the join coord-side) while the machine chips are a client facet over
  // what came back. Held in a ref because it never changes after mount today —
  // Phase 3's redirect is what supplies it.
  const deviceRef = useRef(initialDevice);
  deviceRef.current = initialDevice;

  useEffect(() => {
    const id = window.setTimeout(() => setAppliedQuery(query.trim()), QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

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

  useEffect(() => {
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    if (!pollEnabled) return () => ctrl.abort();
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [refresh, pollEnabled]);

  const rows = useMemo(() => payload?.sessions ?? [], [payload]);
  const agentHalfFailed = payload?.agent_half?.read === "failed";

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
      return true;
    });
    return [...filtered].sort((a, b) => compareSessionRows(a, b, { now }));
  }, [rows, kinds, providers, machines, now]);

  const health = useMemo(
    () =>
      deriveSessionsHealth(visible, {
        readUnknown: unknown,
        agentHalfFailed,
        options: { now },
      }),
    [visible, unknown, agentHalfFailed, now]
  );

  // ---- R6: counts are `null` while unknown, NEVER 0 ---------------------
  //
  // The status tabs are a SERVER filter, so only the active tab's count is
  // measured; the others have not been fetched and a `0` on them would be the
  // `silent-empty-is-unknown` mistake with a number attached. `FilterTabs`
  // renders `null` as `–`.
  const tabs = STATUS_TABS.map((t) => ({
    id: t.id,
    label: t.label,
    count: unknown || t.id !== status ? null : visible.length,
    attention: t.id === status && (health.attention ?? 0) > 0,
  }));

  const stats: Stat[] = [
    { key: "rows", label: "rows ", value: unknown ? null : visible.length },
    { key: "machines", label: "machines ", value: health.machines },
    {
      key: "linked",
      label: "linked ",
      value: unknown ? null : countClass(visible, "linked"),
      title: "coord.sessions row bridged to its coord.agent_sessions row",
    },
    {
      key: "lifecycle",
      label: "lifecycle-only ",
      value: unknown ? null : countClass(visible, "lifecycle_only"),
      title:
        "no Claude Code session id, so no agent-session row can exist — transcript and lineage are not applicable",
      tone: "muted",
    },
    {
      key: "agent",
      label: "agent-only ",
      value: unknown ? null : countClass(visible, "agent_only"),
      title:
        "an allocated agent session no coord.sessions row bridges — heartbeat and state are unknown, not closed",
      tone: "muted",
    },
    {
      key: "unresolved",
      label: "unresolved ",
      value: unknown ? null : countClass(visible, null),
      title:
        "the read landed but the agent half did not answer for these rows — unknown, not zero",
      tone: (health.unknownJoin ?? 0) > 0 ? "warning" : "muted",
    },
  ];

  const badges: HealthBadge[] = [
    {
      key: "attention",
      label: `needs a person ${health.attention ?? "–"}`,
      tone: (health.attention ?? 0) > 0 ? "attention" : "muted",
    },
    { key: "active", label: `active ${health.active ?? "–"}`, tone: "muted" },
    {
      key: "updated",
      label: `updated ${relativeTime(lastUpdated, { absent: "never", now })}`,
      tone: "muted",
      title: stale ? "the last refresh failed" : undefined,
    },
  ];

  return (
    <div className="space-y-3" data-ui-bridge-id="sessions.console">
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

      <FilterTabs
        tabs={tabs}
        active={status}
        onChange={setStatus}
        testIdPrefix="sessions-console-status"
        query={query}
        onQueryChange={setQuery}
        queryPlaceholder="Filter sessions…"
        queryTestId="sessions-console-query"
      />

      <div className="flex flex-col gap-1">
        <FilterChips
          label="kind"
          options={kindOptions}
          selected={kinds}
          onToggle={(v) => setKinds(toggle(kinds, v))}
          onClear={() => setKinds([])}
          maxVisible={8}
          testIdPrefix="sessions-console-kind"
        />
        <FilterChips
          label="provider"
          options={providerOptions}
          selected={providers}
          onToggle={(v) => setProviders(toggle(providers, v))}
          onClear={() => setProviders([])}
          maxVisible={8}
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
          testIdPrefix="sessions-console-machine"
        />
      </div>

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
            filtered={
              status !== "all" ||
              appliedQuery !== "" ||
              kinds.length + providers.length + machines.length > 0
            }
          />
        }
        renderRow={(row, ctx) => (
          <SessionConsoleRow
            row={row}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
            rowKey={ctx.rowKey}
            machineLabel={machineLabel}
            now={now}
            coordinationReaders={coordinationReaders}
            readOutput={readOutput}
            listArtifacts={listArtifacts}
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
  expanded,
  onToggle,
  rowKey,
  machineLabel,
  now,
  coordinationReaders,
  readOutput,
  listArtifacts,
}: {
  row: ConsolidatedSessionRow;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
  machineLabel: (deviceId: string | null | undefined) => string | null;
  now?: number;
  coordinationReaders?: CoordinationReaders;
  readOutput?: OutputReader;
  listArtifacts?: ArtifactLister;
}) {
  const status = deriveSessionStatus(row, { now });
  const machine = machineLabel(row.device_id);
  const kind = row.session_kind ?? null;
  const purpose = sessionPurpose(row);
  const lineage = hasAgentHalf(row);
  const beat = lastHeartbeatAt(row);
  const state = lifecycleState(row);
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

  const coordination = useSessionCoordination(
    row.id,
    expanded,
    coordinationReaders ?? {}
  );

  return (
    <RecordRow
      identity={<span title={row.id}>{row.id.slice(0, 8)}</span>}
      rowKey={rowKey}
      accent={rowAccentClass(status)}
      expanded={expanded}
      onToggle={onToggle}
      data-testid="sessions-console-row"
      label={
        <span className="flex items-baseline gap-3 min-w-0">
          <span className="truncate min-w-0 flex-1" title={purpose}>
            {purpose}
          </span>
          {/* Machine is a COLUMN, not a grouping container (§4.1). */}
          <span
            className="hidden md:inline shrink-0 w-32 truncate text-xs text-muted-foreground"
            title={row.device_id ? String(row.device_id) : "no device recorded"}
            data-testid="sessions-console-row-machine"
          >
            {machine ?? <Dash title="coord recorded no device for this row" />}
          </span>
          <span
            className="hidden lg:inline shrink-0 w-28 truncate text-xs text-muted-foreground"
            data-testid="sessions-console-row-kind"
          >
            {kind ?? (
              <Dash
                title={
                  hasLifecycleHalf(row) === false
                    ? "no coord.sessions row, so no session kind — unknown, not absent"
                    : "coord served no session kind for this row"
                }
              />
            )}
          </span>
          {/* D2's cells. Each dash carries the sentence that says which
              unknown it is — "not applicable", "unknown" and "we did not look"
              are three different claims. */}
          <span
            className="hidden lg:inline shrink-0 w-24 truncate text-xs text-muted-foreground"
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
            className="hidden lg:inline shrink-0 w-20 truncate text-xs text-muted-foreground"
            data-testid="sessions-console-row-transcript"
          >
            {transcriptTier.unknown ? (
              <Dash title={transcriptTier.title} />
            ) : (
              <span title={transcriptTier.title}>{transcriptTier.label}</span>
            )}
          </span>
          <span
            className="hidden xl:inline shrink-0 w-24 truncate text-xs text-muted-foreground tabular-nums"
            data-testid="sessions-console-row-heartbeat"
          >
            {state === null ? (
              <Dash
                title={
                  hasLifecycleHalf(row) === false
                    ? "no coord.sessions row — heartbeat and state are unknown for this row, NOT closed"
                    : "the join half for this row is unresolved — unknown, not closed"
                }
              />
            ) : beat === null ? (
              <Dash title="active, but coord has recorded no heartbeat yet" />
            ) : (
              relativeTime(beat, { absent: "–", now })
            )}
          </span>
        </span>
      }
      status={<StatusBadge status={status} palette={SESSION_STATUS_PALETTE} />}
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
      {/* R5 / D3: the detail expands IN PLACE, sharing this row's border. */}
      <SessionRowExpansion
        row={row}
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
 */
function EmptyState({
  unknown,
  error,
  filtered,
}: {
  unknown: boolean;
  error: string | null;
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
      <p className="font-medium">
        {filtered ? "No sessions match this filter" : "No sessions on the fleet"}
      </p>
      <p className="text-xs mt-1 max-w-md mx-auto">
        {filtered
          ? "coord answered — nothing matched. Clear a filter to widen the question."
          : "Start a session from any runner and it will surface here."}
      </p>
    </div>
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

function toggle(selected: string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value];
}
