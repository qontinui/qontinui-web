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
 */

import type {
  State,
  Transition,
  OutgoingTransition,
  StateImage,
  StateRegion,
  SearchRegion,
  StateLocation,
  StateString,
} from "@/contexts/automation-context/types";

import type {
  StateTemplate,
  StateTemplateConfig,
  RegionTemplate,
  LocationTemplate,
  StringTemplate,
  StateGroup,
  GroupTreeNode,
  StateGroupAssociation,
  StateMetadata,
  StateSearchFilter,
  StateSearchResult,
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
  SearchMatch,
} from "@/types/state-organization/types";

import {
  STATE_COMPLEXITY_THRESHOLDS,
  STATE_COMPLEXITY_WEIGHTS,
  STORAGE_VERSION,
  STORAGE_KEY,
} from "@/types/state-organization/types";

// ============================================================================
// StateOrganizationService Class
// ============================================================================

export class StateOrganizationService {
  private static instance: StateOrganizationService;

  // Storage
  private groups: Map<string, StateGroup> = new Map();
  private associations: StateGroupAssociation[] = [];
  private metadata: Map<string, StateMetadata> = new Map();
  private templates: Map<string, StateTemplate> = new Map();
  private autoSaveEnabled = true;

  // External data - provided by AutomationContext
  private states: State[] = [];
  private transitions: Transition[] = [];

  private constructor() {
    this.loadFromStorage();
    this.initializeBuiltInTemplates();
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
    this.states = states;
  }

  /**
   * Set transitions from AutomationContext
   */
  setTransitions(transitions: Transition[]): void {
    this.transitions = transitions;
  }

  // ==========================================================================
  // State Templates
  // ==========================================================================

  /**
   * Create a new state template
   */
  createStateTemplate(
    name: string,
    config: StateTemplateConfig
  ): TemplateOperationResult {
    try {
      if (!name || !name.trim()) {
        return { success: false, error: "Template name cannot be empty" };
      }

      const template: StateTemplate = {
        id: this.generateId("template"),
        name: name.trim(),
        description: config.defaultDescription || "",
        category: "custom",
        config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.templates.set(template.id, template);
      this.save();

      return { success: true, template };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create template: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get a template by ID
   */
  getStateTemplate(id: string): TemplateOperationResult {
    const template = this.templates.get(id);
    if (!template) {
      return { success: false, error: `Template not found: ${id}` };
    }
    return { success: true, template: { ...template } };
  }

  /**
   * Get all templates
   */
  getAllStateTemplates(): StateTemplate[] {
    return Array.from(this.templates.values()).map((t) => ({ ...t }));
  }

  /**
   * Create a new state from template
   */
  createStateFromTemplate(
    templateId: string,
    name: string
  ): StateOperationResult {
    try {
      const templateResult = this.getStateTemplate(templateId);
      if (!templateResult.success || !templateResult.template) {
        return { success: false, error: templateResult.error };
      }

      const template = templateResult.template;
      const config = template.config;

      // Create state from template
      const state: State = {
        id: this.generateId("state"),
        name: name.trim(),
        description: config.defaultDescription,
        initial: false,
        stateImages: config.stateImages.map((img) =>
          this.createStateImageFromTemplate(img)
        ),
        regions: config.regions.map((region) =>
          this.createRegionFromTemplate(region)
        ),
        locations: config.locations.map((loc) =>
          this.createLocationFromTemplate(loc)
        ),
        strings: config.strings.map((str) =>
          this.createStringFromTemplate(str)
        ),
        position: { x: 0, y: 0 },
      };

      // Initialize metadata
      const metadata: StateMetadata = {
        tags: [`template:${template.name}`],
        createdAt: new Date().toISOString(),
        notes: `Created from template: ${template.name}`,
      };
      this.metadata.set(state.id, metadata);
      this.save();

      return { success: true, state };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create state from template: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // State Groups/Folders
  // ==========================================================================

  /**
   * Create a new state group
   */
  createStateGroup(
    name: string,
    description?: string,
    color?: string,
    icon?: string
  ): GroupOperationResult {
    try {
      if (!name || !name.trim()) {
        return { success: false, error: "Group name cannot be empty" };
      }

      const group: StateGroup = {
        id: this.generateId("group"),
        name: name.trim(),
        parentId: null,
        color,
        icon,
        description: description?.trim(),
        metadata: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          stateCount: 0,
          descendantCount: 0,
        },
        order: this.getNextOrder(null),
      };

      this.groups.set(group.id, group);
      this.save();

      return { success: true, group };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create group: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Add state to group
   */
  addStateToGroup(stateId: string, groupId: string): GroupOperationResult {
    try {
      if (!this.groups.has(groupId)) {
        return { success: false, error: `Group not found: ${groupId}` };
      }

      // Check if state exists
      const stateExists = this.states.some((s) => s.id === stateId);
      if (!stateExists) {
        return { success: false, error: `State not found: ${stateId}` };
      }

      // Check if already in a group
      const existing = this.associations.find((a) => a.stateId === stateId);
      if (existing) {
        if (existing.groupId === groupId) {
          return {
            success: true,
            warnings: ["State already in this group"],
          };
        }
        // Remove from old group
        this.removeStateFromGroup(stateId, existing.groupId);
      }

      // Add association
      this.associations.push({
        stateId,
        groupId,
        addedAt: new Date().toISOString(),
      });

      this.updateStateCounts(groupId);
      this.save();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add state to group: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Remove state from group
   */
  removeStateFromGroup(stateId: string, groupId: string): GroupOperationResult {
    try {
      const index = this.associations.findIndex(
        (a) => a.stateId === stateId && a.groupId === groupId
      );

      if (index === -1) {
        return {
          success: true,
          warnings: ["State not in this group"],
        };
      }

      this.associations.splice(index, 1);
      this.updateStateCounts(groupId);
      this.save();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove state from group: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get all states in a group
   */
  getStatesInGroup(groupId: string, recursive = false): StateListResult {
    try {
      if (!this.groups.has(groupId)) {
        return {
          success: false,
          stateIds: [],
          error: `Group not found: ${groupId}`,
        };
      }

      const stateIds = new Set<string>();

      // Add states from this group
      this.associations
        .filter((a) => a.groupId === groupId)
        .forEach((a) => stateIds.add(a.stateId));

      // Add states from subgroups if recursive
      if (recursive) {
        const descendants = this.getGroupDescendants(groupId);
        for (const descendant of descendants) {
          this.associations
            .filter((a) => a.groupId === descendant.id)
            .forEach((a) => stateIds.add(a.stateId));
        }
      }

      return {
        success: true,
        stateIds: Array.from(stateIds),
      };
    } catch (error) {
      return {
        success: false,
        stateIds: [],
        error: `Failed to get states in group: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get all state groups
   */
  getAllStateGroups(): GroupListResult {
    try {
      const groups = Array.from(this.groups.values());
      return {
        success: true,
        groups: groups.map((g) => ({ ...g })),
      };
    } catch (error) {
      return {
        success: false,
        groups: [],
        error: `Failed to get groups: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Move state group to new parent (hierarchical)
   */
  moveStateGroup(
    groupId: string,
    newParentId: string | null
  ): GroupOperationResult {
    try {
      const group = this.groups.get(groupId);
      if (!group) {
        return { success: false, error: `Group not found: ${groupId}` };
      }

      // Validate move
      if (groupId === newParentId) {
        return { success: false, error: "Cannot move group to itself" };
      }

      if (newParentId && !this.groups.has(newParentId)) {
        return {
          success: false,
          error: `Parent group not found: ${newParentId}`,
        };
      }

      // Check for circular dependency
      if (newParentId) {
        const descendants = this.getGroupDescendants(groupId);
        if (descendants.some((d) => d.id === newParentId)) {
          return {
            success: false,
            error: "Cannot move group to one of its descendants",
          };
        }
      }

      const oldParentId = group.parentId;
      group.parentId = newParentId;
      group.metadata.updated = new Date().toISOString();

      this.updateDescendantCounts(oldParentId);
      this.updateDescendantCounts(newParentId);
      this.save();

      return { success: true, group };
    } catch (error) {
      return {
        success: false,
        error: `Failed to move group: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get group tree (hierarchical structure)
   */
  getGroupTree(rootId: string | null = null): GroupTreeResult {
    try {
      const tree = this.buildGroupTree(rootId);
      return { success: true, tree };
    } catch (error) {
      return {
        success: false,
        tree: [],
        error: `Failed to build group tree: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // Tags and Metadata
  // ==========================================================================

  /**
   * Add tag to state
   */
  addStateTag(stateId: string, tag: string): MetadataOperationResult {
    try {
      let metadata = this.metadata.get(stateId);
      if (!metadata) {
        metadata = { tags: [] };
        this.metadata.set(stateId, metadata);
      }

      if (!metadata.tags.includes(tag)) {
        metadata.tags.push(tag);
        this.save();
      }

      return { success: true, metadata };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add tag: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Remove tag from state
   */
  removeStateTag(stateId: string, tag: string): MetadataOperationResult {
    try {
      const metadata = this.metadata.get(stateId);
      if (!metadata) {
        return { success: true, warnings: ["State has no metadata"] };
      }

      const index = metadata.tags.indexOf(tag);
      if (index > -1) {
        metadata.tags.splice(index, 1);
        this.save();
      }

      return { success: true, metadata };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove tag: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get states by tag
   */
  getStatesByTag(tag: string): State[] {
    const stateIds: string[] = [];

    for (const [stateId, metadata] of this.metadata.entries()) {
      if (metadata.tags.includes(tag)) {
        stateIds.push(stateId);
      }
    }

    return this.states.filter((s) => stateIds.includes(s.id));
  }

  /**
   * Update state metadata
   */
  updateStateMetadata(
    stateId: string,
    updates: Partial<StateMetadata>
  ): MetadataOperationResult {
    try {
      let metadata = this.metadata.get(stateId);
      if (!metadata) {
        metadata = { tags: [] };
        this.metadata.set(stateId, metadata);
      }

      // Merge updates
      Object.assign(metadata, updates);
      metadata.lastModifiedAt = new Date().toISOString();
      this.save();

      return { success: true, metadata };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get state metadata
   */
  getStateMetadata(stateId: string): StateMetadata | null {
    return this.metadata.get(stateId) || null;
  }

  // ==========================================================================
  // Search and Filter
  // ==========================================================================

  /**
   * Search states with advanced filters
   */
  searchStates(
    query: string,
    filters?: StateSearchFilter
  ): StateSearchResult[] {
    const results: StateSearchResult[] = [];
    const searchTerm = filters?.caseSensitive ? query : query.toLowerCase();

    for (const state of this.states) {
      const metadata = this.metadata.get(state.id) || { tags: [] };
      const matches: SearchMatch[] = [];
      let score = 0;

      // Apply filters first
      if (!this.matchesFilters(state, metadata, filters)) {
        continue;
      }

      // Search in name
      const stateName = filters?.caseSensitive
        ? state.name
        : state.name.toLowerCase();
      if (stateName.includes(searchTerm)) {
        matches.push({
          field: "name",
          value: state.name,
          matchedText: query,
        });
        score += 50;
      }

      // Search in description
      if (filters?.includeDescription !== false && state.description) {
        const stateDesc = filters?.caseSensitive
          ? state.description
          : state.description.toLowerCase();
        if (stateDesc.includes(searchTerm)) {
          matches.push({
            field: "description",
            value: state.description,
            matchedText: query,
          });
          score += 25;
        }
      }

      // Search in tags
      for (const tag of metadata.tags) {
        const tagValue = filters?.caseSensitive ? tag : tag.toLowerCase();
        if (tagValue.includes(searchTerm)) {
          matches.push({
            field: "tag",
            value: tag,
            matchedText: query,
          });
          score += 30;
        }
      }

      if (matches.length > 0 || !query) {
        results.push({ state, metadata, matches, score });
      }
    }

    // Sort by score (descending)
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Filter states by image usage
   */
  filterByImageUsage(imageId: string): State[] {
    return this.states.filter((state) =>
      state.stateImages.some((img) =>
        img.patterns.some((pattern) => pattern.imageId === imageId)
      )
    );
  }

  /**
   * Filter states by action type (via transitions)
   */
  filterByActionType(_actionType: string): State[] {
    // This would require workflow analysis
    // For now, return states with transitions
    const statesWithTransitions = new Set<string>();

    for (const transition of this.transitions) {
      if (transition.type === "OutgoingTransition") {
        statesWithTransitions.add(transition.fromState);
      }
      if (transition.toState) {
        statesWithTransitions.add(transition.toState);
      }
    }

    return this.states.filter((s) => statesWithTransitions.has(s.id));
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  /**
   * Bulk tag states
   */
  bulkTag(stateIds: string[], tags: string[]): BulkOperationResult {
    const result: BulkOperationResult = {
      success: true,
      processedCount: 0,
      failedCount: 0,
      errors: [],
    };

    for (const stateId of stateIds) {
      try {
        for (const tag of tags) {
          this.addStateTag(stateId, tag);
        }
        result.processedCount++;
      } catch (error) {
        result.failedCount++;
        result.errors.push({
          stateId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    result.success = result.failedCount === 0;
    return result;
  }

  /**
   * Bulk move states to group
   */
  bulkMove(stateIds: string[], groupId: string): BulkOperationResult {
    const result: BulkOperationResult = {
      success: true,
      processedCount: 0,
      failedCount: 0,
      errors: [],
    };

    for (const stateId of stateIds) {
      const moveResult = this.addStateToGroup(stateId, groupId);
      if (moveResult.success) {
        result.processedCount++;
      } else {
        result.failedCount++;
        result.errors.push({
          stateId,
          error: moveResult.error || "Unknown error",
        });
      }
    }

    result.success = result.failedCount === 0;
    return result;
  }

  /**
   * Bulk delete states (returns state IDs to be deleted by AutomationContext)
   */
  bulkDelete(stateIds: string[]): BulkOperationResult {
    const result: BulkOperationResult = {
      success: true,
      processedCount: 0,
      failedCount: 0,
      errors: [],
    };

    for (const stateId of stateIds) {
      try {
        // Remove from groups
        const association = this.associations.find(
          (a) => a.stateId === stateId
        );
        if (association) {
          this.removeStateFromGroup(stateId, association.groupId);
        }

        // Remove metadata
        this.metadata.delete(stateId);
        result.processedCount++;
      } catch (error) {
        result.failedCount++;
        result.errors.push({
          stateId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    this.save();
    result.success = result.failedCount === 0;
    return result;
  }

  /**
   * Bulk duplicate states (returns new state configurations)
   */
  bulkDuplicate(stateIds: string[]): {
    success: boolean;
    states: State[];
    errors: Array<{ stateId: string; error: string }>;
  } {
    const result: {
      success: boolean;
      states: State[];
      errors: Array<{ stateId: string; error: string }>;
    } = {
      success: true,
      states: [],
      errors: [],
    };

    for (const stateId of stateIds) {
      try {
        const state = this.states.find((s) => s.id === stateId);
        if (!state) {
          result.errors.push({ stateId, error: "State not found" });
          continue;
        }

        const duplicated: State = {
          ...state,
          id: this.generateId("state"),
          name: `${state.name} (Copy)`,
          position: {
            x: Math.round(state.position.x + 50),
            y: Math.round(state.position.y + 50),
          },
        };

        result.states.push(duplicated);

        // Copy metadata
        const metadata = this.metadata.get(stateId);
        if (metadata) {
          this.metadata.set(duplicated.id, {
            ...metadata,
            createdAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        result.errors.push({
          stateId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    this.save();
    result.success = result.errors.length === 0;
    return result;
  }

  /**
   * Bulk export states
   */
  bulkExport(stateIds: string[], options?: ExportOptions): ExportData {
    const statesToExport = this.states.filter((s) => stateIds.includes(s.id));
    const metadataToExport: Record<string, StateMetadata> = {};

    for (const stateId of stateIds) {
      const metadata = this.metadata.get(stateId);
      if (metadata) {
        metadataToExport[stateId] = metadata;
      }
    }

    const exportData: ExportData = {
      states: statesToExport,
      metadata: metadataToExport,
      exportedAt: new Date().toISOString(),
      exportedBy: "Qontinui",
      version: STORAGE_VERSION,
    };

    if (options?.includeGroups) {
      const relevantGroups = new Set<string>();
      for (const association of this.associations) {
        if (stateIds.includes(association.stateId)) {
          relevantGroups.add(association.groupId);
        }
      }

      exportData.groups = Array.from(relevantGroups)
        .map((id) => this.groups.get(id))
        .filter((g): g is StateGroup => g !== undefined);

      exportData.associations = this.associations.filter((a) =>
        stateIds.includes(a.stateId)
      );
    }

    if (options?.includeTags) {
      // Tags are already in metadata
    }

    return exportData;
  }

  // ==========================================================================
  // State Relationships
  // ==========================================================================

  /**
   * Get state relationships (incoming/outgoing transitions)
   */
  getStateRelationships(stateId: string): StateRelationship | null {
    const state = this.states.find((s) => s.id === stateId);
    if (!state) return null;

    const incoming: TransitionInfo[] = [];
    const outgoing: TransitionInfo[] = [];
    const activates: string[] = [];
    const deactivates: string[] = [];
    const staysVisibleWith: string[] = [];

    for (const transition of this.transitions) {
      if (transition.type === "OutgoingTransition") {
        const outTrans = transition as OutgoingTransition;

        if (outTrans.fromState === stateId) {
          outgoing.push({
            transitionId: transition.id,
            fromStateId: outTrans.fromState,
            fromStateName: this.getStateName(outTrans.fromState),
            toStateId: outTrans.toState,
            toStateName: outTrans.toState
              ? this.getStateName(outTrans.toState)
              : undefined,
            workflowCount: transition.workflows.length,
            timeout: transition.timeout,
            retryCount: transition.retryCount,
          });

          activates.push(...outTrans.activateStates);
          deactivates.push(...outTrans.deactivateStates);
          if (outTrans.staysVisible) {
            staysVisibleWith.push(outTrans.toState || "");
          }
        }
      }

      if (transition.toState === stateId) {
        incoming.push({
          transitionId: transition.id,
          fromStateId:
            transition.type === "OutgoingTransition"
              ? (transition as OutgoingTransition).fromState
              : undefined,
          fromStateName:
            transition.type === "OutgoingTransition"
              ? this.getStateName((transition as OutgoingTransition).fromState)
              : undefined,
          toStateId: transition.toState,
          toStateName: this.getStateName(transition.toState),
          workflowCount: transition.workflows.length,
          timeout: transition.timeout,
          retryCount: transition.retryCount,
        });
      }
    }

    return {
      stateId,
      stateName: state.name,
      incoming,
      outgoing,
      activates: [...new Set(activates)],
      deactivates: [...new Set(deactivates)],
      staysVisibleWith: [...new Set(staysVisibleWith)].filter(Boolean),
    };
  }

  /**
   * Find orphaned states (no transitions)
   */
  findOrphanedStates(): State[] {
    const connectedStates = new Set<string>();

    for (const transition of this.transitions) {
      if (transition.type === "OutgoingTransition") {
        connectedStates.add((transition as OutgoingTransition).fromState);
      }
      if (transition.toState) {
        connectedStates.add(transition.toState);
      }
    }

    return this.states.filter((s) => !connectedStates.has(s.id) && !s.initial);
  }

  /**
   * Find dead-end states (no outgoing transitions)
   */
  findDeadEndStates(): State[] {
    const statesWithOutgoing = new Set<string>();

    for (const transition of this.transitions) {
      if (transition.type === "OutgoingTransition") {
        statesWithOutgoing.add((transition as OutgoingTransition).fromState);
      }
    }

    return this.states.filter((s) => !statesWithOutgoing.has(s.id));
  }

  /**
   * Get state graph (full graph of state relationships)
   */
  getStateGraph(): StateGraph {
    const nodes: StateGraphNode[] = this.states.map((state) => ({
      id: state.id,
      name: state.name,
      type: state.initial ? "initial" : "state",
      metadata: this.metadata.get(state.id) || { tags: [] },
    }));

    const edges: StateGraphEdge[] = [];

    for (const transition of this.transitions) {
      if (transition.type === "OutgoingTransition" && transition.toState) {
        const outTrans = transition as OutgoingTransition;
        edges.push({
          from: outTrans.fromState,
          to: outTrans.toState!,
          transitionId: transition.id,
          workflowCount: transition.workflows.length,
        });
      }
    }

    return { nodes, edges };
  }

  // ==========================================================================
  // State Analysis
  // ==========================================================================

  /**
   * Analyze state complexity
   */
  analyzeStateComplexity(stateId: string): StateComplexity | null {
    const state = this.states.find((s) => s.id === stateId);
    if (!state) return null;

    const imageCount = state.stateImages.length;
    const regionCount = state.regions.length;
    const locationCount = state.locations.length;

    // Count transitions
    let transitionCount = 0;
    for (const transition of this.transitions) {
      if (
        transition.type === "OutgoingTransition" &&
        (transition as OutgoingTransition).fromState === stateId
      ) {
        transitionCount++;
      }
      if (transition.toState === stateId) {
        transitionCount++;
      }
    }

    // Count total patterns
    const totalPatternCount = state.stateImages.reduce(
      (sum, img) => sum + img.patterns.length,
      0
    );

    // Count search regions
    const searchRegionCount =
      state.regions.filter((r) => r.isSearchRegion).length +
      state.stateImages.reduce(
        (sum, img) => sum + (img.searchRegions?.length || 0),
        0
      );

    // Calculate complexity score
    const score = Math.min(
      100,
      imageCount * STATE_COMPLEXITY_WEIGHTS.imageCount +
        regionCount * STATE_COMPLEXITY_WEIGHTS.regionCount +
        locationCount * STATE_COMPLEXITY_WEIGHTS.locationCount +
        transitionCount * STATE_COMPLEXITY_WEIGHTS.transitionCount +
        totalPatternCount * STATE_COMPLEXITY_WEIGHTS.patternCount +
        searchRegionCount * STATE_COMPLEXITY_WEIGHTS.searchRegionCount
    );

    let level: StateComplexity["level"] = "simple";
    if (score >= STATE_COMPLEXITY_THRESHOLDS.complex) {
      level = "very-complex";
    } else if (score >= STATE_COMPLEXITY_THRESHOLDS.moderate) {
      level = "complex";
    } else if (score >= STATE_COMPLEXITY_THRESHOLDS.simple) {
      level = "moderate";
    }

    return {
      imageCount,
      regionCount,
      locationCount,
      transitionCount,
      totalPatternCount,
      searchRegionCount,
      complexityScore: score,
      level,
    };
  }

  /**
   * Get complexity score for a state
   */
  getComplexityScore(stateId: string): number {
    const complexity = this.analyzeStateComplexity(stateId);
    return complexity?.complexityScore || 0;
  }

  /**
   * Find duplicate/similar states
   */
  findDuplicateStates(
    threshold = 0.7
  ): Array<{ state: State; duplicates: StateSimilarity[] }> {
    const results: Array<{ state: State; duplicates: StateSimilarity[] }> = [];

    for (const state of this.states) {
      const duplicates: StateSimilarity[] = [];

      for (const otherState of this.states) {
        if (state.id === otherState.id) continue;

        const similarity = this.calculateStateSimilarity(state, otherState);
        if (similarity.similarityScore >= threshold * 100) {
          duplicates.push(similarity);
        }
      }

      if (duplicates.length > 0) {
        results.push({ state, duplicates });
      }
    }

    return results;
  }

  /**
   * Get full state analysis
   */
  getStateAnalysis(stateId: string): AnalysisResult {
    try {
      const state = this.states.find((s) => s.id === stateId);
      if (!state) {
        return { success: false, error: "State not found" };
      }

      const complexity = this.analyzeStateComplexity(stateId);
      const relationships = this.getStateRelationships(stateId);
      const imageUsage = this.getStateImageUsage(state);
      const duplicateCandidates = this.findSimilarStates(state, 0.5);
      const issues = this.analyzeStateIssues(state, complexity, relationships);

      const analysis: StateAnalysis = {
        stateId,
        stateName: state.name,
        complexity: complexity!,
        relationships: relationships!,
        imageUsage,
        duplicateCandidates,
        issues,
      };

      return { success: true, analysis };
    } catch (error) {
      return {
        success: false,
        error: `Failed to analyze state: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // Import/Export
  // ==========================================================================

  /**
   * Export states with options
   */
  exportStates(
    stateIds: string[],
    includeGroups = false,
    includeImages = false
  ): ExportData {
    return this.bulkExport(stateIds, {
      includeGroups,
      includeImages,
      includeTags: true,
      includeMetadata: true,
    });
  }

  /**
   * Import states
   */
  importStates(data: ExportData, options?: ImportOptions): BulkOperationResult {
    const result: BulkOperationResult = {
      success: true,
      processedCount: 0,
      failedCount: 0,
      errors: [],
      warnings: [],
    };

    try {
      // Import groups first if included
      if (data.groups && options?.merge !== false) {
        for (const group of data.groups) {
          if (!this.groups.has(group.id) || options?.overwriteExisting) {
            this.groups.set(group.id, group);
          }
        }
      }

      // Import metadata
      for (const [stateId, metadata] of Object.entries(data.metadata)) {
        if (!this.metadata.has(stateId) || options?.overwriteExisting) {
          this.metadata.set(stateId, metadata);
        }
      }

      // Import associations
      if (data.associations) {
        for (const association of data.associations) {
          const exists = this.associations.some(
            (a) =>
              a.stateId === association.stateId &&
              a.groupId === association.groupId
          );

          if (!exists || options?.overwriteExisting) {
            if (!exists) {
              this.associations.push(association);
            }
          }
        }
      }

      result.processedCount = data.states.length;
      this.save();
    } catch (error) {
      result.success = false;
      result.failedCount = data.states.length;
      result.errors.push({
        stateId: "import",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return result;
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Initialize built-in templates
   */
  private initializeBuiltInTemplates(): void {
    const builtInTemplates: Array<{
      name: string;
      config: StateTemplateConfig;
    }> = [
      {
        name: "Login Page",
        config: {
          defaultDescription:
            "Login page with username, password, and submit button",
          stateImages: [
            {
              name: "Username Field",
              placeholder: true,
              patterns: 1,
              shared: false,
            },
            {
              name: "Password Field",
              placeholder: true,
              patterns: 1,
              shared: false,
            },
            {
              name: "Login Button",
              placeholder: true,
              patterns: 2, // normal + hover
              shared: false,
            },
          ],
          regions: [
            {
              name: "Form Area",
              x: 0,
              y: 0,
              width: 400,
              height: 300,
              isSearchRegion: true,
            },
          ],
          locations: [
            {
              name: "Username Click",
              x: 200,
              y: 100,
              fixed: false,
              anchor: false,
            },
            {
              name: "Password Click",
              x: 200,
              y: 150,
              fixed: false,
              anchor: false,
            },
            {
              name: "Submit Click",
              x: 200,
              y: 200,
              fixed: false,
              anchor: false,
            },
          ],
          strings: [
            { name: "Username", value: "", inputText: true },
            { name: "Password", value: "", inputText: true },
          ],
        },
      },
      {
        name: "Navigation Menu",
        config: {
          defaultDescription: "Standard navigation menu with multiple items",
          stateImages: [
            { name: "Menu Icon", placeholder: true, patterns: 2, shared: true },
            {
              name: "Menu Item 1",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
            {
              name: "Menu Item 2",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
            {
              name: "Menu Item 3",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
          ],
          regions: [
            {
              name: "Menu Bar",
              x: 0,
              y: 0,
              width: 200,
              height: 400,
              isSearchRegion: true,
            },
          ],
          locations: [
            { name: "Menu Toggle", x: 20, y: 20, fixed: true, anchor: true },
          ],
          strings: [],
        },
      },
      {
        name: "Form Page",
        config: {
          defaultDescription:
            "Form with multiple input fields and submit button",
          stateImages: [
            { name: "Field 1", placeholder: true, patterns: 1, shared: false },
            { name: "Field 2", placeholder: true, patterns: 1, shared: false },
            { name: "Field 3", placeholder: true, patterns: 1, shared: false },
            {
              name: "Submit Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
            {
              name: "Cancel Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
          ],
          regions: [
            {
              name: "Form Container",
              x: 0,
              y: 0,
              width: 500,
              height: 400,
              isSearchRegion: true,
            },
          ],
          locations: [
            {
              name: "Field 1 Click",
              x: 250,
              y: 100,
              fixed: false,
              anchor: false,
            },
            {
              name: "Field 2 Click",
              x: 250,
              y: 150,
              fixed: false,
              anchor: false,
            },
            {
              name: "Field 3 Click",
              x: 250,
              y: 200,
              fixed: false,
              anchor: false,
            },
            {
              name: "Submit Click",
              x: 200,
              y: 300,
              fixed: false,
              anchor: false,
            },
            {
              name: "Cancel Click",
              x: 300,
              y: 300,
              fixed: false,
              anchor: false,
            },
          ],
          strings: [],
        },
      },
      {
        name: "Dialog/Modal",
        config: {
          defaultDescription:
            "Modal dialog with title, content, and action buttons",
          stateImages: [
            {
              name: "Dialog Background",
              placeholder: true,
              patterns: 1,
              shared: false,
            },
            {
              name: "Close Button",
              placeholder: true,
              patterns: 2,
              shared: true,
            },
            {
              name: "OK Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
            {
              name: "Cancel Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
          ],
          regions: [
            {
              name: "Dialog Area",
              x: 0,
              y: 0,
              width: 400,
              height: 250,
              isSearchRegion: true,
            },
            {
              name: "Title Bar",
              x: 0,
              y: 0,
              width: 400,
              height: 50,
              isSearchRegion: false,
            },
          ],
          locations: [
            { name: "Close X", x: 380, y: 10, fixed: false, anchor: false },
            { name: "OK Click", x: 250, y: 220, fixed: false, anchor: false },
            {
              name: "Cancel Click",
              x: 150,
              y: 220,
              fixed: false,
              anchor: false,
            },
          ],
          strings: [{ name: "Dialog Title", value: "", expectedText: true }],
        },
      },
      {
        name: "Error Page",
        config: {
          defaultDescription: "Error state with message and retry/back options",
          stateImages: [
            {
              name: "Error Icon",
              placeholder: true,
              patterns: 1,
              shared: true,
            },
            {
              name: "Retry Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
            {
              name: "Back Button",
              placeholder: true,
              patterns: 2,
              shared: false,
            },
          ],
          regions: [
            {
              name: "Error Container",
              x: 0,
              y: 0,
              width: 500,
              height: 300,
              isSearchRegion: true,
            },
          ],
          locations: [
            {
              name: "Retry Click",
              x: 250,
              y: 220,
              fixed: false,
              anchor: false,
            },
            { name: "Back Click", x: 250, y: 260, fixed: false, anchor: false },
          ],
          strings: [{ name: "Error Message", value: "", expectedText: true }],
        },
      },
    ];

    for (const { name, config } of builtInTemplates) {
      const template: StateTemplate = {
        id: this.generateId("template"),
        name,
        description: config.defaultDescription,
        category: "built-in",
        icon: this.getTemplateIcon(name),
        config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.templates.set(template.id, template);
    }
  }

  /**
   * Get icon for template
   */
  private getTemplateIcon(templateName: string): string {
    const iconMap: Record<string, string> = {
      "Login Page": "lock",
      "Navigation Menu": "menu",
      "Form Page": "document",
      "Dialog/Modal": "window",
      "Error Page": "exclamation",
    };
    return iconMap[templateName] || "template";
  }

  /**
   * Create StateImage from template
   */
  private createStateImageFromTemplate(template: { name: string; patterns: number; shared: boolean; searchRegions?: unknown[] }): StateImage {
    return {
      id: this.generateId("image"),
      name: template.name,
      patterns: Array.from({ length: template.patterns }, (_, i) => ({
        id: this.generateId("pattern"),
        name: `Pattern ${i + 1}`,
        searchRegions: [],
        fixed: false,
      })),
      shared: template.shared,
      searchRegions:
        (template.searchRegions?.map((sr: unknown) => ({
          id: this.generateId("searchregion"),
          ...(sr as object),
        })) as SearchRegion[]) || [],
    };
  }

  /**
   * Create StateRegion from template
   */
  private createRegionFromTemplate(template: RegionTemplate): StateRegion {
    return {
      id: this.generateId("region"),
      ...template,
    };
  }

  /**
   * Create StateLocation from template
   */
  private createLocationFromTemplate(
    template: LocationTemplate
  ): StateLocation {
    return {
      id: this.generateId("location"),
      ...template,
    };
  }

  /**
   * Create StateString from template
   */
  private createStringFromTemplate(template: StringTemplate): StateString {
    return {
      id: this.generateId("string"),
      ...template,
    };
  }

  /**
   * Check if state matches filters
   */
  private matchesFilters(
    state: State,
    metadata: StateMetadata,
    filters?: StateSearchFilter
  ): boolean {
    if (!filters) return true;

    // Group filter
    if (filters.groups && filters.groups.length > 0) {
      const association = this.associations.find((a) => a.stateId === state.id);
      if (!association || !filters.groups.includes(association.groupId)) {
        return false;
      }
    }

    // Tag filter
    if (filters.tags && filters.tags.length > 0) {
      const hasTag = filters.tags.some((tag) => metadata.tags.includes(tag));
      if (!hasTag) return false;
    }

    // Has images filter
    if (filters.hasImages !== undefined) {
      const hasImages = state.stateImages.length > 0;
      if (hasImages !== filters.hasImages) return false;
    }

    // Has transitions filter
    if (filters.hasTransitions !== undefined) {
      const hasTransitions = this.transitions.some(
        (t) =>
          (t.type === "OutgoingTransition" &&
            (t as OutgoingTransition).fromState === state.id) ||
          t.toState === state.id
      );
      if (hasTransitions !== filters.hasTransitions) return false;
    }

    // Complexity filter
    if (
      filters.complexityMin !== undefined ||
      filters.complexityMax !== undefined
    ) {
      const complexity = this.analyzeStateComplexity(state.id);
      if (complexity) {
        if (
          filters.complexityMin !== undefined &&
          complexity.complexityScore < filters.complexityMin
        ) {
          return false;
        }
        if (
          filters.complexityMax !== undefined &&
          complexity.complexityScore > filters.complexityMax
        ) {
          return false;
        }
      }
    }

    // Image usage filter
    if (filters.imageId) {
      const usesImage = state.stateImages.some((img) =>
        img.patterns.some((p) => p.imageId === filters.imageId)
      );
      if (!usesImage) return false;
    }

    return true;
  }

  /**
   * Calculate similarity between two states
   */
  private calculateStateSimilarity(
    state1: State,
    state2: State
  ): StateSimilarity {
    const images1 = new Set(
      state1.stateImages.flatMap((img) => img.patterns.map((p) => p.imageId))
    );
    const images2 = new Set(
      state2.stateImages.flatMap((img) => img.patterns.map((p) => p.imageId))
    );

    const commonImages = Array.from(images1).filter((id) =>
      images2.has(id)
    ).length;
    const totalImages = Math.max(images1.size, images2.size);

    const commonRegions = Math.min(
      state1.regions.length,
      state2.regions.length
    );
    const totalRegions = Math.max(state1.regions.length, state2.regions.length);

    const commonLocations = Math.min(
      state1.locations.length,
      state2.locations.length
    );
    const totalLocations = Math.max(
      state1.locations.length,
      state2.locations.length
    );

    // Weighted similarity score
    const imageScore = totalImages > 0 ? (commonImages / totalImages) * 50 : 0;
    const regionScore =
      totalRegions > 0 ? (commonRegions / totalRegions) * 30 : 0;
    const locationScore =
      totalLocations > 0 ? (commonLocations / totalLocations) * 20 : 0;

    return {
      stateId: state2.id,
      stateName: state2.name,
      similarityScore: imageScore + regionScore + locationScore,
      commonImages,
      commonRegions,
      commonLocations,
    };
  }

  /**
   * Find similar states
   */
  private findSimilarStates(
    state: State,
    threshold: number
  ): StateSimilarity[] {
    const similar: StateSimilarity[] = [];

    for (const otherState of this.states) {
      if (state.id === otherState.id) continue;

      const similarity = this.calculateStateSimilarity(state, otherState);
      if (similarity.similarityScore >= threshold * 100) {
        similar.push(similarity);
      }
    }

    return similar.sort((a, b) => b.similarityScore - a.similarityScore);
  }

  /**
   * Get image usage for a state
   */
  private getStateImageUsage(state: State): StateImageUsage[] {
    const usage: StateImageUsage[] = [];

    for (const stateImage of state.stateImages) {
      const imageIds = stateImage.patterns
        .map((p) => p.imageId)
        .filter((id): id is string => id !== undefined);

      for (const imageId of imageIds) {
        // Count how many states use this image
        const usedInStates = this.states.filter((s) =>
          s.stateImages.some((img) =>
            img.patterns.some((p) => p.imageId === imageId)
          )
        ).length;

        usage.push({
          imageId,
          imageName: stateImage.name,
          patternCount: stateImage.patterns.length,
          usedInStates,
          sharedImage: stateImage.shared,
        });
      }
    }

    return usage;
  }

  /**
   * Analyze state issues
   */
  private analyzeStateIssues(
    state: State,
    complexity: StateComplexity | null,
    relationships: StateRelationship | null
  ): StateIssue[] {
    const issues: StateIssue[] = [];

    // Check for orphaned state
    if (
      relationships &&
      relationships.incoming.length === 0 &&
      relationships.outgoing.length === 0
    ) {
      issues.push({
        type: "warning",
        category: "orphaned",
        message: "State has no transitions",
        suggestion: "Add transitions to connect this state to your workflow",
      });
    }

    // Check for dead-end state
    if (
      relationships &&
      relationships.outgoing.length === 0 &&
      relationships.incoming.length > 0
    ) {
      issues.push({
        type: "info",
        category: "dead-end",
        message: "State has no outgoing transitions",
        suggestion:
          "Consider adding transitions to other states or mark as final state",
      });
    }

    // Check for no images
    if (state.stateImages.length === 0) {
      issues.push({
        type: "warning",
        category: "no-images",
        message: "State has no images",
        suggestion: "Add state images for visual recognition",
      });
    }

    // Check for high complexity
    if (complexity && complexity.level === "very-complex") {
      issues.push({
        type: "warning",
        category: "high-complexity",
        message: `High complexity state (score: ${complexity.complexityScore})`,
        suggestion: "Consider breaking this state into smaller, simpler states",
      });
    }

    return issues;
  }

  /**
   * Get state name by ID
   */
  private getStateName(stateId: string): string {
    const state = this.states.find((s) => s.id === stateId);
    return state?.name || "Unknown";
  }

  /**
   * Generate unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get children of a group
   */
  private getChildren(parentId: string | null): StateGroup[] {
    return Array.from(this.groups.values())
      .filter((g) => g.parentId === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /**
   * Get next order number for a parent
   */
  private getNextOrder(parentId: string | null): number {
    const children = this.getChildren(parentId);
    if (children.length === 0) return 0;

    const maxOrder = Math.max(...children.map((c) => c.order ?? 0));
    return maxOrder + 1;
  }

  /**
   * Get all descendants of a group
   */
  private getGroupDescendants(groupId: string): StateGroup[] {
    const descendants: StateGroup[] = [];
    const children = this.getChildren(groupId);

    for (const child of children) {
      descendants.push(child);
      descendants.push(...this.getGroupDescendants(child.id));
    }

    return descendants;
  }

  /**
   * Build group tree
   */
  private buildGroupTree(rootId: string | null, depth = 0): GroupTreeNode[] {
    const children = this.getChildren(rootId);

    return children.map((group) => {
      const path: string[] = [];
      let currentId: string | null = group.id;

      while (currentId) {
        const g = this.groups.get(currentId);
        if (!g) break;
        path.unshift(g.name);
        currentId = g.parentId;
      }

      const node: GroupTreeNode = {
        ...group,
        children: this.buildGroupTree(group.id, depth + 1),
        depth,
        path,
        hasChildren: this.getChildren(group.id).length > 0,
        description: group.description || undefined,
      };

      return node;
    });
  }

  /**
   * Update state counts for a group and its ancestors
   */
  private updateStateCounts(groupId: string | null): void {
    if (!groupId) return;

    const group = this.groups.get(groupId);
    if (!group) return;

    // Count states in this group
    const count = this.associations.filter((a) => a.groupId === groupId).length;

    group.metadata.stateCount = count;
    group.metadata.updated = new Date().toISOString();

    // Update parent
    if (group.parentId) {
      this.updateStateCounts(group.parentId);
    }
  }

  /**
   * Update descendant counts for a group and its ancestors
   */
  private updateDescendantCounts(groupId: string | null): void {
    if (!groupId) return;

    const group = this.groups.get(groupId);
    if (!group) return;

    // Count descendants
    const descendants = this.getGroupDescendants(groupId);
    group.metadata.descendantCount = descendants.length;
    group.metadata.updated = new Date().toISOString();

    // Update parent
    if (group.parentId) {
      this.updateDescendantCounts(group.parentId);
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Save to localStorage
   */
  private save(): void {
    if (!this.autoSaveEnabled) return;

    try {
      const data: StateOrganizationStorage = {
        groups: Object.fromEntries(this.groups),
        associations: this.associations,
        metadata: Object.fromEntries(this.metadata),
        templates: Object.fromEntries(
          Array.from(this.templates.entries()).filter(
            ([_, t]) => t.category === "custom"
          )
        ),
        version: STORAGE_VERSION,
        lastModified: new Date().toISOString(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save state organization to storage:", error);
    }
  }

  /**
   * Load from localStorage
   */
  private loadFromStorage(): void {
    try {
      const json = localStorage.getItem(STORAGE_KEY);
      if (!json) return;

      const data: StateOrganizationStorage = JSON.parse(json);

      // Validate version
      if (data.version !== STORAGE_VERSION) {
        console.warn(
          `Storage version mismatch. Expected ${STORAGE_VERSION}, got ${data.version}`
        );
      }

      // Load data
      this.groups = new Map(Object.entries(data.groups || {}));
      this.associations = data.associations || [];
      this.metadata = new Map(Object.entries(data.metadata || {}));

      // Load custom templates (built-in templates are initialized separately)
      const customTemplates = new Map(Object.entries(data.templates || {}));
      for (const [id, template] of customTemplates) {
        if (template.category === "custom") {
          this.templates.set(id, template);
        }
      }
    } catch (error) {
      console.error("Failed to load state organization from storage:", error);
    }
  }

  /**
   * Clear all data
   */
  clearAll(): void {
    this.groups.clear();
    this.associations = [];
    this.metadata.clear();
    // Keep built-in templates, only clear custom ones
    for (const [id, template] of this.templates) {
      if (template.category === "custom") {
        this.templates.delete(id);
      }
    }
    this.save();
  }

  /**
   * Enable/disable auto-save
   */
  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
  }
}

// ============================================================================
// Exports
// ============================================================================

export const stateOrganizationService = StateOrganizationService.getInstance();
