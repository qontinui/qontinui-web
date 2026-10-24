"use client";

/**
 * /admin/coord/spawns — every spawn coord was asked to place: where it went,
 * how long it waited, and how it ended.
 *
 * Plan `2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration`
 * Phase 5; its D7 defines every number shown. Reads coord's spawn ledger
 * (`GET /coord/spawns`, `/stats`, `/{id}`, the plan's Phase 2) through the web
 * backend's passthrough proxies (`useSpawnLedger`), names devices from the
 * `/fleet/health` roster and gives each its dispatch role from
 * `/fleet/dispatch-roles`. The launcher that CREATES a spawn is a different
 * page, `/admin/coord/spawn` ("Launch session"), and this page links to it.
 *
 * ## What this page will not say
 *
 * - **"No spawns" when the ledger is not deployed.** coord answers
 *   `{available: false}` while its tables are absent, and the page says
 *   exactly that — the strip, the list and the chart all read UNKNOWN.
 * - **0 for a number coord could not state.** A share over no ended request, a
 *   percentile over no started one, a device with no wait sample: `unknown`.
 * - **"Finished" for a session whose outcome nobody reported.** The row status
 *   is the gates page's continuation vocabulary: `spawned` is not success.
 * - **That nothing is waiting because the window holds no waiting request.**
 *   The requests still waiting are read whatever their age, oldest first,
 *   and listed; a cut at coord's page bound is said, with the total.
 * - **"Efficiency".** Requested per hour against started per hour, by name.
 *
 * Console style (`frontend/docs/console-ui-style-guide.md`, §3.8 for this
 * page): no page title (R9), strip first (R1), per-device share list, filter
 * tabs with live counts (R6), one line per request (R2) whose detail expands
 * in place (R5), and the rate chart collapsible (R7).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Rocket, Server } from "lucide-react";
import {
  FilterTabs,
  HealthStrip,
  RecordList,
  RefreshButton,
  ShareList,
} from "@/components/console";
import { describeRole } from "@/components/operations/fleetDispatchRoles";
import { useFleetDispatchRoles } from "@/components/operations/useFleetDispatchRoles";
import { useFleetHealth } from "@/components/operations/useFleetHealth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SpawnStatsWindow } from "@/lib/api/operations/coordSpawns";
import { SpawnRateChart } from "./_components/SpawnRateChart";
import { SpawnRow } from "./_components/SpawnRow";
import {
  SPAWN_FILTERS,
  SPAWN_WINDOWS,
  deriveSpawnsHealth,
  hourlyRates,
  isSpawnRow,
  matchesSpawnFilter,
  mergeSpawnRows,
  perDeviceShares,
  spawnFilterAnswered,
  spawnFilterCounts,
  spawnFilterEmptyText,
  spawnFilterUnknownText,
  spawnIssueText,
  windowSpec,
  type DeviceRoles,
  type SpawnFilter,
} from "./_lib/spawnStatus";
import { SPAWNS_POLL_MS, useSpawnLedger } from "./_lib/useSpawnLedger";

/** The launcher this page reports on — relabelled "Launch session" in the nav. */
const LAUNCH_SESSION_HREF = "/admin/coord/spawn";

function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "an unknown time" : d.toLocaleString();
}

export default function CoordSpawnsPage() {
  const [windowId, setWindowId] = useState<SpawnStatsWindow>("7d");
  const [filter, setFilter] = useState<SpawnFilter>("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const ledger = useSpawnLedger(windowId);
  const fleet = useFleetHealth();
  const dispatchRoles = useFleetDispatchRoles();
  const roster = useMemo(() => fleet.data?.devices ?? [], [fleet.data]);
  const spec = windowSpec(windowId);

  const roles = useMemo<DeviceRoles>(() => {
    const read = dispatchRoles.read;
    if (read.state === "loading") {
      return {
        kind: "unknown",
        reason: "the dispatch-role read has not answered yet",
      };
    }
    if (read.state === "unknown")
      return { kind: "unknown", reason: read.reason };
    const byDevice = new Map<string, string>();
    for (const m of read.machines) {
      if (m.deviceId) byDevice.set(m.deviceId, describeRole(m));
    }
    return { kind: "known", byDevice };
  }, [dispatchRoles.read]);

  // The page's clock: a waiting request's age grows by TIME, and the request
  // nobody picks up is exactly the one that sends nothing to re-render the
  // page.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const list = ledger.list.data;
  const pending = ledger.pending.data;
  const rows = useMemo(
    () => mergeSpawnRows(list?.items ?? null, pending?.items ?? null),
    [list, pending]
  );
  const unreadableRows = [
    ...(list?.items ?? []),
    ...(pending?.items ?? []),
  ].filter((r) => !isSpawnRow(r)).length;
  // Which read each tab's answer rests on: a tab whose read did not answer
  // has no count and no "none" sentence, whatever the other read brought.
  const reads = useMemo(
    () => ({ list: list !== null, pending: pending !== null }),
    [list, pending]
  );
  const counts = useMemo(() => spawnFilterCounts(rows, reads), [rows, reads]);
  const visible = useMemo(
    () => (rows ?? []).filter((r) => matchesSpawnFilter(r, filter)),
    [rows, filter]
  );
  const health = useMemo(
    () =>
      deriveSpawnsHealth({
        stats: ledger.stats.data,
        issue: ledger.stats.issue,
        window: windowId,
        rows,
        nowMs,
        clock: clockTime,
      }),
    [ledger.stats.data, ledger.stats.issue, windowId, rows, nowMs]
  );
  const shares = useMemo(
    () =>
      ledger.stats.data
        ? perDeviceShares(ledger.stats.data, roster, roles)
        : null,
    [ledger.stats.data, roster, roles]
  );
  const series = useMemo(
    () => (list ? hourlyRates(list, spec.ms) : null),
    [list, spec.ms]
  );
  const listIssue = ledger.list.issue;
  const pendingIssue = ledger.pending.issue;
  const stale = listIssue !== null || pendingIssue !== null;

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-spawns-page"
      data-ui-bridge-id="coord-spawns-page"
    >
      <HealthStrip
        data-testid="coord-spawns-health"
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
      />

      <div className="flex flex-wrap items-center gap-2">
        <RefreshButton
          onRefresh={ledger.refresh}
          label="Refresh spawns"
          title={`Re-reads the spawn ledger from coord now; the page also refreshes itself every ${SPAWNS_POLL_MS / 1000} s`}
          data-testid="coord-spawns-refresh"
        />
        <Select
          value={windowId}
          onValueChange={(v) => {
            setWindowId(v as SpawnStatsWindow);
            setExpandedKey(null);
          }}
        >
          <SelectTrigger
            className="h-8 w-[150px] text-xs"
            aria-label="Window"
            data-testid="coord-spawns-window"
            title="The window every figure on this page covers: requests first requested in it. Requests still waiting are listed whatever their age."
          >
            <SelectValue placeholder="window" />
          </SelectTrigger>
          <SelectContent>
            {SPAWN_WINDOWS.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground m-0">
          Time to spawn runs from the first moment coord tried to place a
          request to the moment its session started.
        </p>
        <Link
          href={LAUNCH_SESSION_HREF}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
          data-testid="coord-spawns-launch-link"
        >
          <Rocket className="h-3 w-3" aria-hidden /> Launch session
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {listIssue && (
        <p
          className="text-sm text-amber-200"
          role="status"
          data-testid="coord-spawns-unknown-banner"
          data-issue={listIssue.kind}
        >
          {list
            ? "Last refresh failed — the rows below are from the last good read. "
            : ""}
          {spawnIssueText(listIssue, "which spawns were requested")}
        </p>
      )}
      {pendingIssue && pendingIssue.kind !== listIssue?.kind && (
        <p
          className="text-sm text-amber-200"
          role="status"
          data-testid="coord-spawns-pending-banner"
          data-issue={pendingIssue.kind}
        >
          {spawnIssueText(
            pendingIssue,
            "which older requests are still waiting"
          )}
        </p>
      )}

      <section className="space-y-2" data-testid="coord-spawns-devices-section">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
          Where spawns were placed — per device
        </h2>
        <p
          className="text-xs text-muted-foreground m-0"
          data-testid="coord-spawns-reserve-note"
        >
          Spawns placed per device in the {spec.label}, each line with its
          dispatch role, its time-to-spawn p50 and how many started, were
          refused and were deferred. Each device&apos;s current reserve and
          ceilings: not served yet — coord publishes them once the spawn reserve
          ships.
          {roles.kind === "unknown" ? ` Roles unknown: ${roles.reason}` : ""}
        </p>
        {shares === null ? (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="coord-spawns-devices-unknown"
          >
            No per-device figures from coord — where spawns were placed is
            unknown, not nowhere.
          </p>
        ) : (
          <ShareList
            items={shares.items}
            total={shares.total}
            unit="placed"
            data-testid="coord-spawns-device-list"
            empty={
              <p
                className="text-sm text-muted-foreground"
                data-testid="coord-spawns-devices-empty"
              >
                Coord placed no spawn on any device in the {spec.label}
                {ledger.stats.issue ? " at the last good read" : ""}.
              </p>
            }
          />
        )}
      </section>

      <section className="space-y-2" data-testid="coord-spawns-list-section">
        <FilterTabs
          tabs={SPAWN_FILTERS.map((f) => ({
            id: f.id,
            label: <span title={f.title}>{f.label}</span>,
            count: counts[f.id],
            attention:
              f.id === "failed" && counts.failed !== null && counts.failed > 0,
          }))}
          active={filter}
          onChange={(id) => {
            setFilter(id);
            setExpandedKey(null);
          }}
          testIdPrefix="coord-spawns-filter"
        />
        {(list || pending) && (
          <p
            className="text-xs text-muted-foreground m-0"
            data-testid="coord-spawns-coverage"
          >
            {list === null
              ? `The requests in the ${spec.label} could not be read; only requests still waiting are listed.`
              : list.truncated
                ? `Showing the ${list.items.length} most recent of ${list.total ?? "an unknown number of"} requests in the ${spec.label}, as of ${clockTime(list.as_of)}; tab counts cover these rows only.`
                : `Every request in the ${spec.label}, as of ${clockTime(list.as_of)}.`}
            {pending === null
              ? " Requests still waiting from before the window could not be read."
              : pending.truncated
                ? ` Plus the ${pending.items.length} oldest of ${pending.total ?? "an unknown number of"} requests still waiting, whatever their age.`
                : ` Plus every request still waiting, whatever its age (${pending.items.length}).`}
            {unreadableRows > 0
              ? ` ${unreadableRows} row${unreadableRows === 1 ? "" : "s"} coord sent could not be read and ${unreadableRows === 1 ? "is" : "are"} not listed.`
              : ""}
          </p>
        )}
        <RecordList
          items={visible}
          itemKey={(r) => r.id}
          loaded={rows !== null || listIssue !== null}
          expandedKey={expandedKey}
          onExpandedKeyChange={setExpandedKey}
          empty={
            rows === null || !spawnFilterAnswered(filter, reads) ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-spawns-list-unknown"
              >
                {spawnFilterUnknownText(filter, spec.label, reads)}
              </p>
            ) : (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-spawns-list-empty"
              >
                {spawnFilterEmptyText(filter, spec.label, {
                  scope: list?.truncated ? "loaded" : "window",
                  stale:
                    filter === "queued"
                      ? pendingIssue !== null
                      : filter === "all"
                        ? stale
                        : listIssue !== null,
                })}
              </p>
            )
          }
          renderRow={(row, ctx) => (
            <SpawnRow
              row={row}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
              roster={roster}
              nowMs={nowMs}
            />
          )}
        />
      </section>

      <SpawnRateChart
        series={series}
        windowLabel={spec.label}
        shown={list?.items.length ?? null}
        total={list?.total ?? null}
      />
    </div>
  );
}
