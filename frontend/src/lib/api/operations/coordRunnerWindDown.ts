/**
 * `/operations/fleet/resource-samples` — the per-device readiness read behind
 * `/admin/coord/runners`.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D5, Phase 7). Split from `coordFleet.ts` on purpose: the runner wind-down
 * surface owns its own poll policy. Mirrors `get_fleet_resource_samples` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`, proxying coord's
 * `/coord/fleet/resource-samples`. The body is interpreted in
 * `components/operations/runnerStatus.ts` (`resolveReadiness`), so it is
 * returned as `unknown` here.
 *
 * The function calls `httpClient.fetch` directly with its URL inline over
 * `OPERATIONS_BASE` (same-origin); see `base.ts`.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /fleet/resource-samples?device_id=&history=false` — the device's latest
 * resource sample (the readiness verdict rides on it).
 *
 * A dashboard poll: `maxRetries: 0`, because the next tick is the retry. A
 * non-2xx rejects with `GET <url> failed: <status> - <body>` (read the status
 * back with `httpStatusOf`).
 */
export async function fetchDeviceResourceSamples(
  deviceId: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/resource-samples?device_id=${encodeURIComponent(
    deviceId
  )}&history=false`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<unknown>(res, `GET ${url}`);
}
