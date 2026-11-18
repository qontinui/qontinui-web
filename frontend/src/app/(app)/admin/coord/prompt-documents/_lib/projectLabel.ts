import type { Tenant } from "@/contexts/tenant-context";

/**
 * A project named for the operator, from ITS OWN row in the membership list
 * (`tenants`, the layout's tenant provider's; `undefined` when there is no
 * provider): its name, else its slug, else its id. Never another project's
 * name — the provider's active project, for one, can be a different project
 * (a provider that predates a client-side navigation). `null` is the home
 * project, none selected. An id not in the list is the id itself, said to be
 * unknown.
 */
export function projectLabel(
  tenants: readonly Tenant[] | undefined,
  id: string | null
): string {
  if (id === null) return "your home project (none selected)";
  const row = tenants?.find((t) => t.id === id);
  return row
    ? row.name?.trim() || row.slug?.trim() || id
    : `${id} (unknown project — not in this page's project list)`;
}
