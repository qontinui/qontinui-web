/**
 * pageMap.ts
 *
 * Single source of truth for the co-pilot's page graph: the set of pages the
 * planner is allowed to target (each with an `id` + short `description`) and
 * the `pageId -> URL` map the executor uses to navigate the user's own tab.
 *
 * BOTH are derived from the existing shared navigation registry
 * (`qontinui-navigation`'s `getWebNavigation()`), the same registry that
 * renders the app sidebar (see
 * `src/components/navigation/sidebar/shared-nav-adapter.ts`). Sourcing the
 * planner's page list and the executor's URL map from one registry means a
 * planner-emitted page id is, by construction, a real route the executor can
 * resolve — there is no hand-maintained mirror to drift.
 *
 * Pure, server- and client-safe: `qontinui-navigation` has no React runtime
 * dependency for these accessors, so this module can be imported from Route
 * Handlers, RSC, and client components alike.
 */

import { getWebNavigation, type NavigationItem } from "qontinui-navigation";

/** A page the co-pilot planner may target. */
export interface CopilotPage {
  /** Stable nav-item id (e.g. "build-workflows", "runner-fleet"). */
  id: string;
  /** Short human-readable description for the planner's page list. */
  description: string;
}

/**
 * Resolve a NavigationItem's route. Mirrors `shared-nav-adapter.ts`'s
 * convention: an item without an explicit `route` falls back to `/${id}`.
 */
function routeForItem(item: NavigationItem): string {
  return item.route ?? `/${item.id}`;
}

/**
 * The co-pilot's OWN route. Excluded from the targetable page list so the
 * planner can never ground a step on the co-pilot surface or "navigate to
 * /co-pilot" from /co-pilot (self-targeting). The co-pilot only ever drives
 * OTHER pages after it soft-navigates away, so its own page is never a valid
 * target. Pairs with the `data-bridge-invisible` guard on the page wrappers.
 */
const SELF_ROUTE = "/co-pilot";

/**
 * Build a short description for the planner's page list. Prefers the
 * registry's `description`; falls back to the `label` so every page carries
 * at least a human-readable name.
 */
function descriptionForItem(item: NavigationItem): string {
  const desc = item.description?.trim();
  if (desc) return desc;
  return item.label.trim();
}

/**
 * Walk the web navigation groups depth-first, visiting every item and its
 * children exactly once (deduped by id — the registry can surface the same
 * item as both a parent and inside a CHILDREN_MAP). Routes containing path
 * params (e.g. `/projects/:projectId/rag`) are skipped: the co-pilot cannot
 * navigate to a parameterized URL without runtime context, so they must not
 * appear as targetable pages.
 */
function collectItems(): NavigationItem[] {
  const seen = new Set<string>();
  const out: NavigationItem[] = [];

  const visit = (item: NavigationItem): void => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    const route = routeForItem(item);
    // Skip parameterized routes — not navigable without runtime context.
    // Skip the co-pilot's own route — the planner must never target itself.
    if (!route.includes(":") && route !== SELF_ROUTE) {
      out.push(item);
    }
    // NavigationItem children are not embedded on the item in the shared
    // package's flat model; the adapter resolves them via getChildrenForPlatform.
    // getWebNavigation() already returns the platform-filtered groups, but its
    // items may carry nested children on some shapes — handle defensively.
    const children = (item as NavigationItem & { children?: NavigationItem[] })
      .children;
    if (Array.isArray(children)) {
      for (const child of children) visit(child);
    }
  };

  for (const group of getWebNavigation()) {
    for (const item of group.items) visit(item);
  }
  return out;
}

/**
 * Memoized derivation. The navigation registry is static for the process
 * lifetime, so we compute the page list / URL map once on first access.
 */
let cachedPages: CopilotPage[] | null = null;
let cachedUrlMap: Readonly<Record<string, string>> | null = null;

function build(): {
  pages: CopilotPage[];
  urlMap: Readonly<Record<string, string>>;
} {
  if (cachedPages !== null && cachedUrlMap !== null) {
    return { pages: cachedPages, urlMap: cachedUrlMap };
  }

  const items = collectItems();
  const pages: CopilotPage[] = [];
  const urlMap: Record<string, string> = {};

  for (const item of items) {
    pages.push({ id: item.id, description: descriptionForItem(item) });
    urlMap[item.id] = routeForItem(item);
  }

  cachedPages = pages;
  cachedUrlMap = Object.freeze(urlMap);
  return { pages: cachedPages, urlMap: cachedUrlMap };
}

/**
 * The set of pages the co-pilot planner may target. The SAME array seeds the
 * page-catalog header (so the planner sees the page ids) and the planner
 * request's `pages` param. Order follows the sidebar's group/item order.
 */
export const copilotPages: CopilotPage[] = build().pages;

/**
 * Immutable `pageId -> URL` map. Keys are nav-item ids; values are the routes
 * the executor navigates to. Derived from the same registry as `copilotPages`.
 */
export const pageMap: Readonly<Record<string, string>> = build().urlMap;

/**
 * Resolve a planner-emitted page id to its app-relative URL. Returns
 * `undefined` for an unknown id so the executor can surface a clear
 * "no such page" error rather than navigating somewhere unexpected.
 */
export function pageIdToUrl(id: string): string | undefined {
  return build().urlMap[id];
}
