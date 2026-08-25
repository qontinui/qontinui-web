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
 * ONE mount: `/admin/coord/devops`, the Dev Ops Overview (plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 1). This section
 * is a first-class part of that page and nothing above it needs the count, so
 * it simply opens the poll itself.
 *
 * It used to have a second mount inside the pipeline page's collapsed "System
 * details" section, which unmounted while collapsed — so that PAGE owned the
 * poll and injected it here, because the saturated-lane alarm had to keep
 * counting on the collapsed header. Phase 4 deleted the section, the page
 * poll and the injection prop together: the alarm now rides the `Dev Ops ▾`
 * nav trigger (`CoordNav`'s `useFleetAlarmBadge`), where it is visible from
 * every console page rather than from one.
 *
 * It adds no `/coord/status` poll to `MachineCard` — that shipped as Phase
 * 1.3 and was deliberately deleted.
 */

import { useEffect, useState } from "react";
import { CiRunPanel } from "./CiRunPanel";
import { FleetResourceStrip } from "./FleetResourceStrip";
import { useFleetResourceSamples } from "./useFleetResourceSamples";
import type { FleetDeviceRef } from "./fleetResources";

export interface FleetResourcesSectionProps {
  /** Coord's device list, from the page's existing `/fleet/health` poll. */
  devices: FleetDeviceRef[];
}

export function FleetResourcesSection({
  devices,
}: FleetResourcesSectionProps) {
  // This section owns the one poll and passes the SAME rows to both children.
  // Two polls of one route would be two chances to disagree about what the
  // fleet looks like right now.
  const resources = useFleetResourceSamples();

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
