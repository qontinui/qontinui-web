/**
 * State Organization Types
 *
 * Type definitions for organizing states in large projects with templates,
 * groups, tags, search, relationships, and complexity analysis.
 */

import type { State } from "@/contexts/automation-context/types";

// ============================================================================
// State Template Types
// ============================================================================

export interface StateTemplate {
  id: string;
  name: string;
  description: string;
  category: "built-in" | "custom";
  icon?: string;
  config: StateTemplateConfig;
  createdAt: string;
  updatedAt: string;
}

export interface StateTemplateConfig {
  stateImages: StateImageTemplate[];
  regions: RegionTemplate[];
  locations: LocationTemplate[];
  strings: StringTemplate[];
  defaultDescription: string;
}

export interface StateImageTemplate {
  name: string;
  placeholder?: boolean; // If true, user needs to provide actual image
  patterns: number; // Number of pattern variations
  shared: boolean;
  searchRegions?: SearchRegionTemplate[];
}

export interface RegionTemplate {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isSearchRegion?: boolean;
}

export interface LocationTemplate {
  name: string;
  x: number;
  y: number;
  fixed: boolean;
  anchor: boolean;
}

export interface StringTemplate {
  name: string;
  value: string;
  identifier?: boolean;
  inputText?: boolean;
  expectedText?: boolean;
}

export interface SearchRegionTemplate {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// State Group Types
// ============================================================================

export interface StateGroup {
  id: string;
  name: string;
  parentId: string | null;
  color?: string;
  icon?: string;
  description?: string;
  metadata: GroupMetadata;
  order?: number;
}

export interface GroupMetadata {
  created: string;
  updated: string;
  stateCount?: number;
  descendantCount?: number;
}

export interface GroupTreeNode extends StateGroup {
  children: GroupTreeNode[];
  depth: number;
  path: string[];
  hasChildren: boolean;
}

export interface StateGroupAssociation {
  stateId: string;
  groupId: string;
  addedAt: string;
}

// ============================================================================
// State Metadata Types
// ============================================================================

export interface StateMetadata {
  tags: string[];
  complexity?: StateComplexity;
  lastAnalyzed?: string;
  notes?: string;
  customFields?: Record<string, unknown>;
  createdBy?: string;
  lastModifiedBy?: string;
  createdAt?: string;
  lastModifiedAt?: string;
}

// ============================================================================
// Search and Filter Types
// ============================================================================

export interface StateSearchFilter {
  query?: string;
  groups?: string[];
  tags?: string[];
  hasImages?: boolean;
  hasTransitions?: boolean;
  complexityMin?: number;
  complexityMax?: number;
  imageId?: string;
  actionType?: string;
  includeDescription?: boolean;
  caseSensitive?: boolean;
}

export interface StateSearchResult {
  state: State;
  metadata: StateMetadata;
  matches: SearchMatch[];
  score: number;
}

export interface SearchMatch {
  field: "name" | "description" | "tag" | "group";
  value: string;
  matchedText: string;
}

// ============================================================================
// State Relationship Types
// ============================================================================

export interface StateRelationship {
  stateId: string;
  stateName: string;
  incoming: TransitionInfo[];
  outgoing: TransitionInfo[];
  activates: string[]; // States this state activates
  deactivates: string[]; // States this state deactivates
  staysVisibleWith: string[]; // States that stay visible with this one
}

export interface TransitionInfo {
  transitionId: string;
  fromStateId?: string;
  fromStateName?: string;
  toStateId?: string;
  toStateName?: string;
  workflowCount: number;
  timeout: number;
  retryCount: number;
}

export interface StateGraph {
  nodes: StateGraphNode[];
  edges: StateGraphEdge[];
}

export interface StateGraphNode {
  id: string;
  name: string;
  type: "state" | "initial";
  metadata: StateMetadata;
}

export interface StateGraphEdge {
  from: string;
  to: string;
  transitionId: string;
  workflowCount: number;
}

// ============================================================================
// State Complexity Types
// ============================================================================

export interface StateComplexity {
  imageCount: number;
  regionCount: number;
  locationCount: number;
  transitionCount: number;
  totalPatternCount: number;
  searchRegionCount: number;
  complexityScore: number; // 0-100
  level: "simple" | "moderate" | "complex" | "very-complex";
}

export interface StateAnalysis {
  stateId: string;
  stateName: string;
  complexity: StateComplexity;
  relationships: StateRelationship;
  imageUsage: StateImageUsage[];
  duplicateCandidates: StateSimilarity[];
  issues: StateIssue[];
}

export interface StateImageUsage {
  imageId: string;
  imageName: string;
  patternCount: number;
  usedInStates: number;
  sharedImage: boolean;
}

export interface StateSimilarity {
  stateId: string;
  stateName: string;
  similarityScore: number; // 0-100
  commonImages: number;
  commonRegions: number;
  commonLocations: number;
}

export interface StateIssue {
  type: "warning" | "error" | "info";
  category:
    | "orphaned"
    | "dead-end"
    | "no-images"
    | "no-transitions"
    | "high-complexity";
  message: string;
  suggestion?: string;
}

// ============================================================================
// Bulk Operation Types
// ============================================================================

export interface BulkOperationResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  errors: Array<{ stateId: string; error: string }>;
  warnings?: string[];
}

export interface ExportOptions {
  includeGroups?: boolean;
  includeImages?: boolean;
  includeTags?: boolean;
  includeMetadata?: boolean;
  includeTransitions?: boolean;
}

export interface ImportOptions {
  merge?: boolean;
  overwriteExisting?: boolean;
  preserveIds?: boolean;
  updateReferences?: boolean;
}

export interface ExportData {
  states: State[];
  groups?: StateGroup[];
  associations?: StateGroupAssociation[];
  metadata: Record<string, StateMetadata>;
  templates?: StateTemplate[];
  exportedAt: string;
  exportedBy: string;
  version: string;
}

// ============================================================================
// Operation Result Types
// ============================================================================

export interface TemplateOperationResult {
  success: boolean;
  template?: StateTemplate;
  error?: string;
  warnings?: string[];
}

export interface GroupOperationResult {
  success: boolean;
  group?: StateGroup;
  error?: string;
  warnings?: string[];
}

export interface MetadataOperationResult {
  success: boolean;
  metadata?: StateMetadata;
  error?: string;
  warnings?: string[];
}

export interface StateOperationResult {
  success: boolean;
  state?: State;
  error?: string;
  warnings?: string[];
}

export interface GroupListResult {
  success: boolean;
  groups: StateGroup[];
  error?: string;
}

export interface GroupTreeResult {
  success: boolean;
  tree: GroupTreeNode[];
  error?: string;
}

export interface StateListResult {
  success: boolean;
  stateIds: string[];
  error?: string;
}

export interface AnalysisResult {
  success: boolean;
  analysis?: StateAnalysis;
  error?: string;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface StateOrganizationStorage {
  groups: Record<string, StateGroup>;
  associations: StateGroupAssociation[];
  metadata: Record<string, StateMetadata>;
  templates: Record<string, StateTemplate>;
  version: string;
  lastModified: string;
}

// ============================================================================
// Constants
// ============================================================================

export const STATE_COMPLEXITY_THRESHOLDS = {
  simple: 20,
  moderate: 50,
  complex: 75,
  veryComplex: 100,
};

export const STATE_COMPLEXITY_WEIGHTS = {
  imageCount: 10,
  regionCount: 5,
  locationCount: 3,
  transitionCount: 8,
  patternCount: 4,
  searchRegionCount: 2,
};

export const DEFAULT_COLORS = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#10b981", // green
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#6b7280", // gray
  "#14b8a6", // teal
];

export const DEFAULT_ICONS = [
  "folder",
  "folder-open",
  "briefcase",
  "archive",
  "bookmark",
  "star",
  "tag",
  "collection",
  "cube",
  "puzzle",
];

export const STORAGE_VERSION = "1.0.0";
export const STORAGE_KEY = "state-organization";
