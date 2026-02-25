import type {
  Transition,
  OutgoingTransition,
  IncomingTransition,
  State,
  TransitionTemplate,
  TransitionGroup,
  TransitionFilter,
  ValidationIssue,
  ValidationReport,
  TransitionStatistics,
  TransitionMatrix,
  CircularPath,
  TransitionPattern,
  RedundantTransition,
  OptimizationSuggestion,
  BulkOperationResult,
  ImportExportOptions,
} from "./types";

import { TemplateManager } from "./template-manager";
import { GroupManager } from "./group-manager";
import {
  validateTransitions,
  validateTransition,
  checkForConflicts,
  validateTransitionGraph,
} from "./validator";
import {
  findCircularTransitions,
  findUnreachableStates,
  getTransitionStatistics,
  searchTransitions,
  getTransitionsForState,
  getTransitionsByPattern,
  generateTransitionMatrix,
  exportTransitionMatrix,
} from "./analyzer";
import {
  findRedundantTransitions,
  suggestMergableTransitions,
  optimizeTransitionOrder,
} from "./optimizer";

export type {
  Transition,
  OutgoingTransition,
  IncomingTransition,
  State,
  TransitionTemplate,
  TransitionGroup,
  TransitionFilter,
  ValidationIssue,
  ValidationReport,
  TransitionStatistics,
  TransitionMatrix,
  CircularPath,
  TransitionPattern,
  RedundantTransition,
  OptimizationSuggestion,
  BulkOperationResult,
  ImportExportOptions,
} from "./types";

export { TemplateManager } from "./template-manager";
export { GroupManager } from "./group-manager";
export {
  validateTransitions,
  validateTransition,
  checkForConflicts,
  validateTransitionGraph,
  getValidationReport,
} from "./validator";
export {
  buildTransitionGraph,
  findCircularTransitions,
  findUnreachableStates,
  getTransitionStatistics,
  searchTransitions,
  getTransitionsForState,
  getTransitionsByPattern,
  generateTransitionMatrix,
  exportTransitionMatrix,
} from "./analyzer";
export {
  findRedundantTransitions,
  suggestMergableTransitions,
  optimizeTransitionOrder,
} from "./optimizer";

export class TransitionOrganizationService {
  private static instance: TransitionOrganizationService;
  private templateManager: TemplateManager;
  private groupManager: GroupManager;
  private transitionMetadata: Map<string, unknown> = new Map();

  private constructor() {
    this.templateManager = new TemplateManager();
    this.groupManager = new GroupManager();
    this.loadMetadata();
  }

  static getInstance(): TransitionOrganizationService {
    if (!TransitionOrganizationService.instance) {
      TransitionOrganizationService.instance =
        new TransitionOrganizationService();
    }
    return TransitionOrganizationService.instance;
  }

  // ==========================================================================
  // Transition Templates
  // ==========================================================================

  createTransitionTemplate(
    name: string,
    config: TransitionTemplate["config"],
    options: {
      description?: string;
      category?: TransitionTemplate["category"];
      tags?: string[];
      icon?: string;
    } = {}
  ): TransitionTemplate {
    return this.templateManager.createTransitionTemplate(name, config, options);
  }

  getTemplate(id: string): TransitionTemplate | undefined {
    return this.templateManager.getTemplate(id);
  }

  getAllTemplates(): TransitionTemplate[] {
    return this.templateManager.getAllTemplates();
  }

  getTemplatesByCategory(
    category: TransitionTemplate["category"]
  ): TransitionTemplate[] {
    return this.templateManager.getTemplatesByCategory(category);
  }

  createFromTemplate(
    templateId: string,
    fromStateId: string,
    toStateId?: string,
    customConfig?: Partial<TransitionTemplate["config"]>
  ): Transition | null {
    return this.templateManager.createFromTemplate(
      templateId,
      fromStateId,
      toStateId,
      customConfig
    );
  }

  deleteTemplate(id: string): boolean {
    return this.templateManager.deleteTemplate(id);
  }

  // ==========================================================================
  // Bulk Transition Operations
  // ==========================================================================

  bulkCreateTransitions(
    fromStateIds: string[],
    toStateId: string,
    template: string | TransitionTemplate["config"]
  ): BulkOperationResult {
    const result: BulkOperationResult = {
      success: 0,
      failed: 0,
      successIds: [],
      failures: [],
      timestamp: new Date().toISOString(),
    };

    const config =
      typeof template === "string"
        ? this.templateManager.getTemplate(template)?.config
        : template;

    if (!config) {
      result.failed = fromStateIds.length;
      result.failures = fromStateIds.map((id) => ({
        id,
        reason: "Invalid template or configuration",
      }));
      return result;
    }

    for (const fromStateId of fromStateIds) {
      try {
        const transition =
          typeof template === "string"
            ? this.createFromTemplate(template, fromStateId, toStateId)
            : this.createFromTemplate("custom", fromStateId, toStateId, config);

        if (transition) {
          result.success++;
          result.successIds.push(transition.id);
        } else {
          result.failed++;
          result.failures.push({
            id: fromStateId,
            reason: "Failed to create transition",
          });
        }
      } catch (error) {
        result.failed++;
        result.failures.push({
          id: fromStateId,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return result;
  }

  createTransitionMatrix(
    stateIds: string[],
    rules: {
      allToAll?: boolean;
      excludeSelfLoops?: boolean;
      pattern?: "linear" | "circular" | "star" | "custom";
      customRules?: Array<{ from: string; to: string }>;
      template: string | TransitionTemplate["config"];
    }
  ): BulkOperationResult {
    const result: BulkOperationResult = {
      success: 0,
      failed: 0,
      successIds: [],
      failures: [],
      timestamp: new Date().toISOString(),
    };

    const connections: Array<{ from: string; to: string }> = [];

    if (rules.allToAll) {
      for (const from of stateIds) {
        for (const to of stateIds) {
          if (rules.excludeSelfLoops && from === to) continue;
          connections.push({ from, to });
        }
      }
    } else if (rules.pattern === "linear") {
      for (let i = 0; i < stateIds.length - 1; i++) {
        connections.push({ from: stateIds[i]!, to: stateIds[i + 1]! });
      }
    } else if (rules.pattern === "circular") {
      for (let i = 0; i < stateIds.length; i++) {
        connections.push({
          from: stateIds[i]!,
          to: stateIds[(i + 1) % stateIds.length]!,
        });
      }
    } else if (rules.pattern === "star") {
      const hub = stateIds[0]!;
      for (let i = 1; i < stateIds.length; i++) {
        connections.push({ from: hub, to: stateIds[i]! });
        connections.push({ from: stateIds[i]!, to: hub });
      }
    } else if (rules.customRules) {
      connections.push(...rules.customRules);
    }

    for (const { from, to } of connections) {
      const bulkResult = this.bulkCreateTransitions([from], to, rules.template);
      result.success += bulkResult.success;
      result.failed += bulkResult.failed;
      result.successIds.push(...bulkResult.successIds);
      result.failures.push(...bulkResult.failures);
    }

    return result;
  }

  bulkUpdateTransitions(
    transitionIds: string[],
    updates: Partial<Transition>,
    transitions: Transition[]
  ): BulkOperationResult {
    const result: BulkOperationResult = {
      success: 0,
      failed: 0,
      successIds: [],
      failures: [],
      timestamp: new Date().toISOString(),
    };

    for (const id of transitionIds) {
      const transition = transitions.find((t) => t.id === id);
      if (!transition) {
        result.failed++;
        result.failures.push({ id, reason: "Transition not found" });
        continue;
      }

      try {
        Object.assign(transition, updates);
        result.success++;
        result.successIds.push(id);
      } catch (error) {
        result.failed++;
        result.failures.push({
          id,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return result;
  }

  bulkDeleteTransitions(
    transitionIds: string[],
    transitions: Transition[]
  ): BulkOperationResult {
    const result: BulkOperationResult = {
      success: 0,
      failed: 0,
      successIds: [],
      failures: [],
      timestamp: new Date().toISOString(),
    };

    for (const id of transitionIds) {
      const index = transitions.findIndex((t) => t.id === id);
      if (index === -1) {
        result.failed++;
        result.failures.push({ id, reason: "Transition not found" });
        continue;
      }

      try {
        transitions.splice(index, 1);
        result.success++;
        result.successIds.push(id);
      } catch (error) {
        result.failed++;
        result.failures.push({
          id,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return result;
  }

  // ==========================================================================
  // Transition Analysis
  // ==========================================================================

  validateTransitions(
    transitions: Transition[],
    states: State[],
    workflows: { id: string }[]
  ): ValidationReport {
    return validateTransitions(transitions, states, workflows);
  }

  findCircularTransitions(transitions: Transition[]): CircularPath[] {
    return findCircularTransitions(transitions);
  }

  findUnreachableStates(transitions: Transition[], states: State[]): string[] {
    return findUnreachableStates(transitions, states);
  }

  getTransitionStatistics(
    transitions: Transition[],
    states: State[]
  ): TransitionStatistics {
    return getTransitionStatistics(
      transitions,
      states,
      this.groupManager.getAllGroups()
    );
  }

  // ==========================================================================
  // Transition Search and Filter
  // ==========================================================================

  searchTransitions(
    transitions: Transition[],
    query: string,
    filters?: TransitionFilter
  ): Transition[] {
    return searchTransitions(
      transitions,
      query,
      filters,
      (id: string) => this.getTransitionMetadata(id),
      (id: string) => this.groupManager.getGroup(id)
    );
  }

  getTransitionsForState(
    transitions: Transition[],
    stateId: string,
    direction: "incoming" | "outgoing" | "both" = "both"
  ): Transition[] {
    return getTransitionsForState(transitions, stateId, direction);
  }

  getTransitionsByPattern(
    transitions: Transition[],
    pattern: TransitionPattern
  ): Transition[] {
    return getTransitionsByPattern(transitions, pattern);
  }

  // ==========================================================================
  // Transition Validation
  // ==========================================================================

  validateTransition(
    transition: Transition,
    states: State[],
    workflows: { id: string }[]
  ): ValidationIssue[] {
    return validateTransition(transition, states, workflows);
  }

  checkForConflicts(
    transition: Transition,
    allTransitions: Transition[]
  ): ValidationIssue[] {
    return checkForConflicts(transition, allTransitions);
  }

  validateTransitionGraph(
    transitions: Transition[],
    states: State[],
    workflows: { id: string }[]
  ): ValidationReport {
    return validateTransitionGraph(
      transitions,
      states,
      workflows,
      findCircularTransitions,
      findUnreachableStates
    );
  }

  getValidationReport(
    transitions: Transition[],
    states: State[],
    workflows: { id: string }[]
  ): ValidationReport {
    return this.validateTransitionGraph(transitions, states, workflows);
  }

  // ==========================================================================
  // Transition Groups
  // ==========================================================================

  createTransitionGroup(
    name: string,
    transitionIds: string[],
    options: {
      description?: string;
      color?: string;
      tags?: string[];
      enabled?: boolean;
    } = {}
  ): TransitionGroup {
    return this.groupManager.createTransitionGroup(
      name,
      transitionIds,
      options
    );
  }

  getGroup(id: string): TransitionGroup | undefined {
    return this.groupManager.getGroup(id);
  }

  getAllGroups(): TransitionGroup[] {
    return this.groupManager.getAllGroups();
  }

  updateGroup(id: string, updates: Partial<TransitionGroup>): boolean {
    return this.groupManager.updateGroup(id, updates);
  }

  deleteGroup(id: string): boolean {
    return this.groupManager.deleteGroup(id);
  }

  addToGroup(groupId: string, transitionIds: string[]): boolean {
    return this.groupManager.addToGroup(groupId, transitionIds);
  }

  removeFromGroup(groupId: string, transitionIds: string[]): boolean {
    return this.groupManager.removeFromGroup(groupId, transitionIds);
  }

  toggleGroupEnabled(groupId: string, enabled: boolean): boolean {
    return this.groupManager.toggleGroupEnabled(groupId, enabled);
  }

  getGroupsForTransition(transitionId: string): TransitionGroup[] {
    return this.groupManager.getGroupsForTransition(transitionId);
  }

  // ==========================================================================
  // Import/Export
  // ==========================================================================

  exportTransitions(
    transitions: Transition[],
    transitionIds: string[],
    states: State[],
    workflows: { id: string; name: string }[],
    options: ImportExportOptions = {}
  ): string {
    const selectedTransitions = transitions.filter((t) =>
      transitionIds.includes(t.id)
    );

    const exportData: unknown = {
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      transitions: selectedTransitions,
    };

    if (options.includeStates) {
      const stateIds = new Set<string>();
      for (const transition of selectedTransitions) {
        if (transition.type === "OutgoingTransition") {
          const outgoing = transition as OutgoingTransition;
          stateIds.add(outgoing.fromState);
          if (outgoing.toState) stateIds.add(outgoing.toState);
          outgoing.activateStates.forEach((id) => stateIds.add(id));
          outgoing.deactivateStates.forEach((id) => stateIds.add(id));
        } else {
          const incoming = transition as IncomingTransition;
          stateIds.add(incoming.toState);
        }
      }
      (exportData as { states?: State[] }).states = states.filter((s) =>
        stateIds.has(s.id)
      );
    }

    if (options.includeWorkflows) {
      const workflowIds = new Set<string>();
      for (const transition of selectedTransitions) {
        transition.workflows.forEach((id) => workflowIds.add(id));
      }
      (exportData as { workflows?: unknown[] }).workflows = workflows.filter(
        (w) => workflowIds.has(w.id)
      );
    }

    if (options.includeGroups) {
      (exportData as { groups?: TransitionGroup[] }).groups = this.groupManager
        .getAllGroups()
        .filter((g) =>
          g.transitionIds.some((id) => transitionIds.includes(id))
        );
    }

    if (options.includeMetadata) {
      (exportData as { metadata?: Record<string, unknown> }).metadata =
        Object.fromEntries(
          Array.from(this.transitionMetadata.entries()).filter(([id]) =>
            transitionIds.includes(id)
          )
        );
    }

    return JSON.stringify(exportData, null, 2);
  }

  importTransitions(
    data: string,
    options: ImportExportOptions = {}
  ): {
    transitions: Transition[];
    states?: State[];
    groups?: TransitionGroup[];
  } | null {
    try {
      const importData = JSON.parse(data);

      if (options.validate) {
        if (!importData.transitions || !Array.isArray(importData.transitions)) {
          console.error("Invalid import data: missing transitions array");
          return null;
        }
      }

      const importDataObj = importData as {
        transitions?: Transition[];
        states?: State[];
        groups?: TransitionGroup[];
        metadata?: Record<string, unknown>;
      };

      const result: {
        transitions: Transition[];
        states?: State[];
        groups?: TransitionGroup[];
      } = {
        transitions: [],
      };

      if (importDataObj.transitions) {
        for (const transition of importDataObj.transitions) {
          const existingIndex = result.transitions.findIndex(
            (t: Transition) => t.id === transition.id
          );

          if (existingIndex !== -1) {
            if (options.skipDuplicates) {
              continue;
            } else if (options.mergeStrategy === "replace") {
              result.transitions[existingIndex] = transition;
            } else if (options.mergeStrategy === "rename") {
              transition.id = `${transition.id}-imported-${Date.now()}`;
              result.transitions.push(transition);
            }
          } else {
            result.transitions.push(transition);
          }
        }
      }

      if (importDataObj.states && options.includeStates) {
        result.states = importDataObj.states;
      }

      if (importDataObj.groups && options.includeGroups) {
        result.groups = importDataObj.groups;
        for (const group of importDataObj.groups) {
          if (!this.groupManager.updateGroup(group.id, group)) {
            this.groupManager.createTransitionGroup(
              group.name,
              group.transitionIds,
              {
                description: group.description,
                color: group.color,
                tags: group.tags,
                enabled: group.enabled,
              }
            );
          }
        }
      }

      if (importDataObj.metadata && options.includeMetadata) {
        for (const [id, metadata] of Object.entries(importDataObj.metadata)) {
          this.transitionMetadata.set(id, metadata);
        }
        this.saveMetadata();
      }

      return result;
    } catch (error) {
      console.error("Failed to import transitions:", error);
      return null;
    }
  }

  exportTransitionMatrix(transitions: Transition[], states: State[]): string {
    return exportTransitionMatrix(transitions, states);
  }

  generateTransitionMatrix(
    transitions: Transition[],
    states: State[]
  ): TransitionMatrix {
    return generateTransitionMatrix(transitions, states);
  }

  // ==========================================================================
  // Optimization
  // ==========================================================================

  findRedundantTransitions(transitions: Transition[]): RedundantTransition[] {
    return findRedundantTransitions(transitions);
  }

  suggestMergableTransitions(
    transitions: Transition[]
  ): OptimizationSuggestion[] {
    return suggestMergableTransitions(transitions);
  }

  optimizeTransitionOrder(
    transitions: Transition[],
    _states: State[]
  ): OptimizationSuggestion[] {
    return optimizeTransitionOrder(
      transitions,
      _states,
      (transitionId: string) =>
        this.groupManager.getGroupsForTransition(transitionId)
    );
  }

  // ==========================================================================
  // Metadata
  // ==========================================================================

  setTransitionMetadata(transitionId: string, metadata: unknown): void {
    this.transitionMetadata.set(transitionId, metadata);
    this.saveMetadata();
  }

  private getTransitionMetadata(transitionId: string): unknown {
    return this.transitionMetadata.get(transitionId);
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  private loadMetadata(): void {
    try {
      const json = localStorage.getItem("transition-metadata");
      if (json) {
        const data = JSON.parse(json);
        Object.entries(data).forEach(([id, metadata]) => {
          this.transitionMetadata.set(id, metadata);
        });
      }
    } catch (error) {
      console.error("Failed to load transition metadata:", error);
    }
  }

  private saveMetadata(): void {
    try {
      const data: Record<string, unknown> = {};
      this.transitionMetadata.forEach((metadata, id) => {
        data[id] = metadata;
      });
      localStorage.setItem("transition-metadata", JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save transition metadata:", error);
    }
  }

  // ==========================================================================
  // Clear
  // ==========================================================================

  clearCustomData(): void {
    // Templates: keep built-ins handled by TemplateManager
    // We need to delete all custom templates
    const allTemplates = this.templateManager.getAllTemplates();
    for (const t of allTemplates) {
      if (!t.builtin) {
        this.templateManager.deleteTemplate(t.id);
      }
    }

    // Clear all groups
    this.groupManager.clearGroups();

    // Clear all metadata
    this.transitionMetadata.clear();
    this.saveMetadata();
  }
}

export const transitionOrganization =
  TransitionOrganizationService.getInstance();

export default TransitionOrganizationService;
