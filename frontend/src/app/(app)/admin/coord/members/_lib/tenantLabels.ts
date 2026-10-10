/**
 * Tier and tenant labels for /admin/coord/members: the tier <-> coord role
 * mapping, tenant display names, the historical-slug helpers, the rename
 * target, and the tenant-slug constraint. Pure; moved verbatim out of
 * `page.tsx`.
 */

import type { RenameTarget } from "@/components/admin/coord/CoordProjectRenameDialog";
import type {
  CoordMemberRole,
  MyTenantsResponse,
  TenantRoleEntry,
} from "@/lib/api/operations/coordMembers";
import type { GroupTenantRoleRow } from "@/lib/api/operations/cognitoGroups";

// ---------------------------------------------------------------------------
// Tier ↔ coord role mapping
// ---------------------------------------------------------------------------

interface TierOption {
  /** Coord role sent to the API. */
  role: CoordMemberRole;
  /** Product-tier label shown in the UI. */
  label: string;
}

/** Primary tier choices offered in every role selector. */
export const TIER_OPTIONS: TierOption[] = [
  { role: "admin", label: "Administrator" },
  { role: "operator", label: "Developer" },
];

/** Render a coord role as its product-tier label (falls back to the raw role). */
export function tierLabel(role: string): string {
  const opt = TIER_OPTIONS.find((t) => t.role === role);
  return opt ? opt.label : role;
}

/**
 * Human-facing name for a tenant entry. coord's `/admin/coord/me` returns the
 * slug as `slug`; we also accept `tenant_slug` in case a future proxy remaps it.
 * UUIDs are the last resort — they are not user-facing.
 */
export function tenantName(t: TenantRoleEntry): string {
  return t.slug ?? t.tenant_slug ?? t.tenant_id ?? "—";
}

/**
 * Human-facing name for the home tenant. coord returns only `home_tenant_id`,
 * so resolve the slug by matching it against the tenant list (the home tenant
 * is always one of the operator's tenants).
 */
export function homeTenantName(data: MyTenantsResponse): string {
  if (data.home_tenant_slug) return data.home_tenant_slug;
  const match = data.tenants?.find(
    (t) => t.tenant_id != null && t.tenant_id === data.home_tenant_id
  );
  return match ? tenantName(match) : (data.home_tenant_id ?? "—");
}

/**
 * The rename target for a mapping coord flags as stored under a historical
 * slug, or `null` when the row is not known to be historical. Only an explicit
 * `historical_slug === true` with a usable `current_slug` qualifies.
 */
export function historicalRenameTarget(row: GroupTenantRoleRow): string | null {
  if (row.historical_slug !== true) return null;
  return row.current_slug && row.current_slug.length > 0
    ? row.current_slug
    : null;
}

/**
 * Tooltip for a historical-slug mapping. `where` names the surface: the
 * mappings table row IS the thing to delete (and carries the one-click "Move
 * to" action that does both steps), but a Cognito group chip has no
 * per-mapping delete (the destructive action beside it is the POOL-WIDE group
 * delete), so the chip points at the mappings table instead.
 */
export function historicalSlugTooltip(
  currentSlug: string,
  where: "table-row" | "group-chip"
): string {
  const prefix =
    "This mapping names a slug this tenant was renamed away from. It still " +
    `grants at every login. Re-create it under ${currentSlug}, then delete `;
  return where === "table-row"
    ? `${prefix}this row. “Move to ${currentSlug}” does both.`
    : `${prefix}the old mapping in the group → tenant mappings table.`;
}

/**
 * The rename target for a "Your tenant & roles" row, or `null` when the row
 * gets no Rename action.
 *
 * Offered only where the caller holds `admin` IN THAT tenant — the one role
 * coord's `is_tenant_admin` accepts for `PATCH /coord/tenants/:tenant_id`
 * (plan `2026-09-17-tenant-rename` D1/D6). `owner` is deliberately not enough:
 * a control coord would refuse is a control that lies. A row with no id or
 * slug cannot be addressed or pre-filled, so it gets none either.
 */
export function renameTargetFor(t: TenantRoleEntry): RenameTarget | null {
  const slug = t.slug ?? t.tenant_slug;
  if (!t.tenant_id || !slug) return null;
  if (!(t.roles ?? []).includes("admin")) return null;
  return { id: t.tenant_id, slug, name: t.display_name || slug };
}

// ---------------------------------------------------------------------------
// Tenant slug validation (matches the backend / coord constraint).
// ---------------------------------------------------------------------------

export const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
