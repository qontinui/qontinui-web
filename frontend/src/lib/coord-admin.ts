/**
 * The ONE spelling of "is this user a coord tenant admin?".
 *
 * `useAuth().isCoordAdmin` (auth-context) and the sidebar's coord-admin-only
 * nav leaves both read it from here, so a page's link, its menu entry and the
 * web proxy's `require_coord_tenant_admin` gate agree on who may reach it.
 * Qontinui superusers (staff) are a superset and pass.
 *
 * Pure and dependency-free on purpose: the sidebar hook's tests mock
 * `@/contexts/auth-context` wholesale, and a predicate living there would be
 * mocked away with it.
 */

export interface CoordAdminSubject {
  coord_is_admin?: boolean | null;
  is_superuser?: boolean | null;
}

export function isCoordAdminUser(
  user: CoordAdminSubject | null | undefined
): boolean {
  return user?.coord_is_admin === true || user?.is_superuser === true;
}
