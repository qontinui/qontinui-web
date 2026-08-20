/**
 * Shared coord policy-rule wire types + the tenant-admin coord-proxy base path.
 *
 * `coord.policy_rules` carries TWO row shapes behind one route family
 * (`POST/PATCH/DELETE /coord/policies`, coord `policies/routes.rs`):
 *
 *  - **v1 typed rule** — `kind` + `condition` + `action` (the six-variant
 *    `PolicyKind` surface). Authored by `/admin/coord/automation-rules`.
 *  - **v2 decision-domain row** — `decision_domain` (+ `mode`, `payload`) with
 *    `kind = NULL`. Authored by `/admin/coord/gate-clearance` (domain
 *    `gate_clearance`) and by coord's own system-band seeder.
 *
 * Both shapes come back through the SAME list route and the same `PolicyRow`
 * JSON, so the row type and the CRUD chain live here rather than being
 * duplicated per surface. Each surface supplies its own filter + its own
 * create/update body types.
 */

/** Tenant-admin coord proxy (web backend → coord). Never coord directly. */
export const COORD_POLICIES_API = "/api/v1/operations/coord/policies";

/**
 * A policy row as returned by `GET /coord/policies` (coord `PolicyRow`).
 *
 * `kind` is a (possibly null) string and `condition`/`action`/`payload` are raw
 * JSON precisely because the route serves both storage shapes: a v2 row has
 * `kind: null`, `condition`/`action` `{}`, and everything meaningful in
 * `payload`.
 */
export interface CoordPolicyRow {
  policy_id: string;
  tenant_id: string;
  repo: string | null;
  name: string;
  kind: string | null;
  decision_domain: string | null;
  mode: string;
  autonomy_level: string;
  payload: unknown | null;
  condition: unknown;
  action: unknown;
  priority: number;
  enabled: boolean;
  rationale: string | null;
  /**
   * The code constant this row was seeded from (e.g. `agent_meta_answer/v1`),
   * naming the canonical default the restore-default route re-seeds from. `null`
   * for hand-authored rows — the Restore-to-default control is shown only when
   * this is non-null (coord `EffectivePolicy.default_source`).
   */
  default_source: string | null;
  expires_at: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  /**
   * True when this row is a SYSTEM built-in surfaced by coord's effective-set
   * resolver (owned by the system tenant, applies to every workspace). The
   * caller can't edit/delete it directly.
   */
  built_in: boolean;
  /**
   * For a built-in: how THIS tenant has overridden it via the system-override
   * route. `null` when the row is not a built-in.
   *
   * ⚠️ The override routes are **v1-only** — see `useCoordPolicies`'s
   * `overrideSystemRule` doc. A v2 (`decision_domain`) surface must not wire
   * them.
   */
  override_state: "active" | "disabled" | "customized" | null;
  /**
   * The system rule's `policy_id`, used as the target of the override routes
   * (`PUT|DELETE /coord/policies/system/{system_rule_id}/override`). `null`
   * when the row is not a built-in.
   */
  system_rule_id: string | null;
}

/** `GET /coord/policies` response. */
export interface ListCoordPoliciesResponse {
  policies: CoordPolicyRow[];
  total: number;
}
