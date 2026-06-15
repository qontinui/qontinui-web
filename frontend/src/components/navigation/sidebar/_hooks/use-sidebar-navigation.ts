import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { setProductMode, setShowHiddenItems } from "@qontinui/navigation";
import type { NavItem } from "../types";
import { getWebNavItems } from "../shared-nav-adapter";
import { devNavItems } from "../nav-items";
import { useAuth } from "@/contexts/auth-context";
import { useProductMode } from "@/contexts/product-mode-context";
import { useAdvancedAutomation } from "@/contexts/advanced-automation-context";

// ===========================================================================
// Web menu policy (coord + sessions centric).
//
// qontinui-web's focus is the coordination layer + Terminal/agent sessions, not
// workflow/visual authoring. Terminal sessions live in `coord.sessions` and do
// NOT produce task_runs, findings, observations, or library assets — so the
// workflow/task/automation pages below are dead weight for a session+coord user
// and are demoted out of the default menu.
//
// WEB_HIDDEN_IDS — runner-only features whose web routes 404 (no page exists on
// web). Always removed from the web sidebar.
const WEB_HIDDEN_IDS = new Set<string>([
  "reflection",
  "tasks",
  "triggers",
]);

// WEB_ADVANCED_IDS — workflow / task / automation / visual surfaces. Removed
// from the default web menu but revealed by the Settings → General "Show
// advanced automation features" toggle (same toggle that reveals the
// package-level `hidden` items via setShowHiddenItems). Routes stay registered
// so deep-links keep working.
const WEB_ADVANCED_IDS = new Set<string>([
  // execution / review (task_run-scoped, not session-scoped)
  "active",
  "runs",
  "run-findings",
  "memory",
  "gui-automation",
  "scheduled-runs",
  // workflow / automation authoring + assets
  "library",
  "state-machine",
  "state-machine-dev",
  "specs",
  "build-flow-designer",
  "review",
  "inspector",
  // visual automation (belongs to visual mode; never in the coord default)
  "vga",
  // insights / config that are workflow/automation-scoped
  "error-monitor",
  "processes",
  "architecture",
  "observations",
  "config-findings",
  "config-hooks",
  "config-ui-bridge",
]);

export function useSidebarNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { mode: productMode } = useProductMode();
  const { showAdvancedAutomation } = useAdvancedAutomation();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDevelopment = process.env.NODE_ENV === "development";

  const filterNavItems = useCallback(
    (items: NavItem[]): NavItem[] => {
      return items
        .filter((item) => {
          if (item.hiddenInProd && (!mounted || !isDevelopment)) return false;
          // Web menu policy: runner-only items that 404 on web are always gone;
          // workflow/automation/visual items are gated behind the advanced toggle.
          if (WEB_HIDDEN_IDS.has(item.id)) return false;
          if (!showAdvancedAutomation && WEB_ADVANCED_IDS.has(item.id))
            return false;
          if (
            item.productMode &&
            item.productMode !== "both" &&
            item.productMode !== productMode
          )
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
    [mounted, isDevelopment, authLoading, user, productMode, showAdvancedAutomation]
  );

  // Sync product mode to the shared navigation package and rebuild items
  const allItems = useMemo(() => {
    setProductMode(productMode);
    setShowHiddenItems(showAdvancedAutomation);
    const shared = getWebNavItems();
    // Insert devNavItems before SYSTEM so mode-specific items appear above
    // Settings/Help. Admin goes after SYSTEM (always last).
    const systemIdx = shared.findIndex((item) => item.group === "SYSTEM");
    const mainItems = devNavItems.filter((item) => !item.adminOnly);
    const adminItems = devNavItems.filter((item) => item.adminOnly);
    if (systemIdx >= 0) {
      return [
        ...shared.slice(0, systemIdx),
        ...mainItems,
        ...shared.slice(systemIdx),
        ...adminItems,
      ];
    }
    return [...shared, ...devNavItems];
  }, [productMode, showAdvancedAutomation]);

  const visibleNavItems = useMemo(() => {
    return filterNavItems(allItems);
  }, [filterNavItems, allItems]);

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
              child.children.some((gc) => checkRouteMatch(gc.route)))
        );
      }

      return checkRouteMatch(route);
    },
    [pathname, searchParams]
  );

  const buildRoute = useCallback(
    (route: string, projectId: string | null): string => {
      if (route.includes(":projectId")) {
        if (!projectId) return "/build/workflows";
        return route.replace(":projectId", projectId);
      }

      if (!projectId) return route;

      if (route.includes("?")) {
        return `${route}&project=${projectId}`;
      } else {
        return `${route}?project=${projectId}`;
      }
    },
    []
  );

  const handleNavigation = useCallback(
    (route: string, projectId: string | null) => {
      router.push(buildRoute(route, projectId));
    },
    [router, buildRoute]
  );

  const handleDocs = useCallback(() => {
    router.push("/docs");
  }, [router]);

  return {
    mounted,
    visibleNavItems,
    isRouteActive,
    buildRoute,
    handleNavigation,
    handleDocs,
    searchParams,
  };
}
