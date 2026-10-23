/**
 * The worktree-slot join, pure (plan
 * `2026-09-21-worktree-slots-devops-dashboard-view.md` Phase 3).
 *
 * Lifted out of `FleetWorktreeSlotsSection.tsx` by plan
 * `2026-10-23-console-presentation-spaces` Phase 7, because two readers now
 * need the SAME join: the section's table, and the Dev Ops headline strip's
 * "agent workspaces in use" figure. Two joins over one read would be two
 * chances for the strip and the table beneath it to disagree about which
 * machines are counted.
 *
 * **The device list is the spine.** A device with no entry in
 * `GET /fleet/worktree-slots` (not registered on that door, or truncated out
 * by its device cap) still gets a row, `entry: null` — UNKNOWN, never
 * silently dropped. A device the response names that the caller's device list
 * does not is still a row too, under its raw id: discarding a machine that is
 * publishing would be the same class of lie as discarding one that is not.
 *
 * **`census_recent_rows === 0` is UNKNOWN.** Coord found no
 * `coord.worktree_census` row for that device inside the narrow window, so its
 * `active_worktrees` could not be corroborated as live. That is never an idle
 * machine and never a healthy `0/8`.
 */

import type { FleetDeviceRef } from "./fleetResources";
import type { WorktreeSlotDevice } from "./useFleetWorktreeSlots";

export interface WorktreeSlotRow {
  deviceId: string;
  /**
   * Every hostname this row can be known by — the device list's, else the
   * slot entry's — so a presentation alias links it to the same machine the
   * other panels name. Not what the operator sees: that is `displayName`.
   */
  hostname: string | null;
  /** The device list's hostname when it carries one, the device id otherwise. */
  displayName: string;
  /** `null` when this device has no entry in coord's response — UNKNOWN,
   * never dropped. */
  entry: WorktreeSlotDevice | null;
}

/** Join coord's device list (the spine) to the worktree-slots response. */
export function buildWorktreeSlotRows(
  devices: FleetDeviceRef[],
  data: { devices: WorktreeSlotDevice[] } | null
): WorktreeSlotRow[] {
  const byDevice = new Map<string, WorktreeSlotDevice>();
  for (const d of data?.devices ?? []) byDevice.set(d.device_id, d);

  const known = new Map<string, FleetDeviceRef>();
  for (const d of devices) known.set(d.device_id, d);
  for (const deviceId of byDevice.keys()) {
    if (!known.has(deviceId)) known.set(deviceId, { device_id: deviceId });
  }

  const rows: WorktreeSlotRow[] = [];
  for (const [deviceId, device] of known) {
    const entry = byDevice.get(deviceId) ?? null;
    rows.push({
      deviceId,
      hostname: device.hostname || entry?.hostname || null,
      displayName: device.hostname || deviceId,
      entry,
    });
  }
  return rows;
}

/** Whether a row's slot count is corroborated as live (see the module doc). */
export function slotRowIsKnown(
  row: WorktreeSlotRow
): row is WorktreeSlotRow & { entry: WorktreeSlotDevice } {
  return row.entry !== null && row.entry.census_recent_rows > 0;
}
