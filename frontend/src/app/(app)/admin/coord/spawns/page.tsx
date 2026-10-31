"use client";

/**
 * /admin/coord/spawns — agentic activity: the spawn paths this console knows
 * of and the switches that govern them, the machines sessions run on, and how
 * many spawns coord was asked to place, how they ended and across how many
 * machines. The per-request list and the per-device placement are the
 * investigation view's (`/admin/coord/spawns/requests`), which this page links
 * to from those counts in operator mode.
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
 *   `{available: false}` while its tables are absent (or does not serve the
 *   route, or has it switched off), and the page says exactly that ONCE, in
 *   the strip's place (`LedgerUnservedNotice`), naming every section that
 *   rests on the ledger — the strip, each path's Last spawned, in flight per
 *   machine, the counts, the placement and the chart — none of which renders
 *   as a column or a section of UNKNOWNs while it holds.
 * - **0 for a number coord could not state.** A share over no ended request, a
 *   percentile over no started one, a device with no wait sample: `unknown`.
 * - **"Finished" for a session whose outcome nobody reported.** The row status
 *   is the gates page's continuation vocabulary: `spawned` is not success.
 * - **That nothing is waiting because the window holds no waiting request.**
 *   The requests still waiting are read whatever their age, oldest first,
 *   and counted; a cut at coord's page bound is said, with the total.
 * - **"Efficiency".** Requested per hour against started per hour, by name.
 * - **On for a path one of whose switches is unread or off.** A path's
 *   effective state is its verdict across every switch that governs it
 *   (`spawnPathVerdict.ts`): UNKNOWN when any is unknown, Off when any is off,
 *   On only when every one is read and on. The registry switch keeps its own
 *   labelled value beside it.
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
 * control, the raw ids and the links into the investigation view are
 * unmounted (`OperatorOnly`); the refresh and the
 * disclosures stay live because they only change what is
 * displayed; the window picker is the operator's and the window is stated
 * instead; and links obey `lensLinkTarget` (the launcher is operator-only).
 *
 * Console style (`frontend/docs/console-ui-style-guide.md`, §3.8 for this
 * page): no page title (R9), strip first (R1), the matrix and the machine
 * list as tables, the requests and their placement as counts (R6's dash for a
 * count nobody read), and the rate chart collapsible (R7).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Hourglass, Rocket } from "lucide-react";
import { HealthStrip, RefreshButton } from "@/components/console";
import {
  Caption,
  LensLink,
  OperatorOnly,
  Provenance,
  SectionCaption,
  usePresentationMode,
} from "@/components/presentation";
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
import { LedgerReadBanners } from "./_components/LedgerReadBanners";
import { LedgerUnservedNotice } from "./_components/LedgerUnservedNotice";
import { SpawnActivitySummary } from "./_components/SpawnActivitySummary";
import {
  machineListStale,
  machineListUnknown,
  machineStatusLines,
} from "./_lib/machineStatus";
import { ledgerUnserved } from "./_lib/ledgerServed";
import { deriveSpawnPathMatrix } from "./_lib/spawnPathMatrix";
import {
  SPAWN_WINDOWS,
  deriveSpawnsHealth,
  hourlyRates,
  mergeSpawnRows,
  windowSpec,
} from "./_lib/spawnStatus";
import { SPAWNS_SOURCES } from "./_lib/spawnsSources";
import {
  useSessionConcurrency,
  SESSIONS_WINDOW,
} from "./_lib/useSessionConcurrency";
import { SPAWNS_POLL_MS, useSpawnLedger } from "./_lib/useSpawnLedger";
import { useSpawnPathSwitches } from "./_lib/useSpawnPathSwitches";
import { clockTime, usePageClock } from "./_lib/useSpawnPageContext";

/** The launcher this page reports on — relabelled "Launch session" in the nav. */
const LAUNCH_SESSION_HREF = "/admin/coord/spawn";

/** What a started spawn then costs: how long each work type holds a slot. */
const SESSION_LOAD_HREF = "/admin/coord/session-load";

/** Stable identity for "no devices", so memos keyed on it hold. */
const NO_DEVICES: never[] = [];

export default function CoordSpawnsPage() {
  const { presenting } = usePresentationMode();
  const [windowId, setWindowId] = useState<SpawnStatsWindow>("7d");
  const ledger = useSpawnLedger(windowId);
  const fleet = useFleetHealth();
  const dispatchRoles = useFleetDispatchRoles();
  const drain = useFleetDrain();
  const switches = useSpawnPathSwitches();
  const sessions = useSessionConcurrency();
  const roster = useMemo(() => fleet.data?.devices ?? NO_DEVICES, [fleet.data]);
  const spec = windowSpec(windowId);

  const nowMs = usePageClock();

  const list = ledger.list.data;
  const pending = ledger.pending.data;
  const rows = useMemo(
    () => mergeSpawnRows(list?.items ?? null, pending?.items ?? null),
    [list, pending]
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
  const series = useMemo(
    () => (list ? hourlyRates(list, spec.ms) : null),
    [list, spec.ms]
  );
  const listIssue = ledger.list.issue;
  // coord does not serve the ledger at all: said once (`ledgerServed.ts`).
  const unserved = ledgerUnserved(ledger);

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

  // A refresh's terminal moment, said whether or not any read answered: with
  // every as-of null a refresh that ran looks exactly like one that did not.
  const [rereadAt, setRereadAt] = useState<number | null>(null);
  const refreshAll = () =>
    Promise.allSettled([
      ledger.refresh(),
      switches.refresh(),
      sessions.refresh(),
      fleet.refresh(),
      dispatchRoles.refresh(),
      drain.refresh(),
    ]).then(() => setRereadAt(Date.now()));

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-spawns-page"
      data-ui-bridge-id="coord-spawns-page"
    >
      {/* Presentation mode only: what the page shows and why, before data. */}
      <Caption id="agentic-activity.page" />

      {unserved !== null ? (
        // The ledger is not served: one statement, in the strip's place, with
        // every ledger-backed section collapsed under it.
        <LedgerUnservedNotice issue={unserved} presenting={presenting} />
      ) : (
        <>
          <HealthStrip
            data-testid="coord-spawns-health"
            level={health.level}
            headline={health.headline}
            detail={health.detail}
            badges={health.badges}
          />
          {/* Where the strip's figures come from, and when — presentation only. */}
          <span
            className="contents"
            data-testid="coord-spawns-strip-provenance"
          >
            <Provenance
              source={SPAWNS_SOURCES.ledger}
              asOf={ledger.stats.data?.as_of ?? null}
            />
          </span>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <RefreshButton
          onRefresh={refreshAll}
          label="Refresh agentic activity"
          title={`Re-reads the spawn ledger, the switches, the machines and their sessions now; the page also refreshes itself (the ledger every ${SPAWNS_POLL_MS / 1000} s)`}
          data-testid="coord-spawns-refresh"
        />
        {rereadAt !== null && (
          <span
            className="text-xs text-muted-foreground"
            role="status"
            data-testid="coord-spawns-reread"
            title="Every read on this page was issued again and has settled; each section says what it got."
          >
            Re-read at {new Date(rereadAt).toLocaleTimeString()}
          </span>
        )}
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
            onValueChange={(v) => setWindowId(v as SpawnStatsWindow)}
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

      {unserved === null && (
        <LedgerReadBanners ledger={ledger} presenting={presenting} />
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
        showLastSpawned={unserved === null}
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
          // Last spawned's read, while it has a column to feed.
          ...(unserved === null
            ? [{ source: SPAWNS_SOURCES.ledger, asOf: list?.as_of ?? null }]
            : []),
        ]}
      />

      <MachineStatusSection
        showInFlight={unserved === null}
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

      {unserved === null && (
        <>
          <SpawnActivitySummary
            ledger={ledger}
            windowId={windowId}
            windowLabel={spec.label}
            requestSources={[
              { source: SPAWNS_SOURCES.ledger, asOf: list?.as_of ?? null },
              {
                source: SPAWNS_SOURCES.ledgerWaiting,
                asOf: ledger.pending.data?.as_of ?? null,
              },
            ]}
            placementSources={[
              {
                source: SPAWNS_SOURCES.ledger,
                asOf: ledger.stats.data?.as_of ?? null,
              },
            ]}
          />

          <section
            className="space-y-2"
            data-testid="coord-spawns-rate-section"
          >
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
        </>
      )}
    </div>
  );
}
