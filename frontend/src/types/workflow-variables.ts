/**
 * TypeScript types and interfaces for workflow variable monitoring
 *
 * These types define the structure of workflow variables, their changes,
 * and the API responses for the variable monitoring system.
 */

/**
 * Variable scope types
 */
export type VariableScope = "execution" | "workflow" | "global";

/**
 * Variable value types - supports primitives, objects, and arrays
 */
export type VariableValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: unknown }
  | unknown[];

/**
 * A single workflow variable
 */
export interface WorkflowVariable {
  /** Variable name/key */
  name: string;

  /** Current value */
  value: VariableValue;

  /** Variable scope (execution/workflow/global) */
  scope: VariableScope;

  /** ISO timestamp of last update */
  last_updated: string;

  /** Optional: Action ID that last modified this variable */
  last_modified_by?: string;

  /** Optional: Data type (inferred from value) */
  type?: string;
}

/**
 * Snapshot of all variables at a point in time
 */
export interface VariableSnapshot {
  /** ISO timestamp of snapshot */
  timestamp: string;

  /** Execution-scoped variables */
  execution: Record<string, VariableValue>;

  /** Workflow-scoped variables */
  workflow: Record<string, VariableValue>;

  /** Global variables */
  global: Record<string, VariableValue>;
}

/**
 * A single variable change event
 */
export interface VariableChange {
  /** Unique ID for this change */
  id: string;

  /** Variable name that changed */
  variable_name: string;

  /** Variable scope */
  scope: VariableScope;

  /** Previous value (null if newly created) */
  old_value: VariableValue | null;

  /** New value (null if deleted) */
  new_value: VariableValue | null;

  /** ISO timestamp of change */
  timestamp: string;

  /** Action ID that caused this change */
  action_id?: string;

  /** Action name/label */
  action_name?: string;

  /** Change type */
  change_type: "created" | "updated" | "deleted";
}

/**
 * Variable change history response
 */
export interface VariableChangeHistory {
  /** Total number of changes */
  total: number;

  /** Array of changes, sorted by timestamp (newest first) */
  changes: VariableChange[];

  /** Pagination cursor for next page */
  next_cursor?: string;
}

/**
 * API response for current variables
 */
export interface VariablesResponse {
  /** Workflow run ID */
  run_id: string;

  /** Current variable snapshot */
  variables: VariableSnapshot;

  /** ISO timestamp of response */
  fetched_at: string;
}

/**
 * API response for variable changes
 */
export interface VariableChangesResponse {
  /** Workflow run ID */
  run_id: string;

  /** Change history */
  history: VariableChangeHistory;

  /** ISO timestamp of response */
  fetched_at: string;
}

/**
 * Filter options for variable display
 */
export interface VariableFilter {
  /** Search term for variable names */
  search?: string;

  /** Filter by scope */
  scope?: VariableScope | "all";

  /** Filter by value type */
  type?: "string" | "number" | "boolean" | "object" | "array" | "null" | "all";
}

/**
 * Export format for variables
 */
export interface VariableExport {
  /** Workflow run ID */
  run_id: string;

  /** Export timestamp */
  exported_at: string;

  /** Current variables */
  variables: VariableSnapshot;

  /** Optional: Include change history */
  history?: VariableChange[];
}
