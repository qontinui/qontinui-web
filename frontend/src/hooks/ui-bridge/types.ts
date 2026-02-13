/**
 * UI Bridge Exploration Types
 *
 * Shared type definitions used across all UI Bridge exploration sub-hooks.
 */

/**
 * Target type for UI Bridge exploration
 */
export type TargetType = "web" | "desktop" | "mobile" | "extension";

/**
 * Browser tab information from the Chrome extension
 */
export interface BrowserTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
  favIconUrl?: string;
}

/**
 * Configuration for UI Bridge exploration
 */
export interface UIBridgeExplorationConfig {
  /** Target type: web, desktop (Tauri), or mobile (React Native) */
  targetType: TargetType;
  /** Target URL to explore (required - the application to automate) */
  targetUrl: string;
  /** Selected browser tab ID for extension exploration (null = use active tab) */
  selectedBrowserTabId: number | null;
  /** Maximum depth of navigation (0 = current page only) */
  maxDepth: number;
  /** Maximum elements to click per page */
  maxElementsPerPage: number;
  /** Maximum total elements to click */
  maxTotalElements: number;
  /** Delay between actions in milliseconds */
  actionDelayMs: number;
  /** Keywords in element text/label that should be blocked */
  blockedKeywords: string[];
  /** Keywords that are safe even if they might seem dangerous */
  safeKeywords: string[];
  /** CSS selectors to skip */
  blockedSelectors: string[];
  /** Element types to interact with */
  allowedTypes: string[];
  /** Whether to capture render log after each action */
  captureRenderLogs: boolean;
  /** Whether to track and avoid revisiting same states */
  trackVisitedStates: boolean;
}

/**
 * Default exploration configuration
 */
export const DEFAULT_EXPLORATION_CONFIG: UIBridgeExplorationConfig = {
  targetType: "extension",
  targetUrl: "",
  selectedBrowserTabId: null,
  maxDepth: 2,
  maxElementsPerPage: 20,
  maxTotalElements: 100,
  actionDelayMs: 500,
  blockedKeywords: [
    "delete",
    "remove",
    "logout",
    "sign out",
    "cancel subscription",
    "deactivate",
    "close account",
    "unsubscribe",
  ],
  safeKeywords: [],
  blockedSelectors: ["[data-no-explore]", "[data-dangerous]"],
  allowedTypes: ["button", "link", "tab", "menuitem"],
  captureRenderLogs: true,
  trackVisitedStates: true,
};

/**
 * Discovered element during exploration
 */
export interface ExploredElement {
  id: string;
  type: string;
  label?: string;
  tagName: string;
  actions: string[];
  url: string;
  depth: number;
  clicked: boolean;
  skipped: boolean;
  skipReason?: string;
  resultUrl?: string;
  timestamp: number;
}

/**
 * Render log entry captured during exploration
 */
export interface ExplorationRenderLog {
  id: string;
  url: string;
  timestamp: number;
  trigger: string;
  elementId?: string;
  snapshot: {
    root: unknown;
  };
}

/**
 * Exploration progress state
 */
export interface ExplorationProgress {
  status: "idle" | "running" | "paused" | "completed" | "failed";
  currentDepth: number;
  elementsDiscovered: number;
  elementsClicked: number;
  elementsSkipped: number;
  pagesVisited: number;
  renderLogsCollected: number;
  currentElement?: string;
  currentUrl: string;
  startTime?: number;
  endTime?: number;
  error?: string;
}

/**
 * Exploration results
 */
export interface ExplorationResults {
  elements: ExploredElement[];
  renderLogs: ExplorationRenderLog[];
  visitedUrls: string[];
  progress: ExplorationProgress;
}

/**
 * Raw Playwright job status (for compatibility with PlaywrightResultsView)
 */
export interface PlaywrightJobStatus {
  job_id: string;
  status: "idle" | "pending" | "running" | "completed" | "failed";
  url: string;
  progress_message?: string;
  progress_percent?: number;
  error?: string;
}

/**
 * Raw Playwright results (for compatibility with PlaywrightResultsView)
 */
export interface PlaywrightRawResults {
  clickables: Array<{
    element_id: string;
    selector: string;
    tag_name: string;
    text?: string | null;
    aria_label?: string | null;
    bounding_box: { x: number; y: number; width: number; height: number };
    risk_level?: string;
    risk_reason?: string;
    was_clicked: boolean;
    verified?: boolean;
    verification_confidence?: number;
    screenshot?: string;
    error?: string | null;
  }>;
  skipped_dangerous: Array<{
    selector: string;
    text?: string;
    risk: string;
    reason: string;
    url: string;
  }>;
  metrics: {
    total_found: number;
    clicked: number;
    skipped_dangerous: number;
    pages_visited: number;
    errors: number;
    verified?: number;
    unverified?: number;
  };
  pages_visited: string[];
  errors: string[];
}

/**
 * UI Bridge job status
 */
export interface UIBridgeJobStatus {
  job_id: string;
  status: "idle" | "pending" | "running" | "completed" | "failed";
  connection_url: string;
  target_type: string;
  progress_message?: string;
  progress_percent?: number;
  elements_discovered?: number;
  elements_explored?: number;
  current_element?: string;
  error?: string;
}

/**
 * Discovered state from co-occurrence analysis
 */
export interface UIBridgeDiscoveredState {
  id: string;
  name: string;
  state_image_ids: string[];
  screenshot_ids: string[];
  confidence: number;
}

/**
 * Discovered element from UI Bridge exploration
 */
export interface UIBridgeDiscoveredElement {
  id: string;
  name: string;
  type: string;
  render_ids: string[];
  tag_name?: string;
  text_content?: string;
  component_name?: string;
}

/**
 * State discovery results from co-occurrence analysis
 */
export interface UIBridgeStateDiscovery {
  states: UIBridgeDiscoveredState[];
  elements: UIBridgeDiscoveredElement[];
  element_to_renders: Record<string, string[]>;
  render_count: number;
  unique_element_count: number;
}

/**
 * Render log from UI Bridge exploration
 */
export interface UIBridgeRenderLog {
  id: string;
  timestamp: string;
  url: string;
  elements_count: number;
}

/**
 * Action result details from UI Bridge exploration
 */
export interface UIBridgeActionResult {
  response_time_ms: number;
  new_elements: string[];
  removed_elements: string[];
}

/**
 * Exploration step from UI Bridge
 */
export interface UIBridgeExplorationStep {
  step_id: string;
  timestamp: string;
  element_id: string;
  action: string;
  success: boolean;
  state_changed?: boolean;
  depth: number;
  // Enhanced fields for transition discovery
  parent_step_id?: string;
  action_result?: UIBridgeActionResult;
  snapshot_before_hash?: string;
  snapshot_after_hash?: string;
  elements_before?: string[];
  elements_after?: string[];
}

/**
 * Suggested transition discovered from exploration steps
 */
export interface SuggestedTransition {
  /** Unique identifier for this transition */
  id: string;
  /** Hash of the state before the transition */
  fromStateHash: string;
  /** Hash of the state after the transition */
  toStateHash: string;
  /** Element ID that triggers this transition */
  triggerElementId: string;
  /** Action type (e.g., 'click') */
  triggerAction: string;
  /** Elements that become active/visible after this transition */
  activateElements: string[];
  /** Elements that become inactive/hidden after this transition */
  deactivateElements: string[];
  /** Confidence score based on occurrence frequency (0-1) */
  confidence: number;
  /** Step IDs where this transition was observed */
  stepIds: string[];
  /** Optional: human-readable name for the from state */
  fromStateName?: string;
  /** Optional: human-readable name for the to state */
  toStateName?: string;
}

/**
 * Result of building transitions from exploration steps
 */
export interface TransitionBuildResult {
  /** Discovered transitions */
  transitions: SuggestedTransition[];
  /** Mapping of state hash to element IDs present in that state */
  stateHashes: Map<string, string[]>;
  /** Steps that could not be mapped to transitions */
  unmappedSteps: UIBridgeExplorationStep[];
}

/**
 * Raw UI Bridge exploration results
 */
export interface UIBridgeRawResults {
  exploration_id: string;
  elements_discovered: number;
  elements_explored: number;
  steps: UIBridgeExplorationStep[];
  render_logs: UIBridgeRenderLog[];
  render_log_count: number;
  state_discovery?: UIBridgeStateDiscovery;
  errors: string[];
  start_time?: string;
  end_time?: string;
}

/**
 * Exploration session stored in the database
 */
export interface ExplorationSession {
  id: string;
  projectId: string;
  name: string;
  status: string;
  targetType: string;
  targetUrl: string | null;
  explorationConfig: Record<string, unknown>;
  renderCount: number;
  elementsDiscovered: number;
  elementsExplored: number;
  errorMessage: string | null;
  discoveryCompleted: boolean;
  savedConfigId: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * API response for exploration session
 */
export interface ExplorationSessionResponse {
  id: string;
  project_id: string;
  name: string;
  status: string;
  target_type: string;
  target_url: string | null;
  exploration_config: Record<string, unknown>;
  render_count: number;
  elements_discovered: number;
  elements_explored: number;
  error_message: string | null;
  discovery_completed: boolean;
  saved_config_id: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}
