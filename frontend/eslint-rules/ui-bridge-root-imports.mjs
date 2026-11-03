/**
 * Which `@qontinui/ui-bridge/react` exports may be imported from the package
 * ROOT, and which must come from `/react`.
 *
 * @qontinui/ui-bridge ships its root entry and its `/react` entry as SEPARATE
 * bundles (tsup `splitting: false`), and each carries its own copy of
 * `UIBridgeContext`. The app's provider is mounted from `/react`
 * (src/lib/ui-bridge/provider.tsx), so a context hook imported from the
 * package ROOT reads a different, never-provided context: it sees no bridge
 * and its registration is silently inert (finding fa4018f4; #2037, #2068).
 *
 * Every RUNTIME export of the installed `/react` entry belongs to exactly one
 * of the two lists below. `ui-bridge-root-imports.test.mjs` enforces that
 * partition against the installed package, so a ui-bridge bump that adds an
 * export fails the suite until someone classifies it — the gap #2069 left,
 * where the list was complete only for 0.35.0.
 */

/**
 * Context-bound: hooks that read `UIBridgeContext`, and the providers/scopes
 * and components that mount or read it (a root-imported provider mounts the
 * root bundle's context, which no `/react` hook reads).
 */
export const UI_BRIDGE_CONTEXT_BOUND_EXPORTS = [
  "UIBridgeProvider",
  "UIBridgeComponentScope",
  "UIBridgeWindowProvider",
  "RouteUnmatchedContext",
  "CaptureHostFrame",
  "AutoRegisterProvider",
  "CommandRelayListener",
  "State",
  "TransitionTo",
  "useUIBridge",
  "useUIBridgeRequired",
  "useUIBridgeEcho",
  "useCommandRelay",
  "useRouteAwareness",
  "useKeyboardShortcuts",
  "useUIBridgeContext",
  "useUIBridgeOptional",
  "useUIBridgeWindowLabel",
  "useUIElement",
  "useUIElementRef",
  "useUIComponent",
  "useUIComponentAction",
  "useOwningComponent",
  "useUIState",
  "useUIStateGroup",
  "useActiveStates",
  "useStateSnapshot",
  "useUITransition",
  "useTransitions",
  "useAvailableTransitions",
  "useUINavigation",
  "useCanNavigateTo",
  "useNavigationPath",
  "useAutoRegister",
  "useUIAnnotation",
  "usePageContext",
  "useMarkRouteUnmatched",
  "useRouteUnmatchedSignal",
  "useUIRelationship",
  "useUIRelationships",
  "useDragSource",
  "useDropZone",
  "useUndoRedo",
];

/**
 * Context-free: pure helpers and constants that read no context, so the root
 * bundle's copy behaves identically and stays importable from root.
 */
export const UI_BRIDGE_CONTEXT_FREE_EXPORTS = [
  "trackElementBbox",
  "useBuildIdWatcher",
  "pollForTaggedElement",
  "routePatternFromParams",
  "createRouteUnmatchedSignal",
  "DEFAULT_CAPTURE_HOST_IDS",
  "UI_BRIDGE_CONTENT_ATTR",
  "UI_BRIDGE_ID_ATTR",
  "UI_BRIDGE_PERSIST_ATTR",
  "UI_BRIDGE_ROLE_ATTR",
  "UI_BRIDGE_TEST_ID_ATTR",
];

export const UI_BRIDGE_ROOT_IMPORT_MESSAGE =
  'Import this from "@qontinui/ui-bridge/react": the package root bundles its own UIBridgeContext, so the provider mounted from /react never reaches it and its registration is inert.';
