/**
 * Route-manifest generator — walks the Next.js `app/` directory to discover
 * every navigable route in the application.
 *
 * Used by the spec-less crawl lane (Phase 4 of the Playwright Parity plan) to
 * smoke-test pages that have no IR spec for console errors, HTTP 500s, and
 * basic page health. The authoritative route source is the file system.
 */

import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export interface AppRoute {
  /** URL path, e.g. "/login", "/dashboard", "/settings/general" */
  path: string;
  /** true if any segment is a [param] dynamic segment */
  isDynamic: boolean;
  /** Default fixture values for dynamic segments (only when isDynamic) */
  dynamicParams?: Record<string, string>;
}

/** Page file names that make a directory a navigable route. */
const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js"] as const;

/**
 * Default fixture values for common dynamic-segment parameter names.
 * Used to construct concrete URLs for dynamic routes during crawl.
 * The demo-detail UUID is the same one already used in run-spec-ci.ts:650.
 */
const DYNAMIC_FIXTURES: Record<string, string> = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  slug: "spec-ci-test-slug",
  sessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  agent_id: "spec-ci-sentinel-agent",
  projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  runId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  entryId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  findingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  doc: "spec-ci-fixture",
  name: "spec-ci-fixture",
  version: "spec-ci-fixture",
};

/** Fallback fixture value for dynamic params not in DYNAMIC_FIXTURES. */
const DEFAULT_FIXTURE = "spec-ci-fixture";

/**
 * Returns true if a directory entry is a Next.js route group (parenthesized
 * name like `(app)` or `(marketing)`). Route groups are transparent in the
 * URL — their name is stripped from the path.
 */
function isRouteGroup(name: string): boolean {
  return name.startsWith("(") && name.endsWith(")");
}

/**
 * Returns true if a directory entry is a Next.js dynamic segment, e.g. `[id]`
 * or `[...path]` (catch-all).
 */
function isDynamicSegment(name: string): boolean {
  return name.startsWith("[") && name.endsWith("]");
}

/**
 * Extract the parameter name from a dynamic segment directory name.
 * `[id]` -> `"id"`, `[...path]` -> `"path"`.
 */
function extractParamName(segment: string): string {
  let inner = segment.slice(1, -1); // strip [ ]
  if (inner.startsWith("...")) inner = inner.slice(3); // catch-all
  return inner;
}

/** Returns true if a directory entry has a page file. */
function hasPageFile(dir: string): boolean {
  return PAGE_FILES.some((f) => existsSync(join(dir, f)));
}

/**
 * Walk the Next.js app/ directory and return every navigable route.
 *
 * A route is navigable if its directory contains page.tsx (or .ts/.jsx/.js).
 * Route groups like (app) and (marketing) are transparent -- their name is
 * stripped from the URL path. Underscore-prefixed directories (_components,
 * _hooks) and `api/` routes are skipped.
 */
export function discoverAppRoutes(appDir: string): AppRoute[] {
  const routes: AppRoute[] = [];

  function walk(dir: string, pathSegments: string[], dynamicParams: Record<string, string>): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // unreadable directory -- skip
    }

    // Check if THIS directory is a navigable route
    if (hasPageFile(dir)) {
      const urlPath = "/" + pathSegments.join("/");
      const isDyn = Object.keys(dynamicParams).length > 0;
      routes.push({
        path: urlPath || "/",
        isDynamic: isDyn,
        ...(isDyn ? { dynamicParams: { ...dynamicParams } } : {}),
      });
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      const entryPath = join(dir, entry);

      // Skip non-directories
      try {
        if (!statSync(entryPath).isDirectory()) continue;
      } catch {
        continue; // unreadable -- skip
      }

      // Skip underscore-prefixed directories (_components, _hooks, etc.)
      if (entry.startsWith("_")) continue;

      // Skip api/ routes (they're not pages)
      if (entry === "api") continue;

      // Skip node_modules and hidden directories
      if (entry === "node_modules" || entry.startsWith(".")) continue;

      if (isRouteGroup(entry)) {
        // Route groups are transparent -- recurse without adding to path
        walk(entryPath, pathSegments, dynamicParams);
      } else if (isDynamicSegment(entry)) {
        // Dynamic segments: add the param fixture to the path
        const paramName = extractParamName(entry);
        const fixture = DYNAMIC_FIXTURES[paramName] ?? DEFAULT_FIXTURE;
        walk(entryPath, [...pathSegments, fixture], {
          ...dynamicParams,
          [paramName]: fixture,
        });
      } else {
        // Regular directory segment
        walk(entryPath, [...pathSegments, entry], dynamicParams);
      }
    }
  }

  walk(appDir, [], {});
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}
