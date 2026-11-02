/**
 * `/operations/coord` membership routes: the caller's own tenants, the
 * members list, per-member role grants, and add-a-member-by-email.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7a). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` (same-origin, D6) with its URL inline, states its retry
 * policy, and returns the PARSED body through `readJson`. A non-2xx rejects
 * with `<METHOD> <url> failed: <status> - <body>`: a caller reads the status
 * with `httpStatusOf` and the operator sentence with `operationsErrorMessage`.
 *
 * The wire types below are hand-written (these handlers declare no
 * `response_model`), and each names the backend handler it mirrors in
 * `backend/app/api/v1/endpoints/operations/__init__.py`.
 *
 * Writes whose result no caller reads resolve `null` for a 2xx whose body does
 * not parse (a 204 included): the 2xx is the fact that the change landed, and
 * failing it would invite a repeat of a write that already happened.
 *
 * A shared `request(path)` helper underneath would make every call site a
 * wrapper-of-a-wrapper, which `route-walker.test.ts` cannot resolve.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * The coord role string a member grant sends on the wire — the bare role
 * names the members page offers (its product tiers map onto these). The ONE
 * role type for the members surface.
 */
export type CoordMemberRole = "admin" | "operator";

/** One tenant membership — an entry of `MyTenantsResponse.tenants`. */
export interface TenantRoleEntry {
  tenant_id?: string;
  /** coord `/admin/coord/me` returns the slug here; `tenant_slug` is a fallback. */
  slug?: string;
  tenant_slug?: string;
  /** The tenant's human-chosen name; null/absent for a tenant that never got one. */
  display_name?: string | null;
  roles?: string[];
}

/**
 * `GET /coord/my-tenants` — `get_coord_my_tenants`, a raw passthrough of
 * coord's `/admin/coord/me` with no response model. Every field is optional
 * because no key's absence is decidable here.
 */
export interface MyTenantsResponse {
  home_tenant_id?: string | null;
  home_tenant_slug?: string | null;
  tenants?: TenantRoleEntry[];
  roles?: string[];
}

/** One operator row of `MembersResponse`. */
export interface OperatorRow {
  operator_id: string;
  email: string | null;
  display_name: string | null;
  sso_provider: string | null;
  last_login_at: string | null;
  created_at: string | null;
  roles: string[];
}

/**
 * `GET /coord/members` — `get_coord_members`, proxying coord's
 * `GET /admin/coord/operators` (scoped to the caller's tenant by coord).
 */
export interface MembersResponse {
  operators: OperatorRow[];
}

/**
 * `POST` / `DELETE /coord/members/{operator_id}/roles` —
 * `post_coord_member_role` / `delete_coord_member_role`, proxying coord's
 * operator role write, which answers `{ok: true}`.
 */
export interface MemberRoleWriteResponse {
  ok: boolean;
}

/**
 * `POST /coord/tenant-members` — `post_coord_tenant_member`.
 *
 * `status` is declared optional against the wire even though the backend
 * always sends it: a 2xx that carries no arm is a body the caller cannot
 * describe, and the only honest rendering of it is an error, not a silent
 * success.
 */
export interface TenantMemberAddResponse {
  /** `added` | `invited` | `invitation_pending` | `invite_required`. */
  status?: string;
  operator_id?: string;
  role?: string;
  /**
   * `added` only — what happened to the "you have been given access" email.
   * `sent`, `not_sent`, or `not_needed` (they already had access to this
   * team, so nothing was sent and nothing needed to be). Absent on a backend
   * that predates the notice, which is a further state (UNKNOWN) rather than
   * a failure: the copy then says nothing about email rather than claiming
   * any outcome.
   */
  notice?: string;
}

/** `GET /coord/my-tenants` — the caller's home tenant and tenant roles. */
export async function fetchMyTenants(): Promise<MyTenantsResponse | null> {
  const url = `${OPERATIONS_BASE}/coord/my-tenants`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  // `| null`: a passthrough with no response model can answer a bare `null`,
  // which the caller must refuse rather than render as "no roles".
  return readJson<MyTenantsResponse | null>(res, `GET ${url}`);
}

/** `GET /coord/members` — operators homed in the active tenant. */
export async function fetchMembers(): Promise<MembersResponse> {
  const url = `${OPERATIONS_BASE}/coord/members`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<MembersResponse>(res, `GET ${url}`);
}

/**
 * `POST /coord/members/{operator_id}/roles` — grant one role. Not re-sent on
 * a 5xx (`idempotent: false`): a gateway timeout can arrive after coord
 * already wrote the grant.
 */
export async function grantMemberRole(
  operatorId: string,
  role: CoordMemberRole
): Promise<MemberRoleWriteResponse | null> {
  const url = `${OPERATIONS_BASE}/coord/members/${encodeURIComponent(operatorId)}/roles`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ role }),
    idempotent: false,
  });
  return readJson<MemberRoleWriteResponse>(res, `POST ${url}`, {
    unparseable: "null",
  });
}

/**
 * `DELETE /coord/members/{operator_id}/roles` — revoke one role. A `DELETE`
 * is retried on a 5xx by method (RFC 9110): repeating a landed revoke
 * removes nothing further.
 */
export async function revokeMemberRole(
  operatorId: string,
  role: string
): Promise<MemberRoleWriteResponse | null> {
  const url = `${OPERATIONS_BASE}/coord/members/${encodeURIComponent(operatorId)}/roles`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    body: JSON.stringify({ role }),
    idempotent: true,
  });
  return readJson<MemberRoleWriteResponse>(res, `DELETE ${url}`, {
    unparseable: "null",
  });
}

/**
 * `POST /coord/tenant-members` — give an email a tier in the active tenant.
 * Never re-sent on a 5xx (`idempotent: false`): it can send an invitation
 * email, and a blind repeat could send a second one.
 */
export async function addTenantMember(
  email: string,
  role: CoordMemberRole
): Promise<TenantMemberAddResponse> {
  const url = `${OPERATIONS_BASE}/coord/tenant-members`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ email, role }),
    idempotent: false,
  });
  return readJson<TenantMemberAddResponse>(res, `POST ${url}`);
}
