"use client";

/**
 * Route Awareness Provider
 *
 * Bridges Next.js routing information into the UI Bridge navigation tracker
 * via the useRouteAwareness hook. This enables automation tools to understand
 * the current route, params, and query parameters.
 */

import React, { useEffect } from "react";
import {
  usePathname,
  useSearchParams,
  useParams,
  useRouter,
} from "next/navigation";
import { useRouteAwareness } from "@qontinui/ui-bridge/react";

function flattenParams(
  params: ReturnType<typeof useParams>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      result[key] = Array.isArray(value) ? value.join("/") : value;
    }
  }
  return result;
}

export function RouteAwarenessProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams();
  const router = useRouter();

  useRouteAwareness({
    pattern: pathname,
    params: flattenParams(params),
    queryParams: Object.fromEntries(searchParams),
  });

  // Register client-side navigation handler for UI Bridge pageNavigate commands.
  // This allows navigate commands to use Next.js router.push() instead of
  // window.location.href, which would destroy the SSE connection and React tree.
  useEffect(() => {
    const g = (window as Record<string, unknown>).__UI_BRIDGE__ as
      | (Record<string, unknown> & { navigateHandler?: (url: string) => void })
      | undefined;
    if (g) {
      g.navigateHandler = (url: string) => router.push(url);
    }
    return () => {
      const g2 = (window as Record<string, unknown>).__UI_BRIDGE__ as
        | (Record<string, unknown> & {
            navigateHandler?: (url: string) => void;
          })
        | undefined;
      if (g2) delete g2.navigateHandler;
    };
  }, [router]);

  return <>{children}</>;
}
