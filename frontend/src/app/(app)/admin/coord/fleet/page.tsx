"use client";

/**
 * /admin/coord/fleet — fleet + operations overview.
 *
 * The single cross-machine view: fleet health + per-device coord
 * cross-links (Trees / Claims / Sessions) + the FleetOverview, plus the
 * operations panels that used to live on the standalone /operations page
 * (merge train, cross-repo dependency graph, CI status, gates, migration
 * queue, landed features). /operations now redirects here, so there is one
 * fleet view instead of two. Fleet/health rollup comes from coord via
 * /api/v1/operations/fleet/health.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, HeartPulse, RefreshCw } from "lucide-react";
import {
  CiStatusPanel,
  DevActionsTile,
  FleetOverview,
  FleetTestTargetsPanel,
  GatesPanel,
  LandedFeaturesPanel,
  MergeDependencyGraph,
  MergeTrain,
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

function HealthSummaryCard() {
  const [data, setData] = useState<FleetHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
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
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

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
          onClick={fetchData}
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
  return (
    // `overflow-x-auto` mirrors the old /operations ScrollArea: wide panels
    // (the merge dependency graph, escalation/train rows) scroll instead of
    // stranding action buttons off-screen. Vertical scroll comes from the
    // coord layout's <main overflow-y-auto>.
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-fleet-page"
    >
      <HealthSummaryCard />
      <FleetOverview />
      <FleetTestTargetsPanel />

      {/* Dev Actions + Migration Queue paired side-by-side: two narrow
          ledger/queue lists. Full-width stacked on mobile, two columns on
          large screens. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <DevActionsTile />
        <MigrationQueueTile />
      </div>

      {/* Merged from the former standalone /operations page. */}
      <MergeTrain />
      <div id="merge-dep-graph">
        <MergeDependencyGraph />
      </div>
      <CiStatusPanel />
      <GatesPanel />
      <LandedFeaturesPanel />
    </div>
  );
}
