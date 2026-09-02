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
 * Coord's `ListPoliciesQuery`, as far as the web proxy forwards it.
 *
 * ⚠️ `enabled` is NOT a safe way to list a tenant's turned-off rules. Coord's
 * `DELETE /coord/policies/:id` is a **soft delete** that sets exactly this
 * column (`policies/routes.rs::delete_soft` — `SET enabled = false`), and
 * `coord.policy_rules` carries no tombstone column, so `enabled = false` means
 * "turned off" and "deleted" indistinguishably. Listing that arm would
 * resurrect every rule the tenant has ever deleted. See
 * [`listCoordPolicies`]'s note.
 */
export interface CoordPolicyFilters {
  /** A v1 `PolicyKind` string. Coord 400s an unknown one. */
  kind?: string;
  /** Coord matches this EXACTLY, empty string included — `""` is a real
   *  filter (it selects the degenerate empty-repo rows), not "unfiltered". */
  repo?: string;
  /** EQUALITY, not "show everything": coord binds this as `AND enabled = $2`
   *  against the tenant's own rules. Read the interface note before using it. */
  enabled?: boolean;
}

/**
 * `GET /coord/policies` — the tenant's effective set (its own rows in the
 * requested `enabled` state ∪ the system built-ins, annotated with `built_in` /
 * `override_state`).
 *
 * The filters are coord's own (`policies/routes.rs::ListPoliciesQuery`) and
 * were unreachable from the browser until the web proxy learned to forward a
 * query string. Every current caller still passes NONE of them, taking coord's
 * `enabled = true` default — deliberately.
 *
 * **Why no caller lists the disabled arm.** It looks like the obvious way to
 * show a turned-off rule, and it is not: coord's DELETE is a soft delete onto
 * the same column, with no tombstone to tell the two apart. A console that
 * listed `enabled=false` would show every deleted rule as merely "inactive" and
 * offer to switch it back on. The distinction has to come from coord (a real
 * `deleted_at`, or a `get_list` that excludes soft-deleted rows) before any
 * caller here can honestly read that arm. `kind` / `repo` carry no such
 * hazard.
 *
 * A value is sent when PRESENT, including an empty string — the same rule the
 * proxy follows, so the two halves cannot disagree about what was asked.
 */
export function listCoordPolicies(
  filters?: CoordPolicyFilters
): Promise<ListCoordPoliciesResponse> {
  const qs = new URLSearchParams();
  if (filters?.kind !== undefined) qs.set("kind", filters.kind);
  if (filters?.repo !== undefined) qs.set("repo", filters.repo);
  if (filters?.enabled !== undefined)
    qs.set("enabled", String(filters.enabled));
  const query = qs.toString();
  return httpClient.get<ListCoordPoliciesResponse>(
    query ? `${COORD_POLICIES_API}?${query}` : COORD_POLICIES_API
  );
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
    body,
    {
      // Safe to re-issue: `update_coord_policy` proxies to a plain
      // `UPDATE ... SET <fields>` in coord; field assignment, no version row.
      idempotent: true,
    }
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
