"use client";

// Horizontal icon popover for collapsed sidebar - updated icons v3
import React, { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Workflow,
  Network,
  Sparkles,
  CheckCircle2,
  BarChart3,
  Settings,
  FileText,
  ChevronLeft,
  ChevronRight,
  Scissors,
  Search,
  ImageIcon,
  Camera,
  Map,
  Eraser,
  Box,
  GitBranch,
  Scan,
  Target,
  Sliders,
  Globe,
  Play,
  Video,
  Monitor,
  Server,
  Link,
  Store,
  CreditCard,
  TestTube2,
  LogOut,
  Download,
  Upload,
  User,
  Database,
  AlertCircle,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CollapsedMenuPopover } from "./collapsed-menu-popover";
import { SidebarFlyout } from "./sidebar-flyout";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { OrganizationSwitcher } from "@/components/collaboration/OrganizationSwitcher";
import { CreateOrganizationDialog } from "@/components/collaboration/CreateOrganizationDialog";
import { useOrganization } from "@/contexts/organization-context";
import { useSidebar } from "@/contexts/sidebar-context";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { useAutomationStore } from "@/stores/automation";
import { useProjects, useCreateProject } from "@/hooks/use-projects";
import { toast } from "sonner";
import { ConfigImporter } from "@/lib/config-importer";
import { getProjectLoader } from "@/lib/project";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProjectExportDialog } from "@/components/automation-builder/components/ProjectExportDialog";

interface NavItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  route: string;
  color: string;
  children?: NavItem[];
  badge?: "beta" | "experimental";
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard size={28} />,
    route: "/dashboard",
    color: "var(--brand-primary)",
  },
  {
    id: "build",
    label: "Build",
    icon: <Network size={28} />,
    route: "/automation-builder/states",
    color: "var(--brand-secondary)",
    children: [
      {
        id: "state-machine",
        label: "State Machine",
        description: "Define states and transitions",
        icon: <Network size={22} />,
        route: "/automation-builder/states",
        color: "var(--brand-secondary)",
      },
      {
        id: "workflows",
        label: "Workflows",
        description: "Create automation action sequences",
        icon: <Workflow size={22} />,
        route: "/automation-builder",
        color: "var(--brand-secondary)",
      },
      {
        id: "variables",
        label: "Variables",
        description: "Global configuration values",
        icon: <Sliders size={22} />,
        route: "/automation-builder/variables",
        color: "var(--brand-secondary)",
      },
      {
        id: "contexts",
        label: "AI Contexts",
        description: "Domain knowledge for AI tasks",
        icon: <BookOpen size={22} />,
        route: "/automation-builder/contexts",
        color: "var(--brand-secondary)",
      },
      {
        id: "components",
        label: "Components",
        description: "Reusable automation components",
        icon: <Box size={22} />,
        route: "/automation-builder/components",
        color: "var(--brand-secondary)",
      },
      {
        id: "marketplace",
        label: "Marketplace",
        description: "Community automation packages",
        icon: <Store size={22} />,
        route: "/marketplace",
        color: "var(--brand-secondary)",
      },
    ],
  },
  {
    id: "assets",
    label: "Assets",
    icon: <ImageIcon size={28} />,
    route: "/automation-builder/images",
    color: "#8B5CF6",
    children: [
      {
        id: "images",
        label: "Images",
        description: "Pattern image library",
        icon: <ImageIcon size={22} />,
        route: "/automation-builder/images",
        color: "#8B5CF6",
      },
      {
        id: "screenshots",
        label: "Screenshots",
        description: "Uploaded screenshots for pattern creation",
        icon: <Camera size={22} />,
        route: "/automation-builder/screenshots",
        color: "#8B5CF6",
      },
      {
        id: "recordings",
        label: "Recordings",
        description: "Video recordings for state discovery",
        icon: <Video size={22} />,
        route: "/recordings",
        color: "#8B5CF6",
      },
      {
        id: "visual-index",
        label: "Visual Index",
        description: "Indexed elements for visual search",
        icon: <Database size={22} />,
        route: "/projects/:projectId/rag",
        color: "#8B5CF6",
      },
    ],
  },
  {
    id: "create",
    label: "Create",
    icon: <Sparkles size={28} />,
    route: "/automation-builder/image-extraction",
    color: "var(--brand-success)",
    children: [
      {
        id: "extract-images",
        label: "Extract Images",
        description: "Cut pattern images from screenshots",
        icon: <Scissors size={22} />,
        route: "/automation-builder/image-extraction",
        color: "var(--brand-success)",
      },
      {
        id: "optimize-patterns",
        label: "Optimize Patterns",
        description: "Improve pattern image quality",
        icon: <Sparkles size={22} />,
        route: "/automation-builder/pattern-optimization",
        color: "var(--brand-success)",
      },
      {
        id: "annotations",
        label: "Annotations",
        description: "Create regions and locations for states",
        icon: <Scan size={22} />,
        route: "/automation-builder/annotations",
        color: "var(--brand-success)",
        adminOnly: true,
      },
    ],
  },
  {
    id: "discover",
    label: "Discover",
    icon: <Search size={28} />,
    route: "/automation-builder/state-discovery",
    color: "#4ECDC4",
    children: [
      {
        id: "discover-states",
        label: "Discover States",
        description: "Automatically discover UI states",
        icon: <Search size={22} />,
        route: "/automation-builder/state-discovery",
        color: "#4ECDC4",
        badge: "beta",
        adminOnly: true,
      },
      {
        id: "extraction",
        label: "Discover",
        description: "Discover states from web, desktop, or render logs",
        icon: <Globe size={22} />,
        route: "/automation-builder/extraction",
        color: "#4ECDC4",
        badge: "beta",
      },
      {
        id: "remove-backgrounds",
        label: "Remove Backgrounds",
        description: "Remove image backgrounds for patterns",
        icon: <Eraser size={22} />,
        route: "/automation-builder/background-removal",
        color: "#4ECDC4",
        badge: "experimental",
        adminOnly: true,
      },
    ],
  },
  {
    id: "config-testing",
    label: "Config Testing",
    icon: <CheckCircle2 size={28} />,
    route: "/automation-builder/pattern-tests",
    color: "#FF6B6B",
    children: [
      {
        id: "pattern-tests",
        label: "Pattern Tests",
        description: "Test pattern recognition accuracy",
        icon: <Target size={22} />,
        route: "/automation-builder/pattern-tests",
        color: "#FF6B6B",
      },
      {
        id: "integration-tests",
        label: "Integration Tests",
        description: "End-to-end workflow testing",
        icon: <TestTube2 size={22} />,
        route: "/integration-testing",
        color: "#FF6B6B",
        badge: "beta",
      },
      {
        id: "semantic-analysis",
        label: "Semantic Analysis",
        description: "Analyze UI element semantics",
        icon: <Scan size={22} />,
        route: "/automation-builder/semantic-analysis",
        color: "#FF6B6B",
      },
      {
        id: "rag-testing",
        label: "RAG Testing",
        description: "Test RAG element matching with SAM3/CLIP",
        icon: <Target size={22} />,
        route: "/automation-builder/rag-testing",
        color: "#FF6B6B",
        badge: "beta",
      },

      {
        id: "workflow-runner",
        label: "Workflow Runner",
        description: "Execute and debug workflows",
        icon: <Play size={22} />,
        route: "/workflow-viz",
        color: "#FF6B6B",
      },
      {
        id: "captures",
        label: "Captures",
        description: "Execution recordings with input events",
        icon: <Camera size={22} />,
        route: "/captures",
        color: "#FF6B6B",
      },
    ],
  },
  {
    id: "qa-testing",
    label: "QA Testing",
    icon: <TestTube2 size={28} />,
    route: "/qa-dashboard",
    color: "#F59E0B",
    children: [
      {
        id: "qa-dashboard",
        label: "Dashboard",
        description: "QA testing overview and metrics",
        icon: <LayoutDashboard size={22} />,
        route: "/qa-dashboard",
        color: "#F59E0B",
      },
      {
        id: "test-runs",
        label: "Test Runs",
        description: "View test execution history",
        icon: <Play size={22} />,
        route: "/testing",
        color: "#F59E0B",
      },
      {
        id: "qa-runs",
        label: "QA Runs",
        description: "QA test run history",
        icon: <TestTube2 size={22} />,
        route: "/qa-dashboard/runs",
        color: "#F59E0B",
      },
      {
        id: "coverage",
        label: "Coverage",
        description: "Test coverage analysis",
        icon: <BarChart3 size={22} />,
        route: "/qa-dashboard/coverage",
        color: "#F59E0B",
      },
      {
        id: "deficiencies",
        label: "Deficiencies",
        description: "Track testing deficiencies",
        icon: <Target size={22} />,
        route: "/qa-dashboard/deficiencies",
        color: "#F59E0B",
      },
      {
        id: "compare",
        label: "Compare",
        description: "Compare test results",
        icon: <GitBranch size={22} />,
        route: "/qa-dashboard/compare",
        color: "#F59E0B",
      },
      {
        id: "execution-history",
        label: "Execution History",
        description: "View detailed execution tree events",
        icon: <Play size={22} />,
        route: "/execution-history",
        color: "#F59E0B",
      },
    ],
  },
  {
    id: "ai-tasks",
    label: "AI Tasks",
    icon: <Sparkles size={28} />,
    route: "/ai-tasks",
    color: "#9333EA",
    children: [
      {
        id: "ai-tasks-list",
        label: "All Tasks",
        description: "View all AI analysis tasks",
        icon: <Sparkles size={22} />,
        route: "/ai-tasks",
        color: "#9333EA",
      },
    ],
  },
  {
    id: "project-tools",
    label: "Project Tools",
    icon: <Box size={28} />,
    route: "/automation-builder/overview",
    color: "var(--brand-primary)",
    children: [
      {
        id: "overview",
        label: "Overview",
        description: "Project summary and quick access",
        icon: <LayoutDashboard size={22} />,
        route: "/automation-builder/overview",
        color: "var(--brand-primary)",
      },
      {
        id: "dependencies",
        label: "Dependencies",
        description: "View state and workflow relationships",
        icon: <GitBranch size={22} />,
        route: "/automation-builder/dependencies",
        color: "var(--brand-primary)",
      },
      {
        id: "documentation",
        label: "Documentation",
        description: "Auto-generated project docs",
        icon: <FileText size={22} />,
        route: "/automation-builder/documentation",
        color: "var(--brand-primary)",
      },
      {
        id: "automation-analytics",
        label: "Automation Analytics",
        description: "Performance metrics and insights",
        icon: <BarChart3 size={22} />,
        route: "/automation-builder/analytics",
        color: "var(--brand-primary)",
      },
      {
        id: "issues",
        label: "Issues",
        description: "Track and manage project issues",
        icon: <AlertCircle size={22} />,
        route: "/issues",
        color: "var(--brand-primary)",
      },
    ],
  },
  {
    id: "runners",
    label: "Runners",
    icon: <Server size={28} />,
    route: "/runners",
    color: "#10B981",
    children: [
      {
        id: "runner-list",
        label: "Manage Runners",
        description: "View and configure your runners",
        icon: <Server size={22} />,
        route: "/runners",
        color: "#10B981",
      },
      {
        id: "connect-runner",
        label: "Connect Runner",
        description: "Connect a new desktop runner",
        icon: <Link size={22} />,
        route: "/connect-runner",
        color: "#10B981",
      },
      {
        id: "monitor",
        label: "Monitor",
        description: "Real-time runner monitoring",
        icon: <Monitor size={22} />,
        route: "/monitor",
        color: "#10B981",
      },
      {
        id: "discoveries",
        label: "Discoveries",
        description: "Review pending discoveries from runners",
        icon: <Sparkles size={22} />,
        route: "/discoveries",
        color: "#4ECDC4",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: <Settings size={28} />,
    route: "/automation-builder/settings",
    color: "#FFD700",
    children: [
      {
        id: "automation-settings",
        label: "Automation",
        description: "Configure automation preferences",
        icon: <Sliders size={22} />,
        route: "/automation-builder/settings",
        color: "#FFD700",
      },
      {
        id: "application-settings",
        label: "Profile",
        description: "Manage your account settings",
        icon: <Settings size={22} />,
        route: "/profile",
        color: "#FFD700",
      },
      {
        id: "pricing",
        label: "Pricing",
        description: "View plans and billing",
        icon: <CreditCard size={22} />,
        route: "/pricing",
        color: "#FFD700",
      },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    icon: <Settings size={28} />,
    route: "/admin",
    color: "#FF6B6B",
    adminOnly: true,
    children: [
      {
        id: "admin-dashboard",
        label: "Dashboard",
        description: "Admin overview and metrics",
        icon: <LayoutDashboard size={22} />,
        route: "/admin",
        color: "#FF6B6B",
        adminOnly: true,
      },
      {
        id: "admin-annotations",
        label: "Annotations",
        description: "Manage training data annotations",
        icon: <Scan size={22} />,
        route: "/admin/annotations",
        color: "#FF6B6B",
        adminOnly: true,
      },
      {
        id: "admin-analysis",
        label: "GUI Analysis",
        description: "Analyze GUI elements globally",
        icon: <Search size={22} />,
        route: "/admin/analysis",
        color: "#FF6B6B",
        adminOnly: true,
      },
      {
        id: "admin-regions",
        label: "Region Analysis",
        description: "Screen region classification",
        icon: <Map size={22} />,
        route: "/admin/region-analysis",
        color: "#FF6B6B",
        adminOnly: true,
      },
      {
        id: "admin-architecture",
        label: "Architecture",
        description: "System architecture overview",
        icon: <Network size={22} />,
        route: "/admin/architecture",
        color: "#FF6B6B",
        adminOnly: true,
      },
    ],
  },
];

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
  const [openFlyout, setOpenFlyout] = useState<string | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [closeTimer, setCloseTimer] = useState<NodeJS.Timeout | null>(null);
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Prevent hydration mismatch by only rendering client-specific components after mount
  React.useEffect(() => {
    setMounted(true);
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
  const importer = new ConfigImporter();

  const handleExport = () => {
    if (!user) {
      toast.error("Please log in to export your project");
      return;
    }
    // Open the full export dialog with validation and RAG processing
    setShowExportDialog(true);
  };

  const handleImport = async () => {
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

        // Load configuration into both React Context and Zustand store
        // The context handles IndexedDB persistence, the store is used by UI components
        loadConfiguration(result);

        // Also load into Zustand store directly for immediate UI updates
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
  };

  const handleLogout = async () => {
    logout();
    router.push("/");
    toast.success("Logged out successfully");
  };

  // Get project ID from prop, URL params, or context - prioritize in that order
  const projectId =
    propProjectId ?? searchParams?.get("project") ?? contextProjectId ?? null;

  // Find the current project from the projects list
  const currentProject = projects.find((p) => p.id === projectId) ?? null;

  // Handle project selection - loads project data and updates context
  const handleProjectChange = async (newProjectId: string) => {
    // Load project data from backend/IndexedDB
    // This hydrates the Zustand store with workflows, states, transitions, images, etc.
    const loader = getProjectLoader();
    const success = await loader.load(newProjectId, {
      currentProjectId: contextProjectId,
    });

    if (!success) {
      toast.error("Failed to load project");
      return;
    }

    // IMPORTANT: Set both projectId AND projectName to ensure data isolation
    // The projectName is used by IndexedDB to filter states/workflows by project
    const newProject = projects.find((p) => p.id === newProjectId);
    setContextProjectId(newProjectId);
    if (newProject) {
      setProjectName(newProject.name);
    }
    // Update URL to include project parameter (preserves current page)
    const url = new URL(window.location.href);
    url.searchParams.set("project", newProjectId);
    router.push(url.pathname + url.search);
  };

  // Handle creating a new project
  const handleCreateProject = async () => {
    try {
      const newProject = await createProject.mutateAsync({
        name: `New Automation ${new Date().toLocaleDateString()}`,
        description: "A new automation workflow",
        configuration: {},
      });
      // Select the newly created project
      handleProjectChange(newProject.id);
      toast.success("Project created successfully");
    } catch (error: unknown) {
      console.error("Failed to create project:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to create project"
      );
    }
  };

  // Filter nav items based on admin status
  // IMPORTANT: During auth loading OR when user is null, we exclude admin-only items
  // to ensure consistent server/client rendering and avoid hydration mismatches.
  // On the server, user is always null. On the client, authLoading starts as true.
  const filterNavItems = (items: NavItem[]): NavItem[] => {
    return items
      .filter((item) => {
        // Exclude admin-only items when auth is loading or user not available
        // This ensures SSR and initial client render match
        if (authLoading || !user) return !item.adminOnly;
        // After auth loads with user data, filter based on actual user status
        return !item.adminOnly || user.is_superuser === true;
      })
      .map((item) => ({
        ...item,
        children: item.children ? filterNavItems(item.children) : undefined,
      }))
      .filter((item) => !item.children || item.children.length > 0);
  };

  const visibleNavItems = filterNavItems(navItems);

  // Save collapse state to localStorage
  const toggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem("unified-sidebar-collapsed", JSON.stringify(newState));

    // Close any open flyout when collapsing sidebar
    if (newState) {
      setOpenFlyout(null);
    }
  };

  const toggleFlyout = (id: string) => {
    setOpenFlyout(openFlyout === id ? null : id);
  };

  const isRouteActive = (route: string, item: NavItem): boolean => {
    // Check if route matches
    const checkRouteMatch = (routeToCheck: string): boolean => {
      if (routeToCheck.includes("?")) {
        const [basePath, query] = routeToCheck.split("?");
        const queryParams = new URLSearchParams(query);
        const currentParams = searchParams;

        const baseMatch = pathname === basePath;
        const categoryMatch =
          queryParams.get("category") === currentParams.get("category");
        const tabMatch = queryParams.get("tab") === currentParams.get("tab");

        const matches = baseMatch && categoryMatch && tabMatch;
        return matches;
      } else {
        // Route has no query params - it should only match if current path also has no query params
        const currentHasParams = searchParams.toString().length > 0;
        const matches = pathname === routeToCheck && !currentHasParams;
        return matches;
      }
    };

    // If item has children, check if any child is active
    if (item.children && item.children.length > 0) {
      const childActive = item.children.some((child) =>
        checkRouteMatch(child.route)
      );
      return childActive;
    }

    return checkRouteMatch(route);
  };

  const buildRoute = (route: string): string => {
    // Handle routes with :projectId placeholder (path parameter)
    if (route.includes(":projectId")) {
      if (!projectId) {
        // If no project selected, redirect to dashboard
        return "/dashboard";
      }
      return route.replace(":projectId", projectId);
    }

    // Handle routes with query parameter
    if (!projectId) return route;

    if (route.includes("?")) {
      return `${route}&project=${projectId}`;
    } else {
      return `${route}?project=${projectId}`;
    }
  };

  const handleNavigation = (route: string) => {
    router.push(buildRoute(route));
  };

  const handleOrganizationChange = async (orgId: string) => {
    try {
      await switchOrganization(orgId);
    } catch (error) {
      console.error("[UnifiedSidebar] Failed to switch organization:", error);
    }
  };

  const handleCreateOrganization = () => {
    setShowCreateOrgDialog(true);
  };

  // Convert organizations to the format expected by OrganizationSwitcher
  const switcherOrganizations: Array<{
    id: string;
    name: string;
    avatar_url?: string;
    member_count: number;
    role: "owner" | "admin" | "member" | "viewer";
  }> = organizations.map((org) => ({
    id: org.id,
    name: org.name,
    avatar_url: undefined, // Organizations don&apos;t have avatars yet
    member_count: org.member_count,
    role: org.owner_id === user?.id ? "owner" : "member",
  }));

  const switcherCurrentOrg = currentOrganization
    ? {
        id: currentOrganization.id,
        name: currentOrganization.name,
        avatar_url: undefined,
        member_count: currentOrganization.member_count,
        role: (currentOrganization.owner_id === user?.id
          ? "owner"
          : "member") as "owner" | "admin" | "member" | "viewer",
      }
    : null;

  return (
    <div
      data-sidebar="true"
      data-ui-id="sidebar-nav"
      className={cn(
        "fixed left-0 top-0 h-screen bg-surface-canvas border-r border-border-subtle flex flex-col transition-all duration-300 overflow-visible z-50",
        isCollapsed ? "w-16" : "w-64",
        className
      )}
    >
      {/* Top Gradient Overlay */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-cyan-500/5 via-purple-500/5 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="relative h-16 border-b border-border-subtle flex items-center justify-center px-3 py-2.5 bg-gradient-to-r from-cyan-500/5 via-purple-500/5 to-green-500/5">
        {isCollapsed ? (
          <img
            src="/q-logo.png"
            alt="Qontinui"
            className="h-10 w-auto"
          />
        ) : (
          <div className="flex items-center gap-1">
            <img
              src="/q-logo.png"
              alt="Qontinui"
              className="h-9 w-auto"
            />
            <span className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
              ontinui
            </span>
          </div>
        )}
      </div>

      {/* Organization Switcher */}
      {!isCollapsed && (
        <div className="px-3 pt-4 pb-2 border-b border-border-subtle">
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

      {/* Project Switcher */}
      {!isCollapsed && (
        <div className="px-3 pt-2 pb-2 border-b border-border-subtle">
          {mounted ? (
            <ProjectSwitcher
              projects={projects}
              currentProject={currentProject}
              onProjectChange={handleProjectChange}
              onCreateProject={handleCreateProject}
              loading={projectsLoading}
              className="bg-surface-raised/50 border-border-default hover:bg-surface-raised hover:border-border-default"
            />
          ) : (
            <div className="h-10 w-full rounded-md bg-surface-raised/50 border border-border-default animate-pulse" />
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin px-2 py-4 space-y-1">
        {visibleNavItems.map((item, index) => {
          const itemZIndex = visibleNavItems.length - index;
          return (
            <div
              key={item.id}
              className="relative"
              style={{ zIndex: itemZIndex }}
            >
              <button
                data-nav-id={item.id}
                data-ui-id={`sidebar-nav-item-${item.id}`}
                onClick={() => {
                  if (item.children) {
                    toggleFlyout(item.id);
                  } else {
                    handleNavigation(item.route);
                  }
                }}
                onMouseEnter={() => {
                  if (closeTimer) {
                    clearTimeout(closeTimer);
                    setCloseTimer(null);
                  }
                  setHoveredItem(item.id);
                }}
                onMouseLeave={() => {
                  // Delay closing to allow mouse to move to popover
                  const timer = setTimeout(() => {
                    setHoveredItem(null);
                  }, 300);
                  setCloseTimer(timer);
                }}
                className={cn(
                  "w-full px-3 py-2.5 rounded-lg flex items-center justify-between gap-2 transition-all duration-300 relative group",
                  isRouteActive(item.route, item)
                    ? `bg-[${item.color}]10 border-l-3 border-[${item.color}]`
                    : "hover:bg-surface-raised"
                )}
                style={
                  isRouteActive(item.route, item)
                    ? {
                        backgroundColor: `${item.color}20`,
                        borderLeftColor: item.color,
                      }
                    : {}
                }
              >
                {/* Left Border for Active */}
                {isRouteActive(item.route, item) && (
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full"
                    style={{ backgroundColor: item.color }}
                  />
                )}

                {/* Icon Container */}
                <div
                  className={cn(
                    "flex items-center transition-all duration-300",
                    isCollapsed ? "justify-center w-full" : "",
                    hoveredItem === item.id || isRouteActive(item.route, item)
                      ? "scale-110"
                      : "scale-100"
                  )}
                  style={
                    hoveredItem === item.id || isRouteActive(item.route, item)
                      ? {
                          filter: `drop-shadow(0 0 8px ${item.color}) brightness(${isRouteActive(item.route, item) ? 1.5 : 1.1})`,
                        }
                      : {}
                  }
                >
                  <span style={{ color: item.color }}>{item.icon}</span>
                </div>

                {/* Label & Chevron (only when expanded) */}
                {!isCollapsed && (
                  <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {item.label}
                    </span>
                    {item.children && (
                      <ChevronRight
                        size={16}
                        className={cn(
                          "flex-shrink-0 transition-transform duration-300",
                          openFlyout === item.id ? "rotate-90" : ""
                        )}
                      />
                    )}
                  </div>
                )}

                {/* Tooltip for Collapsed State */}
                {isCollapsed && hoveredItem === item.id && (
                  <div
                    className="absolute left-full ml-3 px-3 py-2 rounded-lg text-sm font-medium bg-surface-canvas border text-text-primary whitespace-nowrap z-50 pointer-events-none"
                    style={{
                      borderColor: item.color,
                      boxShadow: `0 0 12px ${item.color}40`,
                    }}
                  >
                    {item.label}
                  </div>
                )}
              </button>

              {/* Children - Expanded Sidebar Flyout */}
              {item.children && openFlyout === item.id && !isCollapsed && (
                <SidebarFlyout
                  parentLabel={item.label}
                  parentColor={item.color}
                  items={item.children.map((child) => ({
                    id: child.id,
                    label: child.label,
                    description: child.description,
                    icon: child.icon,
                    route: child.route,
                    color: child.color,
                    badge: child.badge,
                  }))}
                  onNavigate={handleNavigation}
                  onClose={() => setOpenFlyout(null)}
                  activeRoute={pathname}
                />
              )}

              {/* Children - Collapsed Sidebar Popover */}
              {item.children && isCollapsed && hoveredItem === item.id && (
                <CollapsedMenuPopover
                  parentId={item.id}
                  parentColor={item.color}
                  items={item.children}
                  onNavigate={handleNavigation}
                  onClose={() => setHoveredItem(null)}
                  onClearTimer={() => {
                    if (closeTimer) {
                      clearTimeout(closeTimer);
                      setCloseTimer(null);
                    }
                  }}
                />
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom Gradient Overlay */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-purple-500/5 to-transparent pointer-events-none" />

      {/* Footer with User Actions */}
      <div className="border-t border-border-subtle p-2">
        <TooltipProvider delayDuration={300}>
          {/* User action buttons */}
          {user && (
            <div
              className={cn(
                "flex gap-1 mb-2",
                isCollapsed ? "flex-col items-center" : "justify-center"
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleExport}
                    data-ui-id="sidebar-export-btn"
                    className="p-2 rounded-lg hover:bg-surface-raised transition-all duration-300 hover:scale-110 text-text-muted hover:text-brand-secondary"
                  >
                    <Download size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side={isCollapsed ? "right" : "top"}>
                  <p>Export & Load to Runner</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleImport}
                    data-ui-id="sidebar-import-btn"
                    className="p-2 rounded-lg hover:bg-surface-raised transition-all duration-300 hover:scale-110 text-text-muted hover:text-brand-success"
                  >
                    <Upload size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side={isCollapsed ? "right" : "top"}>
                  <p>Import Project</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => router.push("/docs")}
                    data-ui-id="sidebar-docs-btn"
                    className="p-2 rounded-lg hover:bg-surface-raised transition-all duration-300 hover:scale-110 text-text-muted hover:text-brand-primary"
                  >
                    <FileText size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side={isCollapsed ? "right" : "top"}>
                  <p>Documentation</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleLogout}
                    data-ui-id="sidebar-logout-btn"
                    className="p-2 rounded-lg hover:bg-surface-raised transition-all duration-300 hover:scale-110 text-text-muted hover:text-red-500"
                  >
                    <LogOut size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side={isCollapsed ? "right" : "top"}>
                  <p>Log Out</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* User info (when expanded) */}
          {user && !isCollapsed && (
            <div className="flex items-center gap-2 px-2 py-1 mb-2 text-xs text-text-muted">
              <User size={14} />
              <span className="truncate">{user.username || user.email}</span>
            </div>
          )}

          {/* Collapse toggle */}
          <div className="flex justify-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleCollapse}
                  data-ui-id="sidebar-collapse-btn"
                  className="p-2 rounded-lg hover:bg-surface-raised transition-all duration-300 hover:scale-110 text-text-muted hover:text-text-primary"
                >
                  {isCollapsed ? (
                    <ChevronRight size={20} />
                  ) : (
                    <ChevronLeft size={20} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side={isCollapsed ? "right" : "top"}>
                <p>{isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* Create Organization Dialog */}
      <CreateOrganizationDialog
        open={showCreateOrgDialog}
        onOpenChange={setShowCreateOrgDialog}
      />

      {/* Project Export Dialog */}
      <ProjectExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
      />
    </div>
  );
};
