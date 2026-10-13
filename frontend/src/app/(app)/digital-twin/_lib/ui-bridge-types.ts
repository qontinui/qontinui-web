/**
 * Shapes for the runner's Spec API + live snapshot, read through the relay,
 * what the tab derives from them (`summarizeSpecGraph`,
 * `snapshotHasElementTree`), and the app-id rule the runner's registry
 * enforces (`isValidAppId`). Kept loose (optional fields, index signatures)
 * because they originate from the runner and the digital-twin tab only
 * summarizes + shows raw — but each field named here is one the runner
 * actually sends (qontinui-runner `spec_api/handlers.rs`
 * `build_list_response` / `get_graph`, and `mcp/ui_bridge/elements.rs`
 * `ui_bridge_get_snapshot_handler`).
 */

/**
 * The runner's own UI app id (qontinui-runner
 * `spec_api::storage::RUNNER_APP_ID`). Runners register it for themselves at
 * start-up (`database/pg/apps.rs` `ensure_self_registered`) since 85d61ed2b,
 * committed 2026-09-07 — older builds do not, and even a current one skips or
 * fails it, logged and non-fatal, when it cannot resolve its repo root or
 * write the row. So it is the id most likely to be registered, not one that
 * always is.
 */
export const RUNNER_APP_ID = "qontinui-runner";

/**
 * The shape the runner's app registry admits, and so the only ids it can ever
 * have registered (qontinui-schemas `rust/src/apps.rs` `validate_app_id`, run
 * on every insert): 1–64 lowercase ASCII letters, digits and hyphens, not
 * starting with a hyphen.
 */
const APP_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** What {@link isValidAppId} requires, in words, for an inline message. */
export const APP_ID_RULE =
  "1–64 lowercase letters, digits and hyphens, starting with a letter or digit";

/**
 * Whether `id` is an app id a runner could have registered.
 *
 * Anything else can never answer — at best the runner says `app-not-found`
 * — and many such ids cannot even be asked for as one id. The relay path is
 * decoded before it is checked or forwarded (backend `runner_proxy`,
 * `{path:path}`), so percent-encoding does not keep an id to one path
 * segment: a `/` — encoded or not — becomes extra segments, which the
 * runner's relay allowlist refuses with a 403 (`relay_path_policy.rs`
 * `normalize_relay_path`), and the backend refuses most other characters
 * with a 400 (`device_bridge_ws.py` `_SAFE_PATH_RE`). So the panel says the
 * id is not valid instead of sending it.
 */
export function isValidAppId(id: string): boolean {
  return APP_ID_RE.test(id);
}

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

/**
 * One row of the runner's app registry as `GET /apps` sends it (qontinui-schemas
 * `rust/src/apps.rs` `App`). The row carries more (`repo_root`,
 * `ui_bridge_url`, thresholds, …); only the two fields the App picker reads
 * are named here.
 */
export interface RegisteredApp {
  app_id?: string;
  display_name?: string;
  [k: string]: unknown;
}

/**
 * The runner's `GET /apps` body (qontinui-runner `spec_api/apps.rs`
 * `handle_list_apps`): bare `{ ok, apps }`, no `ApiResponse` envelope. Its
 * failure (`{ ok: false, reason }`) is thrown by `runnerProxyGet`, never
 * returned.
 */
export interface AppListResponse {
  ok?: boolean;
  apps?: RegisteredApp[];
}

/** A suggestion for the App field: the id, and an optional human label. */
export interface AppIdSuggestion {
  id: string;
  note?: string;
}

/**
 * The App field's suggestions from the runner's own registry: one per
 * registered app, labelled with its `display_name` when that says more than
 * the id. `null` when the body carries no `apps` array — that is "the
 * registry was not read", not "no apps are registered", so the caller falls
 * back to its static suggestions rather than offering nothing. An `apps: []`
 * IS an answer, and yields no suggestions. Rows whose id the registry could
 * never have admitted (see `isValidAppId`) are dropped: suggesting one would
 * only offer an id the panel refuses to send.
 */
export function registeredAppSuggestions(
  resp: AppListResponse | undefined
): AppIdSuggestion[] | null {
  if (!resp || !Array.isArray(resp.apps)) return null;
  const out: AppIdSuggestion[] = [];
  const seen = new Set<string>();
  for (const app of resp.apps) {
    const id = typeof app?.app_id === "string" ? app.app_id : "";
    if (!isValidAppId(id) || seen.has(id)) continue;
    seen.add(id);
    const name =
      typeof app.display_name === "string" ? app.display_name.trim() : "";
    out.push(name && name !== id ? { id, note: name } : { id });
  }
  return out;
}
