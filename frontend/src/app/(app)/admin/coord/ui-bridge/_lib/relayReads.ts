/**
 * The UI Bridge dashboard's relay call sites — every runner route
 * `/admin/coord/ui-bridge` reads that the digital twin's `useUiBridge` does
 * not already read (plan `2026-10-23-console-presentation-spaces` Phase 6).
 *
 * The runner relays only a CLOSED list of `(method, path)` pairs (qontinui-runner
 * `src-tauri/src/mcp/relay_path_policy.rs` `RELAY_ALLOWED`), and that file's
 * header requires every entry to name the client call site it exists for.
 * The two entries Phase 6 adds name the functions in THIS module, so they are
 * the contract between the two repos and their names do not change:
 *
 * | function | route | on `RELAY_ALLOWED` |
 * |---|---|---|
 * | {@link fetchRunnerComponents} | `GET /ui-bridge/control/components` | from Phase 6's runner half |
 * | {@link fetchRunnerPageHealth} | `POST /ui-bridge/control/page-health` | from Phase 6's runner half |
 * | {@link fetchRunnerHealth} | `GET /health` | since the relay began |
 * | {@link fetchRunnerVisibility} | `POST /ui-bridge/control/visibility` | NOT carried |
 *
 * {@link RUNNER_ROUTES} catalogues these and the twin reads the page reuses.
 *
 * A runner built before an entry existed refuses that route with a 403 (the
 * relay's "not carried" answer), which `runnerRequest` surfaces as
 * `RUNNER_NEEDS_LOCAL`; the dashboard renders it as a labelled UNKNOWN naming
 * the runner's build (`relaySource.ts`), never as an empty panel.
 *
 * The occlusion sweep is called although no runner carries it yet, on purpose:
 * it is the only route that serves `occlusionDataObserved`, the one field that
 * separates "nothing is covered" from "nothing was observed" (served policy
 * `ux-priorities` `the-runner-serves-the-occlusion-sweep-and-it-is-currently-vacuous`).
 * Page health carries no occlusion verdict at all. So today every runner
 * answers 403 and the occlusion row reads UNKNOWN — "this runner's relay does
 * not carry the occlusion sweep", a measured answer rather than an assumed
 * one — and the day a runner adds the entry (naming this function) the row
 * becomes a real verdict with no web change. Its read is on demand only, like
 * page health's.
 *
 * Every function here is a READ. Two of the routes are registered as POST
 * because they take an options body; the handlers ignore it or read only a
 * threshold, and neither changes runner or app state.
 */

import {
  runnerProxyGet,
  runnerProxyPost,
} from "@/app/(app)/digital-twin/_lib/runner-relay";

/**
 * Per-route budgets. Page health and the sweep each run one full `discover`
 * of the runner's webview before answering, so they get more room than the
 * metadata reads.
 */
export const HEALTH_TIMEOUT_MS = 8_000;
export const COMPONENTS_TIMEOUT_MS = 10_000;
export const PAGE_HEALTH_TIMEOUT_MS = 15_000;
export const VISIBILITY_TIMEOUT_MS = 15_000;

/**
 * Where each route stands on the runner's relay allowlist — what a 403 from
 * it MEANS, which is what the UNKNOWN text has to say:
 *  - `always` — carried by every runner that has a relay;
 *  - `dashboard` — carried from the runner build that added this dashboard's
 *    entries; a 403 means the build predates them;
 *  - `never` — carried by no runner build yet.
 */
export type RelayCarriage = "always" | "dashboard" | "never";

export interface RunnerRoute {
  readonly method: "GET" | "POST";
  /** The runner path, no leading slash (the relay URL's tail). */
  readonly path: string;
  readonly carriage: RelayCarriage;
  /** What the route reads, in an operator's words — names the UNKNOWN. */
  readonly subject: string;
  /** The function that makes the call. */
  readonly callSite: string;
}

/**
 * Every runner route the dashboard reads — this module's four, and the four
 * it reuses from the digital twin's `useUiBridge.ts` — with what a 403 from
 * each means. Measured against qontinui-runner `RELAY_ALLOWED` on
 * `be39991d2` plus Phase 6's runner half: the twin's spec and snapshot reads
 * are carried; the runner's own app list (`GET /apps`, which the twin's
 * `useRunnerApps` asks for) is NOT, so its column reads UNKNOWN on every
 * runner until an entry names that hook.
 */
export const RUNNER_ROUTES = {
  health: {
    method: "GET",
    path: "health",
    carriage: "always",
    subject: "the runner's health and build",
    callSite: "fetchRunnerHealth",
  },
  components: {
    method: "GET",
    path: "ui-bridge/control/components",
    carriage: "dashboard",
    subject: "the runner's component actions",
    callSite: "fetchRunnerComponents",
  },
  pageHealth: {
    method: "POST",
    path: "ui-bridge/control/page-health",
    carriage: "dashboard",
    subject: "the runner's page health",
    callSite: "fetchRunnerPageHealth",
  },
  visibility: {
    method: "POST",
    path: "ui-bridge/control/visibility",
    carriage: "never",
    subject: "the occlusion sweep",
    callSite: "fetchRunnerVisibility",
  },
  apps: {
    method: "GET",
    path: "apps",
    carriage: "never",
    subject: "this runner's own app list",
    callSite: "useRunnerApps (digital twin)",
  },
  specList: {
    method: "GET",
    path: "apps/{app_id}/spec/list",
    carriage: "always",
    subject: "the app's screens",
    callSite: "useRunnerSpecList (digital twin)",
  },
  specGraph: {
    method: "GET",
    path: "apps/{app_id}/spec/graph",
    carriage: "always",
    subject: "the app's states and transitions",
    callSite: "useRunnerSpecGraph (digital twin)",
  },
  snapshot: {
    method: "GET",
    path: "ui-bridge/control/snapshot",
    carriage: "always",
    subject: "a live snapshot of the runner's screen",
    callSite: "useRunnerSnapshot (digital twin)",
  },
} as const satisfies Record<string, RunnerRoute>;

/**
 * `GET /health`, whole. The runner puts its SDK feature inventory
 * (`sdkFeatures`), `uiBridge` and a `buildId` mirror at the TOP level of the
 * body, beside `data`, so the envelope is kept rather than unwrapped
 * (`runnerProxyGet`'s `envelope: "keep"`). Read by `runnerHealth.ts`.
 */
export function fetchRunnerHealth(deviceId: string): Promise<unknown> {
  return runnerProxyGet<unknown>(deviceId, RUNNER_ROUTES.health.path, {
    timeoutMs: HEALTH_TIMEOUT_MS,
    envelope: "keep",
  });
}

/**
 * `GET /ui-bridge/control/components` — the component action registry of the
 * runner's own webview (qontinui-runner `ui_bridge/elements.rs`
 * `ui_bridge_get_components_handler`).
 *
 * **Over the relay it is the runner's OWN registry and nothing else.** A local
 * read merges that registry with the reply of every live WebSocket-wrapper
 * app; the relay marks every request it forwards, and a marked read asks no
 * wrapper app (`ComponentSources::RunnerOnly`, qontinui-runner `afc970df9`).
 * The reply says which it was in `data.wrapperComponents` — `"withheld"` for a
 * relayed read, which is the only kind this dashboard makes — and
 * `componentEffectStatus.ts` reads it so the panel never implies wrapper apps
 * were consulted. A build that predates the field sends none, which the panel
 * reads as UNKNOWN, not as either word.
 *
 * The payload is `{ components: [...], wrapperComponents }` once
 * `runnerProxyGet` unwraps the `{ success, data }` envelope; each action
 * carries its author-declared `effect`, or no `effect` key at all when nobody
 * declared one (the runner's `serializeComponent` never defaults it). Read by
 * `componentEffectStatus.ts`.
 */
export function fetchRunnerComponents(deviceId: string): Promise<unknown> {
  return runnerProxyGet<unknown>(deviceId, RUNNER_ROUTES.components.path, {
    timeoutMs: COMPONENTS_TIMEOUT_MS,
  });
}

/**
 * `POST /ui-bridge/control/page-health` with `{}` — the DOM-derived health
 * report of the runner's current window (qontinui-runner
 * `ui_bridge/screenshots.rs` `ui_bridge_page_health_handler`: summary,
 * findings, heatmap, element counts). The body is reserved by the runner for
 * per-check options and ignored today; `{}` is its empty value. Read by
 * `pageHealthStatus.ts`.
 */
export function fetchRunnerPageHealth(deviceId: string): Promise<unknown> {
  return runnerProxyPost<unknown>(
    deviceId,
    RUNNER_ROUTES.pageHealth.path,
    {},
    {
      timeoutMs: PAGE_HEALTH_TIMEOUT_MS,
    }
  );
}

/**
 * `POST /ui-bridge/control/visibility` with `{}` — the occlusion sweep, at the
 * runner's own defaults (`minRatio` 0.02, expected overlays filtered). Not on
 * any runner's relay allowlist yet; see the module doc for why it is called
 * anyway. Read by `occlusionStatus.ts`.
 */
export function fetchRunnerVisibility(deviceId: string): Promise<unknown> {
  return runnerProxyPost<unknown>(
    deviceId,
    RUNNER_ROUTES.visibility.path,
    {},
    {
      timeoutMs: VISIBILITY_TIMEOUT_MS,
    }
  );
}
