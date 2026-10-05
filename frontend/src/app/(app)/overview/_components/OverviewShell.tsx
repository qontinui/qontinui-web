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
import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import { OverviewPermissionsProvider } from "@/components/overview/editing/permissions";
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

  // The sub-navigation scrolls sideways rather than wrapping, which on a
  // phone leaves sections off the right edge with nothing saying so. A fade
  // there is that signal — shown only while something IS cut off, so it never
  // dims the last tab on a screen wide enough to hold them all.
  // A callback ref, not `useRef` + a mount-only effect: the `<nav>` is below
  // the `if (!user) return null` guard, so on any first render without a user
  // a mount-only effect would read `null`, return, and never run again —
  // leaving the fade dead for the component's whole life.
  const [subnav, setSubnav] = useState<HTMLElement | null>(null);
  const [subnavHasMore, setSubnavHasMore] = useState(false);

  useEffect(() => {
    const nav = subnav;
    if (!nav) return;
    const update = () => {
      // 1px of slack: a fractional layout width otherwise leaves the fade on
      // permanently at the scroll end.
      setSubnavHasMore(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    };
    update();
    nav.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => {
      nav.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [subnav]);

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
          // Steps down below `sm`: at 390px a long project name in `text-3xl`
          // wrapped to three lines and pushed the sub-navigation off screen.
          className="mt-1 font-[family-name:var(--font-overview-serif)] text-2xl leading-tight tracking-[-0.01em] text-foreground sm:text-4xl"
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

        <div className="relative -mb-px mt-5">
          <nav
            ref={setSubnav}
            aria-label="Overview pages"
            className="flex gap-1 overflow-x-auto"
            data-ui-bridge-id="overview.subnav"
          >
            {OVERVIEW_SECTIONS.map((section) => {
              const active = current?.id === section.id;
              return (
                <Link
                  key={section.id}
                  href={section.route}
                  aria-current={active ? "page" : undefined}
                  title={
                    section.available
                      ? section.description
                      : `${section.description} (not available yet)`
                  }
                  data-ui-bridge-id={`overview.subnav.${section.id}`}
                  className={cn(
                    "inline-flex items-center gap-1 whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-1 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-t-sm",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {section.label}
                  {!section.available && (
                    <>
                      {/* A shape, not only a colour, marks an unbuilt page. */}
                      <Clock3 className="size-3 opacity-70" aria-hidden />
                      <span className="sr-only">(not available yet)</span>
                    </>
                  )}
                </Link>
              );
            })}
          </nav>
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent transition-opacity motion-reduce:transition-none",
              subnavHasMore ? "opacity-100" : "opacity-0"
            )}
          />
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        {/* What the viewer may edit, for THIS project — every overview page
            gates its edit controls on it (never on `isCoordAdmin`). */}
        <OverviewPermissionsProvider
          tenantId={activeTenantId}
          hold={tenantsLoading || tenantsError !== null}
        >
          <div className="px-6 py-8 sm:px-10">{children}</div>
        </OverviewPermissionsProvider>
      </ScrollArea>
    </div>
  );
}
