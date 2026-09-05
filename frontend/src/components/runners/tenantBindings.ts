/**
 * Presentation helper for a device's tenant bindings.
 *
 * The binding set is TRI-STATE (see `RegisteredDevice` in `@/types/runner`):
 * `null` is UNKNOWN, `[]` is a measured zero, and a non-empty array is the
 * set. This module turns that into chips without ever collapsing UNKNOWN
 * into "none".
 */

import type { DeviceTenantBinding } from "@/types/runner";

export type TenantBindingsKind = "unknown" | "none" | "bound";

export interface TenantChip {
  /** Stable key for the chip — the full tenant id. */
  key: string;
  /** Short label: the tenant slug, or the first 8 characters of the id. */
  label: string;
  /** Hover text carrying the full tenant id and the last-active time. */
  title: string;
}

export interface TenantBindingsSummary {
  kind: TenantBindingsKind;
  chips: TenantChip[];
}

/** Localized rendering of a binding's `last_active_at`; `null` reads "never". */
export function formatLastActive(lastActiveAt: string | null): string {
  if (lastActiveAt === null) return "never";
  const parsed = new Date(lastActiveAt);
  if (Number.isNaN(parsed.getTime())) return "unknown time";
  return parsed.toLocaleString();
}

/**
 * Describe a binding set for rendering.
 *
 * - `null` / `undefined` → `{ kind: "unknown", chips: [] }` — coord did not
 *   report bindings; render "bindings unknown", never nothing and never "none".
 * - `[]` → `{ kind: "none", chips: [] }` — coord measured zero bindings.
 * - otherwise → `{ kind: "bound", chips }`, one chip per binding.
 *
 * `formatTimestamp` is injectable so callers (and tests) can pin the
 * locale-dependent rendering; it defaults to {@link formatLastActive}.
 */
export function describeTenantBindings(
  bindings: DeviceTenantBinding[] | null | undefined,
  formatTimestamp: (lastActiveAt: string | null) => string = formatLastActive
): TenantBindingsSummary {
  if (bindings === null || bindings === undefined) {
    return { kind: "unknown", chips: [] };
  }
  if (bindings.length === 0) {
    return { kind: "none", chips: [] };
  }
  return {
    kind: "bound",
    chips: bindings.map((binding) => ({
      key: binding.tenant_id,
      label: binding.tenant_slug ?? binding.tenant_id.slice(0, 8),
      title: `Tenant ${binding.tenant_id} · last active ${formatTimestamp(
        binding.last_active_at
      )}`,
    })),
  };
}
