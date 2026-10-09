/**
 * `/operations/computers*` — coord's per-computer sample reads.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D5). Both bodies are typed by `computerStatus.ts`, which also owns the
 * "schema pending" and error classification rules.
 */

import type {
  ComputerDetailWire,
  ComputersListWire,
} from "@/app/(app)/admin/coord/computers/_lib/computerStatus";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /computers` — every computer in the caller's tenant. */
export async function fetchComputers(
  options: HttpOptions = {}
): Promise<ComputersListWire> {
  const url = `${OPERATIONS_BASE}/computers`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ComputersListWire>(res, `GET ${url}`);
}

/** `GET /computers/{computer_id}` — one computer's detail. */
export async function fetchComputer(
  computerId: string,
  options: HttpOptions = {}
): Promise<ComputerDetailWire> {
  const url = `${OPERATIONS_BASE}/computers/${encodeURIComponent(computerId)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ComputerDetailWire>(res, `GET ${url}`);
}
