/**
 * `/operations/coord` membership routes: the caller's own tenants, the
 * members list, per-member role grants, and add-a-member-by-email.
 *
 * The first module of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5). For now each function is the byte-preserving move of a call site
 * out of `admin/coord/members/page.tsx`: the same URL on the absolute
 * `OPERATIONS_API` base, the same `httpClient.fetch` options, and the raw
 * `Response` returned, so every caller keeps its own status and error
 * handling. Parsed return types and the relative base are Phase 7a's.
 *
 * Each function calls `httpClient.fetch` directly with its URL inline. A
 * shared `request(path)` helper underneath would make every call site a
 * wrapper-of-a-wrapper, which `route-walker.test.ts` cannot resolve.
 */

import { OPERATIONS_API } from "@/components/operations/utils";
import { httpClient } from "@/services/service-factory";

/** Coord role string sent on the wire (product tiers map onto these). */
export type CoordMemberRole = "admin" | "operator";

/** `GET /coord/my-tenants` — the caller's home tenant and tenant roles. */
export function fetchMyTenants(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_API}/coord/my-tenants`);
}

/** `GET /coord/members` — operators homed in the active tenant. */
export function fetchMembers(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_API}/coord/members`);
}

/** `POST /coord/members/{operator_id}/roles` — grant one role. */
export function grantMemberRole(
  operatorId: string,
  role: CoordMemberRole
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_API}/coord/members/${encodeURIComponent(operatorId)}/roles`,
    { method: "POST", body: JSON.stringify({ role }) }
  );
}

/** `DELETE /coord/members/{operator_id}/roles` — revoke one role. */
export function revokeMemberRole(
  operatorId: string,
  role: string
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_API}/coord/members/${encodeURIComponent(operatorId)}/roles`,
    { method: "DELETE", body: JSON.stringify({ role }) }
  );
}

/** `POST /coord/tenant-members` — give an email a tier in the active tenant. */
export function addTenantMember(
  email: string,
  role: CoordMemberRole
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_API}/coord/tenant-members`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}
