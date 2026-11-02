"use client";

/**
 * What both spawns pages — the agentic-activity page and its requests
 * investigation view (`/admin/coord/spawns/requests`) — need the same way: the
 * page clock, how a device is named, and each device's dispatch role.
 */

import { useEffect, useMemo, useState } from "react";
import { useMachineAliaser } from "@/components/presentation";
import {
  describeRole,
  type DispatchRolesRead,
} from "@/components/operations/fleetDispatchRoles";
import {
  deviceName,
  type DeviceNaming,
  type DeviceRoles,
  type RosterDevice,
} from "./spawnStatus";

/** An RFC 3339 instant as the reader's clock time, or "an unknown time". */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "an unknown time" : d.toLocaleString();
}

/**
 * The page's clock: a waiting request's age grows by TIME, and the request
 * nobody picks up is exactly the one that sends nothing to re-render the
 * page. A drain's deadline passes the same way.
 */
export function usePageClock(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return nowMs;
}

/**
 * How a page names a device: the roster's hostname for the operator, the
 * session alias while presenting (D3.3) — and no device id while presenting.
 */
export function useDeviceNaming(
  roster: ReadonlyArray<RosterDevice>,
  presenting: boolean
): DeviceNaming {
  const aliaser = useMachineAliaser();
  return useMemo<DeviceNaming>(
    () => ({
      nameOf: (deviceId: string) => {
        const hostname =
          roster.find(
            (d) => d.device_id.toLowerCase() === deviceId.toLowerCase()
          )?.hostname ?? null;
        return presenting
          ? aliaser({ deviceId, hostname })
          : deviceName(deviceId, roster);
      },
      showIds: !presenting,
    }),
    [aliaser, presenting, roster]
  );
}

/** Each device's dispatch role, or why the roles are unknown. */
export function useDeviceRoles(read: DispatchRolesRead): DeviceRoles {
  return useMemo<DeviceRoles>(() => {
    if (read.state === "loading") {
      return {
        kind: "unknown",
        reason: "the dispatch-role read has not answered yet",
      };
    }
    if (read.state === "unknown")
      return { kind: "unknown", reason: read.reason };
    const byDevice = new Map<string, string>();
    for (const m of read.machines) {
      if (m.deviceId) byDevice.set(m.deviceId, describeRole(m));
    }
    return { kind: "known", byDevice };
  }, [read]);
}
