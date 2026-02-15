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

export interface TransitionAction {
  type: "click" | "type" | "select" | "wait" | "navigate";
  target?: string;
  text?: string;
  value?: string;
  url?: string;
  delay_ms?: number;
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
}
