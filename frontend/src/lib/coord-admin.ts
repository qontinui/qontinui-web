/**
 * "Is this user a coord tenant admin?" — two questions, kept apart.
 *
 * - {@link isCoordAdminUser} is the UNION: `coord_is_admin` is true when the
 *   user administers ANY tenant they belong to (the web backend derives it
 *   that way; `operations.py` says so beside `require_coord_tenant_admin`).
 *   `useAuth().isCoordAdmin` is this, and it is right only where a union is
 *   the question.
 * - {@link isActiveTenantCoordAdmin} is the question `require_coord_tenant_admin`
 *   actually asks: admin IN THE EFFECTIVE TENANT. An admin of tenant A with
 *   tenant B selected is refused by that gate, so a link or menu entry to an
 *   admin-gated read must use this one, or it promises a page that 403s.
 *
 * Pure and dependency-free on purpose: the sidebar hook's tests mock the auth
 * and tenant contexts wholesale, and a predicate living there would be mocked
 * away with them.
 */

export interface CoordAdminSubject {
  coord_is_admin?: boolean | null;
  is_superuser?: boolean | null;
}

/** Union across tenants (or a superuser). See the module doc before using it to gate a link. */
export function isCoordAdminUser(
  user: CoordAdminSubject | null | undefined
): boolean {
  return user?.coord_is_admin === true || user?.is_superuser === true;
}

export interface TenantRoles {
  id: string;
  /** Absent on a web backend that predates per-tenant roles — UNKNOWN. */
  roles?: string[];
}

/**
 * Admin in the ACTIVE tenant — the same question `require_coord_tenant_admin`
 * answers, from the tenant list's per-tenant `roles`.
 *
 * A superuser always passes (the backend gate lets staff through too). When
 * the active tenant's `roles` are absent — a backend predating per-tenant
 * roles, the list not loaded yet, or no selection resolved — the answer falls
 * back to the `coord_is_admin` union, the only signal left; the backend gate
 * still decides, and the page renders its 403 as "admin only".
 */
export function isActiveTenantCoordAdmin(input: {
  user: CoordAdminSubject | null | undefined;
  tenants: readonly TenantRoles[];
  activeTenantId: string | null;
}): boolean {
  const { user, tenants, activeTenantId } = input;
  if (user?.is_superuser === true) return true;
  const active = tenants.find((t) => t.id === activeTenantId);
  if (Array.isArray(active?.roles)) return active.roles.includes("admin");
  return user?.coord_is_admin === true;
}
