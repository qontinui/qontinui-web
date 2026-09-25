"use client";

/**
 * Polling hook for the fleet disk-telemetry read,
 * `GET /api/v1/operations/fleet/volumes` (coord's `GET /coord/fleet/volumes`).
 *
 * ## Why this is its own poll now
 *
 * Until plan `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`
 * Phase 4 this read rode inside `FleetOverview`'s `fetchData`, on the 5 s
 * `POLL_INTERVAL_MS` loop, with `httpClient`'s default 5xx retries and no
 * guard against overlap. Coord's read had a median of 4.3 s, so one viewer
 * kept about 12 census reads a minute going, each 504 overlapping the next
 * poll. That load is what hung coord on 2026-09-22. Disk free space does not
 * change on a 5 s scale, so this poll runs at `RESOURCE_POLL_INTERVAL_MS`
 * (30 s), single-flight, with no retries: a 6x cut in per-viewer census reads
 * and nothing lost.
 *
 * ## What it returns
 *
 * A {@link VolumesFetch}, exactly as `FleetOverview` built it before, so what
 * the page renders from it is unchanged. Every failure is `unavailable` WITH a
 * reason. Unlike the sibling hooks the last good reading is NOT kept on
 * failure: a disk section that kept showing the old numbers would present them
 * as confirmed by a read that did not happen (plan D10 /
 * `silent-empty-is-unknown`), which is the posture this surface already had.
 */

import { useCallback, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { FLEET_VOLUMES_API } from "./utils";
import {
  VOLUMES_NOT_YET_READ,
  volumesFetchFromFailure,
  volumesFetchFromPayload,
  type VolumesFetch,
} from "./fleetVolumes";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import { RESOURCE_POLL_INTERVAL_MS } from "./useFleetResourceSamples";
import { useSingleFlightPoll } from "./useSingleFlightPoll";

/** One fleet-volumes read, mapped to what the disk section renders. */
export async function readFleetVolumes(): Promise<VolumesFetch> {
  let res: Response;
  try {
    res = await httpClient.fetch(
      FLEET_VOLUMES_API,
      COORD_DASHBOARD_POLL_OPTIONS
    );
  } catch (err) {
    return {
      state: "unavailable",
      reason: `Request to ${FLEET_VOLUMES_API} failed: ${
        (err as Error)?.message ?? "unknown error"
      }`,
    };
  }
  if (!res.ok) {
    // A body that cannot be read is simply not classified; the status alone
    // still produces an honest `unavailable`.
    const bodyText = await Promise.resolve()
      .then(() => res.text())
      .catch(() => null);
    return volumesFetchFromFailure(res.status, bodyText);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    return {
      state: "unavailable",
      reason: `The fleet-volumes response was not valid JSON: ${
        err instanceof Error ? err.message : "parse error"
      }`,
    };
  }
  return volumesFetchFromPayload(payload);
}

export function useFleetVolumes(): VolumesFetch {
  const [volumes, setVolumes] = useState<VolumesFetch>(VOLUMES_NOT_YET_READ);

  const poll = useCallback(async (isCurrent: () => boolean) => {
    const next = await readFleetVolumes();
    if (isCurrent()) setVolumes(next);
  }, []);

  useSingleFlightPoll(poll, RESOURCE_POLL_INTERVAL_MS);

  return volumes;
}
