"use client";

/**
 * /admin/coord/spawns — agentic activity: the spawn paths this console knows
 * of and the switches that govern them, the machines sessions run on, and every
 * spawn coord was asked to place — where it went, how long it waited, and how
 * it ended.
 *
 * Plan `2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration`
 * Phase 5 built the ledger half; its D7 defines every number there. Reads
 * coord's spawn ledger (`GET /coord/spawns`, `/stats`, `/{id}`, that plan's
 * Phase 2) through the web backend's passthrough proxies (`useSpawnLedger`),
 * names devices from the `/fleet/health` roster and gives each its dispatch
 * role from `/fleet/dispatch-roles`. The launcher that CREATES a spawn is a
 * different page, `/admin/coord/spawn` ("Launch session"), and this page
 * links to it in operator mode.
 *
 * Plan `2026-10-23-console-presentation-spaces` Phase 4 added two sections
 * and made the page a presentation lens surface (agentic activity):
 *
 * - **Spawn paths** (`SpawnPathMatrixSection`, derived by `spawnPathMatrix.ts`
 *   from `useSpawnPathSwitches`): one row per spawn path — coord's served
 *   registry kinds and class switches, the post-merge follow-up, and the
 *   runner-local paths the plan names (a runner's other automatic starts have
 *   no row, and the section says so) — with each switch this console can
 *   read that governs it (its registry row, its class row, a fixer's
 *   merge-settings dial or knob, a dispatch arm's autonomy level and fleet
 *   flag), its scope, whether it is enforced, coord's own value for it (for a
 *   registry row, the tenant default coord enforces — never a member's own
 *   preference), and when the path last spawned (from the ledger this page
 *   already reads). Tenant switches are writable in operator mode through
 *   their existing doors, and what a row shows after a write is coord's
 *   read-back.
 * - **Machines** (`MachineStatusSection`, derived by `machineStatus.ts`): one
 *   line per machine — drain, dispatch role, in flight against ceiling (an
 *   UNKNOWN naming the door no console reads yet) and the sessions open now.
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
 * - **One verdict per spawn path.** Each switch shows the value its own source
 *   serves; coord's authorization fold is coord's, and is never recomputed
 *   here.
 * - **"Never" for a path the ledger cannot attribute.** Last spawned is
 *   UNKNOWN, and says why, wherever no ledger field names the path or names
 *   only some of its starts; a start found is a lower bound, and "none" is
 *   said of the requests the window holds, never of the path.
 * - **The value a write asked for.** After a switch write the row shows what
 *   coord reads back, and a read-back that disagrees is shown as one; a write
 *   coord refused says so, and one whose outcome coord could not confirm is
 *   UNKNOWN until a re-read answers.
 * - **A member's own preference as a path's state.** Coord enforces the
 *   tenant default for the paths it starts; the operator's own preference row
 *   is shown beside it in operator mode, and never while presenting.
 *
 * ## Presentation mode
 *
 * The same route and reads (D1). The page opens with its caption, each
 * section with its caption and the provenance of its reads; machines read as
 * their session alias and no device id renders; coord's own words (a terminal
 * reason, an event's reason, a failure's text) are not quoted; every write
 * control and the raw ids are unmounted (`OperatorOnly`); the refresh and the
 * disclosures stay live because they only change what is
 * displayed; the window picker is the operator's and the window is stated
 * instead; and links obey `lensLinkTarget` (the launcher is operator-only).
 *
 * Console style (`frontend/docs/console-ui-style-guide.md`, §3.8 for this
 * page): no page title (R9), strip first (R1), the matrix and the machine
 * list as tables, per-device share list, filter tabs with live counts (R6),
 * one line per request (R2) whose detail expands in place (R5), and the rate
 * chart collapsible (R7).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Hourglass, Rocket, Server } from "lucide-react";
import {
  FilterTabs,
  HealthStrip,
  RecordList,
  RefreshButton,
  ShareList,
} from "@/components/console";
import {
  Caption,
  LensLink,
  OperatorOnly,
  Provenance,
  SectionCaption,
  captionEntry,
  useMachineAliaser,
  usePresentationMode,
} from "@/components/presentation";
import { describeRole } from "@/components/operations/fleetDispatchRoles";
import { useFleetDispatchRoles } from "@/components/operations/useFleetDispatchRoles";
import { useFleetDrain } from "@/components/operations/useFleetDrain";
import { useFleetHealth } from "@/components/operations/useFleetHealth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SpawnStatsWindow } from "@/lib/api/operations/coordSpawns";
import { MachineStatusSection } from "./_components/MachineStatusSection";
import { SpawnPathMatrixSection } from "./_components/SpawnPathMatrix";
import { SpawnRateChart } from "./_components/SpawnRateChart";
import { SpawnRow } from "./_components/SpawnRow";
import {
  machineListStale,
  machineListUnknown,
  machineStatusLines,
} from "./_lib/machineStatus";
import { deriveSpawnPathMatrix } from "./_lib/spawnPathMatrix";
import {
  SPAWN_FILTERS,
  SPAWN_WINDOWS,
  deriveSpawnsHealth,
  deviceName,
  hourlyRates,
  isSpawnRow,
  matchesSpawnFilter,
  mergeSpawnRows,
  perDeviceShares,
  spawnFilterAnswered,
  spawnFilterCounts,
  spawnFilterEmptyText,
  spawnFilterUnknownText,
  spawnIssueTextFor,
  windowSpec,
  type DeviceNaming,
  type DeviceRoles,
  type SpawnFilter,
} from "./_lib/spawnStatus";
import { SPAWNS_SOURCES } from "./_lib/spawnsSources";
import {
  useSessionConcurrency,
  SESSIONS_WINDOW,
} from "./_lib/useSessionConcurrency";
import { SPAWNS_POLL_MS, useSpawnLedger } from "./_lib/useSpawnLedger";
import { useSpawnPathSwitches } from "./_lib/useSpawnPathSwitches";

/** The launcher this page reports on — relabelled "Launch session" in the nav. */
const LAUNCH_SESSION_HREF = "/admin/coord/spawn";

/** What a started spawn then costs: how long each work type holds a slot. */
const SESSION_LOAD_HREF = "/admin/coord/session-load";

/** Stable identity for "no devices", so memos keyed on it hold. */
const NO_DEVICES: never[] = [];

function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "an unknown time" : d.toLocaleString();
}

export default function CoordSpawnsPage() {
  const { presenting } = usePresentationMode();
  const [windowId, setWindowId] = useState<SpawnStatsWindow>("7d");
  const [filter, setFilter] = useState<SpawnFilter>("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const ledger = useSpawnLedger(windowId);
  const fleet = useFleetHealth();
  const dispatchRoles = useFleetDispatchRoles();
  const drain = useFleetDrain();
  const switches = useSpawnPathSwitches();
  const sessions = useSessionConcurrency();
  const roster = useMemo(() => fleet.data?.devices ?? NO_DEVICES, [fleet.data]);
  const spec = windowSpec(windowId);

  // How this page names a device: the roster's hostname for the operator, the
  // session alias while presenting (D3.3) — and no device id while presenting.
  const aliaser = useMachineAliaser();
  const naming = useMemo<DeviceNaming>(
    () => ({
      nameOf: (deviceId: string) => {
        const hostname =
          roster.find(
            (d) => d.device_id.toLowerCase() === deviceId.toLowerCase()
          )?.hostname ?? null;
        return presenting
          ? aliaser({ deviceId, hostname })
          : deviceName(deviceId, roster);
      },
      showIds: !presenting,
    }),
    [aliaser, presenting, roster]
  );

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
  // page. A drain's deadline passes the same way.
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
        presenting,
      }),
    [ledger.stats.data, ledger.stats.issue, windowId, rows, nowMs, presenting]
  );
  const shares = useMemo(
    () =>
      ledger.stats.data
        ? perDeviceShares(ledger.stats.data, roles, naming)
        : null,
    [ledger.stats.data, roles, naming]
  );
  const series = useMemo(
    () => (list ? hourlyRates(list, spec.ms) : null),
    [list, spec.ms]
  );
  const listIssue = ledger.list.issue;
  const pendingIssue = ledger.pending.issue;
  const stale = listIssue !== null || pendingIssue !== null;

  const matrix = useMemo(
    () =>
      deriveSpawnPathMatrix({
        effective: switches.effective,
        defaults: switches.defaults,
        nextStep: switches.nextStep,
        mergeSettings: switches.mergeSettings,
        followup: switches.followup,
        ledger: { list, issue: listIssue, windowLabel: spec.label },
        writes: switches.writes,
        presenting,
      }),
    [
      switches.effective,
      switches.defaults,
      switches.nextStep,
      switches.mergeSettings,
      switches.followup,
      switches.writes,
      list,
      listIssue,
      spec.label,
      presenting,
    ]
  );
  // A switch is busy from its request until its read-back has landed.
  const busy = useMemo(
    () =>
      new Set(
        Object.entries(switches.writes)
          .filter(([, w]) => w.phase === "writing" || w.phase === "unconfirmed")
          .map(([key]) => key)
      ),
    [switches.writes]
  );

  const machines = useMemo(() => {
    const input = {
      devices: fleet.data ? roster : null,
      devicesError: fleet.error,
      drain: drain.read,
      roles: dispatchRoles.read,
      sessions: { data: sessions.data, issue: sessions.issue },
      sessionsWindowLabel: SESSIONS_WINDOW.label,
      nowMs,
      presenting,
    };
    return {
      lines: machineStatusLines(input),
      unknown: machineListUnknown(input),
      stale: machineListStale(input),
    };
  }, [
    fleet.data,
    fleet.error,
    roster,
    drain.read,
    dispatchRoles.read,
    sessions.data,
    sessions.issue,
    nowMs,
    presenting,
  ]);

  const refreshAll = () =>
    Promise.all([
      ledger.refresh(),
      switches.refresh(),
      sessions.refresh(),
      fleet.refresh(),
      dispatchRoles.refresh(),
      drain.refresh(),
    ]);

  const roleNote =
    roles.kind === "unknown"
      ? presenting
        ? " The machines' roles could not be read."
        : ` Roles unknown: ${roles.reason}`
      : "";

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-spawns-page"
      data-ui-bridge-id="coord-spawns-page"
    >
      {/* Presentation mode only: what the page shows and why, before data. */}
      <Caption id="agentic-activity.page" />

      <HealthStrip
        data-testid="coord-spawns-health"
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
      />
      {/* Where the strip's figures come from, and when — presentation only. */}
      <span className="contents" data-testid="coord-spawns-strip-provenance">
        <Provenance
          source={SPAWNS_SOURCES.ledger}
          asOf={ledger.stats.data?.as_of ?? null}
        />
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <RefreshButton
          onRefresh={refreshAll}
          label="Refresh agentic activity"
          title={`Re-reads the spawn ledger, the switches, the machines and their sessions now; the page also refreshes itself (the ledger every ${SPAWNS_POLL_MS / 1000} s)`}
          data-testid="coord-spawns-refresh"
        />
        {/* The window picker is the operator's: a closed Radix Select keeps
            its items in a detached DocumentFragment, which no presentation
            check can read, so while presenting the window is stated instead
            (the operator picks it before presenting; it stays picked). */}
        <OperatorOnly
          placeholder={
            <span
              className="text-xs text-muted-foreground"
              data-testid="coord-spawns-window-presented"
            >
              Window: the {spec.label}
            </span>
          }
        >
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
        </OperatorOnly>
        <p className="text-xs text-muted-foreground m-0">
          Time to spawn runs from the first attempt to place a request to the
          moment its session started.
        </p>
        <LensLink
          href={SESSION_LOAD_HREF}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
          textClassName="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"
          data-testid="coord-spawns-session-load-link"
          title="How long each work type holds a session slot once started, and how many sessions each machine carries"
        >
          <Hourglass className="h-3 w-3" aria-hidden /> Session load
        </LensLink>
        {/* The launcher is a write surface, never a lens page: operator only. */}
        <OperatorOnly>
          <Link
            href={LAUNCH_SESSION_HREF}
            className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
            data-testid="coord-spawns-launch-link"
          >
            <Rocket className="h-3 w-3" aria-hidden /> Launch session
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        </OperatorOnly>
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
          {spawnIssueTextFor(
            listIssue,
            "which spawns were requested",
            presenting
          )}
        </p>
      )}
      {pendingIssue && pendingIssue.kind !== listIssue?.kind && (
        <p
          className="text-sm text-amber-200"
          role="status"
          data-testid="coord-spawns-pending-banner"
          data-issue={pendingIssue.kind}
        >
          {spawnIssueTextFor(
            pendingIssue,
            "which older requests are still waiting",
            presenting
          )}
        </p>
      )}

      <SpawnPathMatrixSection
        matrix={matrix}
        writers={{
          setRegistryDefault: switches.setRegistryDefault,
          setAutonomyLevel: switches.setAutonomyLevel,
          setFixerDial: switches.setFixerDial,
          setRedMainKnob: switches.setRedMainKnob,
          busy,
        }}
        presenting={presenting}
        sources={[
          { source: SPAWNS_SOURCES.registry, asOf: switches.effective.asOfMs },
          {
            source: SPAWNS_SOURCES.tenantDefaults,
            asOf: switches.defaults.asOfMs,
          },
          { source: SPAWNS_SOURCES.nextStep, asOf: switches.nextStep.asOfMs },
          {
            source: SPAWNS_SOURCES.mergeSettings,
            asOf: switches.mergeSettingsAsOfMs,
          },
          {
            source: SPAWNS_SOURCES.followupScopes,
            asOf: switches.followupAsOfMs,
          },
          { source: SPAWNS_SOURCES.ledger, asOf: list?.as_of ?? null },
        ]}
      />

      <MachineStatusSection
        lines={machines.lines}
        listUnknown={machines.unknown}
        listStale={machines.stale}
        presenting={presenting}
        sources={[
          { source: SPAWNS_SOURCES.fleetHealth, asOf: fleet.asOfMs },
          { source: SPAWNS_SOURCES.drainState, asOf: drain.asOfMs },
          { source: SPAWNS_SOURCES.dispatchRoles, asOf: dispatchRoles.asOfMs },
          { source: SPAWNS_SOURCES.sessionRuns, asOf: sessions.asOf },
        ]}
      />

      <section className="space-y-2" data-testid="coord-spawns-devices-section">
        <SectionCaption
          id="agentic-activity.placement"
          sources={[
            {
              source: SPAWNS_SOURCES.ledger,
              asOf: ledger.stats.data?.as_of ?? null,
            },
            { source: SPAWNS_SOURCES.fleetHealth, asOf: fleet.asOfMs },
            {
              source: SPAWNS_SOURCES.dispatchRoles,
              asOf: dispatchRoles.asOfMs,
            },
          ]}
        />
        {!presenting && (
          <h2 className="text-sm font-medium flex items-center gap-1.5">
            <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
            {captionEntry("agentic-activity.placement").title} — per device
          </h2>
        )}
        <p
          className="text-xs text-muted-foreground m-0"
          data-testid="coord-spawns-reserve-note"
        >
          Spawns placed per device in the {spec.label}, each line with its
          dispatch role, its time-to-spawn p50 and how many started, were
          refused and were deferred. Each device&apos;s current reserve and
          ceilings: not served yet — they are published once the spawn reserve
          ships.
          {roleNote}
        </p>
        {shares === null ? (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="coord-spawns-devices-unknown"
          >
            No per-device figures were read — where spawns were placed is
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
                No spawn was placed on any device in the {spec.label}
                {ledger.stats.issue ? " at the last good read" : ""}.
              </p>
            }
          />
        )}
      </section>

      <section className="space-y-2" data-testid="coord-spawns-list-section">
        <SectionCaption
          id="agentic-activity.requests"
          sources={[
            { source: SPAWNS_SOURCES.ledger, asOf: list?.as_of ?? null },
            {
              source: SPAWNS_SOURCES.ledgerWaiting,
              asOf: pending?.as_of ?? null,
            },
          ]}
        />
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
              ? ` ${unreadableRows} row${unreadableRows === 1 ? "" : "s"} in the answer could not be read and ${unreadableRows === 1 ? "is" : "are"} not listed.`
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
              naming={naming}
              nowMs={nowMs}
            />
          )}
        />
      </section>

      <section className="space-y-2" data-testid="coord-spawns-rate-section">
        <SectionCaption
          id="agentic-activity.rate"
          sources={[
            { source: SPAWNS_SOURCES.ledger, asOf: list?.as_of ?? null },
          ]}
        />
        <SpawnRateChart
          series={series}
          windowLabel={spec.label}
          shown={list?.items.length ?? null}
          total={list?.total ?? null}
          forceOpen={presenting}
        />
      </section>
    </div>
  );
}
