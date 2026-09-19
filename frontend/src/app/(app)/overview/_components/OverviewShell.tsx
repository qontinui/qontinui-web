"use client";

/**
 * The frame every overview page shares: the project's name, the section's
 * own sub-navigation, and a scrolling body.
 *
 * "Project" here is the active coord tenant — the one chosen in the sidebar's
 * project selector (`contexts/tenant-context.tsx`). Every overview read goes
 * through `/api/v1/operations/*`, which carries that selection in the
 * `X-Qontinui-Active-Tenant` header.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  OVERVIEW_SECTIONS,
  findOverviewSection,
} from "@/components/overview/sections";
import { cn } from "@/lib/utils";

export function OverviewShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const {
    tenants,
    activeTenantId,
    loading: tenantsLoading,
    error: tenantsError,
  } = useTenant();

  if (!user) return null;

  const current = findOverviewSection(pathname);
  const project = tenants.find((t) => t.id === activeTenantId);

  return (
    <div
      className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
      data-ui-bridge-id="overview.page"
    >
      <header
        className="shrink-0 border-b border-border px-6 pt-6 sm:px-10"
        data-ui-bridge-id="overview.header"
      >
        <p className="text-sm text-muted-foreground">
          {current?.label ?? "Overview"}
        </p>
        <h1
          className="mt-1 font-[family-name:var(--font-overview-serif)] text-3xl leading-tight tracking-[-0.01em] text-foreground sm:text-4xl"
          data-ui-bridge-id="overview.header.project-name"
        >
          {project?.name ??
            (tenantsLoading
              ? " "
              : tenantsError
                ? "Project name unavailable"
                : "Project not selected")}
        </h1>
        {!tenantsLoading && !project && (
          <p
            className="mt-1 text-sm text-muted-foreground"
            data-ui-bridge-id="overview.header.project-hint"
          >
            {tenantsError
              ? "The list of projects couldn’t be loaded, so this page can’t show which project it describes. Try again in a few minutes."
              : "Choose a project in the sidebar to see its overview."}
          </p>
        )}

        <nav
          aria-label="Overview pages"
          className="-mb-px mt-5 flex gap-1 overflow-x-auto"
          data-ui-bridge-id="overview.subnav"
        >
          {OVERVIEW_SECTIONS.map((section) => {
            const active = current?.id === section.id;
            return (
              <Link
                key={section.id}
                href={section.route}
                aria-current={active ? "page" : undefined}
                title={section.description}
                data-ui-bridge-id={`overview.subnav.${section.id}`}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-t-sm",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                  !section.available && !active && "text-muted-foreground/60"
                )}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-8 sm:px-10">{children}</div>
      </ScrollArea>
    </div>
  );
}
