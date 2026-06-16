/**
 * Coord role helpers for Coord Console UI gating.
 *
 * The single source of truth for coord authorization is coord's server-side
 * RBAC. Coord's role hierarchy is `operator < agent_supervisor < admin`
 * (`coord/src/rbac.rs`), resolved from the forwarded Cognito bearer; a higher
 * role implicitly satisfies a lower one.
 *
 * These helpers are a UX boundary ONLY — they hide controls a caller's role
 * can't successfully drive. Coord enforces the real boundary independently
 * (its `operator_admin_writes` sub-router wraps role-gated routes with
 * `require_role`, and tenant-scoped routes 403 callers that aren't linked
 * tenant members), and qontinui-web's `/operations` proxy forwards the bearer
 * and propagates coord's 403. Do NOT use `is_superuser` (a qontinui-web staff
 * flag) for coord gating — it is unrelated to the coord role hierarchy.
 *
 * `CoordIdentity` here is the frontend-facing shape returned by
 * `GET /api/v1/operations/coord/identity` (which reuses the backend's
 * `coord_identity` fetch of coord `GET /admin/coord/me`).
 */

/** Coord role hierarchy, least → most privileged. Mirrors `rbac.rs`. */
export const COORD_ROLE_HIERARCHY = [
  "operator",
  "agent_supervisor",
  "admin",
] as const;

export type CoordRole = (typeof COORD_ROLE_HIERARCHY)[number];

/** Frontend view of the caller's coord roles. */
export interface CoordIdentity {
  /** All coord roles the caller holds (may include custom non-hierarchy roles). */
  roles: string[];
  /** True when the caller holds `admin` on their home tenant. */
  isAdmin: boolean;
}

/**
 * True when `held` satisfies `required` per the coord hierarchy. Matches
 * `rbac.rs::role_satisfies`: hierarchy roles compare by rank (held rank ≥
 * required rank); non-hierarchy roles match only exactly.
 */
function roleSatisfies(held: string, required: string): boolean {
  const heldIdx = COORD_ROLE_HIERARCHY.indexOf(held as CoordRole);
  const reqIdx = COORD_ROLE_HIERARCHY.indexOf(required as CoordRole);
  if (heldIdx >= 0 && reqIdx >= 0) {
    return heldIdx >= reqIdx;
  }
  return held === required;
}

/**
 * True when the identity holds at least `required` per the coord hierarchy.
 * Mirrors `rbac.rs::has_required_role`.
 */
export function coordRoleAtLeast(
  identity: CoordIdentity | null | undefined,
  required: CoordRole | string
): boolean {
  if (!identity) return false;
  return identity.roles.some((r) => roleSatisfies(r, required));
}

/** True when the caller can drive admin-gated coord controls. */
export function canAdminCoord(
  identity: CoordIdentity | null | undefined
): boolean {
  // `isAdmin` is coord's authoritative per-tenant flag; fall back to a role
  // check for parity with `coordRoleAtLeast`.
  return Boolean(identity?.isAdmin) || coordRoleAtLeast(identity, "admin");
}

/**
 * True when the caller is a coord tenant member at all (any resolvable role).
 * Coord gates its tenant-scoped console routes (spawn, plan transition, memory
 * writes, question respond, PR-merge writes, gates, sessions, onboarding) on
 * tenant membership only — NOT on a role tier — so any member can drive them.
 */
export function isCoordMember(
  identity: CoordIdentity | null | undefined
): boolean {
  return Boolean(identity && identity.roles.length > 0);
}
