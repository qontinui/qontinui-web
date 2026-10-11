/**
 * `/operations/coord/policies` — the tenant-admin coord proxy for
 * `coord.policy_rules` (list, create, patch, soft-delete, restore-default and
 * the system-override pair).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline and returns the PARSED body through
 * `readJson`; a non-2xx rejects with `<METHOD> <url> failed: <status> - <body>`.
 * The row types live in `app/(app)/admin/coord/_shared/coordPolicies.ts`.
 */

import { httpClient } from "@/services/service-factory";
import type {
  CoordPolicyRow,
  ListCoordPoliciesResponse,
} from "@/app/(app)/admin/coord/_shared/coordPolicies";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /coord/policies[?query]` — `query` is the already-built query string. */
export async function fetchCoordPolicies(
  query: string
): Promise<ListCoordPoliciesResponse> {
  const url = query
    ? `${OPERATIONS_BASE}/coord/policies?${query}`
    : `${OPERATIONS_BASE}/coord/policies`;
  const res = await httpClient.fetch(url, { method: "GET" });
  return readJson<ListCoordPoliciesResponse>(res, `GET ${url}`);
}

/** `POST /coord/policies` — v1 (`kind`) or v2 (`decision_domain`) body. */
export async function postCoordPolicy(body: unknown): Promise<CoordPolicyRow> {
  const url = `${OPERATIONS_BASE}/coord/policies`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return readJson<CoordPolicyRow>(res, `POST ${url}`);
}

/**
 * `PATCH /coord/policies/:id`. Safe to re-issue (`idempotent: true`):
 * `update_coord_policy` proxies to a plain field-assignment `UPDATE` in coord.
 */
export async function patchCoordPolicyRow(
  policyId: string,
  body: unknown
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/policies/${encodeURIComponent(policyId)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    idempotent: true,
  });
  return readJson<unknown>(res, `PATCH ${url}`);
}

/** `DELETE /coord/policies/:id` (a soft delete in coord). */
export async function deleteCoordPolicyRow(policyId: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/policies/${encodeURIComponent(policyId)}`;
  const res = await httpClient.fetch(url, { method: "DELETE" });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}

/** `POST /coord/policies/:id/restore-default` — re-seed from `default_source`. */
export async function postCoordPolicyRestoreDefault(
  policyId: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/policies/${encodeURIComponent(policyId)}/restore-default`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/** `PUT /coord/policies/system/:id/override` — v1 shapes only. */
export async function putCoordPolicySystemRuleOverride(
  systemRuleId: string,
  body: unknown
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/policies/system/${encodeURIComponent(systemRuleId)}/override`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return readJson<unknown>(res, `PUT ${url}`);
}

/** `DELETE /coord/policies/system/:id/override` — revert to the built-in. */
export async function deleteCoordPolicySystemRuleOverride(
  systemRuleId: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/policies/system/${encodeURIComponent(systemRuleId)}/override`;
  const res = await httpClient.fetch(url, { method: "DELETE" });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}
