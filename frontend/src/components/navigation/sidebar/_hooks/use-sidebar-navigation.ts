import { useCallback, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { setProductMode } from "qontinui-navigation";
import type { NavItem } from "../types";
import { getWebNavItems } from "../shared-nav-adapter";
import { devNavItems } from "../nav-items";
import { useAuth } from "@/contexts/auth-context";
import { useProductMode } from "@/contexts/product-mode-context";

export function useSidebarNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { mode: productMode } = useProductMode();
  const [mounted, setMounted] = useState(false);

  const isDevelopment = process.env.NODE_ENV === "development";

  const filterNavItems = useCallback(
    (items: NavItem[]): NavItem[] => {
      return items
        .filter((item) => {
          if (item.hiddenInProd && (!mounted || !isDevelopment)) return false;
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
    [mounted, isDevelopment, authLoading, user, productMode]
  );

  // Sync product mode to the shared navigation package and rebuild items
  const allItems = useMemo(() => {
    setProductMode(productMode);
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
  }, [productMode]);

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
    setMounted,
    visibleNavItems,
    isRouteActive,
    buildRoute,
    handleNavigation,
    handleDocs,
    searchParams,
  };
}
