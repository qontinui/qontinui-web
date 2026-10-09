/**
 * `/operations/coord` SSO-group routes: the group -> tenant -> role mappings,
 * the Cognito user-pool groups, their members, and a group delete's
 * blast-radius preview.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7a). The mappings live here rather than in `coordMembers.ts`
 * because they are keyed by an IdP group, not by an operator: they are the
 * other half of "auto-provision by SSO group", and their only consumers are
 * that panel and the Cognito group rows.
 *
 * Every function calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE`
 * (same-origin, D6) with its URL inline, states its retry policy, and returns
 * the PARSED body through `readJson`. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`: a caller reads the status with
 * `httpStatusOf` and the operator sentence with `operationsErrorMessage`.
 *
 * The wire types below are hand-written, and each names the backend handler
 * it mirrors in `backend/app/api/v1/endpoints/operations/__init__.py`.
 *
 * A shared `request(path)` helper underneath would make every call site a
 * wrapper-of-a-wrapper, which `route-walker.test.ts` cannot resolve.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** One mapping row of `GroupTenantRolesResponse`. */
export interface GroupTenantRoleRow {
  group_id: string;
  tenant_slug: string;
  role: string;
  auto_create_tenant: boolean;
  created_at: string | null;
  tenant_id: string | null;
  /**
   * Additive fields from coord (qontinui-coord#2473). A mapping stored under a
   * slug its tenant was RENAMED AWAY from is listed for the renamed tenant:
   * `current_slug` is the slug that tenant carries today, and `historical_slug`
   * is true exactly when the stored `tenant_slug` differs from it. Such a row
   * still grants at every login; `tenant_slug` stays the DELETE key. Older
   * coord builds omit both, so absent means "not known to be historical".
   */
  current_slug?: string;
  historical_slug?: boolean;
}

/**
 * `GET /coord/group-tenant-roles` — `get_coord_group_tenant_roles`, proxying
 * coord's `GET /admin/coord/group-tenant-roles`.
 */
export interface GroupTenantRolesResponse {
  group_tenant_roles: GroupTenantRoleRow[];
}

/** The body of `POST /coord/group-tenant-roles`. */
export interface GroupTenantRoleCreate {
  group_id: string;
  tenant_slug: string;
  role: string;
  auto_create_tenant: boolean;
}

/**
 * `POST /coord/group-tenant-roles` — `post_coord_group_tenant_role`, which
 * answers coord's echo of the stored mapping. Nothing in the web app reads
 * it, so only the mapping's own key fields are declared, all optional.
 */
export type GroupTenantRoleEcho = Partial<GroupTenantRoleCreate>;

/** The body of `DELETE /coord/group-tenant-roles` — the mapping's key. */
export interface GroupTenantRoleKey {
  group_id: string;
  tenant_slug: string;
  role: string;
}

/**
 * `DELETE /coord/group-tenant-roles` — `delete_coord_group_tenant_role`:
 * coord's `{ok, deleted}`, or `{status: "ok"}` when coord answered 204
 * (`_proxy_coord_delete`). Every field is optional for that reason.
 */
export interface GroupTenantRoleDeleteResponse {
  ok?: boolean;
  deleted?: unknown;
  status?: string;
}

/**
 * One Cognito group — `cognito_admin._group_to_dict`, the row of
 * `list_cognito_groups` and the whole body of `create_cognito_group`.
 */
export interface CognitoGroupRow {
  group_name: string;
  description: string | null;
  creation_date: string | null;
  last_modified_date: string | null;
  precedence: number | null;
}

/** `GET /coord/cognito/groups` — `list_cognito_groups`. */
export interface CognitoGroupsResponse {
  groups: CognitoGroupRow[];
}

/** The body of `POST /coord/cognito/groups` (`_CreateGroupBody`). */
export interface CognitoGroupCreate {
  group_name: string;
  description?: string;
}

/** One member row of `CognitoGroupUsersResponse`. */
export interface CognitoGroupUserRow {
  username: string;
  email: string | null;
  status: string | null;
  enabled: boolean | null;
}

/** `GET /coord/cognito/groups/{group_name}/users` — `list_cognito_group_users`. */
export interface CognitoGroupUsersResponse {
  users: CognitoGroupUserRow[];
}

/**
 * `DELETE /coord/cognito/groups/{group_name}` (`delete_cognito_group`,
 * `{ok: true}`) and `POST` / `DELETE …/{group_name}/users`
 * (`add_cognito_group_user` / `remove_cognito_group_user`,
 * `{ok: true, username}`).
 */
export interface CognitoGroupWriteResponse {
  ok: boolean;
  username?: string;
}

/**
 * `GET /coord/cognito/groups/{group_name}/blast-radius` —
 * `get_cognito_group_blast_radius`, the backend's `_BlastRadius`: what
 * deleting one Cognito group would take down, POOL-WIDE — the delete's own
 * verdict, read ahead of the click.
 *
 * Partial by design: slugs are named for the caller's OWN tenant only and
 * every other tenant is an integer, so the two `*_total` fields are the honest
 * sizes and the lists never are. A reader that renders a list as "everything
 * affected" is reading it wrong. The members page re-checks the body field by
 * field (`parseBlastRadiusVerdict`) before trusting any of it.
 */
export interface BlastRadiusVerdict {
  group_name: string;
  /** ROW count, pool-wide. */
  mapped_total: number;
  /** Own-tenant slugs, sorted + deduplicated by the backend. */
  mapped_own_tenant: string[];
  /** ROWS in tenants the caller does not administer. */
  mapped_other_tenant_rows: number;
  /** ROWS whose tenant is not materialised yet. */
  mapped_unmaterialized_rows: number;
  /** Distinct TENANTS the delete would leave with no admin at all. */
  strands_total: number;
  strands_own_tenant: string[];
  strands_other_tenant_count: number;
}

/** `GET /coord/group-tenant-roles` — the active tenant's mappings. */
export async function fetchGroupTenantRoles(): Promise<GroupTenantRolesResponse> {
  const url = `${OPERATIONS_BASE}/coord/group-tenant-roles`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<GroupTenantRolesResponse>(res, `GET ${url}`);
}

/**
 * `POST /coord/group-tenant-roles` — create (upsert) one mapping. Not re-sent
 * on a 5xx (`idempotent: false`): with `auto_create_tenant` it can create a
 * tenant, and a gateway timeout can arrive after it did.
 */
export async function createGroupTenantRole(
  mapping: GroupTenantRoleCreate
): Promise<GroupTenantRoleEcho> {
  const url = `${OPERATIONS_BASE}/coord/group-tenant-roles`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    // Spelled field by field so the wire key order never depends on how the
    // caller built its object.
    body: JSON.stringify({
      group_id: mapping.group_id,
      tenant_slug: mapping.tenant_slug,
      role: mapping.role,
      auto_create_tenant: mapping.auto_create_tenant,
    }),
    idempotent: false,
  });
  return readJson<GroupTenantRoleEcho>(res, `POST ${url}`);
}

/**
 * `DELETE /coord/group-tenant-roles` — delete one mapping by its key. Retried
 * on a 5xx by method: repeating a landed delete removes nothing further.
 */
export async function deleteGroupTenantRole(
  mapping: GroupTenantRoleKey
): Promise<GroupTenantRoleDeleteResponse> {
  const url = `${OPERATIONS_BASE}/coord/group-tenant-roles`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    body: JSON.stringify({
      group_id: mapping.group_id,
      tenant_slug: mapping.tenant_slug,
      role: mapping.role,
    }),
    idempotent: true,
  });
  return readJson<GroupTenantRoleDeleteResponse>(res, `DELETE ${url}`);
}

/** `GET /coord/cognito/groups` — every group in the user pool. */
export async function fetchCognitoGroups(): Promise<CognitoGroupsResponse> {
  const url = `${OPERATIONS_BASE}/coord/cognito/groups`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<CognitoGroupsResponse>(res, `GET ${url}`);
}

/**
 * `POST /coord/cognito/groups` — create a group (`description` optional, and
 * absent from the body when not given). Not re-sent on a 5xx: a repeat of a
 * create that landed answers 409, which reads as "already exists".
 */
export async function createCognitoGroup(
  group: CognitoGroupCreate
): Promise<CognitoGroupRow> {
  const url = `${OPERATIONS_BASE}/coord/cognito/groups`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    // Spelled field by field, in a fixed key order; `JSON.stringify` drops an
    // `undefined` description, so an absent one is absent on the wire too.
    body: JSON.stringify({
      group_name: group.group_name,
      description: group.description,
    }),
    idempotent: false,
  });
  return readJson<CognitoGroupRow>(res, `POST ${url}`);
}

/**
 * `DELETE /coord/cognito/groups/{group_name}` — a POOL-WIDE delete.
 *
 * `allowHomeGroup` is the one override the dashboard offers; the backend
 * refuses a `-home` group without it. Retried on a 5xx by method, as every
 * `DELETE` is: a repeat of a landed delete answers 404, never a second delete.
 */
export async function deleteCognitoGroup(
  groupName: string,
  { allowHomeGroup }: { allowHomeGroup: boolean }
): Promise<CognitoGroupWriteResponse> {
  const query = allowHomeGroup ? "?allow_home_group=true" : "";
  const url = `${OPERATIONS_BASE}/coord/cognito/groups/${encodeURIComponent(
    groupName
  )}${query}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: true,
  });
  return readJson<CognitoGroupWriteResponse>(res, `DELETE ${url}`);
}

/**
 * `GET /coord/cognito/groups/{group_name}/blast-radius` — what deleting the
 * group would take down, pool-wide.
 */
export async function fetchCognitoGroupBlastRadius(
  groupName: string
): Promise<BlastRadiusVerdict> {
  const url = `${OPERATIONS_BASE}/coord/cognito/groups/${encodeURIComponent(
    groupName
  )}/blast-radius`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<BlastRadiusVerdict>(res, `GET ${url}`);
}

/** `GET /coord/cognito/groups/{group_name}/users` — the group's members. */
export async function fetchCognitoGroupUsers(
  groupName: string
): Promise<CognitoGroupUsersResponse> {
  const url = `${OPERATIONS_BASE}/coord/cognito/groups/${encodeURIComponent(
    groupName
  )}/users`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<CognitoGroupUsersResponse>(res, `GET ${url}`);
}

/**
 * `POST /coord/cognito/groups/{group_name}/users` — add a user by email. Not
 * re-sent on a 5xx (`idempotent: false`).
 */
export async function addCognitoGroupUser(
  groupName: string,
  email: string
): Promise<CognitoGroupWriteResponse> {
  const url = `${OPERATIONS_BASE}/coord/cognito/groups/${encodeURIComponent(
    groupName
  )}/users`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ email }),
    idempotent: false,
  });
  return readJson<CognitoGroupWriteResponse>(res, `POST ${url}`);
}

/**
 * `DELETE /coord/cognito/groups/{group_name}/users` — remove a user by email.
 * Retried on a 5xx by method: repeating a landed removal removes nothing.
 */
export async function removeCognitoGroupUser(
  groupName: string,
  email: string
): Promise<CognitoGroupWriteResponse> {
  const url = `${OPERATIONS_BASE}/coord/cognito/groups/${encodeURIComponent(
    groupName
  )}/users`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    body: JSON.stringify({ email }),
    idempotent: true,
  });
  return readJson<CognitoGroupWriteResponse>(res, `DELETE ${url}`);
}
