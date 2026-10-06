"use client";

import { useTenant } from "@/contexts/tenant-context";

/**
 * The display name of the project (tenant) Regression Tests is scoped to, or
 * `null` when it is not known.
 *
 * Resolved from the MEMBERSHIP list `useTenant()` fetched, never from the raw
 * stored id. The stored `qontinui.active_tenant_id` can name a project the
 * user has left; coord's active-tenant override is fail-soft and silently
 * serves the home tenant for a non-member id, so labelling the page from that
 * id would name project B above project A's data. `TenantProvider` reconciles
 * a stale id to the server's own active tenant once the list loads, so after
 * that the id resolves; until then (and when the list failed to load, or the
 * id is somehow not a member) this answers `null` and the page shows no
 * project name rather than a guess or a raw UUID.
 */
export function useActiveProjectName(): string | null {
  const { tenants, activeTenantId } = useTenant();
  if (!activeTenantId) return null;
  const tenant = tenants.find((t) => t.id === activeTenantId);
  const name = tenant?.name?.trim() || tenant?.slug?.trim();
  return name ? name : null;
}
