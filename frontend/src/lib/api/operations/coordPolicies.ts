/**
 * `/operations/coord/policies` routes: coord's policy rules, as the web
 * backend proxies them (`backend/app/api/v1/endpoints/operations/__init__.py`
 * `list_coord_policies`, `create_coord_policy`, `update_coord_policy`,
 * `delete_coord_policy`, `restore_coord_policy_default`,
 * `put_coord_policy_override`, `delete_coord_policy_override`).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 5). Moved here from `admin/coord/_shared/coordPolicyApi.ts`
 * (the raw calls) and `_shared/coordPolicies.ts` (the wire types). Same
 * conventions as `repos.ts`: `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE`, the URL inline, the retry policy stated, and a non-2xx
 * rejecting with `<METHOD> <url> failed: <status> - <body>` — what the
 * `httpClient.get` / `post` / … helpers these calls used to go through threw,
 * so every caller's error text is unchanged.
 *
 * No toasts, no reload, no React. `useCoordPolicies` wraps these with the
 * toast + reload behaviour every single-step edit wants; multi-step sequences
 * (the gate-clearance replace flow, which coord's payload-less PATCH forces)
 * compose the raw calls instead, so there is exactly ONE place that knows the
 * routes.
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

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * A policy row as returned by `GET /coord/policies` (coord `PolicyRow`, passed
 * through untyped by `list_coord_policies`).
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
 * `GET /coord/policies` (`list_coord_policies`) — the tenant's effective set
 * (its own rows in the requested `enabled` state ∪ the system built-ins,
 * annotated with `built_in` / `override_state`).
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
export async function listCoordPolicies(
  filters?: CoordPolicyFilters
): Promise<ListCoordPoliciesResponse> {
  const qs = new URLSearchParams();
  if (filters?.kind !== undefined) qs.set("kind", filters.kind);
  if (filters?.repo !== undefined) qs.set("repo", filters.repo);
  if (filters?.enabled !== undefined)
    qs.set("enabled", String(filters.enabled));
  const query = qs.toString();
  const url = query
    ? `${OPERATIONS_BASE}/coord/policies?${query}`
    : `${OPERATIONS_BASE}/coord/policies`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListCoordPoliciesResponse>(res, `GET ${url}`);
}

/**
 * `POST /coord/policies` (`create_coord_policy`) — v1 (`kind`) or v2
 * (`decision_domain`) body. Never re-sent on a 5xx (`idempotent: false`): a
 * gateway timeout can arrive after coord inserted the row, and a repeat would
 * create a second one.
 */
export async function createCoordPolicy<TCreate>(
  body: TCreate
): Promise<CoordPolicyRow> {
  const url = `${OPERATIONS_BASE}/coord/policies`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<CoordPolicyRow>(res, `POST ${url}`);
}

/**
 * `PATCH /coord/policies/:id` (`update_coord_policy`).
 *
 * ⚠️ Coord's `UpdatePolicyRequest` carries no `payload` field, so a v2 row's
 * domain body is NOT patchable — only name / repo / priority / enabled /
 * rationale / expiry / autonomy_level.
 *
 * Safe to re-issue (`idempotent: true`, as before the move):
 * `update_coord_policy` proxies to a plain `UPDATE ... SET <fields>` in coord;
 * field assignment, no version row.
 */
export async function patchCoordPolicy<TUpdate>(
  policyId: string,
  body: TUpdate
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/policies/${encodeURIComponent(policyId)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    idempotent: true,
  });
  return readJson<unknown>(res, `PATCH ${url}`);
}

/**
 * `DELETE /coord/policies/:id` (`delete_coord_policy`) — coord's soft delete.
 * A 204 resolves `undefined`, as `httpClient.delete` did.
 */
export async function deleteCoordPolicy(policyId: string): Promise<unknown> {
  // `idempotent: false` is a no-op here: the client still retries a DELETE
  // on a 5xx by method, exactly as `httpClient.delete` did.
  const url = `${OPERATIONS_BASE}/coord/policies/${encodeURIComponent(policyId)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: false,
  });
  if (res.status === 204) return undefined;
  return readJson<unknown>(res, `DELETE ${url}`);
}

/**
 * `POST /coord/policies/:id/restore-default` (`restore_coord_policy_default`)
 * — re-seed from `default_source`. Sends `{}`, as before the move. Never
 * re-sent on a 5xx.
 */
export async function restoreCoordPolicyDefault(
  policyId: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/policies/${encodeURIComponent(policyId)}/restore-default`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/**
 * `PUT /coord/policies/system/:id/override` (`put_coord_policy_override`) —
 * v1 shapes only; see `useCoordPolicies.overrideSystemRule` for why a v2
 * surface must not use it.
 */
export async function putCoordPolicySystemOverride<TCreate>(
  systemRuleId: string,
  body: { disabled: boolean } | TCreate
): Promise<unknown> {
  // `idempotent: false` is a no-op here: the client still retries a PUT on a
  // 5xx by method, exactly as `httpClient.put` did.
  const url = `${OPERATIONS_BASE}/coord/policies/system/${encodeURIComponent(systemRuleId)}/override`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `PUT ${url}`);
}

/**
 * `DELETE /coord/policies/system/:id/override` (`delete_coord_policy_override`)
 * — revert to the built-in. A 204 resolves `undefined`.
 */
export async function deleteCoordPolicySystemOverride(
  systemRuleId: string
): Promise<unknown> {
  // `idempotent: false` is a no-op here: the client still retries a DELETE
  // on a 5xx by method, exactly as `httpClient.delete` did.
  const url = `${OPERATIONS_BASE}/coord/policies/system/${encodeURIComponent(systemRuleId)}/override`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: false,
  });
  if (res.status === 204) return undefined;
  return readJson<unknown>(res, `DELETE ${url}`);
}
