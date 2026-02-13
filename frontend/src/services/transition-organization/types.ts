import type {
  Transition,
  OutgoingTransition,
  IncomingTransition,
  State,
} from "@/contexts/automation-context/types";

// Re-export imported types for convenience
export type { Transition, OutgoingTransition, IncomingTransition, State };

/**
 * Transition template for quick creation
 */
export interface TransitionTemplate {
  /** Unique template identifier */
  id: string;

  /** Template name */
  name: string;

  /** Template description */
  description: string;

  /** Template category */
  category:
    | "interaction"
    | "navigation"
    | "conditional"
    | "error-handling"
    | "automation"
    | "custom";

  /** Template icon */
  icon?: string;

  /** Whether this is a built-in template */
  builtin: boolean;

  /** Template configuration */
  config: {
    /** Transition type */
    type: "OutgoingTransition" | "IncomingTransition";

    /** Default workflow IDs */
    workflows: string[];

    /** Default timeout (ms) */
    timeout: number;

    /** Default retry count */
    retryCount: number;

    /** For OutgoingTransition */
    staysVisible?: boolean;
    activateStates?: string[];
    deactivateStates?: string[];
  };

  /** Template tags for search */
  tags: string[];

  /** Usage count */
  usageCount?: number;

  /** Metadata */
  metadata?: {
    created?: string;
    updated?: string;
    author?: string;
    [key: string]: unknown;
  };
}

/**
 * Transition group for organizing related transitions
 */
export interface TransitionGroup {
  /** Unique group identifier */
  id: string;

  /** Group name */
  name: string;

  /** Group description */
  description: string;

  /** Group color (hex) */
  color?: string;

  /** Transition IDs in this group */
  transitionIds: string[];

  /** Whether all transitions in group are enabled */
  enabled: boolean;

  /** Group tags */
  tags: string[];

  /** Metadata */
  metadata?: {
    created?: string;
    updated?: string;
    [key: string]: unknown;
  };
}

/**
 * Filter options for transition search
 */
export interface TransitionFilter {
  /** Filter by from state */
  fromState?: string;

  /** Filter by to state */
  toState?: string;

  /** Filter by transition type */
  type?: "OutgoingTransition" | "IncomingTransition";

  /** Filter by workflow ID */
  hasWorkflow?: string;

  /** Filter by timeout range */
  timeoutRange?: { min: number; max: number };

  /** Filter by retry count range */
  retryCountRange?: { min: number; max: number };

  /** Filter by states that stay visible */
  staysVisible?: boolean;

  /** Filter by activated states */
  activatesState?: string;

  /** Filter by deactivated states */
  deactivatesState?: string;

  /** Filter by group membership */
  inGroup?: string;

  /** Filter by tag */
  hasTag?: string;
}

/**
 * Validation issue for a transition
 */
export interface ValidationIssue {
  /** Issue severity */
  severity: "error" | "warning" | "info";

  /** Issue type */
  type:
    | "broken-reference"
    | "circular-path"
    | "unreachable"
    | "duplicate"
    | "conflict"
    | "missing-workflow"
    | "timeout"
    | "configuration";

  /** Issue message */
  message: string;

  /** Transition ID that has the issue */
  transitionId: string;

  /** Related entity IDs (states, workflows, etc.) */
  relatedIds?: string[];

  /** Suggested fix */
  suggestion?: string;
}

/**
 * Validation report for transitions
 */
export interface ValidationReport {
  /** Total transitions validated */
  totalTransitions: number;

  /** Number of valid transitions */
  validTransitions: number;

  /** Number of transitions with issues */
  transitionsWithIssues: number;

  /** All validation issues found */
  issues: ValidationIssue[];

  /** Issues grouped by severity */
  errorCount: number;
  warningCount: number;
  infoCount: number;

  /** Timestamp of validation */
  timestamp: string;
}

/**
 * Statistics about transitions
 */
export interface TransitionStatistics {
  /** Total transition count */
  total: number;

  /** Count by type */
  byType: {
    outgoing: number;
    incoming: number;
  };

  /** Average timeout */
  avgTimeout: number;

  /** Average retry count */
  avgRetryCount: number;

  /** Transitions with workflows */
  withWorkflows: number;

  /** Transitions without workflows */
  withoutWorkflows: number;

  /** Most used workflows */
  topWorkflows: Array<{ workflowId: string; count: number }>;

  /** Most connected states */
  topStates: Array<{
    stateId: string;
    incomingCount: number;
    outgoingCount: number;
  }>;

  /** Circular paths detected */
  circularPaths: number;

  /** Unreachable states */
  unreachableStates: number;

  /** Orphaned transitions (referencing deleted states/workflows) */
  orphanedTransitions: number;

  /** Groups statistics */
  groups: {
    total: number;
    avgTransitionsPerGroup: number;
  };
}

/**
 * Transition matrix for visualization and analysis
 */
export interface TransitionMatrix {
  /** State IDs (rows and columns) */
  states: string[];

  /** Matrix data: [fromStateIndex][toStateIndex] = transition IDs */
  matrix: (string[] | null)[][];

  /** Metadata about the matrix */
  metadata: {
    generated: string;
    totalTransitions: number;
    coverage: number;
  };
}

/**
 * Circular path detection result
 */
export interface CircularPath {
  /** Path of state IDs forming the cycle */
  path: string[];

  /** Transition IDs in the cycle */
  transitions: string[];

  /** Length of the cycle */
  length: number;
}

/**
 * Pattern for finding similar transitions
 */
export interface TransitionPattern {
  /** Pattern name */
  name: string;

  /** Pattern type */
  type:
    | "workflow-sequence"
    | "timeout-pattern"
    | "state-activation"
    | "error-handling"
    | "custom";

  /** Matching criteria */
  criteria: {
    workflows?: string[];
    timeout?: number;
    retryCount?: number;
    activateStates?: string[];
    deactivateStates?: string[];
  };

  /** Tolerance for matching (0-1) */
  tolerance?: number;
}

/**
 * Redundant transition detection result
 */
export interface RedundantTransition {
  /** Original transition ID */
  transitionId: string;

  /** Duplicate/similar transition IDs */
  duplicateIds: string[];

  /** Reason for redundancy */
  reason: "exact-duplicate" | "similar-config" | "same-path" | "subsumes";

  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Optimization suggestion
 */
export interface OptimizationSuggestion {
  /** Suggestion type */
  type:
    | "merge"
    | "remove"
    | "reorder"
    | "simplify"
    | "add-group"
    | "timeout-adjustment";

  /** Suggestion description */
  description: string;

  /** Affected transition IDs */
  transitionIds: string[];

  /** Expected impact */
  impact: "high" | "medium" | "low";

  /** Suggested action */
  action: string;

  /** Auto-applicable */
  autoApplicable: boolean;
}

/**
 * Bulk operation result
 */
export interface BulkOperationResult {
  /** Number of successful operations */
  success: number;

  /** Number of failed operations */
  failed: number;

  /** IDs of successfully processed transitions */
  successIds: string[];

  /** Failed operations with reasons */
  failures: Array<{ id?: string; reason: string }>;

  /** Timestamp */
  timestamp: string;
}

/**
 * Import/Export options
 */
export interface ImportExportOptions {
  /** Include related states */
  includeStates?: boolean;

  /** Include related workflows */
  includeWorkflows?: boolean;

  /** Include groups */
  includeGroups?: boolean;

  /** Include metadata */
  includeMetadata?: boolean;

  /** Validate before import */
  validate?: boolean;

  /** Skip duplicates on import */
  skipDuplicates?: boolean;

  /** Merge strategy for conflicts */
  mergeStrategy?: "replace" | "skip" | "rename";
}
