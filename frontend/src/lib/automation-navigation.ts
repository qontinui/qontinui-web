import {
  LayoutDashboard,
  GitBranch,
  Network,
  TestTube,
  BarChart3,
  FileText,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface AutomationRoute {
  name: string;
  path: string;
  icon: LucideIcon;
  description?: string;
  badge?: number;
}

export const automationBuilderRoutes: AutomationRoute[] = [
  {
    name: "Workflows",
    path: "/build/workflows",
    icon: LayoutDashboard,
    description: "Manage and edit workflows",
  },
  {
    name: "Workflows",
    path: "/automation-builder",
    icon: GitBranch,
    description: "Manage and edit workflows",
  },
  {
    name: "Dependencies",
    path: "/automation-builder/dependencies",
    icon: Network,
    description: "Visualize workflow dependencies",
  },
  {
    name: "Testing",
    path: "/automation-builder/testing",
    icon: TestTube,
    description: "Test workflows and view results",
  },
  {
    name: "Analytics",
    path: "/automation-builder/analytics",
    icon: BarChart3,
    description: "Performance metrics and insights",
  },
  {
    name: "Documentation",
    path: "/automation-builder/documentation",
    icon: FileText,
    description: "API docs and guides",
  },
  {
    name: "Settings",
    path: "/automation-builder/settings",
    icon: Settings,
    description: "Configuration and preferences",
  },
];

/**
 * Get route by path
 */
export function getRouteByPath(path: string): AutomationRoute | undefined {
  return automationBuilderRoutes.find((route) => route.path === path);
}

/**
 * Get route name by path
 */
export function getRouteNameByPath(path: string): string {
  const route = getRouteByPath(path);
  return route?.name || "Automation Builder";
}

/**
 * Check if a path is an automation builder route
 */
export function isAutomationBuilderRoute(path: string): boolean {
  return path.startsWith("/automation-builder");
}

/**
 * Get active route from pathname
 */
export function getActiveRoute(pathname: string): AutomationRoute | undefined {
  // Exact match first
  const exactMatch = automationBuilderRoutes.find(
    (route) => route.path === pathname
  );
  if (exactMatch) return exactMatch;

  // Try to match by prefix (for nested routes)
  return automationBuilderRoutes.find((route) => {
    if (
      route.path === "/automation-builder" &&
      pathname === "/automation-builder"
    ) {
      return true;
    }
    return pathname.startsWith(route.path + "/");
  });
}
