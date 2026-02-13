/**
 * Workflow Version Control - Type Definitions
 *
 * All interfaces, types, and enums for the version control system.
 */

import { Workflow } from "../../lib/action-schema/action-types";

// ============================================================================
// Branch & Version Types
// ============================================================================

/**
 * Branch represents a line of development for a workflow
 */
export interface Branch {
  id: string;
  workflowId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  parentBranchId?: string;
  currentVersionId?: string;
  isDefault?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Version represents a saved state of a workflow (like a commit)
 */
export interface Version {
  id: string;
  workflowId: string;
  branchId: string;
  workflow: Workflow;
  message: string;
  author?: string;
  timestamp: string;
  parentVersionId?: string;
  tags?: string[];
  metadata?: {
    actionCount: number;
    connectionCount: number;
    changesSummary?: ChangeSummary;
    [key: string]: unknown;
  };
}

/**
 * Tag marks an important version
 */
export interface Tag {
  id: string;
  workflowId: string;
  versionId: string;
  name: string;
  description?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Diff Types
// ============================================================================

/**
 * Detailed diff between two workflows
 */
export interface VersionDiff {
  // Action changes
  actionsAdded: ActionDiff[];
  actionsRemoved: ActionDiff[];
  actionsModified: ActionModification[];
  actionsUnchanged: string[];

  // Connection changes
  connectionsAdded: ConnectionDiff[];
  connectionsRemoved: ConnectionDiff[];
  connectionsModified: ConnectionModification[];

  // Workflow property changes
  propertiesChanged: PropertyChange[];

  // Variable changes
  variablesChanged: VariableChange[];

  // Summary statistics
  summary: DiffSummary;
}

export interface ActionDiff {
  id: string;
  type: string;
  name?: string;
  position: [number, number];
  config: unknown;
}

export interface ActionModification {
  id: string;
  changes: {
    type?: { old: string; new: string };
    name?: { old?: string; new?: string };
    config?: { old: unknown; new: unknown; fields: string[] };
    position?: { old: [number, number]; new: [number, number] };
    base?: { old?: unknown; new?: unknown };
    execution?: { old?: unknown; new?: unknown };
  };
}

export interface ConnectionDiff {
  source: string;
  target: string;
  type: "main" | "error" | "success" | "parallel";
  outputIndex: number;
  inputIndex: number;
}

export interface ConnectionModification {
  source: string;
  oldTarget: string;
  newTarget: string;
  type: "main" | "error" | "success" | "parallel";
}

export interface PropertyChange {
  property: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface VariableChange {
  scope: "local" | "process" | "global";
  key: string;
  oldValue?: unknown;
  newValue?: unknown;
  type: "added" | "removed" | "modified";
}

export interface DiffSummary {
  actionsAdded: number;
  actionsRemoved: number;
  actionsModified: number;
  connectionsChanged: number;
  propertiesChanged: number;
  variablesChanged: number;
  totalChanges: number;
}

// ============================================================================
// Merge Types
// ============================================================================

/**
 * Merge conflict information
 */
export interface MergeConflict {
  id: string;
  type: "action" | "connection" | "property" | "variable";
  path: string;
  sourceValue: unknown;
  targetValue: unknown;
  baseValue?: unknown;
  description: string;
}

export interface MergeResult {
  success: boolean;
  workflow?: Workflow;
  conflicts: MergeConflict[];
  message: string;
}

export interface ConflictResolution {
  conflictId: string;
  resolution: "source" | "target" | "manual";
  value?: unknown;
}

// ============================================================================
// Change Tracking Types
// ============================================================================

/**
 * Change tracking
 */
export interface ChangeSummary {
  actionsAdded: number;
  actionsRemoved: number;
  actionsModified: number;
  connectionsChanged: number;
  propertiesChanged: string[];
  hasStructuralChanges: boolean;
  hasConfigChanges: boolean;
}

export interface ChangeStatistics {
  totalVersions: number;
  totalChanges: number;
  averageChangesPerVersion: number;
  mostActiveAreas: string[];
  changeFrequency: {
    actions: number;
    connections: number;
    properties: number;
    variables: number;
  };
}

export interface Contributor {
  author: string;
  versionCount: number;
  lastContribution: string;
  areasModified: string[];
}
