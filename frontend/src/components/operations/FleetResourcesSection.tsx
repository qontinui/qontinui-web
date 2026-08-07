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
 * This component is mounted INSIDE the page's collapsed "System details"
 * section, so it unmounts while collapsed. Its POLL does not stop with it,
 * though — the page owns the poll and passes it down, because the
 * saturated-lane alarm has to keep counting on the collapsed header. That is
 * a deliberate trade: one lightweight 30 s GET on every visit to this page,
 * bought so a machine that is out of memory cannot hide behind a click.
 *
 * It adds **no nav entry** (`[policy: ux-priorities#discoverability]`) and no
 * `/coord/status` poll to `MachineCard` — that shipped as Phase 1.3 and was
 * deliberately deleted.
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
   * The page DOES hold one: it hoists the saturated-lane count onto the
   * collapsed "System details" header, exactly as it already hoists the
   * unhealthy-machine count, so a red machine cannot hide behind a click.
   * That alarm has to keep counting while this section is unmounted, which
   * means the poll has to live above it. Passing the same result down keeps
   * it to ONE poll rather than two views of the fleet that can disagree.
   *
   * Omitted, the section opens its own — which is what makes it usable
   * standalone and testable without a page.
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
