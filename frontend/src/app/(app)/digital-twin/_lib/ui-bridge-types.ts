/**
 * Shapes for the runner's Spec API + live snapshot, read through the relay,
 * and what the tab derives from them (`summarizeSpecGraph`,
 * `snapshotHasElementTree`). Kept loose (optional fields, index signatures)
 * because they originate from the runner and the digital-twin tab only
 * summarizes + shows raw — but each field named here is one the runner
 * actually sends (qontinui-runner `spec_api/handlers.rs`
 * `build_list_response` / `get_graph`, and `mcp/ui_bridge/elements.rs`
 * `ui_bridge_get_snapshot_handler`).
 */

/**
 * The runner's own UI app id — the one id every runner registers for itself
 * on start (qontinui-runner `spec_api::storage::RUNNER_APP_ID`, registered by
 * `ensure_self_registered`).
 */
export const RUNNER_APP_ID = "qontinui-runner";

/**
 * The spec list's per-page `config` — a bundled-page PROJECTION
 * (`version`, `description`, `groups`, `metadata`). It carries no state
 * machine: states and transitions are read from the graph instead.
 */
export interface SpecConfigLike {
  version?: unknown;
  description?: string | null;
  groups?: unknown[];
  metadata?: { url?: string; [k: string]: unknown } | null;
  [k: string]: unknown;
}

export interface DiscoveredSpecLike {
  specId: string;
  appName?: string;
  config?: SpecConfigLike;
}

/** `GET /apps/{app}/spec/list`. */
export interface SpecListResponse {
  ok?: boolean;
  specs?: DiscoveredSpecLike[];
  /** Present on an empty list (`no-pages-registered`). */
  reason?: string;
}

/**
 * One page of `GET /apps/{app}/spec/graph`. The runner sends state and
 * transition IDS, not objects. A page whose IR could not be read carries
 * `error` + `reason: "ir-read-failed"` and NO id lists — its counts are
 * unknown, not zero. A page with no IR document carries empty lists and
 * `reason: "no-ir-document"`.
 */
export interface SpecGraphPage {
  id?: string;
  stateIds?: string[];
  transitionIds?: string[];
  reason?: string;
  error?: string;
}

/** `GET /apps/{app}/spec/graph`. */
export interface SpecGraphResponse {
  ok?: boolean;
  pages?: SpecGraphPage[];
  /** Present on an empty graph (`no-pages-registered`). */
  reason?: string;
}

/** The graph, counted. */
export interface SpecGraphSummary {
  /** Graph nodes: every page the graph listed, readable or not. */
  pages: number;
  states: number;
  transitions: number;
  /**
   * Pages whose IR could not be read (no id lists). Their states and
   * transitions are NOT in the totals, so a non-zero value makes the totals a
   * floor — the panel says so rather than passing a partial count off as whole.
   */
  unreadablePages: number;
  /** States per page id, for the pages that carry their id lists. */
  statesByPage: ReadonlyMap<string, number>;
}

/**
 * Count states and transitions from the graph — the only runner read that
 * carries them (the spec list's projection has no state machine).
 */
export function summarizeSpecGraph(graph: SpecGraphResponse): SpecGraphSummary {
  const pages = graph.pages ?? [];
  let states = 0;
  let transitions = 0;
  let unreadablePages = 0;
  const statesByPage = new Map<string, number>();
  for (const page of pages) {
    if (!Array.isArray(page.stateIds) || !Array.isArray(page.transitionIds)) {
      unreadablePages += 1;
      continue;
    }
    states += page.stateIds.length;
    transitions += page.transitionIds.length;
    if (page.id) statesByPage.set(page.id, page.stateIds.length);
  }
  return {
    pages: pages.length,
    states,
    transitions,
    unreadablePages,
    statesByPage,
  };
}

/**
 * The `data` of `GET /ui-bridge/control/snapshot`, after `runnerProxyGet`
 * unwraps the runner's `{ success, data }` envelope.
 *
 * The runner answers this route from its OWN window (`ui_bridge_request_sync`
 * drives the runner's webview), whatever app the Spec API reads are about — so
 * what was snapshotted is whatever `appId` / `page` the snapshot itself
 * reports, never the App field's value.
 */
export interface UiBridgeSnapshot {
  elements?: unknown[];
  components?: unknown[];
  /** The app that produced the snapshot (the runner's `runner-tabs` enricher). */
  appId?: string;
  page?: {
    url?: string;
    pathname?: string;
    title?: string;
    [k: string]: unknown;
  };
  /** The route (pathname) at snapshot time, when the SDK knows it. */
  route?: string;
  /**
   * `"native_capture"` when the SDK was not connected and the runner fell
   * back to a window capture (no element tree; `note` says so).
   */
  source?: string;
  note?: string;
  [k: string]: unknown;
}

/**
 * Whether the snapshot carries an element tree at all. The runner's native
 * window-capture fallback sends `elements: []` beside a note that no tree is
 * available, so its counts are UNKNOWN, not zero.
 */
export function snapshotHasElementTree(snap: UiBridgeSnapshot): boolean {
  return snap.source !== "native_capture";
}
