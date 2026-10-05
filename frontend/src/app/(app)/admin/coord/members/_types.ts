/**
 * Wire types for /admin/coord/members — mirror the web backend's /coord/*
 * proxy responses. Moved verbatim out of `page.tsx`.
 */

/** Coord role string. The wire contract uses bare role names. */
export type CoordRole = "admin" | "operator";

// ---------------------------------------------------------------------------
// Wire types — mirror the web backend's /coord/* proxy responses.
// ---------------------------------------------------------------------------

export interface OperatorRow {
  operator_id: string;
  email: string | null;
  display_name: string | null;
  sso_provider: string | null;
  last_login_at: string | null;
  created_at: string | null;
  roles: string[];
}

export interface MembersResponse {
  operators: OperatorRow[];
}

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

export interface GroupTenantRolesResponse {
  group_tenant_roles: GroupTenantRoleRow[];
}

export interface CognitoGroupRow {
  group_name: string;
  description: string | null;
  creation_date: string | null;
  last_modified_date: string | null;
  precedence: number | null;
}

export interface CognitoGroupsResponse {
  groups: CognitoGroupRow[];
}

export interface CognitoGroupUserRow {
  username: string;
  email: string | null;
  status: string | null;
  enabled: boolean | null;
}

export interface CognitoGroupUsersResponse {
  users: CognitoGroupUserRow[];
}

export interface TenantRoleEntry {
  tenant_id?: string;
  /** coord `/admin/coord/me` returns the slug here; `tenant_slug` is a fallback. */
  slug?: string;
  tenant_slug?: string;
  /** The tenant's human-chosen name; null/absent for a tenant that never got one. */
  display_name?: string | null;
  roles?: string[];
}

export interface MyTenantsResponse {
  home_tenant_id?: string | null;
  home_tenant_slug?: string | null;
  tenants?: TenantRoleEntry[];
  roles?: string[];
}
