"use client";

/**
 * Project switcher + create action for the coord operator console header.
 *
 * Renders for EVERY operator, including one who belongs to a single tenant.
 * It used to hide itself behind `if (!isMultiTenant) return null;` — correct
 * while switching was all it did (a one-row switcher offers no choice), and
 * wrong the moment it grew a create action: the operator with exactly one
 * project is precisely the one who needs a second, and a control hidden from
 * them can never offer it. A single-project operator now sees their project
 * name plus "+ New" instead of nothing.
 *
 * Vocabulary: the user-facing word is **Project**. The route, table and JWT
 * claims stay `tenant` — that is the access/resource/billing boundary and it
 * is load-bearing across auth and SSO — so this file switches words at the
 * presentation layer only (plan
 * `2026-08-25-self-service-tenant-project-creation`, § Naming).
 *
 * Selecting a project persists it via {@link useTenant} (localStorage), which
 * the `HttpClient` reads to attach `X-Qontinui-Active-Tenant` to every
 * `/operations/*` call — so coord re-scopes the operator's context to the
 * chosen project (membership-validated coord-side; it can never widen
 * access).
 *
 * Unlike the Sessions-page switcher (which filters client-side), switching
 * here triggers a full reload: the entire coord surface — fleet, gates,
 * plans, members, merge queue — must re-fetch in the new project's context,
 * and a reload is the simplest correct way to re-scope all of it at once.
 *
 * Console style guide (`frontend/docs/console-ui-style-guide.md`): this is
 * page chrome, so **R9** binds — the whole control stays on the layout's
 * single header row at `h-7 text-xs`, and adds no second row.
 */

import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/contexts/tenant-context";
import { CoordProjectCreateDialog } from "./CoordProjectCreateDialog";

export function CoordTenantSwitcher() {
  const { tenants, activeTenantId, setActiveTenantId } = useTenant();
  const [createOpen, setCreateOpen] = useState(false);

  const onSwitch = (id: string) => {
    if (id === activeTenantId) return;
    setActiveTenantId(id);
    // Re-scope the whole coord surface: every /operations/* call now reads
    // the new selection from localStorage, so a reload re-fetches all coord
    // data in the chosen project's context.
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
          aria-label="Active project"
        >
          <SelectValue placeholder="Select project" />
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
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setCreateOpen(true)}
        data-testid="coord-project-new"
        data-ui-bridge-id="coord.tenant-switcher-new"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        New
      </Button>
      <CoordProjectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
