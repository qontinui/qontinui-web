/**
 * Tree Event Types for qontinui-web
 *
 * Re-exports types from qontinui-schemas and adds frontend-specific extensions.
 * This provides a single import point for all tree event types in the web frontend.
 *
 * @module tree-events
 */

// Re-export all types from the shared schema
export type {
  MatchLocation,
  TopMatch,
  RuntimeData,
  StateContext,
  TimingInfo,
  Outcome,
  NodeMetadata,
  TreeNode,
  PathElement,
  TreeEvent,
  TreeEventCreate,
  TreeEventResponse,
  TreeEventListResponse,
  ExecutionTreeResponse,
  DisplayNode,
} from "@qontinui/schemas/tree_events";

// Re-export enums (values, not just types)
export {
  NodeType,
  NodeStatus,
  TreeEventType,
  ActionType,
} from "@qontinui/schemas/tree_events";

// Import for local use
import type {
  DisplayNode as SchemaDisplayNode,
  TreeEvent,
} from "@qontinui/schemas/tree_events";

/**
 * Extended DisplayNode with additional frontend state
 *
 * Adds properties for UI interactions that aren't part of the schema.
 */
export interface DisplayNodeWithUI extends SchemaDisplayNode {
  /** Whether this node is currently selected in the UI */
  isSelected?: boolean;
  /** Whether this node is highlighted (e.g., during search) */
  isHighlighted?: boolean;
  /** Custom CSS class for styling */
  customClass?: string;
}

/**
 * Unified execution step type that can represent both real TreeEvents
 * and mock integration test steps.
 *
 * This allows components to display both live execution events
 * and historical/mock test data using the same UI.
 */
export interface UnifiedExecutionStep {
  /** Step number in the execution sequence */
  stepNumber: number;
  /** Timestamp when this step occurred */
  timestamp: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Type of step - either a TreeEvent type or mock step type */
  stepType:
    | "workflow_started"
    | "workflow_completed"
    | "workflow_failed"
    | "action_started"
    | "action_completed"
    | "action_failed"
    | "transition_started"
    | "transition_completed"
    | "transition_failed"
    | "state_discovery"
    | "path_calculation"
    | "state_update";
  /** Display name for this step */
  name: string;
  /** Node type (workflow, action, transition) */
  nodeType?: "workflow" | "action" | "transition";
  /** Success/failure status */
  status: "pending" | "running" | "success" | "failed";
  /** Error message if failed */
  error?: string | null;
  /** Node ID from TreeEvent */
  nodeId?: string;
  /** Action type if this is an action */
  actionType?: string;
  /** State context - states before/after */
  stateContext?: {
    activeBefore?: string[];
    activeAfter?: string[];
    changed?: boolean;
    activated?: string[];
    deactivated?: string[];
  };
  /** Match location for find/click actions */
  matchLocation?: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    confidence?: number;
  };
  /** Input data for type/drag actions */
  inputData?: {
    text?: string;
    from?: { x: number; y: number };
    to?: { x: number; y: number };
  };
  /** Screenshot reference */
  screenshotUrl?: string;
  /** Original metadata for advanced display */
  metadata?: Record<string, unknown>;
  /** Original TreeEvent if this was converted from one */
  originalTreeEvent?: TreeEvent;
  /** Indicates if this is from real execution or mock */
  isRealExecution: boolean;
}

/**
 * Props for components that display execution steps
 */
export interface ExecutionStepDisplayProps {
  step: UnifiedExecutionStep;
  isExpanded?: boolean;
  onToggle?: () => void;
  isCurrent?: boolean;
  nameMap?: Map<string, string>;
}

/**
 * Tree display state for rendering hierarchical execution tree
 */
export interface TreeDisplayState {
  /** Root nodes of the execution tree */
  roots: SchemaDisplayNode[];
  /** Set of expanded node IDs */
  expandedNodes: Set<string>;
  /** Currently selected node ID */
  selectedNodeId?: string;
  /** Search filter text */
  searchFilter?: string;
  /** Total number of events */
  totalEvents: number;
}
