"use client";

/**
 * Project selector + create action for the app sidebar.
 *
 * Vocabulary: the user-facing word is **Project**, and a project IS a coord
 * tenant (one tenant = one project). The route, table and JWT claims stay
 * `tenant` — that is the access/resource/billing boundary and it is
 * load-bearing across auth and SSO — so this file switches words at the
 * presentation layer only (plan
 * `2026-08-25-self-service-tenant-project-creation`, § Naming).
 *
 * Not to be confused with `../ProjectSwitcher.tsx`, the visual-automation
 * project picker (automation projects in web's DB, organization-scoped),
 * which only renders in the hidden visual product mode.
 *
 * It lived in the Coord Console header as `CoordTenantSwitcher` until the
 * console's navigation moved into the sidebar; it sits here now in place of
 * the organization switcher, which belongs to the visual-automation side.
 *
 * Renders for EVERY user, including one who belongs to a single project: the
 * single-project user is precisely the one who needs "+ New", and a control
 * hidden from them can never offer it.
 *
 * Selecting a project persists it via {@link useTenant} (localStorage), which
 * the `HttpClient` reads to attach `X-Qontinui-Active-Tenant` to coord-backed
 * calls — so coord re-scopes the user's context to the chosen project
 * (membership-validated coord-side; it can never widen access). Switching
 * reloads the page: every coord surface — fleet, gates, plans, members, merge
 * queue — must re-fetch in the new project's context, and a reload is the
 * simplest correct way to re-scope all of it at once.
 *
 * In presentation mode (plan `2026-10-23-console-presentation-spaces` D3) it
 * is a static "Active project" line and nothing else: the switcher's list is
 * the viewer's OTHER projects — the lens's default confidential terms (D3.3)
 * — switching is a write (it changes the active tenant and reloads the page),
 * and "New project" creates a tenant, a write in front of an audience (D3.2).
 * Even the ACTIVE project's name is withheld then: a project name belongs to
 * no repository the scope can vouch for, so it renders through the same
 * `RedactedText` + {@link PROJECT_NAME_DESCRIPTOR} as the home page's tenant
 * strip ("Project"), in the text, the tooltip and every attribute alike.
 */

import { useState } from "react";
import { FolderKanban, Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTenant } from "@/contexts/tenant-context";
import { CoordProjectCreateDialog } from "@/components/admin/coord/CoordProjectCreateDialog";
import {
  PROJECT_NAME_DESCRIPTOR,
  RedactedText,
  usePresentationMode,
} from "@/components/presentation";

interface ProjectSelectorProps {
  isCollapsed: boolean;
}

export function ProjectSelector({ isCollapsed }: ProjectSelectorProps) {
  const { tenants, activeTenantId, setActiveTenantId } = useTenant();
  const { presenting } = usePresentationMode();
  const [createOpen, setCreateOpen] = useState(false);

  const onSwitch = (id: string) => {
    if (id === activeTenantId) return;
    setActiveTenantId(id);
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  const activeTenant = tenants.find((t) => t.id === activeTenantId);
  const activeName = activeTenant
    ? activeTenant.name || activeTenant.slug || activeTenant.id.slice(0, 8)
    : "No project selected";
  // The name as this mode may show it: verbatim for the operator, the
  // descriptor while presenting. "No project selected" names no one.
  const shownName = activeTenant ? (
    <RedactedText
      text={activeName}
      repo={null}
      descriptor={PROJECT_NAME_DESCRIPTOR}
    />
  ) : (
    activeName
  );

  if (isCollapsed) {
    // No room for a select: the icon names the active project on hover, and
    // expanding the sidebar is how you switch.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex size-8 items-center justify-center rounded-md text-text-muted"
            data-ui-bridge-id="coord.tenant-switcher"
          >
            <FolderKanban className="size-4" aria-label="Active project" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          {presenting ? "Active project" : "Project"}: {shownName}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (presenting) {
    return (
      <div
        className="flex h-8 min-w-0 items-center gap-1.5 px-2 text-xs text-text-primary"
        data-ui-bridge-id="coord.tenant-switcher"
        data-testid="coord-project-presented"
      >
        <FolderKanban
          className="size-3.5 shrink-0 text-text-muted"
          aria-hidden
        />
        {/* No switch control: changing project is a write. No `title` with
            the name either — the only title here is the withheld span's own,
            which says that it is withheld and nothing more. */}
        <span className="min-w-0 truncate">
          <span className="sr-only">Active project: </span>
          {shownName}
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 text-xs"
      data-ui-bridge-id="coord.tenant-switcher"
    >
      <Select value={activeTenantId ?? undefined} onValueChange={onSwitch}>
        <SelectTrigger
          className="h-8 min-w-0 flex-1 text-xs bg-surface-raised/50 border-border-default"
          data-ui-bridge-id="coord.tenant-switcher-trigger"
          aria-label="Active project"
        >
          <FolderKanban
            className="mr-1.5 size-3.5 shrink-0 text-text-muted"
            aria-hidden
          />
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
        className="h-8 px-2 text-xs"
        onClick={() => setCreateOpen(true)}
        title="New project"
        data-testid="coord-project-new"
        data-ui-bridge-id="coord.tenant-switcher-new"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">New project</span>
      </Button>
      <CoordProjectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
