/**
 * `/operations/trees` — the primary-tree reads behind `/admin/coord/trees`:
 * one device's trees, and the cross-device path contention.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` with its URL inline and parses through
 * `readJson`. Both are dashboard polls: one request, no client retries
 * (`maxRetries: 0`) — the next tick is the retry.
 */

import { httpClient } from "@/services/service-factory";
import type { PrimaryTreeRow } from "@/components/admin/coord/treeStatus";
import { OPERATIONS_BASE, readJson } from "./base";

/** One repo whose primary checkout path is shared by several devices. */
export interface ContentionRow {
  repo: string;
  primary_paths?: string[];
  devices?: { device_id: string; hostname?: string; primary_path: string }[];
}

/** The body of `GET /trees/by-device/{device_id}`. */
export interface TreesByDeviceResponse {
  device_id?: string;
  trees?: PrimaryTreeRow[];
}

/** The body of `GET /trees/contention`. */
export interface ContentionResponse {
  overlaps?: ContentionRow[];
}

/** `GET /trees/by-device/{device_id}` — the primary trees one device reports. */
export async function fetchTreesByDevice(
  deviceId: string
): Promise<TreesByDeviceResponse> {
  const url = `${OPERATIONS_BASE}/trees/by-device/${encodeURIComponent(deviceId)}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<TreesByDeviceResponse>(res, `GET ${url}`);
}

/** `GET /trees/contention` — repos whose primary path overlaps across devices. */
export async function fetchTreeContention(): Promise<ContentionResponse> {
  const url = `${OPERATIONS_BASE}/trees/contention`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<ContentionResponse>(res, `GET ${url}`);
}
