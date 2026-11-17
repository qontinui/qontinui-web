"use client";

/**
 * Where the window's spawns were placed — one line per device with its
 * dispatch role, its time-to-spawn p50 and how many started, were refused
 * and were deferred (`perDeviceShares`).
 *
 * It is the investigation view's (`/admin/coord/spawns/requests`); the
 * agentic-activity page shows only how many were placed, across how many
 * devices (`SpawnActivitySummary`), and links here.
 */

import { useMemo } from "react";
import { Server } from "lucide-react";
import { ShareList } from "@/components/console";
import {
  SectionCaption,
  captionEntry,
  type SectionSource,
} from "@/components/presentation";
import {
  perDeviceShares,
  type DeviceNaming,
  type DeviceRoles,
  type SpawnStatsWire,
} from "../_lib/spawnStatus";

export function DevicePlacement({
  stats,
  statsStale,
  roles,
  naming,
  windowLabel,
  sources,
}: {
  stats: SpawnStatsWire | null;
  /** The stats are the last good read: the latest one failed. */
  statsStale: boolean;
  roles: DeviceRoles;
  naming: DeviceNaming;
  windowLabel: string;
  sources: readonly SectionSource[];
}) {
  const shares = useMemo(
    () => (stats ? perDeviceShares(stats, roles, naming) : null),
    [stats, roles, naming]
  );
  const roleNote =
    roles.kind === "unknown" ? ` Roles unknown: ${roles.reason}` : "";
  return (
    <section
      className="space-y-2"
      id="placement"
      data-testid="coord-spawns-devices-section"
    >
      <SectionCaption id="agentic-activity.placement" sources={sources} />
      <h2 className="text-sm font-medium flex items-center gap-1.5">
        <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
        {captionEntry("agentic-activity.placement").title} — per device
      </h2>
      <p
        className="text-xs text-muted-foreground m-0"
        data-testid="coord-spawns-reserve-note"
      >
        Spawns placed per device in the {windowLabel}, each line with its
        dispatch role, its time-to-spawn p50 and how many started, were refused
        and were deferred. Each device&apos;s current reserve and ceilings: not
        served yet — they are published once the spawn reserve ships.
        {roleNote}
      </p>
      {shares === null ? (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-spawns-devices-unknown"
        >
          No per-device figures were read — where spawns were placed is unknown,
          not nowhere.
        </p>
      ) : (
        <ShareList
          items={shares.items}
          total={shares.total}
          unit="placed"
          data-testid="coord-spawns-device-list"
          empty={
            <p
              className="text-sm text-muted-foreground"
              data-testid="coord-spawns-devices-empty"
            >
              No spawn was placed on any device in the {windowLabel}
              {statsStale ? " at the last good read" : ""}.
            </p>
          }
        />
      )}
    </section>
  );
}
