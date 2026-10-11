/**
 * `/operations/computers` — the computer list and one computer's detail.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Both are dashboard polls: no client retries (`maxRetries: 0`), the
 * next tick is the retry. Wire types live in
 * `app/(app)/admin/coord/computers/_lib/computerStatus.ts`.
 */

import type {
  ComputerDetailWire,
  ComputersListWire,
} from "@/app/(app)/admin/coord/computers/_lib/computerStatus";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /computers`. */
export async function fetchComputers(): Promise<ComputersListWire> {
  const url = `${OPERATIONS_BASE}/computers`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<ComputersListWire>(res, `GET ${url}`);
}

/** `GET /computers/{id}`. */
export async function fetchComputer(
  computerId: string
): Promise<ComputerDetailWire> {
  const url = `${OPERATIONS_BASE}/computers/${encodeURIComponent(computerId)}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<ComputerDetailWire>(res, `GET ${url}`);
}
