/**
 * Real-shaped bodies for every route the UI Bridge dashboard reads, as the
 * runner (and the web backend) send them — so the tests drive the real hooks
 * and the real relay client, and only `httpClient` is faked.
 *
 * Shapes are taken from qontinui-runner `be39991d2` + Phase 6's runner half:
 * `mcp_api.rs` `health`, `ui_bridge/elements.rs`
 * `ui_bridge_get_components_handler` (with `serializeComponent`'s
 * per-component shape), `ui_bridge/screenshots.rs`
 * `ui_bridge_page_health_handler` and `build_visibility_report`,
 * `backend_relay.rs` `http_relay_error` / `egress_off_http_response`, and
 * qontinui-web `fleet_targets.py` `list_apps`. Names are generic placeholders.
 */

export const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const BUILD_ID = "be39991d2fe9-1761210000000";
export const GIT_SHA = "be39991d2fe9";

/** `GET /health`, whole: `sdkFeatures` and `buildId` sit beside `data`. */
export const HEALTH_BODY = {
  success: true,
  data: {
    status: "ok",
    ready: true,
    gitSha: GIT_SHA,
    buildId: BUILD_ID,
    provenance: { gitSha: GIT_SHA, unstamped: false },
    uiBridgeBinding: {
      binding: "shadow",
      activeBinding: "shadow",
      bindingEnv: "QONTINUI_UI_BRIDGE_BINDING",
      activeBindingEnv: "QONTINUI_UI_BRIDGE_ACTIVE_BINDING",
      reservationMs: 60000,
      maxRows: 4096,
      operatorHeadroom: 256,
      browserMaxRows: 3840,
      registryFullRefusals: 0,
      rules: {
        R2: { wouldRefuse: 4, refused: 0 },
        R1: { wouldRefuse: 0, refused: 0 },
        R10: { wouldRefuse: 1, refused: 0 },
      },
      recent: [],
    },
  },
  uiBridge: {
    appId: "qontinui-runner",
    appName: "Qontinui Runner",
    appType: "desktop",
    framework: "tauri",
    capabilities: ["control", "renderLog", "debug"],
  },
  buildId: BUILD_ID,
  provenance: { gitSha: GIT_SHA, unstamped: false },
  sdkFeatures: ["softNavigate", "snapshotF3", "componentTree"],
  sdkFeaturesDocUrl:
    "https://github.com/qontinui/ui-bridge/blob/main/docs-site/docs/api/runner-features.md",
  timestamp: 1761210000000,
};

/**
 * `GET /ui-bridge/control/components`: three components, seven actions — two
 * read, one write, one destructive, two with NO `effect` key (undeclared), and
 * one declaring a word that is not an effect class (also undeclared).
 */
export const COMPONENTS_BODY = {
  success: true,
  data: {
    components: [
      {
        id: "terminal-tabs",
        name: "Terminal tabs",
        description: "The open terminal sessions.",
        actions: [
          {
            id: "list-terminals",
            label: "List terminals",
            effect: "read",
            path: "/ui-bridge/control/component/terminal-tabs/action/list-terminals",
          },
          {
            id: "create-terminal",
            label: "New terminal",
            description: "Open a new terminal tab.",
            effect: "write",
            path: "/ui-bridge/control/component/terminal-tabs/action/create-terminal",
          },
          {
            id: "close-empty",
            label: "Close empty terminals",
            path: "/ui-bridge/control/component/terminal-tabs/action/close-empty",
          },
        ],
        actionInvocationPath:
          "/ui-bridge/control/component/terminal-tabs/action/{actionId}",
        elementIds: [],
        registeredAt: 1761200000000,
        mounted: true,
        scope: "route",
      },
      {
        id: "profiles",
        name: "Profiles",
        actions: [
          {
            id: "load-profile",
            label: "Load profile",
            path: "/ui-bridge/control/component/profiles/action/load-profile",
          },
          {
            id: "delete-profile",
            label: "Delete profile",
            effect: "destructive",
            path: "/ui-bridge/control/component/profiles/action/delete-profile",
          },
          {
            id: "rename-profile",
            label: "Rename profile",
            effect: "mutate",
            path: "/ui-bridge/control/component/profiles/action/rename-profile",
          },
        ],
        registeredAt: 1761200000000,
        mounted: true,
        scope: "global",
      },
      {
        id: "page-nav",
        name: "Navigation",
        actions: [
          {
            id: "open-settings",
            label: "Open settings",
            effect: "read",
            path: "/ui-bridge/control/component/page-nav/action/open-settings",
          },
        ],
        registeredAt: 1761200000000,
        mounted: true,
        scope: "global",
      },
    ],
  },
};

/** `POST /ui-bridge/control/page-health`: six findings, summary WARNING. */
export const PAGE_HEALTH_BODY = {
  success: true,
  data: {
    summary: "WARNING",
    findings: [
      {
        check: "spatial_coverage",
        severity: "OK",
        detail: "Elements cover 64% of viewport. Left=70%, Right=58%",
        data: { coverage_pct: 64, left_half_pct: 70, right_half_pct: 58 },
      },
      {
        check: "layout_regions",
        severity: "OK",
        detail: "sidebar=12, header=4, content=31",
        data: { sidebar: 12, header: 4, content: 31 },
      },
      {
        check: "element_diversity",
        severity: "OK",
        detail: "3 type(s) across 47 elements",
        data: { types: { button: 20, heading: 7, text: 20 } },
      },
      {
        check: "text_signals",
        severity: "WARNING",
        detail: "errors=0, loading=1, empty=0, css_signals=0",
        data: {
          errors: [],
          loading: ["Loading sessions for Partner A"],
          empty: [],
          css_signals: [],
        },
      },
      {
        check: "interactive_readiness",
        severity: "OK",
        detail: "20 interactive elements, 2 disabled",
        data: { total: 20, disabled: 2 },
      },
      {
        check: "visual_anomalies",
        severity: "OK",
        detail: "zero_size=0, outside_viewport=0",
        data: { zero_size: 0, outside_viewport: 0 },
      },
    ],
    heatmap: Array.from({ length: 20 }, (_, y) =>
      Array.from({ length: 20 }, (_, x) => (x < 4 || y < 2 ? "#" : ".")).join(
        ""
      )
    ),
    element_count: 47,
    visible_count: 40,
  },
};

/** `POST /ui-bridge/control/visibility`, one per verdict shape. */
export function visibilityBody(
  report: Record<string, unknown>
): Record<string, unknown> {
  return {
    success: true,
    data: {
      occlusions: [],
      elementCount: 47,
      minRatio: 0.02,
      includeExpected: false,
      expectedOverlayDetection: "modal-stack",
      expectedOverlaysFiltered: 0,
      ...report,
    },
  };
}

export const VISIBILITY_CLEAR_OBSERVED = visibilityBody({
  verdict: "clear",
  occlusionDataObserved: true,
});

/** The vacuous all-clear: nothing carried occlusion data. */
export const VISIBILITY_CLEAR_UNOBSERVED = visibilityBody({
  verdict: "clear",
  occlusionDataObserved: false,
});

export const VISIBILITY_HIDES_TEXT = visibilityBody({
  verdict: "occlusions_found",
  occlusionDataObserved: true,
  occlusions: [
    {
      element: "session-name",
      occludedBy: "div.minimap",
      ratio: 0.6,
      isExpectedOverlay: false,
      hidesText: true,
      source: "hit-test",
      text: "Session for Partner A",
    },
    {
      element: "panel-border",
      occludedBy: "div.toast",
      ratio: 0.1,
      isExpectedOverlay: false,
      hidesText: false,
      source: "hit-test",
    },
  ],
});

/** The runner refusing a path its relay does not carry (`http_relay_error`). */
export const NOT_CARRIED_BODY = {
  error:
    "this path is not carried by the HTTP relay — the relay serves a closed set of routes, and terminal creation, input and teardown go through the typed relay frames, which carry the create/attach gate",
};

/** The runner withholding a terminal-stream answer (`egress_off_http_response`). */
export const EGRESS_OFF_BODY = {
  error: "egress_off",
  flow: "terminal_stream",
  domain: "egress_terminal_stream",
  message: "Terminal streaming is off for this project",
};

/** The backend relay's 503 for a runner with no live relay session. */
export const NOT_CONNECTED_BODY = {
  detail: "runner not connected",
  device_id: DEVICE_ID,
  ws_connected_at: "2026-10-23T08:00:00+00:00",
  last_seen_at: "2026-10-23T08:05:00+00:00",
  request_id: "req-503",
};

/**
 * The backend relay's 404 for a device id the caller does not own — a stale
 * pairing. Its explanation names the device id it was asked for.
 */
export const DEVICE_NOT_OWNED_BODY = {
  detail: "device not found or not owned by caller",
  device_id: DEVICE_ID,
  request_id: "req-404",
};

/** The runner's Spec API refusing an app id it has not registered. */
export const appNotFoundBody = (appId: string) => ({
  ok: false,
  reason: "app-not-found",
  detail: { appId },
});

/** `GET /api/v1/fleet/apps`. */
export const FLEET_APPS = [
  {
    app_id: "qontinui-runner",
    display_name: "Qontinui Runner",
    repo_root: "/home/dev/src/qontinui-runner",
    update_strategy: "pull_build",
    build_command: "npm run build",
    start_command: null,
  },
  {
    app_id: "example-portal",
    display_name: "Example Portal",
    repo_root: "/home/dev/src/example-portal",
    update_strategy: "pull_only",
    build_command: null,
    start_command: null,
  },
];

/** The runner's `GET /apps/qontinui-runner/spec/list`. */
export const SPEC_LIST_BODY = {
  ok: true,
  specs: [
    {
      specId: "terminal",
      appName: "Qontinui Runner",
      config: { version: "1" },
    },
    {
      specId: "settings",
      appName: "Qontinui Runner",
      config: { version: "1" },
    },
  ],
};

/** The runner's `GET /apps/qontinui-runner/spec/graph`: state and transition ids. */
export const SPEC_GRAPH_BODY = {
  ok: true,
  pages: [
    {
      id: "terminal",
      stateIds: ["terminal-empty", "terminal-running", "terminal-exited"],
      transitionIds: ["start", "exit"],
    },
    { id: "settings", stateIds: ["settings-open"], transitionIds: [] },
  ],
};

/** The runner's live snapshot (`GET /ui-bridge/control/snapshot`). */
export const SNAPSHOT_BODY = {
  success: true,
  data: {
    timestamp: 1761210000000,
    elements: [
      { id: "nav-terminal", type: "button", label: "Terminal" },
      { id: "nav-settings", type: "button", label: "Settings" },
      { id: "title", type: "heading", label: "Sessions of Partner A" },
    ],
    components: [{ id: "terminal-tabs", name: "Terminal tabs" }],
    page: {
      url: "http://tauri.localhost/",
      pathname: "/",
      title: "Qontinui Runner",
    },
    appId: "qontinui-runner",
    route: "/",
  },
};

/** The same registry with every action declaring its effect. */
export const COMPONENTS_ALL_DECLARED_BODY = {
  success: true,
  data: {
    components: COMPONENTS_BODY.data.components.map((component) => ({
      ...component,
      actions: component.actions.map((action) => ({
        ...action,
        effect:
          action.effect === "read" ||
          action.effect === "write" ||
          action.effect === "destructive"
            ? action.effect
            : "write",
      })),
    })),
  },
};
