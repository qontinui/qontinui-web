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

import {
  getWebNavigation,
  getShowHiddenItems,
  setShowHiddenItems,
  type NavigationItem,
} from "@qontinui/navigation";

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
 * /prompt-home" from /prompt-home (self-targeting). The co-pilot only ever
 * drives OTHER pages after it soft-navigates away, so its own page is never a
 * valid target. Pairs with the `data-bridge-invisible` guard on the surface
 * wrappers.
 *
 * The co-pilot surface IS the Home route (`/prompt-home`) — Home renders the
 * co-pilot, matching the runner. (The shared navigation registry surfaces
 * `prompt-home` as a web nav item, so this exclusion keeps Home out of the
 * planner's targetable pages.)
 */
const SELF_ROUTE = "/prompt-home";

/**
 * Co-pilot-local description overrides, keyed by nav-item id.
 *
 * Why these exist: two pages were effectively both named "Workflows", which is
 * ambiguous for a user AND for the runner's planner when it grounds "go to the
 * workflows page". The shared navigation registry (`qontinui-navigation`) is a
 * published package we don't edit from here, so we disambiguate the
 * PLANNER-FACING descriptions at the co-pilot's edge:
 *
 *   - `unified-workflow-builder` (/build/workflows) IS the workflows page — its
 *     sidebar label is already "Workflows". We make its planner description an
 *     unambiguous "Workflows — ..." so the planner routes "the workflows page"
 *     here (to /build/workflows), not to /execute.
 *   - `gui-automation` (/execute) is the run/schedule surface — its sidebar
 *     label is "Execute". We describe it as "Execute / run & schedule
 *     workflows" so it is NOT mistaken for "the workflows page" even though it
 *     runs workflows.
 *
 * Keep this list tiny — it is purely a disambiguation overlay, not a mirror of
 * the registry. Any id not present here falls back to the registry description.
 */
const COPILOT_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  // The authoring surface labelled "Workflows" — the page users (and the
  // planner) mean by "the workflows page".
  "unified-workflow-builder":
    "Workflows — create and edit automation workflows (this is the workflows page)",
  // The run/schedule surface labelled "Execute" — runs workflows but is NOT
  // "the workflows page".
  "gui-automation": "Execute / run & schedule workflows",
};

/**
 * Build a short description for the planner's page list. A co-pilot-local
 * override (see {@link COPILOT_DESCRIPTION_OVERRIDES}) wins so we can
 * disambiguate without editing the shared registry; otherwise prefers the
 * registry's `description` and falls back to the `label` so every page carries
 * at least a human-readable name.
 */
function descriptionForItem(item: NavigationItem): string {
  const override = COPILOT_DESCRIPTION_OVERRIDES[item.id];
  if (override) return override;
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

  // Defensive: the registry accessor should always return the static web
  // navigation groups, but guard against it throwing or yielding nothing so a
  // registry regression can't silently produce an EMPTY page list. An empty
  // `pages` array is exactly what makes the runner planner fall back to its
  // hardcoded `page-…` ids (the live-E2E failure) — so we treat "no items" as a
  // bug to surface, not a state to ship.
  // Include items flagged `hidden` — the advanced workflow-authoring surfaces
  // (Workflow Builder, Step Builders) are hidden from the SIDEBAR but remain
  // valid navigation targets, so the co-pilot must still be able to ground a
  // step on e.g. /build/workflows. `setShowHiddenItems` toggles synchronous
  // global state in the registry; set -> derive -> restore happens in one tick
  // (no await between) so this stays net-pure and cannot interleave.
  let groups: ReturnType<typeof getWebNavigation> = [];
  const prevShowHidden = getShowHiddenItems();
  setShowHiddenItems(true);
  try {
    groups = getWebNavigation() ?? [];
  } catch {
    groups = [];
  } finally {
    setShowHiddenItems(prevShowHidden);
  }
  for (const group of groups) {
    for (const item of group.items ?? []) visit(item);
  }
  if (out.length === 0 && typeof console !== "undefined") {
    console.error(
      "[co-pilot] getWebNavigation() yielded no navigable pages — the planner " +
        "will receive an empty page list and fall back to runner page ids.",
    );
  }
  return out;
}

/**
 * Defensive alias map: a handful of common RUNNER page-ids the planner might
 * still emit, mapped to the WEB page-id whose route they should resolve to.
 *
 * Why this exists: the runner's planner is prompted with a long system prompt
 * whose hardcoded fallback page list uses `page-…`-prefixed ids (see
 * `qontinui-runner/.../prompt_home.rs`'s `SYSTEM_PROMPT_RUNNER_PAGES`). Even
 * when we supply the web's OWN (un-prefixed) `pages` list, the LLM sometimes
 * leaks that `page-…` convention and emits e.g. `page-gui-automation` instead
 * of the web id `gui-automation` we advertised. That id is not in `pageMap`,
 * so the executor dead-ends with "unknown page id". This map is a fallback so a
 * stray runner-id still resolves to the nearest web route instead of failing.
 *
 * Most runner ids are just the web id with a `page-` prefix, so `pageIdToUrl`
 * first tries stripping the prefix and re-looking-up the real map; this table
 * only needs the handful whose runner name differs from the web id (or has no
 * exact web equivalent and should resolve to the nearest page). Keep it small.
 */
const RUNNER_PAGE_ID_ALIASES: Readonly<Record<string, string>> = {
  // "Run and schedule workflows" page — the planner's most common target for
  // "go to the workflows page". Runner id is page-gui-automation; web id is
  // gui-automation (route /execute). This is the exact live-E2E failure.
  "page-gui-automation": "gui-automation",
  // Workflow authoring surface (route /build/workflows).
  "page-unified-workflow-builder": "unified-workflow-builder",
  // Scheduled / queued runs → nearest web pages.
  "page-workflow-queue": "tasks",
  "page-active": "active",
  "page-runs": "runs",
  "page-run-recap": "runs",
  "page-run-findings": "run-findings",
  "page-runs-history": "runs",
  // Observe / knowledge surfaces → web's OWN observations page (/observations).
  //
  // These used to point at the shared registry's `memory` id. As of
  // @qontinui/navigation 0.2.0 that item was renamed `observations` AND gated
  // `platforms: ["runner"]` — its route (`/observe/memory`) 404s on web, which
  // has no `observe/` route tree. So it is (correctly) absent from
  // `getWebNavigation()` and therefore from the registry-derived `urlMap`.
  //
  // Web's equivalent surface is its own local `/observations` page (see
  // WEB_LOCAL_PAGES), so the aliases target that instead — otherwise these ids
  // would dead-end at `undefined`.
  "page-memory-search": "observations",
  "page-knowledge-explorer": "observations",
  // Settings family (runner splits into sub-pages the web doesn't have).
  "page-settings": "settings",
  "page-settings-ai": "settings",
  "page-settings-agentic": "settings",
  "page-settings-general": "settings",
  // Library / specs / builders.
  "page-library": "library",
  "page-specs": "specs",
  "page-step-builders": "step-builders",
  "page-state-machine": "state-machine",
  // Misc 1:1 (also covered by prefix-strip, listed for clarity).
  "page-error-monitor": "error-monitor",
  "page-processes": "processes",
  "page-triggers": "triggers",
  "page-tasks": "tasks",
  // NOTE: no `page-prompt-home` alias — `/prompt-home` is the co-pilot's OWN
  // surface (SELF_ROUTE), excluded from the targetable page map. A leaked
  // runner `page-prompt-home` must NOT resolve to a navigable target (the
  // co-pilot never navigates to itself), so it deliberately falls through to
  // `undefined`.
  "page-reflection": "reflection",
  "page-architecture": "architecture",
  "page-help": "help",
};

/**
 * WEB-LOCAL pages: real qontinui-web routes that the SHARED registry does not
 * surface for the `web` platform, so `collectItems()` cannot see them.
 *
 * Keep this list tiny — it is the deliberate escape hatch for the (few) pages
 * qontinui-web owns outright, mirroring the web-local ids the sidebar already
 * carries in `nav-items.ts`. It is NOT a mirror of the registry.
 *
 * `observations` (/observations, rendered by
 * `src/app/(app)/observations/page.tsx`) is the case that forces this: the
 * shared registry's like-named item is runner-only (its `/observe/memory`
 * route does not exist on web), so without this entry the co-pilot has NO way
 * to reach web's observation-memory surface at all.
 *
 * Ids here must not collide with a registry id; registry items win.
 */
const WEB_LOCAL_PAGES: ReadonlyArray<CopilotPage & { route: string }> = [
  {
    id: "observations",
    description:
      "Observations — browse cross-session observation memory with temporal filtering",
    route: "/observations",
  },
];

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

  // Web-local pages the shared registry does not surface for `web`. Registry
  // items win on an id collision (the registry stays the source of truth).
  for (const local of WEB_LOCAL_PAGES) {
    if (urlMap[local.id] !== undefined) continue;
    if (local.route === SELF_ROUTE || local.route.includes(":")) continue;
    pages.push({ id: local.id, description: local.description });
    urlMap[local.id] = local.route;
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
 * `undefined` for a genuinely unknown id so the executor can surface a clear
 * "no such page" error rather than navigating somewhere unexpected.
 *
 * Resolution order:
 *   1. The real registry-derived map (the happy path — the id we advertised).
 *   2. Fallback for runner-id leakage: strip a leading `page-` and retry the
 *      real map (most runner ids are just the web id with that prefix).
 *   3. The explicit {@link RUNNER_PAGE_ID_ALIASES} table, for runner ids whose
 *      name differs from the web id or that have no exact web equivalent.
 */
export function pageIdToUrl(id: string): string | undefined {
  const urlMap = build().urlMap;

  // 1. Exact, registry-derived web id — the id the planner SHOULD emit.
  const direct = urlMap[id];
  if (direct !== undefined) return direct;

  // 2. Runner-id leakage: the planner prefixed a web id with `page-`. Strip it
  //    and retry the real map so e.g. `page-library` -> `library` -> /library.
  if (id.startsWith("page-")) {
    const stripped = urlMap[id.slice("page-".length)];
    if (stripped !== undefined) return stripped;
  }

  // 3. Explicit alias for runner ids that don't match by prefix-strip (e.g.
  //    `page-memory-search` -> memory, `page-settings-ai` -> settings).
  const aliasWebId = RUNNER_PAGE_ID_ALIASES[id];
  if (aliasWebId !== undefined) {
    const aliased = urlMap[aliasWebId];
    if (aliased !== undefined) return aliased;
  }

  return undefined;
}
