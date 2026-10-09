"use client";

/**
 * Route Awareness Provider
 *
 * Bridges Next.js routing information into the UI Bridge navigation tracker
 * via the useRouteAwareness hook. This enables automation tools to understand
 * the current route, params, and query parameters.
 *
 * `pattern` is a route TEMPLATE (`/marketplace/[slug]`), never the concrete
 * pathname: consumers such as the runner's journey ledger store it, so a
 * concrete `/search/<what the user typed>` would leak user input. Hence:
 *
 * - `routePatternFromParams` derives the template from the RAW `useParams()`
 *   (flattening a catch-all array with `/` would destroy its `[...slug]` run),
 *   and returns `null` rather than leak;
 * - `patternSource: "router"` asserts the template came from the router — a
 *   consumer drops a pattern that does not carry it;
 * - this provider OWNS the not-found signal and provides it to children. On a
 *   404, Next renders `app/not-found.tsx` inside the root layout with
 *   `useParams() == {}`, so `matched: true` alone would hand back the concrete
 *   path. `not-found.tsx` raises the signal (`useMarkRouteUnmatched`) in a
 *   layout effect, which runs before this provider's passive effect in the same
 *   commit, so the hook reports `pattern: null` instead.
 *
 * This provider must stay an ANCESTOR of `app/not-found.tsx` (it is mounted by
 * `UIBridgeWrapper` in the root layout); the context form of
 * `useMarkRouteUnmatched()` silently no-ops without one.
 */

import React, { useEffect } from "react";
import {
  usePathname,
  useSearchParams,
  useParams,
  useRouter,
} from "next/navigation";
import {
  RouteUnmatchedContext,
  routePatternFromParams,
  useRouteAwareness,
  useRouteUnmatchedSignal,
} from "@qontinui/ui-bridge/react";

/**
 * The CONCRETE params as `RouteInfo.params` carries them (`Record<string,
 * string>`, so a catch-all array is joined with `/`). Display data for
 * automation tools only — never used to derive the pattern, which needs the
 * raw arrays to template a `[...slug]` run.
 */
function paramsForReport(
  params: ReturnType<typeof useParams>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
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
  const unmatched = useRouteUnmatchedSignal();

  useRouteAwareness(
    {
      // matched: true is safe ONLY because `unmatched` overrides it on a 404.
      pattern: routePatternFromParams(pathname, params, { matched: true }),
      patternSource: "router",
      params: paramsForReport(params),
      queryParams: Object.fromEntries(searchParams),
    },
    { unmatched }
  );

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

  return (
    <RouteUnmatchedContext value={unmatched}>{children}</RouteUnmatchedContext>
  );
}
