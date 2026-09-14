/**
 * One device-status row per join key — and always the NEWEST one.
 *
 * `useDeviceStatusStream` keys its map by {@link coordDeviceHostKey}
 * (`hostname ?? device_id`), and two devices can share a hostname: a re-paired
 * box comes back with a new `device_id` while coord still holds the old row.
 * Only one row fits under that key, so which one wins decides whose runner
 * report every consumer sees — the machine row, the tile, and the devops
 * strip's credential rollup.
 *
 * Coord serves `GET /coord/status` `ORDER BY updated_at DESC`. A naive
 * `map.set(key, row)` loop over that order therefore leaves the OLDEST row
 * under a shared hostname, hiding the live device behind the stale one. These
 * two functions keep the newest instead, and do not rely on server order
 * alone: `updated_at` decides whenever both rows carry a parseable stamp, and
 * only when one does not does position (first-seen = newest-first) decide.
 *
 * Pure, so the rule is unit-tested without a WebSocket.
 */

import { coordDeviceHostKey } from "./coordCredentialStatus";
import type { DeviceStatus } from "./types";

/** The fields the rule reads. Every `DeviceStatus` satisfies it. */
type KeyedRow = Pick<DeviceStatus, "device_id" | "hostname" | "updated_at">;

function stampMs(row: KeyedRow): number | null {
  const ms = Date.parse(row.updated_at ?? "");
  return Number.isFinite(ms) ? ms : null;
}

/**
 * `true` iff `a` is strictly newer than `b` by `updated_at`; `null` when either
 * row lacks a parseable stamp (the caller then falls back to position).
 */
function isStrictlyNewer(a: KeyedRow, b: KeyedRow): boolean | null {
  const aMs = stampMs(a);
  const bMs = stampMs(b);
  return aMs === null || bMs === null ? null : aMs > bMs;
}

/**
 * Index a REST seed. Rows are expected newest-first (coord's order), so the
 * FIRST row seen under a key is kept unless a later row is provably newer by
 * `updated_at`.
 */
export function indexDeviceStatusRows<T extends KeyedRow>(
  rows: readonly T[]
): Map<string, T> {
  const next = new Map<string, T>();
  for (const row of rows) {
    const key = coordDeviceHostKey(row);
    const current = next.get(key);
    if (current === undefined || isStrictlyNewer(row, current) === true) {
      next.set(key, row);
    }
  }
  return next;
}

/**
 * Apply one pushed diff to the map.
 *
 * - An update for the SAME `device_id` always replaces: it is that device's own
 *   latest report, whatever its stamp says relative to the one it supersedes.
 * - A row for a DIFFERENT device under the same key replaces the current row
 *   unless the current row is provably newer — so a late frame from the
 *   retired half of a re-paired box cannot hide the live half.
 *
 * Returns `prev` itself when the frame is not applied, so a React state updater
 * that returns it skips the re-render; otherwise a NEW Map (consumers' memos
 * key on identity).
 */
export function mergeDeviceStatusRow<T extends KeyedRow>(
  prev: Map<string, T>,
  row: T
): Map<string, T> {
  const key = coordDeviceHostKey(row);
  const current = prev.get(key);
  if (
    current !== undefined &&
    current.device_id !== row.device_id &&
    isStrictlyNewer(current, row) === true
  ) {
    return prev;
  }
  const next = new Map(prev);
  next.set(key, row);
  return next;
}
