/**
 * Types for UI Bridge State Machine page.
 */

// Re-export common types from extraction
export type {
  SavedConfig,
  SavedState,
  DomainKnowledge,
  DiscoveryStrategy,
} from "../../extraction/_types";

// =============================================================================
// Transition Types
// =============================================================================

/**
 * All UI Bridge SDK standard actions + workflow-level actions (wait, navigate).
 *
 * Parameterized actions: click, doubleClick, rightClick, type, select, scroll, drag
 * No-param actions: clear, focus, blur, hover, check, uncheck, toggle, setValue, submit, reset
 * Workflow-level actions: wait, navigate
 */
export type StandardActionType =
  | "click"
  | "doubleClick"
  | "rightClick"
  | "type"
  | "clear"
  | "select"
  | "focus"
  | "blur"
  | "hover"
  | "scroll"
  | "check"
  | "uncheck"
  | "toggle"
  | "setValue"
  | "drag"
  | "submit"
  | "reset"
  | "wait"
  | "navigate";

export interface TransitionAction {
  type: StandardActionType;
  /** Target element ID (used by most element actions) */
  target?: string;
  /** Text to type (type action) */
  text?: string;
  /** Clear before typing (type action) */
  clear_first?: boolean;
  /** Keystroke delay in ms (type action) */
  type_delay?: number;
  /** Value to select or set (select / setValue actions) */
  value?: string | string[];
  /** Select by label instead of value (select action) */
  select_by_label?: boolean;
  /** URL to navigate to (navigate action) */
  url?: string;
  /** Delay in milliseconds (wait action) */
  delay_ms?: number;
  /** Scroll direction (scroll action) */
  scroll_direction?: "up" | "down" | "left" | "right";
  /** Scroll amount in pixels (scroll action) */
  scroll_amount?: number;
  /** Drag target element ID or selector (drag action) */
  drag_target?: string;
  /** Drag target position {x, y} or named position (drag action) */
  drag_target_position?: string;
  /** Number of intermediate mousemove steps (drag action) */
  drag_steps?: number;
  /** Hold delay before first move in ms (drag action) */
  drag_hold_delay?: number;
  /** Dispatch HTML5 drag events alongside mouse events (drag action) */
  drag_html5?: boolean;
  /** Mouse button: left, right, middle (click / doubleClick / rightClick) */
  button?: "left" | "right" | "middle";
  /** Click position relative to element (click / doubleClick / rightClick) */
  position?: { x: number; y: number };
}

export interface UIBridgeTransition {
  id: string;
  config_id: string;
  transition_id: string;
  name: string;
  from_states: string[];
  activate_states: string[];
  exit_states: string[];
  actions: TransitionAction[];
  path_cost: number;
  stays_visible: boolean;
  extra_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UIBridgeTransitionCreate {
  name: string;
  from_states: string[];
  activate_states: string[];
  exit_states: string[];
  actions: TransitionAction[];
  path_cost: number;
  stays_visible: boolean;
  extra_metadata?: Record<string, unknown>;
}

export interface UIBridgeTransitionUpdate {
  name?: string;
  from_states?: string[];
  activate_states?: string[];
  exit_states?: string[];
  actions?: TransitionAction[];
  path_cost?: number;
  stays_visible?: boolean;
  extra_metadata?: Record<string, unknown>;
}

// =============================================================================
// Config with States and Transitions
// =============================================================================

export interface ConfigWithStatesAndTransitions {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  render_count: number;
  element_count: number;
  include_html_ids: boolean;
  created_at: string;
  updated_at: string;
  states: SavedStateWithDetails[];
  transitions: UIBridgeTransition[];
}

export interface SavedStateWithDetails {
  id: string;
  config_id: string;
  state_id: string;
  name: string;
  description: string | null;
  element_ids: string[];
  render_ids: string[];
  confidence: number;
  acceptance_criteria: string[];
  extra_metadata: Record<string, unknown>;
  domain_knowledge: Array<{
    id: string;
    title: string;
    content: string;
    tags: string[];
  }>;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Pathfinding Types
// =============================================================================

export interface PathfindingRequest {
  from_states: string[];
  target_states: string[];
}

export interface PathfindingStep {
  transition_id: string;
  transition_name: string;
  from_states: string[];
  activate_states: string[];
  exit_states: string[];
  path_cost: number;
}

export interface PathfindingResult {
  found: boolean;
  steps: PathfindingStep[];
  total_cost: number;
  error?: string;
}

// =============================================================================
// Export Types
// =============================================================================

export interface ExportConfig {
  states: Record<string, Record<string, unknown>>;
  transitions: Record<string, Record<string, unknown>>;
  config: Record<string, unknown>;
}

// =============================================================================
// Graph Types (ReactFlow)
// =============================================================================

export interface StateNodeData {
  stateId: string;
  name: string;
  elementCount: number;
  confidence: number;
  elementIds: string[];
  description: string | null;
  isBlocking: boolean;
  isSelected: boolean;
  isInitial: boolean;
  outgoingCount?: number;
  incomingCount?: number;
  isDropTarget?: boolean;
  onStartElementDrag?: (stateId: string, elementId: string) => void;
}

export interface TransitionEdgeData {
  transitionId: string;
  name: string;
  pathCost: number;
  actionCount: number;
  actionTypes: TransitionAction["type"][];
  isHighlighted: boolean;
  staysVisible: boolean;
  /** First action target element ID for display on edge label */
  firstActionTarget?: string;
}
