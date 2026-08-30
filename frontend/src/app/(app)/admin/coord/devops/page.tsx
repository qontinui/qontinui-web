"use client";

/**
 * /admin/coord/devops — Dev Ops Overview: how the system is functioning.
 *
 * Plan `2026-08-25-coord-console-intent-and-devops-sections` Phase 1. The
 * operator's requirement was "a dedicated Dev Ops page that a developer can
 * use to adjust the amount of CI a machine is allowed and to view how the
 * system is functioning"; this page is the second half, and Phase 2 mounts
 * the first half (`CiNodeConfigPanel`) onto its machine rows.
 *
 * The page is machine-centric and reads top-to-bottom as one question asked
 * three ways:
 *
 *  1. **Machines** — is it alive, and what is on it? ONE list, joining coord's
 *     `DeviceState` with the runner / session / CI facts. Two lists with two
 *     notions of "healthy" on one page is a correctness defect, not a layout
 *     preference, which is why `HealthSummaryCard` is not mounted here.
 *  2. **Resources** — will it take work? One row per `(device, lane,
 *     lane_instance)`, tone from coord's `headroom` verdict.
 *  3. **CI occupancy** — is it taking work right now?
 *  4. **CI capacity** — how much is it ALLOWED to take? Phase 2 mounts the
 *     shared `CiNodeConfigPanel` as a per-row disclosure on the machine list,
 *     collapsed, rather than as a fourth section: the knob and the telemetry
 *     that says what to set it to belong in one viewport.
 *
 * ## What this page does NOT do
 *
 * It does not recalculate a verdict. Pressure and `headroom` arrive
 * server-computed from coord, and the strip colours rows from `headroom`
 * alone — if the dashboard says a machine is red, the dispatcher must already
 * have stopped sending it work, and that is only true while both consumers
 * read one definition of the number AND the verdict.
 *
 * It opens exactly TWO POLLS: `/fleet/health` here, and
 * `/fleet/resource-samples` inside `FleetResourcesSection`, which passes the
 * same rows to both the strip and the CI panel. Two polls of one route would
 * be two chances to disagree about what the fleet looks like right now.
 *
 * The third read is `/devenv/machines`, read ONCE (`useDevenvMachines`) and
 * not polled: it carries the CI-capacity JOIN, and the roster it indexes
 * changes on an operator's enrolment, not on a telemetry cadence. It carries
 * no CI-node configuration — each disclosure's own `CiNodeConfigPanel` reads
 * and writes that through `getCiNodeConfig` / `setCiNodeConfig`, the same two
 * functions `/environments/machines` calls, which is what makes the two mount
 * points one implementation instead of a fork.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { HealthStrip } from "@/components/console";
import { FleetOverview, FleetResourcesSection } from "@/components/operations";
import { summarizeFleetLiveness } from "@/components/operations/fleetLiveness";
import { useDevenvMachines } from "@/components/operations/useDevenvMachines";
import { useFleetHealth } from "@/components/operations/useFleetHealth";
import type { FleetHealthDevice } from "@/components/operations/useFleetHealth";

// Stable identity: `?? []` would allocate a fresh array every render, which
// defeats every downstream useMemo keyed on it.
const EMPTY_DEVICES: FleetHealthDevice[] = [];

export default function CoordDevOpsPage() {
  const fleet = useFleetHealth();
  // The CI-capacity join (Phase 2). One read, owned here, passed down —
  // never a fetch per machine row. It carries no CI-node configuration of its
  // own: that is `CiNodeConfigPanel`'s, inside the disclosure.
  const ciMachines = useDevenvMachines();
  const devices = fleet.data?.devices ?? EMPTY_DEVICES;

  // R1: derived from data already on the page, never a second fetch. The
  // derivation itself is pure and unit-tested (`fleetLiveness.ts`).
  const liveness = useMemo(
    () =>
      summarizeFleetLiveness({
        devices,
        loading: fleet.loading,
        error: fleet.error,
      }),
    [devices, fleet.loading, fleet.error]
  );

  return (
    // `overflow-x-auto`: the resource strip is wide, and it must scroll rather
    // than strand its right-hand columns off-screen. Vertical scroll comes
    // from the coord layout's <main overflow-y-auto>.
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-devops-page"
    >
      <HealthStrip
        data-testid="coord-devops-health-strip"
        level={liveness.level}
        headline={liveness.headline}
        detail={liveness.detail}
        badges={[
          {
            key: "machines",
            label: `machines ${liveness.total}`,
            tone: "muted",
            "data-testid": "coord-devops-machines-badge",
          },
          ...(liveness.unreachable > 0
            ? [
                {
                  key: "unreachable",
                  label: `unreachable ${liveness.unreachable}`,
                  tone: "attention" as const,
                  "data-testid": "coord-devops-unreachable-badge",
                },
              ]
            : []),
          ...(liveness.degraded > 0
            ? [
                {
                  key: "degraded",
                  label: `degraded ${liveness.degraded}`,
                  tone: "default" as const,
                  "data-testid": "coord-devops-degraded-badge",
                },
              ]
            : []),
          // Coord's fifth DeviceState, and its own badge rather than a share
          // of `degraded` or `unknown`. `stale` is a machine coord still
          // reaches whose resource SAMPLER has gone quiet — the 2026-08-27
          // shape, where `/fleet/health` said `{healthy: 4}` beside a sample
          // 22 minutes old. Deliberately not `attention`: the axis it names is
          // a publisher, not an unreachable machine, and borrowing red would
          // make it indistinguishable from `partitioned` at a glance.
          ...(liveness.stale > 0
            ? [
                {
                  key: "stale",
                  label: `stale ${liveness.stale}`,
                  tone: "default" as const,
                  "data-testid": "coord-devops-stale-badge",
                },
              ]
            : []),
          // Rendered even though it is not red, for the same reason the
          // pipeline page's collapsed header carries it: a fleet whose
          // telemetry has gone dark would otherwise render as "machines N"
          // and nothing else, which is indistinguishable from an all-clear.
          ...(liveness.unknown > 0
            ? [
                {
                  key: "unknown",
                  label: `unknown ${liveness.unknown}`,
                  tone: "muted" as const,
                  "data-testid": "coord-devops-unknown-badge",
                },
              ]
            : []),
        ]}
      />

      {/* The join this page is keyed on, stated once, before the list it
          shapes. Rows here come from coord's device registry, and the bridge
          to a machine record is `Machine.coord_device_id` — a soft, nullable
          pointer. So a machine with no such link is not on this page at all,
          and saying so is the difference between a reader knowing where it is
          and a reader concluding it does not exist. */}
      <p
        className="text-xs text-muted-foreground"
        data-testid="coord-devops-join-note"
      >
        Every row below is a machine coord has a device record for. A machine
        enrolled under Environments that carries no coord device link does not
        appear here at all — it is reachable, and its CI configurable, only
        under{" "}
        <Link
          href="/environments/machines"
          className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2 hover:no-underline"
          data-testid="coord-devops-machines-link"
        >
          Environments → Machines
          <ExternalLink className="h-3 w-3" />
        </Link>
        . This list is not a count of your machines.
      </p>

      {/* 1. Machines — coord's device liveness merged INTO the machine list,
          not beside it. `health` is what makes this the one list on the page:
          a coord device with no runner inventory gets a row whose runner-side
          facts read `unknown`, rather than vanishing or rendering as zero.
          4. CI capacity rides on each row as a collapsed disclosure, resolved
          from `ciMachines` — one read, no per-row fetch. */}
      <FleetOverview health={fleet} ciMachines={ciMachines} />

      {/* 2. Resources and 3. CI occupancy, over the section's own single
          poll of /fleet/resource-samples. `devices` is the spine: a machine
          that publishes no sample still gets a row, as `unknown`. */}
      <FleetResourcesSection devices={devices} />
    </div>
  );
}
