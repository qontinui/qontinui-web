"use client";

import * as React from "react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";
import { useSidebar } from "@/contexts/sidebar-context";
import { useProductMode } from "@/contexts/product-mode-context";
import { toast } from "sonner";
import { useSlotComponent } from "@/lib/extension-slots";
import { ErrorBoundary } from "@/components/error-boundary";
import type { CreateOrganizationDialogProps } from "@/lib/cloud-component-slots";
import { useSidebarNavigation } from "./_hooks/use-sidebar-navigation";
import { useSidebarProjects } from "./_hooks/use-sidebar-projects";
import { useSidebarOrganizations } from "./_hooks/use-sidebar-organizations";
import { SearchTrigger } from "./_components/SearchTrigger";
import { SidebarHeader } from "./_components/SidebarHeader";
import { SidebarNav } from "./_components/SidebarNav";
import { SidebarFooter } from "./_components/SidebarFooter";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SidebarDrawer } from "./SidebarDrawer";

interface UnifiedSidebarProps {
  className?: string;
  projectId?: string | null;
}

export const UnifiedSidebar: React.FC<UnifiedSidebarProps> = (props) => {
  const { preferredCollapsed } = useSidebar();
  return (
    <React.Suspense
      fallback={
        // In step with `SidebarSkeleton` in `app/(app)/layout.tsx`: nothing
        // below `md` (the phone shell has no inline sidebar), the rail at
        // `md`, and the saved preference at `lg`.
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 hidden w-16 flex-col border-r border-border-subtle bg-surface-canvas md:flex",
            preferredCollapsed ? "lg:w-16" : "lg:w-64"
          )}
        />
      }
    >
      <UnifiedSidebarContent {...props} />
    </React.Suspense>
  );
};

const UnifiedSidebarContent: React.FC<UnifiedSidebarProps> = ({
  className,
  projectId: propProjectId,
}) => {
  const { user, logout } = useAuth();
  const { isCollapsed, setIsCollapsed, layout, drawerOpen, setDrawerOpen } =
    useSidebar();
  const { mode } = useProductMode();
  const router = useRouter();

  const {
    mounted,
    visibleNavItems,
    isRouteActive,
    handleNavigation,
    handleDocs,
  } = useSidebarNavigation();

  const {
    projectId,
    projects,
    currentProject,
    projectsLoading,
    handleProjectChange,
    handleCreateProject,
  } = useSidebarProjects(propProjectId);

  const {
    loading: orgLoading,
    showCreateOrgDialog,
    setShowCreateOrgDialog,
    switcherOrganizations,
    switcherCurrentOrg,
    handleOrganizationChange,
    handleCreateOrganization,
  } = useSidebarOrganizations();

  const handleLogout = useCallback(async () => {
    logout();
    router.push("/");
    toast.success("Logged out successfully");
  }, [logout, router]);

  const isDesktop = layout === "desktop";

  /**
   * The drawer is the only way to see the full menu below `lg`, so the same
   * control that collapses and expands on desktop opens and closes it there.
   * Persisting a preference from a narrow screen is exactly what
   * `setIsCollapsed` refuses to do (see `contexts/sidebar-context.tsx`).
   */
  const toggleCollapse = useCallback(() => {
    if (isDesktop) {
      setIsCollapsed(!isCollapsed);
      return;
    }
    setDrawerOpen(!drawerOpen);
  }, [isDesktop, isCollapsed, setIsCollapsed, drawerOpen, setDrawerOpen]);

  /**
   * Below `lg` the menu is an overlay, so following a link has to dismiss it —
   * otherwise the page changes behind a sheet the operator has to close by
   * hand.
   */
  const navigateAndDismiss = useCallback(
    (route: string, pid: string | null) => {
      setDrawerOpen(false);
      handleNavigation(route, pid);
    },
    [handleNavigation, setDrawerOpen]
  );

  // Where the menu lives right now. The body below is rendered into exactly
  // one of these two containers — see `SidebarDrawer`'s doc block for why it
  // is moved rather than duplicated.
  const inDrawer = drawerOpen && !isDesktop;
  // The drawer always shows the full menu, whatever the inline sidebar is.
  const bodyCollapsed = inDrawer ? false : isCollapsed;

  const body = (
    <>
      <SidebarHeader
        isCollapsed={bodyCollapsed}
        mounted={mounted}
        loading={orgLoading}
        switcherOrganizations={switcherOrganizations}
        switcherCurrentOrg={switcherCurrentOrg}
        onOrganizationChange={handleOrganizationChange}
        onCreateOrganization={handleCreateOrganization}
        showOrganizationSwitcher={mode === "visual"}
      />

      <div
        className={cn(
          "flex flex-col gap-2 p-2 border-b border-border-subtle",
          bodyCollapsed && "items-center"
        )}
      >
        {mode === "visual" &&
          (mounted ? (
            <ProjectSwitcher
              isCollapsed={bodyCollapsed}
              projects={projects}
              currentProject={currentProject}
              onProjectChange={handleProjectChange}
              onCreateProject={handleCreateProject}
              loading={projectsLoading}
            />
          ) : (
            <div
              className={cn(
                "h-8 rounded-md bg-surface-raised/50 animate-pulse",
                bodyCollapsed ? "w-8" : "w-full"
              )}
            />
          ))}
        <SearchTrigger isCollapsed={bodyCollapsed} />
      </div>

      <SidebarNav
        isCollapsed={bodyCollapsed}
        mounted={mounted}
        visibleNavItems={visibleNavItems}
        projectId={projectId}
        isRouteActive={isRouteActive}
        onNavigate={navigateAndDismiss}
      />

      <SidebarFooter
        isCollapsed={bodyCollapsed}
        user={user}
        onLogout={handleLogout}
        onDocs={handleDocs}
        onToggleCollapse={toggleCollapse}
        toggleLabel={inDrawer ? "Close menu" : undefined}
      />
    </>
  );

  return (
    <TooltipProvider delayDuration={0}>
      {inDrawer ? (
        <SidebarDrawer open onOpenChange={setDrawerOpen} className={className}>
          {body}
        </SidebarDrawer>
      ) : (
        <aside
          data-sidebar="true"
          data-tutorial-id="sidebar-main"
          className={cn(
            // `hidden md:flex` rather than a layout-band check: the phone
            // shell has no inline sidebar, and a pure CSS switch cannot
            // disagree with the top bar's own `md:hidden` about where the
            // breakpoint is. The element stays in the DOM at phone width so
            // the tutorial anchors below it resolve at every width — and,
            // because the body is MOVED into the drawer rather than copied,
            // never twice.
            "fixed inset-y-0 left-0 z-50 hidden flex-col border-r border-border-subtle bg-surface-canvas transition-all duration-200 ease-linear motion-reduce:transition-none md:flex",
            bodyCollapsed ? "w-16" : "w-64",
            className
          )}
        >
          {body}
        </aside>
      )}

      <CreateOrganizationDialogSlot
        open={showCreateOrgDialog}
        onOpenChange={setShowCreateOrgDialog}
      />
    </TooltipProvider>
  );
};

/**
 * Renders cloud-control's `CreateOrganizationDialog` if registered, or
 * nothing in OSS-only mode. `useSlotComponent` *subscribes* to the slot
 * registry, so cloud-control's `registerCloudExtensions` call can land
 * after the OSS app shell mounts (no module-load-order coupling) and this
 * component re-renders when it does. Resolving on every render would not be
 * enough on its own — it only helps if something else triggers another
 * render; the subscription is what makes the late registration land.
 *
 * Two further guards, both load-bearing — a slot component is FOREIGN code
 * that the host cannot typecheck against its own provider tree:
 *
 * 1. Mount only while `open`. A dialog that isn't on screen has no business
 *    running its hooks, and cloud-control's dialog calls `useOrganization()`
 *    unconditionally at the top of its body.
 * 2. Fault-isolate behind an ErrorBoundary. The registry originally
 *    transported components and services but NOT providers, so a slot
 *    component that read its own package's React context found no Provider
 *    and threw — as cloud-control's `useOrganization` does (it throws rather
 *    than returning the OSS stub's safe default). Unguarded, that throw
 *    reached the root boundary in `app/layout.tsx` and white-screened every
 *    authenticated page, which is exactly what it did in production.
 *
 *    The `providers` slot has since closed that specific hole (see
 *    `lib/extension-slots.ts` and `components/CloudProviders`), and this
 *    boundary still stays. It is not a workaround for the missing slot kind:
 *    a slot component is foreign code the host cannot typecheck against its
 *    own provider tree, so it can throw for reasons the host never sees —
 *    including the window where cloud-control has registered a component but
 *    not the provider it depends on, which is a one-line mistake in a
 *    different repo. Degrading one optional dialog to nothing beats losing
 *    the whole app.
 */
export function CreateOrganizationDialogSlot(
  props: CreateOrganizationDialogProps
) {
  // Hook first: `useSlotComponent` subscribes, so it must run on every
  // render regardless of `open` — an early return above it would break the
  // rules of hooks AND drop the late-registration subscription.
  const Slot = useSlotComponent<CreateOrganizationDialogProps>(
    "createOrganizationDialog"
  );
  if (!Slot || !props.open) return null;
  return (
    // The fallback must be a truthy node — ErrorBoundary tests
    // `if (this.props.fallback)`, so `null` would fall through to its
    // full-page error card. An empty fragment renders nothing.
    <ErrorBoundary fallback={<></>}>
      <Slot {...props} />
    </ErrorBoundary>
  );
}
