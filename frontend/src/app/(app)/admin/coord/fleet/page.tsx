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

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, HeartPulse, RefreshCw, Server } from "lucide-react";
import {
  CiStatusPanel,
  DevActionsTile,
  FleetOverview,
  FleetTestTargetsPanel,
  GatesPanel,
  LandedFeaturesPanel,
  MergeDependencyGraph,
  MergePipeline,
  MigrationQueueTile,
} from "@/components/operations";
// Imported from its own module (not the barrel) so the inline HealthSummaryCard
// renders the real presentational primitive even when tests mock the heavy
// "@/components/operations" panels.
import { CollapsiblePanel } from "@/components/operations/CollapsiblePanel";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;

interface FleetHealthDevice {
  device_id: string;
  hostname?: string;
  /**
   * Coord liveness state — `DeviceHealthSnapshot.state` (Rust
   * `DeviceState`, serde-lowercase): healthy | degraded | partitioned |
   * abandoned.
   */
  state?: string;
}

interface FleetHealthPayload {
  devices?: FleetHealthDevice[];
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/**
 * Map a coord `DeviceState` value to a badge variant. Unrecognized /
 * missing states fall back to "outline" (rendered as "unknown").
 */
const STATE_BADGE_VARIANT: Record<string, BadgeVariant> = {
  healthy: "default",
  degraded: "secondary",
  partitioned: "destructive",
  abandoned: "destructive",
};

function deviceStateBadgeVariant(state?: string): BadgeVariant {
  return STATE_BADGE_VARIANT[state ?? ""] ?? "outline";
}

/**
 * Fleet/health polling, hoisted to the page: the System details header badge
 * needs the unhealthy count even while the section (and HealthSummaryCard
 * inside it) is collapsed/unmounted.
 */
function useFleetHealth() {
  const [data, setData] = useState<FleetHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const body = await httpClient.get<FleetHealthPayload>(
        `${API}/fleet/health`
      );
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { data, loading, error, refresh };
}

interface HealthSummaryCardProps {
  data: FleetHealthPayload | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function HealthSummaryCard({
  data,
  loading,
  error,
  onRefresh,
}: HealthSummaryCardProps) {
  const devices = data?.devices ?? [];
  const unhealthy = devices.filter(
    (d) => d.state && d.state !== "healthy"
  ).length;

  return (
    <CollapsiblePanel
      data-testid="coord-fleet-health"
      storageKey="fleet:health"
      icon={<HeartPulse className="h-4 w-4" />}
      title="Fleet health"
      contentClassName="space-y-2"
      summary={
        <>
          <Badge variant="outline" className="ml-2">
            {devices.length}
          </Badge>
          {unhealthy > 0 && (
            <Badge variant="destructive" className="ml-1">
              {unhealthy} unhealthy
            </Badge>
          )}
        </>
      }
      headerActions={
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          data-testid="coord-fleet-health-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      }
    >
        {error && (
          <p className="text-sm text-destructive">
            Failed to load fleet/health: {error}
          </p>
        )}
        {loading && !data ? (
          <Skeleton className="h-20 w-full" />
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No devices reporting health.
          </p>
        ) : (
          <ul className="space-y-1">
            {devices.map((d) => (
              <li
                key={d.device_id}
                data-testid="coord-fleet-health-row"
                className="flex items-center justify-between gap-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs truncate">
                    {d.hostname || d.device_id}
                  </span>
                  <Badge variant={deviceStateBadgeVariant(d.state)}>
                    {d.state ?? "unknown"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    href={`/admin/coord/trees?device_id=${encodeURIComponent(d.device_id)}`}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                  >
                    trees <ExternalLink className="h-3 w-3" />
                  </Link>
                  <span className="text-muted-foreground">·</span>
                  <Link
                    href={`/admin/agent-claims`}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                  >
                    claims <ExternalLink className="h-3 w-3" />
                  </Link>
                  <span className="text-muted-foreground">·</span>
                  <Link
                    href={`/admin/agent-sessions`}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                  >
                    sessions <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
    </CollapsiblePanel>
  );
}

export default function CoordFleetPage() {
  const fleet = useFleetHealth();
  const devices = fleet.data?.devices ?? [];
  const unhealthy = devices.filter(
    (d) => d.state && d.state !== "healthy"
  ).length;

  return (
    // `overflow-x-auto`: wide panels (the merge dependency graph, train rows)
    // scroll instead of stranding action buttons off-screen. Vertical scroll
    // comes from the coord layout's <main overflow-y-auto>.
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-fleet-page"
    >
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
            {fleet.error && (
              <Badge variant="destructive" className="ml-1">
                health unavailable
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
