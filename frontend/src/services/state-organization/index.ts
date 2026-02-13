/**
 * State Organization Service
 *
 * Comprehensive service for organizing states in large projects (50+ states) with:
 * - State templates with predefined patterns
 * - Hierarchical state groups/folders
 * - Tags and metadata management
 * - Advanced search and filtering
 * - Bulk operations
 * - State relationship analysis
 * - Complexity scoring and analysis
 * - Import/export functionality
 * - localStorage persistence with auto-save
 *
 * Integrates with AutomationContext for state management.
 *
 * This barrel module re-exports everything from the sub-modules and
 * provides the singleton StateOrganizationService with the same
 * public API as the original monolithic service.
 */

// Re-export all types
export type {
  ServiceState,
  PersistenceCallbacks,
} from "./types";

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
} from "./types";

export {
  STATE_COMPLEXITY_THRESHOLDS,
  STATE_COMPLEXITY_WEIGHTS,
  STORAGE_VERSION,
  STORAGE_KEY,
} from "./types";

// Re-export sub-module classes
export { TemplateManager } from "./template-manager";
export { GroupManager } from "./group-manager";
export { SearchEngine } from "./search-engine";
export { Analyzer } from "./analyzer";
export { ImportExport } from "./import-export";
export { Persistence } from "./persistence";

// Implementation imports
import type {
  State,
  Transition,
} from "@/contexts/automation-context/types";

import type {
  StateTemplate,
  StateTemplateConfig,
  StateMetadata,
  StateSearchFilter,
  StateSearchResult,
  StateRelationship,
  StateGraph,
  StateComplexity,
  StateSimilarity,
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
} from "@/types/state-organization/types";

import type { ServiceState } from "./types";
import { TemplateManager } from "./template-manager";
import { GroupManager } from "./group-manager";
import { SearchEngine } from "./search-engine";
import { Analyzer } from "./analyzer";
import { ImportExport } from "./import-export";
import { Persistence } from "./persistence";

// ============================================================================
// StateOrganizationService Class
// ============================================================================

export class StateOrganizationService {
  private static instance: StateOrganizationService;

  // Shared state across all sub-modules
  private serviceState: ServiceState;

  // Sub-modules
  private readonly persistenceModule: Persistence;
  private readonly templateManager: TemplateManager;
  private readonly groupManager: GroupManager;
  private readonly searchEngine: SearchEngine;
  private readonly analyzer: Analyzer;
  private readonly importExport: ImportExport;

  private constructor() {
    this.serviceState = {
      groups: new Map(),
      associations: [],
      metadata: new Map(),
      templates: new Map(),
      autoSaveEnabled: true,
      states: [],
      transitions: [],
    };

    this.persistenceModule = new Persistence(this.serviceState);
    const persistenceCallbacks = { save: () => this.persistenceModule.save() };

    this.templateManager = new TemplateManager(this.serviceState, persistenceCallbacks);
    this.groupManager = new GroupManager(this.serviceState, persistenceCallbacks);
    this.searchEngine = new SearchEngine(this.serviceState);
    this.analyzer = new Analyzer(this.serviceState);
    this.importExport = new ImportExport(
      this.serviceState,
      persistenceCallbacks,
      this.groupManager
    );

    this.persistenceModule.loadFromStorage();
    this.templateManager.initializeBuiltInTemplates();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): StateOrganizationService {
    if (!StateOrganizationService.instance) {
      StateOrganizationService.instance = new StateOrganizationService();
    }
    return StateOrganizationService.instance;
  }

  /**
   * Set states from AutomationContext
   */
  setStates(states: State[]): void {
    this.serviceState.states = states;
  }

  /**
   * Set transitions from AutomationContext
   */
  setTransitions(transitions: Transition[]): void {
    this.serviceState.transitions = transitions;
  }

  // ==========================================================================
  // State Templates (delegated to TemplateManager)
  // ==========================================================================

  createStateTemplate(
    name: string,
    config: StateTemplateConfig
  ): TemplateOperationResult {
    return this.templateManager.createStateTemplate(name, config);
  }

  getStateTemplate(id: string): TemplateOperationResult {
    return this.templateManager.getStateTemplate(id);
  }

  getAllStateTemplates(): StateTemplate[] {
    return this.templateManager.getAllStateTemplates();
  }

  createStateFromTemplate(
    templateId: string,
    name: string
  ): StateOperationResult {
    return this.templateManager.createStateFromTemplate(templateId, name);
  }

  // ==========================================================================
  // State Groups/Folders (delegated to GroupManager)
  // ==========================================================================

  createStateGroup(
    name: string,
    description?: string,
    color?: string,
    icon?: string
  ): GroupOperationResult {
    return this.groupManager.createStateGroup(name, description, color, icon);
  }

  addStateToGroup(stateId: string, groupId: string): GroupOperationResult {
    return this.groupManager.addStateToGroup(stateId, groupId);
  }

  removeStateFromGroup(
    stateId: string,
    groupId: string
  ): GroupOperationResult {
    return this.groupManager.removeStateFromGroup(stateId, groupId);
  }

  getStatesInGroup(groupId: string, recursive = false): StateListResult {
    return this.groupManager.getStatesInGroup(groupId, recursive);
  }

  getAllStateGroups(): GroupListResult {
    return this.groupManager.getAllStateGroups();
  }

  moveStateGroup(
    groupId: string,
    newParentId: string | null
  ): GroupOperationResult {
    return this.groupManager.moveStateGroup(groupId, newParentId);
  }

  getGroupTree(rootId: string | null = null): GroupTreeResult {
    return this.groupManager.getGroupTree(rootId);
  }

  // ==========================================================================
  // Tags and Metadata (delegated to GroupManager)
  // ==========================================================================

  addStateTag(stateId: string, tag: string): MetadataOperationResult {
    return this.groupManager.addStateTag(stateId, tag);
  }

  removeStateTag(stateId: string, tag: string): MetadataOperationResult {
    return this.groupManager.removeStateTag(stateId, tag);
  }

  getStatesByTag(tag: string): State[] {
    return this.groupManager.getStatesByTag(tag);
  }

  updateStateMetadata(
    stateId: string,
    updates: Partial<StateMetadata>
  ): MetadataOperationResult {
    return this.groupManager.updateStateMetadata(stateId, updates);
  }

  getStateMetadata(stateId: string): StateMetadata | null {
    return this.groupManager.getStateMetadata(stateId);
  }

  // ==========================================================================
  // Search and Filter (delegated to SearchEngine)
  // ==========================================================================

  searchStates(
    query: string,
    filters?: StateSearchFilter
  ): StateSearchResult[] {
    return this.searchEngine.searchStates(query, filters);
  }

  filterByImageUsage(imageId: string): State[] {
    return this.searchEngine.filterByImageUsage(imageId);
  }

  filterByActionType(_actionType: string): State[] {
    return this.searchEngine.filterByActionType(_actionType);
  }

  // ==========================================================================
  // Bulk Operations (delegated to GroupManager)
  // ==========================================================================

  bulkTag(stateIds: string[], tags: string[]): BulkOperationResult {
    return this.groupManager.bulkTag(stateIds, tags);
  }

  bulkMove(stateIds: string[], groupId: string): BulkOperationResult {
    return this.groupManager.bulkMove(stateIds, groupId);
  }

  bulkDelete(stateIds: string[]): BulkOperationResult {
    return this.groupManager.bulkDelete(stateIds);
  }

  bulkDuplicate(stateIds: string[]): {
    success: boolean;
    states: State[];
    errors: Array<{ stateId: string; error: string }>;
  } {
    return this.groupManager.bulkDuplicate(stateIds);
  }

  bulkExport(stateIds: string[], options?: ExportOptions): ExportData {
    return this.groupManager.bulkExport(stateIds, options);
  }

  // ==========================================================================
  // State Relationships (delegated to Analyzer)
  // ==========================================================================

  getStateRelationships(stateId: string): StateRelationship | null {
    return this.analyzer.getStateRelationships(stateId);
  }

  findOrphanedStates(): State[] {
    return this.analyzer.findOrphanedStates();
  }

  findDeadEndStates(): State[] {
    return this.analyzer.findDeadEndStates();
  }

  getStateGraph(): StateGraph {
    return this.analyzer.getStateGraph();
  }

  // ==========================================================================
  // State Analysis (delegated to Analyzer)
  // ==========================================================================

  analyzeStateComplexity(stateId: string): StateComplexity | null {
    return this.analyzer.analyzeStateComplexity(stateId);
  }

  getComplexityScore(stateId: string): number {
    return this.analyzer.getComplexityScore(stateId);
  }

  findDuplicateStates(
    threshold?: number
  ): Array<{ state: State; duplicates: StateSimilarity[] }> {
    return this.analyzer.findDuplicateStates(threshold);
  }

  getStateAnalysis(stateId: string): AnalysisResult {
    return this.analyzer.getStateAnalysis(stateId);
  }

  // ==========================================================================
  // Import/Export (delegated to ImportExport)
  // ==========================================================================

  exportStates(
    stateIds: string[],
    includeGroups = false,
    includeImages = false
  ): ExportData {
    return this.importExport.exportStates(stateIds, includeGroups, includeImages);
  }

  importStates(data: ExportData, options?: ImportOptions): BulkOperationResult {
    return this.importExport.importStates(data, options);
  }

  // ==========================================================================
  // Persistence (delegated to Persistence module)
  // ==========================================================================

  /**
   * Clear all data
   */
  clearAll(): void {
    this.persistenceModule.clearAll();
  }

  /**
   * Enable/disable auto-save
   */
  setAutoSave(enabled: boolean): void {
    this.persistenceModule.setAutoSave(enabled);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const stateOrganizationService = StateOrganizationService.getInstance();
