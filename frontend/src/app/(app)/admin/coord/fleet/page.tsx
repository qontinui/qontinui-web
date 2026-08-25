"use client";

/**
 * /admin/coord/fleet — the merge pipeline + fleet operations view.
 *
 * Redesigned per qontinui-dev-notes/prompts/
 * coord-fleet-page-redesign-2026-07-14.md: the unified merge pipeline
 * (MergePipeline — one row per PR, one plain-language status, traffic-light
 * health strip) is the hero, because "where is my PR and is it stuck?" is
 * what ~90% of visits are for. Everything infrastructural — machine health,
 * CI rollups, gates, dev-action ledger, migration queue, dependency graph,
 * landed features — is demoted into a single collapsed "System details"
 * section. Collapsing it unmounts those panels entirely (Radix Collapsible),
 * so a routine developer visit costs one data stream instead of nine; the
 * machine-health alarm count is hoisted to this page and stays visible on
 * the collapsed header so a red fleet state never hides behind the click.
 */

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Server } from "lucide-react";
import {
  CiStatusPanel,
  DevActionsTile,
  FleetOverview,
  FleetResourcesSection,
  FleetTestTargetsPanel,
  GatesPanel,
  LandedFeaturesPanel,
  MergeDependencyGraph,
  MergePipeline,
  MigrationQueueTile,
  StuckPrRecoveryPanel,
} from "@/components/operations";
import { CollapsiblePanel } from "@/components/console";
// Imported from their own modules (not the barrel) so the health card renders
// for real even when a test mocks the heavy "@/components/operations" panels.
import { HealthSummaryCard } from "@/components/operations/FleetHealthSummary";
import { useFleetHealth } from "@/components/operations/useFleetHealth";
import type { FleetHealthDevice } from "@/components/operations/useFleetHealth";
import { useFleetResourceSamples } from "@/components/operations/useFleetResourceSamples";
import { summarizeFleetAdmission } from "@/components/operations/fleetResources";

const EMPTY_DEVICES: FleetHealthDevice[] = [];

export default function CoordFleetPage() {
  const fleet = useFleetHealth();
  // Stable identity: `?? []` would allocate a fresh array every render, which
  // defeats every downstream useMemo keyed on it.
  const devices = fleet.data?.devices ?? EMPTY_DEVICES;
  const unhealthy = devices.filter(
    (d) => d.state && d.state !== "healthy"
  ).length;

  // Resource telemetry, hoisted to the page for the same reason fleet health
  // already is: the count of lanes coord has stopped electing has to stay
  // visible on the COLLAPSED "System details" header, so a machine that is
  // refusing work cannot hide behind a click. That is why the poll lives here rather than inside
  // FleetResourcesSection (which unmounts with the section) — and why the same
  // result is passed down, so there is one poll and one view of the fleet.
  const resources = useFleetResourceSamples();

  // A ticking clock, so the alarm ages rows out during an outage. `age_secs`
  // is frozen inside the payload — without this, a dead proxy would leave the
  // header claiming an all-clear indefinitely.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // Counted from coord's own admission verdict — the same field the strip
  // colours rows from. There is no client-side band left that could put a
  // machine in this badge that the dispatcher is still happily electing.
  const admission = useMemo(
    () =>
      summarizeFleetAdmission(
        devices,
        resources.data?.latest ?? [],
        resources.fetchedAtMs == null
          ? 0
          : Math.max(0, (nowMs - resources.fetchedAtMs) / 1000)
      ),
    [devices, resources.data?.latest, resources.fetchedAtMs, nowMs]
  );

  return (
    // `overflow-x-auto`: wide panels (the merge dependency graph, train rows)
    // scroll instead of stranding action buttons off-screen. Vertical scroll
    // comes from the coord layout's <main overflow-y-auto>.
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-fleet-page"
    >
      {/* Above the hero, and only when there IS one: the tenant's own door out
          of a wedged merge train (plan
          2026-07-30-coord-tenant-self-service-merge-recovery Phase 4). coord
          already detects and nudges; this is the remediation attached to the
          alarm. Renders null when nothing is stuck, so a healthy day looks
          exactly as it did before. */}
      <StuckPrRecoveryPanel />

      {/* The hero: unified PR pipeline (health strip + one row per PR). */}
      <MergePipeline />

      {/* Everything infrastructural, one click away. Children unmount while
          collapsed, so their pollers only run when an operator opens this. */}
      <CollapsiblePanel
        data-testid="coord-system-details"
        storageKey="fleet:system-details"
        defaultOpen={false}
        icon={<Server className="h-4 w-4" />}
        title="System details"
        summary={
          <>
            {devices.length > 0 && (
              <Badge variant="outline" className="ml-2">
                {devices.length} machines
              </Badge>
            )}
            {unhealthy > 0 && (
              <Badge variant="destructive" className="ml-1">
                {unhealthy} unhealthy
              </Badge>
            )}
            {admission.breach > 0 && (
              <Badge
                variant="destructive"
                className="ml-1"
                data-testid="coord-fleet-breach-badge"
              >
                {admission.breach} refusing work
              </Badge>
            )}
            {admission.warn > 0 && (
              <Badge
                variant="secondary"
                className="ml-1"
                data-testid="coord-fleet-near-floor-badge"
              >
                {admission.warn} delaying work
              </Badge>
            )}
            {admission.stale > 0 && (
              <Badge
                variant="outline"
                className="ml-1"
                data-testid="coord-fleet-stale-badge"
              >
                {admission.stale} stale
              </Badge>
            )}
            {/* Shown even though it is not red: a fleet whose telemetry has
                gone entirely dark would otherwise render as "N machines" and
                nothing else — indistinguishable from an all-clear, which is
                the false-safe §C3 exists to forbid. */}
            {admission.unknown > 0 && (
              <Badge
                variant="outline"
                className="ml-1"
                data-testid="coord-fleet-unknown-badge"
              >
                {admission.unknown} unknown
              </Badge>
            )}
            {fleet.error && (
              <Badge variant="destructive" className="ml-1">
                health unavailable
              </Badge>
            )}
            {resources.error && (
              <Badge variant="outline" className="ml-1">
                resources unavailable
              </Badge>
            )}
          </>
        }
        contentClassName="space-y-4"
      >
        <HealthSummaryCard
          data={fleet.data}
          loading={fleet.loading}
          error={fleet.error}
          onRefresh={fleet.refresh}
        />
        <FleetResourcesSection devices={devices} resources={resources} />
        <FleetOverview />
        <FleetTestTargetsPanel />

        {/* Dev Actions + Migration Queue paired side-by-side: two narrow
            ledger/queue lists. Full-width stacked on mobile, two columns on
            large screens. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <DevActionsTile />
          <MigrationQueueTile />
        </div>

        <div id="merge-dep-graph">
          <MergeDependencyGraph />
        </div>
        <CiStatusPanel />
        <GatesPanel />
        <LandedFeaturesPanel />
      </CollapsiblePanel>
    </div>
  );
}
