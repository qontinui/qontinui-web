/**
 * The raw coord-policy HTTP calls — no toasts, no reload, no React.
 *
 * `useCoordPolicies` wraps these with the toast + reload behaviour every
 * single-step edit wants. Multi-step sequences (the gate-clearance replace
 * flow, which coord's payload-less PATCH forces) compose the raw calls instead,
 * so there is exactly ONE place that knows the routes.
 */

import { httpClient } from "@/services/service-factory";
import {
  COORD_POLICIES_API,
  type CoordPolicyRow,
  type ListCoordPoliciesResponse,
} from "./coordPolicies";

/**
 * `GET /coord/policies` — the tenant's effective set (own ENABLED rows ∪ the
 * system built-ins, annotated with `built_in` / `override_state`).
 *
 * No filter arguments: the web backend's proxy forwards no query string to
 * coord (`_proxy_coord_get("/coord/policies", tenant_id=...)`), so coord's
 * `kind` / `repo` / `enabled` filters are unreachable from the browser and
 * every caller filters in TypeScript. Accepting an argument here that the
 * wire silently drops would be worse than not having one.
 */
export function listCoordPolicies(): Promise<ListCoordPoliciesResponse> {
  return httpClient.get<ListCoordPoliciesResponse>(COORD_POLICIES_API);
}

/** `POST /coord/policies` — v1 (`kind`) or v2 (`decision_domain`) body. */
export function createCoordPolicy<TCreate>(
  body: TCreate
): Promise<CoordPolicyRow> {
  return httpClient.post<CoordPolicyRow>(COORD_POLICIES_API, body);
}

/**
 * `PATCH /coord/policies/:id`.
 *
 * ⚠️ Coord's `UpdatePolicyRequest` carries no `payload` field, so a v2 row's
 * domain body is NOT patchable — only name / repo / priority / enabled /
 * rationale / expiry / autonomy_level.
 */
export function patchCoordPolicy<TUpdate>(
  policyId: string,
  body: TUpdate
): Promise<unknown> {
  return httpClient.patch(
    `${COORD_POLICIES_API}/${encodeURIComponent(policyId)}`,
    body
  );
}

/** `DELETE /coord/policies/:id`. */
export function deleteCoordPolicy(policyId: string): Promise<unknown> {
  return httpClient.delete(
    `${COORD_POLICIES_API}/${encodeURIComponent(policyId)}`
  );
}

/** `POST /coord/policies/:id/restore-default` — re-seed from `default_source`. */
export function restoreCoordPolicyDefault(policyId: string): Promise<unknown> {
  return httpClient.post(
    `${COORD_POLICIES_API}/${encodeURIComponent(policyId)}/restore-default`,
    {}
  );
}

/** `PUT /coord/policies/system/:id/override` — v1 shapes only; see
 *  `useCoordPolicies.overrideSystemRule` for why a v2 surface must not use it. */
export function putCoordPolicySystemOverride<TCreate>(
  systemRuleId: string,
  body: { disabled: boolean } | TCreate
): Promise<unknown> {
  return httpClient.put(
    `${COORD_POLICIES_API}/system/${encodeURIComponent(systemRuleId)}/override`,
    body
  );
}

/** `DELETE /coord/policies/system/:id/override` — revert to the built-in. */
export function deleteCoordPolicySystemOverride(
  systemRuleId: string
): Promise<unknown> {
  return httpClient.delete(
    `${COORD_POLICIES_API}/system/${encodeURIComponent(systemRuleId)}/override`
  );
}
