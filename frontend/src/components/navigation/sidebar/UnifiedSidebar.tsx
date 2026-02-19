"use client";

import * as React from "react";
import { useState, useCallback, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import nextDynamic from "next/dynamic";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OrganizationSwitcher } from "@/components/collaboration/OrganizationSwitcher";
import { useOrganization } from "@/contexts/organization-context";
import { useSidebar } from "@/contexts/sidebar-context";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { useAutomationStore } from "@/stores/automation";
import { useProjects, useCreateProject } from "@/hooks/use-projects";
import { toast } from "sonner";
import { ConfigImporter } from "@/lib/config-importer";
import { getProjectLoader } from "@/lib/project";

const CreateOrganizationDialog = nextDynamic(
  () =>
    import("@/components/collaboration/CreateOrganizationDialog").then((m) => ({
      default: m.CreateOrganizationDialog,
    })),
  { ssr: false },
);

const ProjectExportDialog = nextDynamic(
  () =>
    import("@/components/automation-builder/components/ProjectExportDialog").then(
      (m) => ({
        default: m.ProjectExportDialog,
      }),
    ),
  { ssr: false },
);
import type { NavItem } from "./types";
import { navItems } from "./nav-items";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { NavItemButton } from "./NavItemButton";
import { CollapsibleNavItem } from "./CollapsibleNavItem";
import { UserMenu } from "./UserMenu";
import { CollapseToggle } from "./CollapseToggle";
import { HelpButton } from "./HelpButton";
import { MenuModeToggle } from "./MenuModeToggle";
import { useMenuModeStore } from "@/stores/menu-mode";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UnifiedSidebar");

// =============================================================================
// Search Trigger Component
// =============================================================================

function SearchTrigger({ isCollapsed }: { isCollapsed: boolean }) {
  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary">
            <Search className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Search</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      data-tutorial-id="sidebar-search"
      className="flex h-9 w-full items-center gap-2 rounded-md border border-border-subtle bg-surface-canvas px-3 text-sm text-text-muted transition-colors hover:border-border-default hover:bg-surface-hover"
    >
      <Search className="size-4" />
      <span>Search...</span>
      <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border border-border-subtle bg-surface-canvas px-1.5 font-mono text-[10px] font-medium text-text-muted sm:flex">
        <span className="text-xs">&#8984;</span>K
      </kbd>
    </button>
  );
}

// =============================================================================
// Main Unified Sidebar Component
// =============================================================================

interface UnifiedSidebarProps {
  className?: string;
  projectId?: string | null;
}

export const UnifiedSidebar: React.FC<UnifiedSidebarProps> = ({
  className,
  projectId: propProjectId,
}) => {
  const { user, logout, loading: authLoading } = useAuth();
  const { isCollapsed, setIsCollapsed } = useSidebar();
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Prevent hydration mismatch + sync mode from runner
  React.useEffect(() => {
    setMounted(true);
    useMenuModeStore.getState().syncFromRunner();
  }, []);

  const { currentOrganization, organizations, loading, switchOrganization } =
    useOrganization();

  // Project management
  const {
    projectId: contextProjectId,
    setProjectId: setContextProjectId,
    setProjectName,
    loadConfiguration,
  } = useAutomation();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const createProject = useCreateProject();

  // Import handler
  const importer = useMemo(() => new ConfigImporter(), []);

  const handleExport = useCallback(() => {
    if (!user) {
      toast.error("Please log in to export your project");
      return;
    }
    setShowExportDialog(true);
  }, [user]);

  const handleImport = useCallback(async () => {
    if (!user) {
      toast.error("Please log in to import a project");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const result = await importer.loadFromFile(file);

        if (result.errors.length > 0) {
          toast.error("Import failed", {
            description: result.errors.join(", "),
          });
          return;
        }

        if (result.warnings.length > 0) {
          result.warnings.forEach((warning) => {
            toast.warning("Import warning", { description: warning });
          });
        }

        loadConfiguration(result);

        const zustandStore = useAutomationStore.getState();
        await zustandStore.loadConfiguration({
          name: result.name,
          workflows: result.workflows,
          states: result.states,
          transitions: result.transitions,
          images: result.images,
          categories: result.categories,
          settings: result.settings,
        });

        toast.success("Import successful", {
          description: `Loaded ${result.states.length} states, ${result.workflows?.length || 0} workflows`,
        });
      } catch (error) {
        toast.error("Import failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    };

    input.click();
  }, [user, importer, loadConfiguration]);

  const handleLogout = useCallback(async () => {
    logout();
    router.push("/");
    toast.success("Logged out successfully");
  }, [logout, router]);

  const handleDocs = useCallback(() => {
    router.push("/docs");
  }, [router]);

  // Get project ID from prop, URL params, or context
  const projectId =
    propProjectId ?? searchParams?.get("project") ?? contextProjectId ?? null;

  const currentProject = projects.find((p) => p.id === projectId) ?? null;

  const handleProjectChange = useCallback(
    async (newProjectId: string) => {
      const loader = getProjectLoader();
      const success = await loader.load(newProjectId, {
        currentProjectId: contextProjectId,
      });

      if (!success) {
        toast.error("Failed to load project");
        return;
      }

      const newProject = projects.find((p) => p.id === newProjectId);
      setContextProjectId(newProjectId);
      if (newProject) {
        setProjectName(newProject.name);
      }
      const url = new URL(window.location.href);
      url.searchParams.set("project", newProjectId);
      router.push(url.pathname + url.search);
    },
    [contextProjectId, projects, setContextProjectId, setProjectName, router],
  );

  const handleCreateProject = useCallback(async () => {
    try {
      const newProject = await createProject.mutateAsync({
        name: `New Automation ${new Date().toLocaleDateString()}`,
        description: "A new automation workflow",
        configuration: {},
      });
      handleProjectChange(newProject.id);
      toast.success("Project created successfully");
    } catch (error: unknown) {
      logger.error("Failed to create project:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to create project",
      );
    }
  }, [createProject, handleProjectChange]);

  // Filter nav items based on admin status, hidden flag, and menu mode
  const isDevelopment = process.env.NODE_ENV === "development";
  const menuMode = useMenuModeStore((s) => s.menuMode);
  const filterNavItems = useCallback(
    (items: NavItem[]): NavItem[] => {
      return items
        .filter((item) => {
          // hidden items only show in development
          if (item.hidden && (!mounted || !isDevelopment)) return false;
          // advancedOnly items only show in advanced mode
          if (item.advancedOnly && mounted && menuMode !== "advanced")
            return false;
          if (authLoading || !user) return !item.adminOnly;
          return !item.adminOnly || user.is_superuser === true;
        })
        .map((item) => ({
          ...item,
          children: item.children ? filterNavItems(item.children) : undefined,
        }))
        .filter((item) => !item.children || item.children.length > 0);
    },
    [mounted, isDevelopment, menuMode, authLoading, user],
  );

  const visibleNavItems = useMemo(() => {
    return filterNavItems(navItems);
  }, [filterNavItems]);

  const toggleCollapse = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem("unified-sidebar-collapsed", JSON.stringify(newState));
  }, [isCollapsed, setIsCollapsed]);

  const isRouteActive = useCallback(
    (route: string, item: NavItem): boolean => {
      const checkRouteMatch = (routeToCheck: string): boolean => {
        if (routeToCheck.includes("?")) {
          const [basePath, query] = routeToCheck.split("?");
          const queryParams = new URLSearchParams(query);
          const currentParams = searchParams;
          const baseMatch = pathname === basePath;
          const categoryMatch =
            queryParams.get("category") === currentParams.get("category");
          const tabMatch = queryParams.get("tab") === currentParams.get("tab");
          return baseMatch && categoryMatch && tabMatch;
        } else {
          const currentHasParams = searchParams.toString().length > 0;
          return pathname === routeToCheck && !currentHasParams;
        }
      };

      if (item.children && item.children.length > 0) {
        return item.children.some(
          (child) =>
            checkRouteMatch(child.route) ||
            (child.children &&
              child.children.some((gc) => checkRouteMatch(gc.route))),
        );
      }

      return checkRouteMatch(route);
    },
    [pathname, searchParams],
  );

  const buildRoute = useCallback(
    (route: string): string => {
      if (route.includes(":projectId")) {
        if (!projectId) return "/dashboard";
        return route.replace(":projectId", projectId);
      }

      if (!projectId) return route;

      if (route.includes("?")) {
        return `${route}&project=${projectId}`;
      } else {
        return `${route}?project=${projectId}`;
      }
    },
    [projectId],
  );

  const handleNavigation = useCallback(
    (route: string) => {
      router.push(buildRoute(route));
    },
    [router, buildRoute],
  );

  const handleOrganizationChange = useCallback(
    async (orgId: string) => {
      try {
        await switchOrganization(orgId);
      } catch (error) {
        logger.error("[UnifiedSidebar] Failed to switch organization:", error);
      }
    },
    [switchOrganization],
  );

  const handleCreateOrganization = useCallback(() => {
    setShowCreateOrgDialog(true);
  }, []);

  // Convert organizations to expected format
  const switcherOrganizations = useMemo(
    () =>
      organizations.map((org) => ({
        id: org.id,
        name: org.name,
        avatar_url: undefined,
        member_count: org.member_count,
        role: (org.owner_id === user?.id ? "owner" : "member") as
          | "owner"
          | "admin"
          | "member"
          | "viewer",
      })),
    [organizations, user?.id],
  );

  const switcherCurrentOrg = useMemo(
    () =>
      currentOrganization
        ? {
            id: currentOrganization.id,
            name: currentOrganization.name,
            avatar_url: undefined,
            member_count: currentOrganization.member_count,
            role: (currentOrganization.owner_id === user?.id
              ? "owner"
              : "member") as "owner" | "admin" | "member" | "viewer",
          }
        : null,
    [currentOrganization, user?.id],
  );

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        data-sidebar="true"
        data-tutorial-id="sidebar-main"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border-subtle bg-surface-canvas transition-all duration-200 ease-linear",
          isCollapsed ? "w-16" : "w-64",
          className,
        )}
      >
        {/* Top Gradient */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-brand-primary/5 via-brand-secondary/5 to-transparent pointer-events-none" />

        {/* Header - Logo */}
        <div
          className={cn(
            "relative flex flex-col gap-3 p-3 border-b border-border-subtle",
            isCollapsed && "items-center",
          )}
        >
          {isCollapsed ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src="/q-logo.png" alt="Qontinui" className="h-10 w-auto" />
          ) : (
            <div className="flex items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/q-logo.png" alt="Qontinui" className="h-9 w-auto" />
              <span className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
                ontinui
              </span>
            </div>
          )}
        </div>

        {/* Organization Switcher */}
        {!isCollapsed && (
          <div className="px-3 pt-3 pb-2 border-b border-border-subtle">
            {mounted ? (
              <OrganizationSwitcher
                organizations={switcherOrganizations}
                currentOrganization={switcherCurrentOrg}
                onOrganizationChange={handleOrganizationChange}
                onCreateOrganization={handleCreateOrganization}
                loading={loading}
                className="bg-surface-raised/50 border-border-default hover:bg-surface-raised hover:border-border-default"
              />
            ) : (
              <div className="h-10 w-full rounded-md bg-surface-raised/50 border border-border-default animate-pulse" />
            )}
          </div>
        )}

        {/* Project Switcher + Search */}
        <div
          className={cn(
            "flex flex-col gap-3 p-3 border-b border-border-subtle",
            isCollapsed && "items-center",
          )}
        >
          {mounted ? (
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
                "h-10 rounded-md bg-surface-raised/50 animate-pulse",
                isCollapsed ? "w-10" : "w-full",
              )}
            />
          )}
          <SearchTrigger isCollapsed={isCollapsed} />
        </div>

        {/* Navigation Area */}
        <ScrollArea className="flex-1 px-3">
          <nav
            data-tutorial-id="sidebar-nav"
            className={cn(
              "flex flex-col gap-1 py-3",
              isCollapsed && "items-center",
            )}
          >
            {visibleNavItems.map((item) =>
              item.children ? (
                <CollapsibleNavItem
                  key={item.id}
                  item={item}
                  isCollapsed={isCollapsed}
                  onNavigate={handleNavigation}
                  isRouteActive={isRouteActive}
                  mounted={mounted}
                />
              ) : (
                <NavItemButton
                  key={item.id}
                  item={item}
                  isCollapsed={isCollapsed}
                  isActive={isRouteActive(item.route, item)}
                  onClick={() => handleNavigation(item.route)}
                  mounted={mounted}
                />
              ),
            )}
          </nav>
        </ScrollArea>

        {/* Bottom Gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-brand-secondary/5 to-transparent pointer-events-none" />

        {/* Footer */}
        <div
          className={cn(
            "relative flex flex-col gap-2 border-t border-border-subtle p-3",
            isCollapsed && "items-center",
          )}
        >
          <HelpButton isCollapsed={isCollapsed} />
          <MenuModeToggle isCollapsed={isCollapsed} />
          <UserMenu
            isCollapsed={isCollapsed}
            user={user}
            onLogout={handleLogout}
            onExport={handleExport}
            onImport={handleImport}
            onDocs={handleDocs}
          />
          <CollapseToggle isCollapsed={isCollapsed} onToggle={toggleCollapse} />
        </div>
      </aside>

      {/* Dialogs */}
      <CreateOrganizationDialog
        open={showCreateOrgDialog}
        onOpenChange={setShowCreateOrgDialog}
      />
      <ProjectExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
      />
    </TooltipProvider>
  );
};
