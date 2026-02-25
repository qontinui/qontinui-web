/**
 * State Organization Types
 *
 * Re-exports all types from the centralized type definitions,
 * plus internal types used by the state organization sub-modules.
 */

export type {
  StateTemplate,
  StateTemplateConfig,
  StateImageTemplate,
  RegionTemplate,
  LocationTemplate,
  StringTemplate,
  SearchRegionTemplate,
  StateGroup,
  GroupMetadata,
  GroupTreeNode,
  StateGroupAssociation,
  StateMetadata,
  StateSearchFilter,
  StateSearchResult,
  SearchMatch,
  StateRelationship,
  TransitionInfo,
  StateGraph,
  StateGraphNode,
  StateGraphEdge,
  StateComplexity,
  StateAnalysis,
  StateImageUsage,
  StateSimilarity,
  StateIssue,
  BulkOperationResult,
  ExportOptions,
  ImportOptions,
  ExportData,
  TemplateOperationResult,
  GroupOperationResult,
  MetadataOperationResult,
  StateOperationResult,
  GroupListResult,
  GroupTreeResult,
  StateListResult,
  AnalysisResult,
  StateOrganizationStorage,
} from "@/types/state-organization/types";

export {
  STATE_COMPLEXITY_THRESHOLDS,
  STATE_COMPLEXITY_WEIGHTS,
  STORAGE_VERSION,
  STORAGE_KEY,
} from "@/types/state-organization/types";

import type { State, Transition } from "@/contexts/automation-context/types";

import type {
  StateGroup,
  StateGroupAssociation,
  StateMetadata,
  StateTemplate,
} from "@/types/state-organization/types";

/**
 * Shared internal state that all sub-modules operate on.
 * This allows splitting the monolithic class while maintaining
 * shared mutable state across modules.
 */
export interface ServiceState {
  groups: Map<string, StateGroup>;
  associations: StateGroupAssociation[];
  metadata: Map<string, StateMetadata>;
  templates: Map<string, StateTemplate>;
  autoSaveEnabled: boolean;
  states: State[];
  transitions: Transition[];
}

/**
 * Interface for the persistence callback, used by sub-modules
 * to trigger saves without depending on the full service.
 */
export interface PersistenceCallbacks {
  save: () => void;
}
