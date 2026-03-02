import { useCallback, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { NavItem } from "../types";
import { getWebNavItems } from "../shared-nav-adapter";
import { devNavItems } from "../nav-items";
import { useAuth } from "@/contexts/auth-context";

export function useSidebarNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [mounted, setMounted] = useState(false);

  const isDevelopment = process.env.NODE_ENV === "development";

  const filterNavItems = useCallback(
    (items: NavItem[]): NavItem[] => {
      return items
        .filter((item) => {
          if (item.hiddenInProd && (!mounted || !isDevelopment)) return false;
          if (authLoading || !user) return !item.adminOnly;
          return !item.adminOnly || user.is_superuser === true;
        })
        .map((item) => ({
          ...item,
          children: item.children ? filterNavItems(item.children) : undefined,
        }))
        .filter((item) => !item.children || item.children.length > 0);
    },
    [mounted, isDevelopment, authLoading, user]
  );

  const allItems = useMemo(() => {
    const shared = getWebNavItems();
    return isDevelopment ? [...shared, ...devNavItems] : shared;
  }, [isDevelopment]);

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
