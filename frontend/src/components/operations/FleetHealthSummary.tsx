"use client";

/**
 * The coord device-liveness card, its state→badge mapping, and the per-device
 * cross-links — lifted verbatim out of `admin/coord/fleet/page.tsx` by plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 1.
 *
 * All three were page-locals, so nothing outside that one page could render a
 * coord `DeviceState`. The Dev Ops Overview needs the state mapping and the
 * cross-links to build ONE merged machine list, so they move here; the card
 * itself stays mounted on the pipeline page until Phase 4 relocates it.
 *
 * `deviceStateBadgeVariant` renders an unrecognised or MISSING state as
 * `outline` and the label as `unknown`. That is the honesty rule the whole
 * surface rests on: a device coord has no verdict for is unknown, never
 * healthy.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, HeartPulse, RefreshCw } from "lucide-react";
import { CollapsiblePanel } from "@/components/console";
import type { FleetHealthPayload } from "./useFleetHealth";

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

export function deviceStateBadgeVariant(state?: string): BadgeVariant {
  return STATE_BADGE_VARIANT[state ?? ""] ?? "outline";
}

/**
 * The three per-device cross-links (trees / claims / sessions). Extracted so
 * the merged Dev Ops machine list can carry the SAME affordances the card
 * carries — Phase 1 requires them preserved, and a second hand-written copy
 * would be the thing that drifts.
 */
export function DeviceCrossLinks({ deviceId }: { deviceId: string }) {
  return (
    <div className="flex items-center gap-1" data-device-cross-links={deviceId}>
      <Link
        href={`/admin/coord/trees?device_id=${encodeURIComponent(deviceId)}`}
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
  );
}

export interface HealthSummaryCardProps {
  data: FleetHealthPayload | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function HealthSummaryCard({
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
              <DeviceCrossLinks deviceId={d.device_id} />
            </li>
          ))}
        </ul>
      )}
    </CollapsiblePanel>
  );
}
