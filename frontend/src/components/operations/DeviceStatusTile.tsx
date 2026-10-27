"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import {
  NAVIGATION_ONLY_PROPS,
  UNKNOWN_AMBER,
  readIsUnknown,
} from "@/components/console";
import {
  MachineName,
  RedactedText,
  usePresentationMode,
} from "@/components/presentation";
import { formatStallAge, relativeTime } from "./utils";
import type { DeviceStatus, StalledSession } from "./types";
import type { UseDeviceStatusStreamResult } from "./useDeviceStatusStream";

type Staleness = "fresh" | "warn" | "stale";

function classifyAge(updatedAt: string): Staleness {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageMin = ageMs / 60_000;
  if (ageMin < 5) return "fresh";
  if (ageMin < 15) return "warn";
  return "stale";
}

function rowTintClass(staleness: Staleness): string {
  // Mirrors MachineCard.tsx's healthy/warn/danger gradient (lines 84-89):
  // healthy=green, warn=yellow, danger=red. Using the same Tailwind
  // utilities keeps the visual vocabulary of the page consistent.
  switch (staleness) {
    case "fresh":
      return "bg-muted/40";
    case "warn":
      return "bg-yellow-500/10";
    case "stale":
      return "bg-red-500/10";
  }
}

function rowTextClass(staleness: Staleness): string {
  if (staleness === "stale") return "text-red-300";
  if (staleness === "warn") return "text-yellow-200";
  return "text-foreground";
}

function identityLabel(row: DeviceStatus): string {
  if (row.hostname && row.hostname.length > 0) return row.hostname;
  return row.device_id.slice(0, 8) + "…";
}

function repoBranchLabel(row: DeviceStatus): string | null {
  if (row.current_repo && row.current_branch) {
    return `${row.current_repo}:${row.current_branch}`;
  }
  return row.current_repo ?? row.current_branch ?? null;
}

/**
 * If a MachineCard with the same hostname exists above this tile, scroll
 * it into view and flash a highlight ring. Cheap UX win for the operator
 * jumping from "this device is doing X" to the runner detail card.
 */
function focusMachineCard(hostname: string | null) {
  if (!hostname) return;
  const card = document.querySelector(
    `[data-operations-machine-card][data-hostname="${CSS.escape(hostname)}"]`
  );
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("ring-2", "ring-primary", "ring-offset-2");
  window.setTimeout(() => {
    card.classList.remove("ring-2", "ring-primary", "ring-offset-2");
  }, 1500);
}

/**
 * Phase 5 (plan `2026-06-24-coord-session-progress-and-stall-detection`) —
 * the per-device stalled-session indicator. Mirrors the page's warn/danger
 * color vocabulary (yellow=warn / red=danger, see `rowTintClass` above):
 *
 * - `expected_unstarted` (a dispatched continuation that never started) is the
 *   more severe "lost work" case → red, labeled "dispatched, never started".
 * - an active-but-not-progressing stall → amber/yellow "stalled".
 *
 * The age comes precomputed from coord (`stall_age_secs`), so we format it with
 * `formatStallAge` rather than `relativeTime` (which expects a timestamp). When
 * more than one session is stalled on the device, the badge surfaces the
 * most-stalled one plus a "+N" suffix. Renders nothing when the device has no
 * stalled session (or coord predates Phase 5 and omits the field).
 */
function StalledBadge({
  mostStalled,
  count,
}: {
  mostStalled: StalledSession | null | undefined;
  count: number | undefined;
}) {
  const { presenting } = usePresentationMode();
  if (!mostStalled || !count || count < 1) return null;

  const isUnstarted = mostStalled.kind === "expected_unstarted";
  const age = formatStallAge(mostStalled.stall_age_secs);
  const label = isUnstarted ? `never started ${age}` : `stalled ${age}`;
  const extra = count > 1 ? ` +${count - 1}` : "";
  // The gate id, work-unit slug and topic name the operator's plans; an
  // outsider gets the stall and its age (D3.3).
  const tip = isUnstarted
    ? `Dispatched continuation never started (${age} ago)` +
      (!presenting && mostStalled.continuation_gate_id
        ? ` — gate ${mostStalled.continuation_gate_id}`
        : "") +
      (!presenting && mostStalled.work_unit_slug
        ? ` — work unit ${mostStalled.work_unit_slug}`
        : "")
    : `Session heartbeating but not progressing for ${age}` +
      (!presenting && mostStalled.correlation_topic
        ? ` — topic ${mostStalled.correlation_topic}`
        : "");

  // Mirror the danger/warn tints used elsewhere on the page; keep the chip
  // outline-styled like the sibling badges (header count / error badge).
  const tone = isUnstarted
    ? "border-red-500/50 bg-red-500/10 text-red-300"
    : "border-yellow-500/50 bg-yellow-500/10 text-yellow-200";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${tone}`}
          data-ui-bridge-id="operations.device-status-stalled"
          data-stall-kind={mostStalled.kind}
          data-stall-count={count}
        >
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {label}
          {extra}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px] max-w-[18rem]">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/** A row's staleness in plain words — the presented task descriptor's status. */
const STALENESS_WORD: Record<Staleness, string> = {
  fresh: "current",
  warn: "quiet",
  stale: "stale",
};

/**
 * One device-status row as an outsider sees it (plan
 * `2026-10-23-console-presentation-spaces` D3.3): the machine's alias, its
 * task only when provably the tenant's own (otherwise a descriptor), any
 * stall, and the age. No device id in any attribute or tooltip, no repository
 * or branch, no free text, and no jump button — its target is keyed on the
 * hostname, which presentation mode does not put in the page.
 */
function PresentedStatusRow({
  row,
  staleness,
}: {
  row: DeviceStatus;
  staleness: Staleness;
}) {
  return (
    <li
      data-ui-bridge-id="operations.device-status-row"
      data-staleness={staleness}
      className={`grid grid-cols-[10rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border/40 px-3 py-2 text-sm ${rowTintClass(staleness)} ${rowTextClass(staleness)}`}
    >
      <span
        className="font-medium truncate"
        data-ui-bridge-id="operations.device-status-identity"
      >
        <MachineName
          identity={{ deviceId: row.device_id, hostname: row.hostname }}
        />
      </span>
      <span
        className="truncate text-foreground/90"
        data-ui-bridge-id="operations.device-status-task"
      >
        {row.current_task ? (
          <RedactedText
            text={row.current_task}
            repo={row.current_repo}
            descriptor={{
              kind: "Task",
              status: STALENESS_WORD[staleness],
              at: row.updated_at,
            }}
          />
        ) : (
          <span className="text-muted-foreground italic">idle</span>
        )}
      </span>
      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        <StalledBadge
          mostStalled={row.most_stalled_session}
          count={row.stalled_session_count}
        />
        <span
          className="tabular-nums"
          data-ui-bridge-id="operations.device-status-updated-at"
          title={new Date(row.updated_at).toLocaleString()}
        >
          {relativeTime(row.updated_at)}
        </span>
      </div>
    </li>
  );
}

/**
 * What the tile can say about the fleet's list, from the stream's own flags —
 * style guide R6's arms, keyed on whether a fleet read has ANSWERED
 * (`everSeeded`, through `readIsUnknown`), never on the list being empty:
 *
 * - `unknown` — the latest fleet read failed and none has ever answered, so
 *   whether any machine reported is not known. The count is "unknown", never
 *   `0`, and an empty list says it could not be read — never that nothing
 *   reported (plan `2026-10-23-console-presentation-spaces` D3; served policy
 *   `verification-and-evidence` `silent-empty-is-unknown`).
 * - `stale` — a fleet read answered earlier and the latest one failed. The
 *   list holds that answer's rows (and any pushed since); its count stands,
 *   but an empty one says so in the past tense, qualified by the failure.
 * - `loading` — nothing has failed, and no fleet read has answered yet. Its
 *   count is a dash (R6: a count nobody fetched is `–`, never `0`).
 * - `answered` — the latest fleet read answered: the count and the empty
 *   sentence are present-tense facts.
 */
type DeviceStatusListState = "unknown" | "stale" | "loading" | "answered";

function deviceStatusListState({
  error,
  seeded,
  everSeeded,
}: Pick<
  UseDeviceStatusStreamResult,
  "error" | "seeded" | "everSeeded"
>): DeviceStatusListState {
  const failed = error !== null;
  if (readIsUnknown(everSeeded, failed)) return "unknown";
  if (failed) return "stale";
  // `everSeeded` as well as `seeded`: a stream that has settled without a
  // read ever answering (which the hook never reports) still never reads as
  // an answered empty list.
  if (!seeded || !everSeeded) return "loading";
  return "answered";
}

/** The header's count: a number only once a fleet read has answered. */
function deviceStatusCount(
  state: DeviceStatusListState,
  rows: number
): string | number {
  if (state === "unknown") return "unknown";
  if (state === "loading") return "–";
  return rows;
}

/**
 * The tile's body when it holds no row: one arm per list state, so the list
 * is said to be empty only over a read that answered it. This is where the
 * absence claim is made in words (R6's `empty=` slot), so a failed read never
 * reaches the present-tense sentence. While presenting, a failure is said in
 * fixed words — the read's own text can quote a URL or name a machine.
 */
function EmptyDeviceStatusList({
  state,
  error,
  presenting,
}: {
  state: DeviceStatusListState;
  error: string | null;
  presenting: boolean;
}) {
  switch (state) {
    case "loading":
      return (
        <p className="text-xs text-muted-foreground italic px-2 py-3">
          Loading device status&hellip;
        </p>
      );
    case "unknown":
      return (
        <div
          role="status"
          className={`rounded-md border p-3 text-xs ${UNKNOWN_AMBER}`}
          data-testid="device-status-unknown"
        >
          {presenting ? (
            "UNKNOWN — the machines' status reports could not be read, so whether any machine has reported what it is working on is not known."
          ) : (
            <>
              UNKNOWN — the device-status read failed ({error}). Whether any
              device is reporting status is not known; this is not an empty
              list.
            </>
          )}
        </div>
      );
    case "stale":
      // Nothing is wrong with the machines, so the muted tone stays; the
      // sentence is past tense and says the latest read failed, because the
      // last answer is not now.
      return (
        <div
          className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground"
          data-testid="device-status-stale-empty"
        >
          {presenting ? (
            "No machine had reported what it is working on at the last read that succeeded. The latest read failed, so whether one has reported since is not known."
          ) : (
            <>
              No devices were reporting status at the last read that answered.
              The latest read failed ({error}), so this may be out of date.
            </>
          )}
        </div>
      );
    case "answered":
      return (
        <div
          className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground"
          data-testid="device-status-empty"
        >
          {/* The route agents post to is the operator's; an outsider reads
              what the empty list means. Rows older than an hour are pruned,
              so empty is "nothing reported in the last hour". */}
          {presenting ? (
            "No machine has reported what it is working on in the last hour."
          ) : (
            <>
              No devices reporting status. Agents post here voluntarily via{" "}
              <code className="bg-muted px-1 rounded">POST /coord/status</code>;
              rows older than 1h are pruned.
            </>
          )}
        </div>
      );
  }
}

/**
 * Bottom-of-page device-status list. Renders the SAME tenant-scoped
 * stream the Dev Ops page holds (`useDeviceStatusStream` —
 * authenticated REST seed via `/api/v1/operations/device-status` +
 * the coord WS bridge), passed down through `FleetOverview` as a prop
 * so the page keeps one stream/WS instance.
 *
 * History: this tile used to fetch coord's `GET /coord/status` directly
 * through the `/coord-api/*` Next rewrite with `credentials: "omit"`,
 * and opened its own anonymous coord WS on a since-deleted
 * `NEXT_PUBLIC_COORD_WS_URL` envvar. Coord's `GET /coord/status` became
 * operator-auth fail-closed (fleet-auth P4), so the direct call 403'd
 * (`tenant_not_resolved`) and the tile silently emptied. Routing through
 * the web-backend proxy forwards the operator bearer and keeps the
 * tenant scoping server-side. No browser code dials coord's WS any more:
 * the last two direct subscribers (strategy, merge pipeline) moved onto
 * the backend's `coord-events/ws` bridge when coord's `/ws` went
 * authenticated.
 */
export function DeviceStatusTile({
  stream,
}: {
  stream: UseDeviceStatusStreamResult;
}) {
  const { byHostname, connected, error, refetch } = stream;
  const { presenting } = usePresentationMode();
  const listState = deviceStatusListState(stream);
  const [, setNowTick] = useState(0);

  // Tick every 15s so the relative-time labels and staleness tints
  // refresh without waiting on a server event.
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const sortedRows = useMemo(
    () =>
      [...byHostname.values()].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      ),
    [byHostname]
  );

  return (
    <section
      className="rounded-lg border border-border bg-card/30 p-4"
      data-ui-bridge-id="operations.device-status-tile"
    >
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Device status
          </h2>
          <Badge
            variant="outline"
            className={
              listState === "unknown"
                ? `text-[10px] ${UNKNOWN_AMBER}`
                : "text-[10px]"
            }
            data-testid="device-status-count"
            data-device-status-list={listState}
          >
            {deviceStatusCount(listState, sortedRows.length)}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {connected ? (
            <>
              <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
              <span data-ui-bridge-id="operations.device-status-connection">
                live
              </span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-yellow-400" />
              <span
                className="text-yellow-300"
                data-ui-bridge-id="operations.device-status-connection"
              >
                {/* The transport is the operator's to know. An outsider reads
                    what the stream does while the socket is down: it re-reads
                    the list on its fallback poll
                    (`DEVICE_STATUS_POLL_FALLBACK_MS`, 5 s; this tile's test
                    holds it under 10 s) — never that the list stopped. A
                    re-read that fails is said by the error badge and by the
                    count and body (unknown, or a past-tense stale list), so
                    these words hold whether or not a re-read succeeds. */}
                {presenting
                  ? "re-read every few seconds"
                  : "polling (WS offline)"}
              </span>
            </>
          )}
          {error && (
            <Badge variant="destructive" className="text-[10px]">
              error
            </Badge>
          )}
          <button
            // A re-read: it changes only what is displayed (D3.2).
            {...NAVIGATION_ONLY_PROPS}
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30"
            data-ui-bridge-id="operations.device-status-refresh"
            aria-label="Refresh device status"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </header>

      {sortedRows.length === 0 ? (
        <EmptyDeviceStatusList
          state={listState}
          error={error}
          presenting={presenting}
        />
      ) : (
        <ul
          className="flex flex-col gap-1.5"
          data-ui-bridge-id="operations.device-status-list"
        >
          {sortedRows.map((row) => {
            const staleness = classifyAge(row.updated_at);
            if (presenting) {
              return (
                <PresentedStatusRow
                  key={row.device_id}
                  row={row}
                  staleness={staleness}
                />
              );
            }
            const repoBranch = repoBranchLabel(row);
            const identity = identityLabel(row);
            return (
              <li
                key={row.device_id}
                data-ui-bridge-id="operations.device-status-row"
                data-device-id={row.device_id}
                data-staleness={staleness}
                className={`grid grid-cols-[10rem_minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border/40 px-3 py-2 text-sm ${rowTintClass(staleness)} ${rowTextClass(staleness)}`}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => focusMachineCard(row.hostname)}
                      className="text-left font-medium truncate hover:underline disabled:cursor-default disabled:no-underline"
                      disabled={!row.hostname}
                      data-ui-bridge-id="operations.device-status-identity"
                    >
                      {identity}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="font-mono text-[11px]">
                    {row.device_id}
                  </TooltipContent>
                </Tooltip>

                <span
                  className="truncate text-foreground/90"
                  data-ui-bridge-id="operations.device-status-task"
                >
                  {row.current_task ?? (
                    <span className="text-muted-foreground italic">idle</span>
                  )}
                </span>

                <span
                  className="truncate font-mono text-xs text-muted-foreground"
                  data-ui-bridge-id="operations.device-status-repo-branch"
                >
                  {repoBranch ?? ""}
                </span>

                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                  <StalledBadge
                    mostStalled={row.most_stalled_session}
                    count={row.stalled_session_count}
                  />
                  {row.free_text && (
                    <span
                      className="italic max-w-[14rem] truncate"
                      data-ui-bridge-id="operations.device-status-free-text"
                      title={row.free_text}
                    >
                      {row.free_text}
                    </span>
                  )}
                  <span
                    className="tabular-nums"
                    data-ui-bridge-id="operations.device-status-updated-at"
                    title={new Date(row.updated_at).toLocaleString()}
                  >
                    {relativeTime(row.updated_at)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
