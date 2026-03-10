"use client";

/**
 * Route Awareness Provider
 *
 * Bridges Next.js routing information into the UI Bridge navigation tracker
 * via the useRouteAwareness hook. This enables automation tools to understand
 * the current route, params, and query parameters.
 */

import React from "react";
import { usePathname, useSearchParams, useParams } from "next/navigation";
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

  useRouteAwareness({
    pattern: pathname,
    params: flattenParams(params),
    queryParams: Object.fromEntries(searchParams),
  });

  return <>{children}</>;
}
