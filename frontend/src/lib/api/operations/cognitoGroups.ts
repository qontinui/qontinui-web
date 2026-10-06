/**
 * `/operations/coord` SSO-group routes: the group -> tenant -> role mappings,
 * the Cognito user-pool groups, their members, and a group delete's
 * blast-radius preview.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5). The mappings live here rather than in `coordMembers.ts` because
 * they are keyed by an IdP group, not by an operator: they are the other half
 * of "auto-provision by SSO group", and their only consumers are that panel
 * and the Cognito group rows.
 *
 * For now each function is the byte-preserving move of a call site out of
 * `admin/coord/members/page.tsx`: the same URL on the absolute
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

/** The body of `POST /coord/group-tenant-roles`. */
export interface GroupTenantRoleCreate {
  group_id: string;
  tenant_slug: string;
  role: string;
  auto_create_tenant: boolean;
}

/** The body of `DELETE /coord/group-tenant-roles` — the mapping's key. */
export interface GroupTenantRoleKey {
  group_id: string;
  tenant_slug: string;
  role: string;
}

/** The body of `POST /coord/cognito/groups`. */
export interface CognitoGroupCreate {
  group_name: string;
  description?: string;
}

/** `GET /coord/group-tenant-roles` — the active tenant's mappings. */
export function fetchGroupTenantRoles(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_API}/coord/group-tenant-roles`);
}

/** `POST /coord/group-tenant-roles` — create (upsert) one mapping. */
export function createGroupTenantRole(
  mapping: GroupTenantRoleCreate
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_API}/coord/group-tenant-roles`, {
    method: "POST",
    // Spelled field by field so the wire key order never depends on how the
    // caller built its object.
    body: JSON.stringify({
      group_id: mapping.group_id,
      tenant_slug: mapping.tenant_slug,
      role: mapping.role,
      auto_create_tenant: mapping.auto_create_tenant,
    }),
  });
}

/** `DELETE /coord/group-tenant-roles` — delete one mapping by its key. */
export function deleteGroupTenantRole(
  mapping: GroupTenantRoleKey
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_API}/coord/group-tenant-roles`, {
    method: "DELETE",
    body: JSON.stringify({
      group_id: mapping.group_id,
      tenant_slug: mapping.tenant_slug,
      role: mapping.role,
    }),
  });
}

/** `GET /coord/cognito/groups` — every group in the user pool. */
export function fetchCognitoGroups(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_API}/coord/cognito/groups`);
}

/** `POST /coord/cognito/groups` — create a group (`description` optional). */
export function createCognitoGroup(
  group: CognitoGroupCreate
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_API}/coord/cognito/groups`, {
    method: "POST",
    body: JSON.stringify(group),
  });
}

/**
 * `DELETE /coord/cognito/groups/{group_name}` — a POOL-WIDE delete.
 *
 * `allowHomeGroup` is the one override the dashboard offers; the backend
 * refuses a `-home` group without it.
 */
export function deleteCognitoGroup(
  groupName: string,
  { allowHomeGroup }: { allowHomeGroup: boolean }
): Promise<Response> {
  const query = allowHomeGroup ? "?allow_home_group=true" : "";
  return httpClient.fetch(
    `${OPERATIONS_API}/coord/cognito/groups/${encodeURIComponent(
      groupName
    )}${query}`,
    { method: "DELETE" }
  );
}

/**
 * `GET /coord/cognito/groups/{group_name}/blast-radius` — what deleting the
 * group would take down, pool-wide.
 */
export function fetchCognitoGroupBlastRadius(
  groupName: string
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_API}/coord/cognito/groups/${encodeURIComponent(
      groupName
    )}/blast-radius`
  );
}

/** `GET /coord/cognito/groups/{group_name}/users` — the group's members. */
export function fetchCognitoGroupUsers(groupName: string): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_API}/coord/cognito/groups/${encodeURIComponent(
      groupName
    )}/users`
  );
}

/** `POST /coord/cognito/groups/{group_name}/users` — add a user by email. */
export function addCognitoGroupUser(
  groupName: string,
  email: string
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_API}/coord/cognito/groups/${encodeURIComponent(
      groupName
    )}/users`,
    { method: "POST", body: JSON.stringify({ email }) }
  );
}

/** `DELETE /coord/cognito/groups/{group_name}/users` — remove a user by email. */
export function removeCognitoGroupUser(
  groupName: string,
  email: string
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_API}/coord/cognito/groups/${encodeURIComponent(
      groupName
    )}/users`,
    { method: "DELETE", body: JSON.stringify({ email }) }
  );
}
