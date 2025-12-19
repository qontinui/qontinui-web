/**
 * Qontinui Action Schema - Graph Format Only
 *
 * Clean, modern action configuration system focused on graph-based workflows.
 * All workflows use connections and positions. No backward compatibility cruft.
 */

// Export main types (includes workflow types - they're merged now)
export * from "./action-types";

// Export workflow utilities
export * from "./workflow-utils";
export * from "./workflow-validation";

// Export shared configuration modules
export * from "./shared/common-types";
export * from "./shared/target-config";
export * from "./shared/search-options";
export * from "./shared/verification-config";
export * from "./shared/timing-config";

// Export action-specific configurations
export * from "./configs/find-actions";
export * from "./configs/mouse-actions";
export * from "./configs/keyboard-actions";
export * from "./configs/control-flow-actions";
export * from "./configs/data-actions";
export * from "./configs/state-actions";
export * from "./configs/code-actions";
export * from "./configs/shell-actions";
export * from "./configs/ai-actions";

// Re-export key action types for convenience
export type {
  Action,
  ActionType,
  ActionConfigMap,
  ConfigForAction,
} from "./action-types";

export {
  isActionOfType,
  createAction,
  getActionOutputCount,
  getActionInputCount,
} from "./action-types";

// Re-export key workflow types
export type {
  Workflow,
  Connection,
  Connections,
  WorkflowVariables,
  WorkflowSettings,
  WorkflowMetadata,
} from "./action-types";

// Re-export key workflow utilities
export {
  getEntryPoints,
  getActionConnections,
  getNextActions,
  getPreviousActions,
  hasCycles,
  hasMergeNodes,
  findOrphanedActions,
  getActionById,
  getActionsByType,
  calculateActionDepths,
  getTopologicalOrder,
  cloneWorkflow,
} from "./workflow-utils";

// Re-export key validation functions
export type { ValidationResult, ValidationError } from "./workflow-validation";

export {
  validateWorkflow,
  isWorkflowValid,
  getValidationSummary,
} from "./workflow-validation";
