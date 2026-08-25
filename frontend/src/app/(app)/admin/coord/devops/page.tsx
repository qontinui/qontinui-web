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
 *
 * ## What this page does NOT do
 *
 * It does not recalculate a verdict. Pressure and `headroom` arrive
 * server-computed from coord, and the strip colours rows from `headroom`
 * alone — if the dashboard says a machine is red, the dispatcher must already
 * have stopped sending it work, and that is only true while both consumers
 * read one definition of the number AND the verdict.
 *
 * It also opens exactly TWO reads: `/fleet/health` here, and
 * `/fleet/resource-samples` inside `FleetResourcesSection`, which passes the
 * same rows to both the strip and the CI panel. Two polls of one route would
 * be two chances to disagree about what the fleet looks like right now.
 */

import { useMemo } from "react";
import { HealthStrip } from "@/components/console";
import { FleetOverview, FleetResourcesSection } from "@/components/operations";
import { summarizeFleetLiveness } from "@/components/operations/fleetLiveness";
import { useFleetHealth } from "@/components/operations/useFleetHealth";
import type { FleetHealthDevice } from "@/components/operations/useFleetHealth";

// Stable identity: `?? []` would allocate a fresh array every render, which
// defeats every downstream useMemo keyed on it.
const EMPTY_DEVICES: FleetHealthDevice[] = [];

export default function CoordDevOpsPage() {
  const fleet = useFleetHealth();
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

      {/* 1. Machines — coord's device liveness merged INTO the machine list,
          not beside it. `health` is what makes this the one list on the page:
          a coord device with no runner inventory gets a row whose runner-side
          facts read `unknown`, rather than vanishing or rendering as zero. */}
      <FleetOverview health={fleet} />

      {/* 2. Resources and 3. CI occupancy, over the section's own single
          poll of /fleet/resource-samples. `devices` is the spine: a machine
          that publishes no sample still gets a row, as `unknown`. */}
      <FleetResourcesSection devices={devices} />

      {/* 4. CI capacity — Phase 2 of
          `2026-08-25-coord-console-intent-and-devops-sections` mounts
          `CiNodeConfigPanel` here, as a per-row disclosure on the machine
          list above rather than a fourth section: the knob and the telemetry
          that says what to set it to belong in one viewport. Nothing is
          stubbed for it — this seam is a comment, and the control stays
          reachable under Environments -> Machines until that phase lands. */}
    </div>
  );
}
