"use client";

/**
 * The §C1 fleet-resource surface: the per-machine strip and the CI runner
 * load panel, over ONE shared poll.
 *
 * Plan: `2026-08-02-fleet-resource-telemetry-and-ci-allocation` §C1/§C2.
 *
 * Why the hook lives here and not in each panel: both panels read the same
 * `latest` rows, and two polls of one route would be two chances to disagree
 * about what the fleet looks like right now. `DeviceStatusTile` already
 * established the shape — the owner holds the stream, the panels take it as a
 * prop.
 *
 * ## Where it is mounted, and who owns the poll
 *
 * Two mounts today, and they answer the ownership question differently.
 *
 * On **`/admin/coord/devops`** (the Dev Ops Overview, plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 1) this section
 * is a first-class part of the page and nothing above it needs the count, so
 * it opens the poll itself.
 *
 * On **`/admin/coord/fleet`** it is inside the collapsed "System details"
 * section and unmounts while collapsed, so the PAGE owns the poll and passes
 * it down: the saturated-lane alarm has to keep counting on the collapsed
 * header, bought at one lightweight 30 s GET per visit so a machine that is
 * out of memory cannot hide behind a click. Phase 4 deletes that section and
 * that poll — the alarm moves to the `Dev Ops ▾` nav trigger, where it is
 * visible from every console page rather than from one, and this section is
 * then left with the single owner it has on Dev Ops today.
 *
 * It adds no `/coord/status` poll to `MachineCard` — that shipped as Phase
 * 1.3 and was deliberately deleted.
 */

import { useEffect, useState } from "react";
import { CiRunPanel } from "./CiRunPanel";
import { FleetResourceStrip } from "./FleetResourceStrip";
import { useFleetResourceSamples } from "./useFleetResourceSamples";
import type { UseFleetResourceSamplesResult } from "./useFleetResourceSamples";
import type { FleetDeviceRef } from "./fleetResources";

export interface FleetResourcesSectionProps {
  /** Coord's device list, from the page's existing `/fleet/health` poll. */
  devices: FleetDeviceRef[];
  /**
   * The shared poll, when the page already holds one.
   *
   * The PIPELINE page holds one, because it hoists the saturated-lane count
   * onto the collapsed "System details" header (exactly as it hoists the
   * unhealthy-machine count) and that alarm has to keep counting while this
   * section is unmounted — so the poll has to live above it. Passing the same
   * result down keeps it to ONE poll rather than two views of the fleet that
   * can disagree, which is the whole reason the strip and the CI panel take
   * their rows as props.
   *
   * Omitted — the Dev Ops Overview mount, and any test — the section opens its
   * own. Nothing above it there needs the count, so there is nothing to hoist.
   */
  resources?: UseFleetResourceSamplesResult;
}

export function FleetResourcesSection({
  devices,
  resources: injected,
}: FleetResourcesSectionProps) {
  // Hooks cannot be conditional; the own poll is disabled when the page
  // supplied one, so nothing double-fetches.
  const own = useFleetResourceSamples({ enabled: !injected });
  const resources = injected ?? own;

  // Same ticking clock the strip keeps: without it the CI panel's freshness
  // would only advance when a poll SUCCEEDS, so an outage would pin every row
  // at its last value.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const sinceFetchSecs =
    resources.fetchedAtMs == null
      ? 0
      : Math.max(0, (nowMs - resources.fetchedAtMs) / 1000);

  return (
    <div className="space-y-4" data-testid="fleet-resources-section">
      <FleetResourceStrip devices={devices} resources={resources} />
      <CiRunPanel
        latest={resources.data?.latest ?? []}
        devices={devices}
        schemaPending={resources.data?.schema_pending}
        sinceFetchSecs={sinceFetchSecs}
        error={resources.error}
      />
    </div>
  );
}
