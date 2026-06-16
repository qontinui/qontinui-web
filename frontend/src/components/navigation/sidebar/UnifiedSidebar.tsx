"use client";

import * as React from "react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";
import { useSidebar } from "@/contexts/sidebar-context";
import { useProductMode } from "@/contexts/product-mode-context";
import { STORAGE_KEYS } from "@qontinui/navigation";
import { toast } from "sonner";
import { getComponent } from "@/lib/extension-slots";
import type { CreateOrganizationDialogProps } from "@/lib/cloud-component-slots";
import { useSidebarNavigation } from "./_hooks/use-sidebar-navigation";
import { useSidebarProjects } from "./_hooks/use-sidebar-projects";
import { useSidebarOrganizations } from "./_hooks/use-sidebar-organizations";
import { SearchTrigger } from "./_components/SearchTrigger";
import { SidebarHeader } from "./_components/SidebarHeader";
import { SidebarNav } from "./_components/SidebarNav";
import { SidebarFooter } from "./_components/SidebarFooter";
import { ProjectSwitcher } from "./ProjectSwitcher";

interface UnifiedSidebarProps {
  className?: string;
  projectId?: string | null;
}

export const UnifiedSidebar: React.FC<UnifiedSidebarProps> = (props) => {
  return (
    <React.Suspense
      fallback={
        <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border-subtle bg-surface-canvas" />
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
  const { isCollapsed, setIsCollapsed } = useSidebar();
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

  const toggleCollapse = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem(STORAGE_KEYS.collapsed, JSON.stringify(newState));
  }, [isCollapsed, setIsCollapsed]);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        data-sidebar="true"
        data-tutorial-id="sidebar-main"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border-subtle bg-surface-canvas transition-all duration-200 ease-linear",
          isCollapsed ? "w-16" : "w-64",
          className
        )}
      >
        <SidebarHeader
          isCollapsed={isCollapsed}
          mounted={mounted}
          loading={orgLoading}
          switcherOrganizations={switcherOrganizations}
          switcherCurrentOrg={switcherCurrentOrg}
          onOrganizationChange={handleOrganizationChange}
          onCreateOrganization={handleCreateOrganization}
        />

        <div
          className={cn(
            "flex flex-col gap-2 p-2 border-b border-border-subtle",
            isCollapsed && "items-center"
          )}
        >
          {mode === "visual" &&
            (mounted ? (
              <ProjectSwitcher
                isCollapsed={isCollapsed}
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
                  isCollapsed ? "w-8" : "w-full"
                )}
              />
            ))}
          <SearchTrigger isCollapsed={isCollapsed} />
        </div>

        <SidebarNav
          isCollapsed={isCollapsed}
          mounted={mounted}
          visibleNavItems={visibleNavItems}
          projectId={projectId}
          isRouteActive={isRouteActive}
          onNavigate={handleNavigation}
        />

        <SidebarFooter
          isCollapsed={isCollapsed}
          user={user}
          onLogout={handleLogout}
          onDocs={handleDocs}
          onToggleCollapse={toggleCollapse}
        />
      </aside>

      <CreateOrganizationDialogSlot
        open={showCreateOrgDialog}
        onOpenChange={setShowCreateOrgDialog}
      />
    </TooltipProvider>
  );
};

/**
 * Renders cloud-control's `CreateOrganizationDialog` if registered, or
 * nothing in OSS-only mode. Resolved via the slot registry on every
 * render so cloud-control's `registerCloudExtensions` call can land
 * after the OSS app shell mounts (no module-load-order coupling).
 */
function CreateOrganizationDialogSlot(props: CreateOrganizationDialogProps) {
  const Slot = getComponent<CreateOrganizationDialogProps>(
    "createOrganizationDialog",
  );
  return Slot ? <Slot {...props} /> : null;
}
