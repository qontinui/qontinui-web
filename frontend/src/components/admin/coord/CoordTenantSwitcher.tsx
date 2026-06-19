"use client";

/**
 * Tenant switcher for the coord operator console header.
 *
 * Renders ONLY for operators who belong to >1 tenant (single-tenant
 * operators have no choice to make — the control is structurally hidden).
 * Selecting a tenant persists it via {@link useTenant} (localStorage), which
 * the `HttpClient` reads to attach `X-Qontinui-Active-Tenant` to every
 * `/operations/*` call — so coord re-scopes the operator's context to the
 * chosen tenant (membership-validated coord-side; it can never widen access).
 *
 * Unlike the Sessions-page switcher (which filters client-side), switching
 * here triggers a full reload: the entire coord surface — fleet, gates,
 * plans, members, merge queue — must re-fetch in the new tenant's context,
 * and a reload is the simplest correct way to re-scope all of it at once.
 */

import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenant } from "@/contexts/tenant-context";

export function CoordTenantSwitcher() {
  const { tenants, activeTenantId, isMultiTenant, setActiveTenantId } =
    useTenant();

  if (!isMultiTenant) return null;

  const onSwitch = (id: string) => {
    if (id === activeTenantId) return;
    setActiveTenantId(id);
    // Re-scope the whole coord surface: every /operations/* call now reads
    // the new selection from localStorage, so a reload re-fetches all coord
    // data in the chosen tenant's context.
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <div
      className="flex items-center gap-2 text-xs"
      data-ui-bridge-id="coord.tenant-switcher"
    >
      <Building2
        className="h-3.5 w-3.5 text-muted-foreground shrink-0"
        aria-hidden
      />
      <Select value={activeTenantId ?? undefined} onValueChange={onSwitch}>
        <SelectTrigger
          className="h-7 w-48 text-xs"
          data-ui-bridge-id="coord.tenant-switcher-trigger"
          aria-label="Active tenant"
        >
          <SelectValue placeholder="Select tenant" />
        </SelectTrigger>
        <SelectContent>
          {tenants.map((t) => (
            <SelectItem
              key={t.id}
              value={t.id}
              data-tenant-id={t.id}
              data-ui-bridge-id="coord.tenant-switcher-item"
            >
              {t.name || t.slug || t.id.slice(0, 8)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
