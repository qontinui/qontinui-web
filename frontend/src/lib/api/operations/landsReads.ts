/**
 * `/operations/lands*` — recent lands, land precision and the land preview.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE` with the URL
 * inline; a non-2xx rejects with `<METHOD> <url> failed: <status> - <body>`.
 */

import type { LandRow } from "@/components/admin/coord/landTypes";
import type { LandPreviewResponse } from "@/components/admin/coord/LandPreviewPanel";
import type { PrecisionResponse } from "@/components/admin/coord/LandPrecisionPanel";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

export interface LandsResponse {
  lands?: LandRow[] | null;
}

/** `GET /lands/precision` — a dashboard poll: no client retries. */
export async function fetchLandPrecision(): Promise<PrecisionResponse> {
  const url = `${OPERATIONS_BASE}/lands/precision`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<PrecisionResponse>(res, `GET ${url}`);
}

/** `GET /lands/preview?<query>` — an operator-triggered read: default retries. */
export async function fetchLandPreview(
  query: URLSearchParams
): Promise<LandPreviewResponse> {
  const url = `${OPERATIONS_BASE}/lands/preview?${query.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<LandPreviewResponse>(res, `GET ${url}`);
}

/** `GET /lands?<query>` — a dashboard poll: no client retries. */
export async function fetchRecentLands(
  query: URLSearchParams
): Promise<LandsResponse> {
  const url = `${OPERATIONS_BASE}/lands?${query.toString()}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<LandsResponse>(res, `GET ${url}`);
}
