/**
 * The spawn requests investigation view's route, and the `?window=` the
 * agentic-activity page links to it with.
 */

import type { SpawnStatsWindow } from "@/lib/api/operations/coordSpawns";
import { SPAWN_WINDOWS } from "./spawnStatus";

/** The investigation view: the per-request list and the per-device placement. */
export const SPAWN_REQUESTS_HREF = "/admin/coord/spawns/requests";

/** The investigation view for a window, at one of its sections. */
export function spawnRequestsHref(
  windowId: SpawnStatsWindow,
  section?: "placement"
): string {
  return `${SPAWN_REQUESTS_HREF}?window=${windowId}${section ? `#${section}` : ""}`;
}

/** The `?window=` a link carried, or `null` for none or one this page does not offer. */
export function windowFromQuery(search: string): SpawnStatsWindow | null {
  const raw = new URLSearchParams(search).get("window");
  return SPAWN_WINDOWS.some((w) => w.id === raw)
    ? (raw as SpawnStatsWindow)
    : null;
}
