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
  // This allows navigate commands to use Next.js router.push() instead of raw
  // history.pushState / window.location.href — pushState updates the URL bar
  // but the App Router never re-renders (useSearchParams stays stale), and a
  // location assignment destroys the SSE connection and React tree.
  //
  // Mount-order robustness: the SDK creates `window.__UI_BRIDGE__` lazily and
  // always MERGES into an existing object, never clobbers (0.13.0
  // `w.__UI_BRIDGE__ ?? (w.__UI_BRIDGE__ = {})`), and reads `navigateHandler`
  // off the global at command time. So when the global doesn't exist yet at
  // mount (provider mounts before SDK init), we create it ourselves instead of
  // silently no-oping — the old `if (g)` guard never retried, leaving soft
  // navigation on the raw-pushState fallback for the whole session.
  useEffect(() => {
    const w = window as unknown as {
      __UI_BRIDGE__?: Record<string, unknown> & {
        navigateHandler?: (url: string) => void;
      };
    };
    const g = w.__UI_BRIDGE__ ?? (w.__UI_BRIDGE__ = {});
    g.navigateHandler = (url: string) => router.push(url);
    return () => {
      const g2 = w.__UI_BRIDGE__;
      if (g2) delete g2.navigateHandler;
    };
  }, [router]);

  return <>{children}</>;
}
