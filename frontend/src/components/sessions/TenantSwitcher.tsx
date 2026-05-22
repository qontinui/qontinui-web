"use client";

/**
 * Tenant switcher — Phase 5 / plan §D12.
 *
 * Renders ONLY when the operator belongs to >1 tenant. Single-tenant
 * operators see nothing (the UI choice is structurally hidden, not
 * just visually).
 *
 * Pinned-session caveat: switching active tenant does NOT migrate any
 * live session. Sessions stamp `tenant_id` at start and keep it for
 * life (`coord.sessions.tenant_id NOT NULL`).
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

export function TenantSwitcher() {
  const { tenants, activeTenantId, isMultiTenant, setActiveTenantId } =
    useTenant();

  if (!isMultiTenant) return null;

  return (
    <div
      className="flex items-center gap-2 text-xs"
      data-ui-bridge-id="sessions.tenant-switcher"
    >
      <Building2
        className="h-3.5 w-3.5 text-muted-foreground"
        aria-hidden
      />
      <Select
        value={activeTenantId ?? undefined}
        onValueChange={setActiveTenantId}
      >
        <SelectTrigger
          className="h-7 w-48 text-xs"
          data-ui-bridge-id="sessions.tenant-switcher-trigger"
        >
          <SelectValue placeholder="Select tenant" />
        </SelectTrigger>
        <SelectContent>
          {tenants.map((t) => (
            <SelectItem
              key={t.id}
              value={t.id}
              data-tenant-id={t.id}
              data-ui-bridge-id="sessions.tenant-switcher-item"
            >
              {t.name || t.slug || t.id.slice(0, 8)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
