"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
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
    `[data-operations-machine-card][data-hostname="${CSS.escape(hostname)}"]`,
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
  if (!mostStalled || !count || count < 1) return null;

  const isUnstarted = mostStalled.kind === "expected_unstarted";
  const age = formatStallAge(mostStalled.stall_age_secs);
  const label = isUnstarted ? `never started ${age}` : `stalled ${age}`;
  const extra = count > 1 ? ` +${count - 1}` : "";
  const tip = isUnstarted
    ? `Dispatched continuation never started (${age} ago)` +
      (mostStalled.continuation_gate_id
        ? ` — gate ${mostStalled.continuation_gate_id}`
        : "") +
      (mostStalled.plan_slug ? ` — plan ${mostStalled.plan_slug}` : "")
    : `Session heartbeating but not progressing for ${age}` +
      (mostStalled.correlation_topic
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

/**
 * Bottom-of-page device-status list. Renders the SAME tenant-scoped
 * stream `FleetOverview` already holds (`useDeviceStatusStream` —
 * authenticated REST seed via `/api/v1/operations/device-status` +
 * the coord WS bridge), passed down as a prop so the page keeps one
 * stream/WS instance.
 *
 * History: this tile used to fetch coord's `GET /coord/status` directly
 * through the `/coord-api/*` Next rewrite with `credentials: "omit"`,
 * and opened its own anonymous coord WS
 * (`NEXT_PUBLIC_COORD_WS_URL`, default `ws://localhost:9870/ws`).
 * Coord's `GET /coord/status` became operator-auth fail-closed
 * (fleet-auth P4), so the direct call 403'd (`tenant_not_resolved`)
 * and the tile silently emptied. Routing through the web-backend
 * proxy forwards the operator bearer and keeps the tenant scoping
 * server-side.
 */
export function DeviceStatusTile({
  stream,
}: {
  stream: UseDeviceStatusStreamResult;
}) {
  const { byHostname, connected, error, seeded, refetch } = stream;
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
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
    [byHostname],
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
          <Badge variant="outline" className="text-[10px]">
            {sortedRows.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {connected ? (
            <>
              <span
                className="h-2 w-2 rounded-full bg-green-500"
                aria-hidden
              />
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
                polling (WS offline)
              </span>
            </>
          )}
          {error && (
            <Badge variant="destructive" className="text-[10px]">
              error
            </Badge>
          )}
          <button
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

      {!seeded && sortedRows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-2 py-3">
          Loading device status&hellip;
        </p>
      ) : sortedRows.length === 0 ? (
        <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground">
          No devices reporting status. Agents post here voluntarily via{" "}
          <code className="bg-muted px-1 rounded">POST /coord/status</code>;
          rows older than 1h are pruned.
        </div>
      ) : (
        <ul
          className="flex flex-col gap-1.5"
          data-ui-bridge-id="operations.device-status-list"
        >
          {sortedRows.map((row) => {
            const staleness = classifyAge(row.updated_at);
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
                    <span className="text-muted-foreground italic">
                      idle
                    </span>
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
