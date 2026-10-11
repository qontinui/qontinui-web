/**
 * `/operations/fleet-policy` — the one backend proxy every fleet-policy dial
 * (tenant band and repo band) reads and writes.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Wire types live in `app/(app)/admin/coord/_shared/fleetPolicy.ts`.
 * Calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE` with its URL
 * inline and parses through `readJson`.
 */

import type {
  FleetPolicyView,
  FleetPolicyWriteResult,
} from "@/app/(app)/admin/coord/_shared/fleetPolicy";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /fleet-policy?domain=` — the effective view of one policy domain. */
export async function fetchFleetPolicy(
  domain: string
): Promise<FleetPolicyView> {
  const url = `${OPERATIONS_BASE}/fleet-policy?domain=${encodeURIComponent(domain)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<FleetPolicyView>(res, `GET ${url}`);
}

/** The body of `PUT /fleet-policy`. */
export interface FleetPolicyWriteBody {
  domain: string;
  scope_band: "tenant" | "repo";
  scope_key: string | null;
  level: string;
  master_enabled: boolean;
  change_note: string;
}

/** `PUT /fleet-policy` — write one band's level; the result carries the read-back. */
export async function putFleetPolicy(
  body: FleetPolicyWriteBody
): Promise<FleetPolicyWriteResult> {
  const url = `${OPERATIONS_BASE}/fleet-policy`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return readJson<FleetPolicyWriteResult>(res, `PUT ${url}`);
}
