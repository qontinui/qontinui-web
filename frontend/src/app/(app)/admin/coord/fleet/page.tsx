"use client";

/**
 * /admin/coord/fleet — fleet overview.
 *
 * Wraps the existing FleetOverview component (rendered today on
 * /operations) and adds cross-links per device into the coord-side
 * pages (Trees / Claims / Sessions). Pulls fleet/health rollup from
 * coord via /api/v1/operations/fleet/health.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, HeartPulse, RefreshCw } from "lucide-react";
import { DevActionsTile, FleetOverview } from "@/components/operations";
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

  return (
    <Card data-testid="coord-fleet-health">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4" />
          Fleet health
          <Badge variant="outline" className="ml-2">
            {devices.length}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={fetchData}
            data-testid="coord-fleet-health-refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
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
      </CardContent>
    </Card>
  );
}

export default function CoordFleetPage() {
  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-fleet-page">
      <HealthSummaryCard />
      <DevActionsTile />
      <FleetOverview />
    </div>
  );
}
