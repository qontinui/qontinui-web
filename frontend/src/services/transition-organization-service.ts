/**
 * Transition Organization Service
 *
 * Comprehensive transition management system for large automation projects.
 * Provides templates, bulk operations, analysis, validation, and organization features.
 *
 * Features:
 * - Pre-built transition templates (Click Button, Form Submit, Navigation, etc.)
 * - Bulk creation, update, and deletion operations
 * - Transition analysis and validation
 * - Advanced search and filtering
 * - Transition groups for organization
 * - Import/Export capabilities
 * - Optimization suggestions
 *
 * Storage:
 * - 'transition-templates': Custom transition templates
 * - 'transition-groups': Transition group definitions
 * - 'transition-metadata': Extended metadata for transitions
 */

import {
  Transition,
  OutgoingTransition,
  IncomingTransition,
  State,
} from '@/contexts/automation-context/types';

// ============================================================================
// Types
// ============================================================================

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
  category: 'interaction' | 'navigation' | 'conditional' | 'error-handling' | 'automation' | 'custom';

  /** Template icon */
  icon?: string;

  /** Whether this is a built-in template */
  builtin: boolean;

  /** Template configuration */
  config: {
    /** Transition type */
    type: 'OutgoingTransition' | 'IncomingTransition';

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
    [key: string]: any;
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
    [key: string]: any;
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
  type?: 'OutgoingTransition' | 'IncomingTransition';

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
  severity: 'error' | 'warning' | 'info';

  /** Issue type */
  type: 'broken-reference' | 'circular-path' | 'unreachable' | 'duplicate' | 'conflict' | 'missing-workflow' | 'timeout' | 'configuration';

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
  topStates: Array<{ stateId: string; incomingCount: number; outgoingCount: number }>;

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
    coverage: number; // Percentage of possible connections
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
  type: 'workflow-sequence' | 'timeout-pattern' | 'state-activation' | 'error-handling' | 'custom';

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
  reason: 'exact-duplicate' | 'similar-config' | 'same-path' | 'subsumes';

  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Optimization suggestion
 */
export interface OptimizationSuggestion {
  /** Suggestion type */
  type: 'merge' | 'remove' | 'reorder' | 'simplify' | 'add-group' | 'timeout-adjustment';

  /** Suggestion description */
  description: string;

  /** Affected transition IDs */
  transitionIds: string[];

  /** Expected impact */
  impact: 'high' | 'medium' | 'low';

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
  mergeStrategy?: 'replace' | 'skip' | 'rename';
}

// ============================================================================
// Transition Organization Service
// ============================================================================

export class TransitionOrganizationService {
  private static instance: TransitionOrganizationService;
  private templates: Map<string, TransitionTemplate> = new Map();
  private groups: Map<string, TransitionGroup> = new Map();
  private transitionMetadata: Map<string, any> = new Map();

  private constructor() {
    this.loadTemplates();
    this.loadGroups();
    this.loadMetadata();
    this.initializeBuiltinTemplates();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TransitionOrganizationService {
    if (!TransitionOrganizationService.instance) {
      TransitionOrganizationService.instance = new TransitionOrganizationService();
    }
    return TransitionOrganizationService.instance;
  }

  // ==========================================================================
  // Transition Templates
  // ==========================================================================

  /**
   * Create a custom transition template
   */
  createTransitionTemplate(
    name: string,
    config: TransitionTemplate['config'],
    options: {
      description?: string;
      category?: TransitionTemplate['category'];
      tags?: string[];
      icon?: string;
    } = {}
  ): TransitionTemplate {
    const template: TransitionTemplate = {
      id: `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      description: options.description || '',
      category: options.category || 'custom',
      icon: options.icon,
      builtin: false,
      config,
      tags: options.tags || [],
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.templates.set(template.id, template);
    this.saveTemplates();

    return template;
  }

  /**
   * Get a template by ID
   */
  getTemplate(id: string): TransitionTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Get all templates
   */
  getAllTemplates(): TransitionTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: TransitionTemplate['category']): TransitionTemplate[] {
    return Array.from(this.templates.values()).filter((t) => t.category === category);
  }

  /**
   * Create transition from template
   */
  createFromTemplate(
    templateId: string,
    fromStateId: string,
    toStateId?: string,
    customConfig?: Partial<TransitionTemplate['config']>
  ): Transition | null {
    const template = this.templates.get(templateId);
    if (!template) {
      return null;
    }

    // Increment usage count
    template.usageCount = (template.usageCount || 0) + 1;
    this.saveTemplates();

    const config = { ...template.config, ...customConfig };

    const transition: Transition = {
      id: `transition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: config.type,
      workflows: config.workflows || [],
      timeout: config.timeout,
      retryCount: config.retryCount,
      ...(config.type === 'OutgoingTransition' ? {
        fromState: fromStateId,
        toState: toStateId || '',
        staysVisible: config.staysVisible || false,
        activateStates: config.activateStates || [],
        deactivateStates: config.deactivateStates || [],
      } : {
        toState: toStateId || fromStateId,
      }),
    } as Transition;

    return transition;
  }

  /**
   * Delete a custom template
   */
  deleteTemplate(id: string): boolean {
    const template = this.templates.get(id);
    if (!template || template.builtin) {
      return false;
    }

    this.templates.delete(id);
    this.saveTemplates();
    return true;
  }

  // ==========================================================================
  // Bulk Transition Operations
  // ==========================================================================

  /**
   * Create transitions from multiple source states to a single target state
   */
  bulkCreateTransitions(
    fromStateIds: string[],
    toStateId: string,
    template: string | TransitionTemplate['config']
  ): BulkOperationResult {
    const result: BulkOperationResult = {
      success: 0,
      failed: 0,
      successIds: [],
      failures: [],
      timestamp: new Date().toISOString(),
    };

    const config = typeof template === 'string'
      ? this.templates.get(template)?.config
      : template;

    if (!config) {
      result.failed = fromStateIds.length;
      result.failures = fromStateIds.map((id) => ({
        id,
        reason: 'Invalid template or configuration',
      }));
      return result;
    }

    for (const fromStateId of fromStateIds) {
      try {
        const transition = typeof template === 'string'
          ? this.createFromTemplate(template, fromStateId, toStateId)
          : this.createFromTemplate('custom', fromStateId, toStateId, config);

        if (transition) {
          result.success++;
          result.successIds.push(transition.id);
        } else {
          result.failed++;
          result.failures.push({
            id: fromStateId,
            reason: 'Failed to create transition',
          });
        }
      } catch (error) {
        result.failed++;
        result.failures.push({
          id: fromStateId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  /**
   * Create a transition matrix (all-to-all or pattern-based connections)
   */
  createTransitionMatrix(
    stateIds: string[],
    rules: {
      /** Create all-to-all connections */
      allToAll?: boolean;
      /** Exclude self-loops */
      excludeSelfLoops?: boolean;
      /** Only create connections matching pattern */
      pattern?: 'linear' | 'circular' | 'star' | 'custom';
      /** Custom connection rules */
      customRules?: Array<{ from: string; to: string }>;
      /** Template to use for connections */
      template: string | TransitionTemplate['config'];
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

    // Generate connections based on pattern
    if (rules.allToAll) {
      for (const from of stateIds) {
        for (const to of stateIds) {
          if (rules.excludeSelfLoops && from === to) continue;
          connections.push({ from, to });
        }
      }
    } else if (rules.pattern === 'linear') {
      for (let i = 0; i < stateIds.length - 1; i++) {
        connections.push({ from: stateIds[i], to: stateIds[i + 1] });
      }
    } else if (rules.pattern === 'circular') {
      for (let i = 0; i < stateIds.length; i++) {
        connections.push({
          from: stateIds[i],
          to: stateIds[(i + 1) % stateIds.length],
        });
      }
    } else if (rules.pattern === 'star') {
      // First state is the hub
      const hub = stateIds[0];
      for (let i = 1; i < stateIds.length; i++) {
        connections.push({ from: hub, to: stateIds[i] });
        connections.push({ from: stateIds[i], to: hub });
      }
    } else if (rules.customRules) {
      connections.push(...rules.customRules);
    }

    // Create transitions for each connection
    for (const { from, to } of connections) {
      const bulkResult = this.bulkCreateTransitions([from], to, rules.template);
      result.success += bulkResult.success;
      result.failed += bulkResult.failed;
      result.successIds.push(...bulkResult.successIds);
      result.failures.push(...bulkResult.failures);
    }

    return result;
  }

  /**
   * Bulk update transitions
   */
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
        result.failures.push({ id, reason: 'Transition not found' });
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
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  /**
   * Bulk delete transitions
   */
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
        result.failures.push({ id, reason: 'Transition not found' });
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
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  // ==========================================================================
  // Transition Analysis
  // ==========================================================================

  /**
   * Validate all transitions for broken references
   */
  validateTransitions(
    transitions: Transition[],
    states: State[],
    workflows: { id: string }[]
  ): ValidationReport {
    const issues: ValidationIssue[] = [];
    const stateIds = new Set(states.map((s) => s.id));
    const workflowIds = new Set(workflows.map((w) => w.id));

    for (const transition of transitions) {
      // Check workflow references
      for (const workflowId of transition.workflows) {
        if (!workflowIds.has(workflowId)) {
          issues.push({
            severity: 'error',
            type: 'missing-workflow',
            message: `Transition references non-existent workflow: ${workflowId}`,
            transitionId: transition.id,
            relatedIds: [workflowId],
            suggestion: 'Remove the workflow reference or create the missing workflow',
          });
        }
      }

      // Check state references
      if (transition.type === 'OutgoingTransition') {
        const outgoing = transition as OutgoingTransition;

        if (!stateIds.has(outgoing.fromState)) {
          issues.push({
            severity: 'error',
            type: 'broken-reference',
            message: `Transition references non-existent source state: ${outgoing.fromState}`,
            transitionId: transition.id,
            relatedIds: [outgoing.fromState],
            suggestion: 'Update the fromState or delete this transition',
          });
        }

        if (outgoing.toState && !stateIds.has(outgoing.toState)) {
          issues.push({
            severity: 'error',
            type: 'broken-reference',
            message: `Transition references non-existent target state: ${outgoing.toState}`,
            transitionId: transition.id,
            relatedIds: [outgoing.toState],
            suggestion: 'Update the toState or delete this transition',
          });
        }

        // Check activated states
        for (const stateId of outgoing.activateStates) {
          if (!stateIds.has(stateId)) {
            issues.push({
              severity: 'warning',
              type: 'broken-reference',
              message: `Transition activates non-existent state: ${stateId}`,
              transitionId: transition.id,
              relatedIds: [stateId],
              suggestion: 'Remove the state from activateStates',
            });
          }
        }

        // Check deactivated states
        for (const stateId of outgoing.deactivateStates) {
          if (!stateIds.has(stateId)) {
            issues.push({
              severity: 'warning',
              type: 'broken-reference',
              message: `Transition deactivates non-existent state: ${stateId}`,
              transitionId: transition.id,
              relatedIds: [stateId],
              suggestion: 'Remove the state from deactivateStates',
            });
          }
        }
      } else {
        const incoming = transition as IncomingTransition;

        if (!stateIds.has(incoming.toState)) {
          issues.push({
            severity: 'error',
            type: 'broken-reference',
            message: `Transition references non-existent target state: ${incoming.toState}`,
            transitionId: transition.id,
            relatedIds: [incoming.toState],
            suggestion: 'Update the toState or delete this transition',
          });
        }
      }

      // Check timeout configuration
      if (transition.timeout < 0) {
        issues.push({
          severity: 'warning',
          type: 'timeout',
          message: `Transition has negative timeout: ${transition.timeout}`,
          transitionId: transition.id,
          suggestion: 'Set timeout to a positive value or 0 for no timeout',
        });
      }

      // Check for missing workflows
      if (transition.workflows.length === 0) {
        issues.push({
          severity: 'info',
          type: 'configuration',
          message: 'Transition has no workflows configured',
          transitionId: transition.id,
          suggestion: 'Add workflows to define the transition behavior',
        });
      }
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    const infoCount = issues.filter((i) => i.severity === 'info').length;

    return {
      totalTransitions: transitions.length,
      validTransitions: transitions.length - new Set(issues.map((i) => i.transitionId)).size,
      transitionsWithIssues: new Set(issues.map((i) => i.transitionId)).size,
      issues,
      errorCount,
      warningCount,
      infoCount,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Find circular transition paths
   */
  findCircularTransitions(transitions: Transition[]): CircularPath[] {
    const circularPaths: CircularPath[] = [];
    const graph = this.buildTransitionGraph(transitions);

    // DFS to detect cycles
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const currentPath: string[] = [];
    const currentTransitions: string[] = [];

    const dfs = (stateId: string): void => {
      visited.add(stateId);
      recursionStack.add(stateId);
      currentPath.push(stateId);

      const neighbors = graph.get(stateId) || [];
      for (const { toState, transitionId } of neighbors) {
        currentTransitions.push(transitionId);

        if (!visited.has(toState)) {
          dfs(toState);
        } else if (recursionStack.has(toState)) {
          // Found a cycle
          const cycleStart = currentPath.indexOf(toState);
          const cyclePath = currentPath.slice(cycleStart);
          const cycleTransitions = currentTransitions.slice(cycleStart);

          circularPaths.push({
            path: cyclePath,
            transitions: cycleTransitions,
            length: cyclePath.length,
          });
        }

        currentTransitions.pop();
      }

      currentPath.pop();
      recursionStack.delete(stateId);
    };

    // Run DFS from each unvisited state
    for (const transition of transitions) {
      if (transition.type === 'OutgoingTransition') {
        const outgoing = transition as OutgoingTransition;
        if (!visited.has(outgoing.fromState)) {
          dfs(outgoing.fromState);
        }
      }
    }

    return circularPaths;
  }

  /**
   * Find unreachable states (states with no incoming transitions)
   */
  findUnreachableStates(transitions: Transition[], states: State[]): string[] {
    const statesWithIncoming = new Set<string>();

    // Find initial states
    const initialStates = new Set(
      states.filter((s) => s.initial).map((s) => s.id)
    );

    // Mark states with incoming transitions
    for (const transition of transitions) {
      if (transition.type === 'OutgoingTransition') {
        const outgoing = transition as OutgoingTransition;
        if (outgoing.toState) {
          statesWithIncoming.add(outgoing.toState);
        }
      } else {
        const incoming = transition as IncomingTransition;
        statesWithIncoming.add(incoming.toState);
      }
    }

    // BFS to find reachable states from initial states
    const reachable = new Set<string>(initialStates);
    const queue = Array.from(initialStates);
    const graph = this.buildTransitionGraph(transitions);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = graph.get(current) || [];

      for (const { toState } of neighbors) {
        if (!reachable.has(toState)) {
          reachable.add(toState);
          queue.push(toState);
        }
      }
    }

    // Return states that are not reachable from initial states
    return states
      .filter((s) => !reachable.has(s.id) && !s.initial)
      .map((s) => s.id);
  }

  /**
   * Get comprehensive transition statistics
   */
  getTransitionStatistics(
    transitions: Transition[],
    states: State[]
  ): TransitionStatistics {
    const outgoingCount = transitions.filter((t) => t.type === 'OutgoingTransition').length;
    const incomingCount = transitions.filter((t) => t.type === 'IncomingTransition').length;

    const totalTimeout = transitions.reduce((sum, t) => sum + t.timeout, 0);
    const totalRetryCount = transitions.reduce((sum, t) => sum + t.retryCount, 0);

    const withWorkflows = transitions.filter((t) => t.workflows.length > 0).length;
    const withoutWorkflows = transitions.length - withWorkflows;

    // Count workflow usage
    const workflowCounts = new Map<string, number>();
    for (const transition of transitions) {
      for (const workflowId of transition.workflows) {
        workflowCounts.set(workflowId, (workflowCounts.get(workflowId) || 0) + 1);
      }
    }

    const topWorkflows = Array.from(workflowCounts.entries())
      .map(([workflowId, count]) => ({ workflowId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Count state connections
    const stateCounts = new Map<string, { incomingCount: number; outgoingCount: number }>();
    for (const state of states) {
      stateCounts.set(state.id, { incomingCount: 0, outgoingCount: 0 });
    }

    for (const transition of transitions) {
      if (transition.type === 'OutgoingTransition') {
        const outgoing = transition as OutgoingTransition;
        const fromCount = stateCounts.get(outgoing.fromState);
        if (fromCount) fromCount.outgoingCount++;

        if (outgoing.toState) {
          const toCount = stateCounts.get(outgoing.toState);
          if (toCount) toCount.incomingCount++;
        }
      } else {
        const incoming = transition as IncomingTransition;
        const toCount = stateCounts.get(incoming.toState);
        if (toCount) toCount.incomingCount++;
      }
    }

    const topStates = Array.from(stateCounts.entries())
      .map(([stateId, counts]) => ({ stateId, ...counts }))
      .sort((a, b) => (b.incomingCount + b.outgoingCount) - (a.incomingCount + a.outgoingCount))
      .slice(0, 10);

    const circularPaths = this.findCircularTransitions(transitions);
    const unreachableStates = this.findUnreachableStates(transitions, states);

    // Count orphaned transitions
    const stateIds = new Set(states.map((s) => s.id));
    const orphanedTransitions = transitions.filter((t) => {
      if (t.type === 'OutgoingTransition') {
        const outgoing = t as OutgoingTransition;
        return !stateIds.has(outgoing.fromState) || (outgoing.toState && !stateIds.has(outgoing.toState));
      } else {
        const incoming = t as IncomingTransition;
        return !stateIds.has(incoming.toState);
      }
    }).length;

    const allGroups = Array.from(this.groups.values());
    const totalGroups = allGroups.length;
    const avgTransitionsPerGroup = totalGroups > 0
      ? allGroups.reduce((sum, g) => sum + g.transitionIds.length, 0) / totalGroups
      : 0;

    return {
      total: transitions.length,
      byType: {
        outgoing: outgoingCount,
        incoming: incomingCount,
      },
      avgTimeout: transitions.length > 0 ? totalTimeout / transitions.length : 0,
      avgRetryCount: transitions.length > 0 ? totalRetryCount / transitions.length : 0,
      withWorkflows,
      withoutWorkflows,
      topWorkflows,
      topStates,
      circularPaths: circularPaths.length,
      unreachableStates: unreachableStates.length,
      orphanedTransitions,
      groups: {
        total: totalGroups,
        avgTransitionsPerGroup,
      },
    };
  }

  // ==========================================================================
  // Transition Search and Filter
  // ==========================================================================

  /**
   * Search transitions with query and filters
   */
  searchTransitions(
    transitions: Transition[],
    query: string,
    filters?: TransitionFilter
  ): Transition[] {
    let results = [...transitions];

    // Apply text search
    if (query) {
      const lowerQuery = query.toLowerCase();
      results = results.filter((t) => {
        const searchableText = [
          t.id,
          t.workflows.join(' '),
          this.getTransitionMetadata(t.id)?.name || '',
          this.getTransitionMetadata(t.id)?.description || '',
        ].join(' ').toLowerCase();

        return searchableText.includes(lowerQuery);
      });
    }

    // Apply filters
    if (filters) {
      if (filters.type) {
        results = results.filter((t) => t.type === filters.type);
      }

      if (filters.fromState) {
        results = results.filter((t) =>
          t.type === 'OutgoingTransition' &&
          (t as OutgoingTransition).fromState === filters.fromState
        );
      }

      if (filters.toState) {
        results = results.filter((t) => {
          if (t.type === 'OutgoingTransition') {
            return (t as OutgoingTransition).toState === filters.toState;
          } else {
            return (t as IncomingTransition).toState === filters.toState;
          }
        });
      }

      if (filters.hasWorkflow) {
        results = results.filter((t) => t.workflows.includes(filters.hasWorkflow!));
      }

      if (filters.timeoutRange) {
        results = results.filter((t) =>
          t.timeout >= filters.timeoutRange!.min &&
          t.timeout <= filters.timeoutRange!.max
        );
      }

      if (filters.retryCountRange) {
        results = results.filter((t) =>
          t.retryCount >= filters.retryCountRange!.min &&
          t.retryCount <= filters.retryCountRange!.max
        );
      }

      if (filters.staysVisible !== undefined) {
        results = results.filter((t) =>
          t.type === 'OutgoingTransition' &&
          (t as OutgoingTransition).staysVisible === filters.staysVisible
        );
      }

      if (filters.activatesState) {
        results = results.filter((t) =>
          t.type === 'OutgoingTransition' &&
          (t as OutgoingTransition).activateStates.includes(filters.activatesState!)
        );
      }

      if (filters.deactivatesState) {
        results = results.filter((t) =>
          t.type === 'OutgoingTransition' &&
          (t as OutgoingTransition).deactivateStates.includes(filters.deactivatesState!)
        );
      }

      if (filters.inGroup) {
        const group = this.groups.get(filters.inGroup);
        if (group) {
          results = results.filter((t) => group.transitionIds.includes(t.id));
        }
      }

      if (filters.hasTag) {
        results = results.filter((t) => {
          const metadata = this.getTransitionMetadata(t.id);
          return metadata?.tags?.includes(filters.hasTag!);
        });
      }
    }

    return results;
  }

  /**
   * Get transitions for a specific state
   */
  getTransitionsForState(
    transitions: Transition[],
    stateId: string,
    direction: 'incoming' | 'outgoing' | 'both' = 'both'
  ): Transition[] {
    return transitions.filter((t) => {
      if (direction === 'incoming' || direction === 'both') {
        if (t.type === 'OutgoingTransition' && (t as OutgoingTransition).toState === stateId) {
          return true;
        }
        if (t.type === 'IncomingTransition' && (t as IncomingTransition).toState === stateId) {
          return true;
        }
      }

      if (direction === 'outgoing' || direction === 'both') {
        if (t.type === 'OutgoingTransition' && (t as OutgoingTransition).fromState === stateId) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Find transitions matching a pattern
   */
  getTransitionsByPattern(
    transitions: Transition[],
    pattern: TransitionPattern
  ): Transition[] {
    const tolerance = pattern.tolerance || 0.8;

    return transitions.filter((t) => {
      let matches = 0;
      let checks = 0;

      if (pattern.criteria.workflows) {
        checks++;
        const workflowMatch = pattern.criteria.workflows.every((wid) =>
          t.workflows.includes(wid)
        );
        if (workflowMatch) matches++;
      }

      if (pattern.criteria.timeout !== undefined) {
        checks++;
        if (t.timeout === pattern.criteria.timeout) matches++;
      }

      if (pattern.criteria.retryCount !== undefined) {
        checks++;
        if (t.retryCount === pattern.criteria.retryCount) matches++;
      }

      if (t.type === 'OutgoingTransition') {
        const outgoing = t as OutgoingTransition;

        if (pattern.criteria.activateStates) {
          checks++;
          const activateMatch = pattern.criteria.activateStates.every((sid) =>
            outgoing.activateStates.includes(sid)
          );
          if (activateMatch) matches++;
        }

        if (pattern.criteria.deactivateStates) {
          checks++;
          const deactivateMatch = pattern.criteria.deactivateStates.every((sid) =>
            outgoing.deactivateStates.includes(sid)
          );
          if (deactivateMatch) matches++;
        }
      }

      return checks > 0 && (matches / checks) >= tolerance;
    });
  }

  // ==========================================================================
  // Transition Validation
  // ==========================================================================

  /**
   * Validate a single transition
   */
  validateTransition(
    transition: Transition,
    states: State[],
    workflows: { id: string }[]
  ): ValidationIssue[] {
    const report = this.validateTransitions([transition], states, workflows);
    return report.issues.filter((i) => i.transitionId === transition.id);
  }

  /**
   * Check for duplicate or conflicting transitions
   */
  checkForConflicts(
    transition: Transition,
    allTransitions: Transition[]
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const existing of allTransitions) {
      if (existing.id === transition.id) continue;

      // Check for exact duplicates
      if (
        transition.type === existing.type &&
        JSON.stringify(transition.workflows) === JSON.stringify(existing.workflows)
      ) {
        if (transition.type === 'OutgoingTransition') {
          const t1 = transition as OutgoingTransition;
          const t2 = existing as OutgoingTransition;

          if (
            t1.fromState === t2.fromState &&
            t1.toState === t2.toState &&
            JSON.stringify(t1.activateStates) === JSON.stringify(t2.activateStates) &&
            JSON.stringify(t1.deactivateStates) === JSON.stringify(t2.deactivateStates)
          ) {
            issues.push({
              severity: 'warning',
              type: 'duplicate',
              message: 'Duplicate transition detected',
              transitionId: transition.id,
              relatedIds: [existing.id],
              suggestion: 'Consider merging or removing one of the duplicate transitions',
            });
          }
        } else {
          const t1 = transition as IncomingTransition;
          const t2 = existing as IncomingTransition;

          if (t1.toState === t2.toState) {
            issues.push({
              severity: 'warning',
              type: 'duplicate',
              message: 'Duplicate incoming transition detected',
              transitionId: transition.id,
              relatedIds: [existing.id],
              suggestion: 'Consider merging or removing one of the duplicate transitions',
            });
          }
        }
      }

      // Check for conflicting configurations
      if (transition.type === 'OutgoingTransition' && existing.type === 'OutgoingTransition') {
        const t1 = transition as OutgoingTransition;
        const t2 = existing as OutgoingTransition;

        if (t1.fromState === t2.fromState && t1.toState === t2.toState) {
          // Check for conflicting state activations/deactivations
          const conflictingActivations = t1.activateStates.filter((sid) =>
            t2.deactivateStates.includes(sid)
          );

          if (conflictingActivations.length > 0) {
            issues.push({
              severity: 'warning',
              type: 'conflict',
              message: 'Conflicting state activation/deactivation detected',
              transitionId: transition.id,
              relatedIds: [existing.id, ...conflictingActivations],
              suggestion: 'Review state activation/deactivation logic',
            });
          }
        }
      }
    }

    return issues;
  }

  /**
   * Validate the entire transition graph
   */
  validateTransitionGraph(
    transitions: Transition[],
    states: State[],
    workflows: { id: string }[]
  ): ValidationReport {
    const report = this.validateTransitions(transitions, states, workflows);

    // Add graph-specific validations
    const circularPaths = this.findCircularTransitions(transitions);
    for (const path of circularPaths) {
      for (const transitionId of path.transitions) {
        report.issues.push({
          severity: 'warning',
          type: 'circular-path',
          message: `Transition is part of a circular path: ${path.path.join(' -> ')}`,
          transitionId,
          relatedIds: path.transitions,
          suggestion: 'Add exit conditions to prevent infinite loops',
        });
      }
    }

    const unreachableStates = this.findUnreachableStates(transitions, states);
    if (unreachableStates.length > 0) {
      // Find transitions leading to unreachable states
      for (const transition of transitions) {
        if (transition.type === 'OutgoingTransition') {
          const outgoing = transition as OutgoingTransition;
          if (outgoing.toState && unreachableStates.includes(outgoing.toState)) {
            report.issues.push({
              severity: 'info',
              type: 'unreachable',
              message: `Transition leads to an unreachable state: ${outgoing.toState}`,
              transitionId: transition.id,
              relatedIds: [outgoing.toState],
              suggestion: 'Add incoming transitions to make the state reachable from initial states',
            });
          }
        }
      }
    }

    // Recalculate counts
    report.errorCount = report.issues.filter((i) => i.severity === 'error').length;
    report.warningCount = report.issues.filter((i) => i.severity === 'warning').length;
    report.infoCount = report.issues.filter((i) => i.severity === 'info').length;

    return report;
  }

  /**
   * Get a comprehensive validation report
   */
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

  /**
   * Create a transition group
   */
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
    const group: TransitionGroup = {
      id: `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      description: options.description || '',
      color: options.color,
      transitionIds,
      enabled: options.enabled !== false,
      tags: options.tags || [],
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.groups.set(group.id, group);
    this.saveGroups();

    return group;
  }

  /**
   * Get a group by ID
   */
  getGroup(id: string): TransitionGroup | undefined {
    return this.groups.get(id);
  }

  /**
   * Get all groups
   */
  getAllGroups(): TransitionGroup[] {
    return Array.from(this.groups.values());
  }

  /**
   * Update a group
   */
  updateGroup(id: string, updates: Partial<TransitionGroup>): boolean {
    const group = this.groups.get(id);
    if (!group) return false;

    Object.assign(group, updates);
    group.metadata = {
      ...group.metadata,
      updated: new Date().toISOString(),
    };

    this.saveGroups();
    return true;
  }

  /**
   * Delete a group
   */
  deleteGroup(id: string): boolean {
    const deleted = this.groups.delete(id);
    if (deleted) {
      this.saveGroups();
    }
    return deleted;
  }

  /**
   * Add transitions to a group
   */
  addToGroup(groupId: string, transitionIds: string[]): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    group.transitionIds = [...new Set([...group.transitionIds, ...transitionIds])];
    group.metadata = {
      ...group.metadata,
      updated: new Date().toISOString(),
    };

    this.saveGroups();
    return true;
  }

  /**
   * Remove transitions from a group
   */
  removeFromGroup(groupId: string, transitionIds: string[]): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    group.transitionIds = group.transitionIds.filter(
      (id) => !transitionIds.includes(id)
    );
    group.metadata = {
      ...group.metadata,
      updated: new Date().toISOString(),
    };

    this.saveGroups();
    return true;
  }

  /**
   * Enable or disable all transitions in a group
   */
  toggleGroupEnabled(groupId: string, enabled: boolean): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    group.enabled = enabled;
    this.saveGroups();
    return true;
  }

  /**
   * Get groups containing a transition
   */
  getGroupsForTransition(transitionId: string): TransitionGroup[] {
    return Array.from(this.groups.values()).filter((g) =>
      g.transitionIds.includes(transitionId)
    );
  }

  // ==========================================================================
  // Import/Export
  // ==========================================================================

  /**
   * Export transitions to JSON
   */
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

    const exportData: any = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      transitions: selectedTransitions,
    };

    if (options.includeStates) {
      const stateIds = new Set<string>();
      for (const transition of selectedTransitions) {
        if (transition.type === 'OutgoingTransition') {
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
      exportData.states = states.filter((s) => stateIds.has(s.id));
    }

    if (options.includeWorkflows) {
      const workflowIds = new Set<string>();
      for (const transition of selectedTransitions) {
        transition.workflows.forEach((id) => workflowIds.add(id));
      }
      exportData.workflows = workflows.filter((w) => workflowIds.has(w.id));
    }

    if (options.includeGroups) {
      exportData.groups = Array.from(this.groups.values()).filter((g) =>
        g.transitionIds.some((id) => transitionIds.includes(id))
      );
    }

    if (options.includeMetadata) {
      exportData.metadata = Object.fromEntries(
        Array.from(this.transitionMetadata.entries()).filter(([id]) =>
          transitionIds.includes(id)
        )
      );
    }

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import transitions from JSON
   */
  importTransitions(
    data: string,
    options: ImportExportOptions = {}
  ): { transitions: Transition[]; states?: State[]; groups?: TransitionGroup[] } | null {
    try {
      const importData = JSON.parse(data);

      if (options.validate) {
        if (!importData.transitions || !Array.isArray(importData.transitions)) {
          console.error('Invalid import data: missing transitions array');
          return null;
        }
      }

      const result: any = {
        transitions: [],
      };

      // Import transitions
      for (const transition of importData.transitions) {
        const existingIndex = result.transitions.findIndex(
          (t: Transition) => t.id === transition.id
        );

        if (existingIndex !== -1) {
          if (options.skipDuplicates) {
            continue;
          } else if (options.mergeStrategy === 'replace') {
            result.transitions[existingIndex] = transition;
          } else if (options.mergeStrategy === 'rename') {
            transition.id = `${transition.id}-imported-${Date.now()}`;
            result.transitions.push(transition);
          }
        } else {
          result.transitions.push(transition);
        }
      }

      // Import states if included
      if (importData.states && options.includeStates) {
        result.states = importData.states;
      }

      // Import groups if included
      if (importData.groups && options.includeGroups) {
        result.groups = importData.groups;
        for (const group of importData.groups) {
          this.groups.set(group.id, group);
        }
        this.saveGroups();
      }

      // Import metadata if included
      if (importData.metadata && options.includeMetadata) {
        for (const [id, metadata] of Object.entries(importData.metadata)) {
          this.transitionMetadata.set(id, metadata);
        }
        this.saveMetadata();
      }

      return result;
    } catch (error) {
      console.error('Failed to import transitions:', error);
      return null;
    }
  }

  /**
   * Export transition matrix as CSV
   */
  exportTransitionMatrix(
    transitions: Transition[],
    states: State[]
  ): string {
    const matrix = this.generateTransitionMatrix(transitions, states);
    const lines: string[] = [];

    // Header row
    lines.push(['State', ...matrix.states].join(','));

    // Data rows
    for (let i = 0; i < matrix.states.length; i++) {
      const row = [matrix.states[i]];
      for (let j = 0; j < matrix.states.length; j++) {
        const transitionIds = matrix.matrix[i][j];
        row.push(transitionIds ? transitionIds.length.toString() : '0');
      }
      lines.push(row.join(','));
    }

    return lines.join('\n');
  }

  /**
   * Generate transition matrix data structure
   */
  generateTransitionMatrix(
    transitions: Transition[],
    states: State[]
  ): TransitionMatrix {
    const stateIds = states.map((s) => s.id);
    const stateIndexMap = new Map(stateIds.map((id, i) => [id, i]));

    // Initialize matrix
    const matrix: (string[] | null)[][] = Array(stateIds.length)
      .fill(null)
      .map(() => Array(stateIds.length).fill(null));

    // Populate matrix
    let totalTransitions = 0;
    for (const transition of transitions) {
      if (transition.type === 'OutgoingTransition') {
        const outgoing = transition as OutgoingTransition;
        const fromIndex = stateIndexMap.get(outgoing.fromState);
        const toIndex = outgoing.toState ? stateIndexMap.get(outgoing.toState) : undefined;

        if (fromIndex !== undefined && toIndex !== undefined) {
          if (!matrix[fromIndex][toIndex]) {
            matrix[fromIndex][toIndex] = [];
          }
          matrix[fromIndex][toIndex]!.push(transition.id);
          totalTransitions++;
        }
      }
    }

    const possibleConnections = stateIds.length * stateIds.length;
    const actualConnections = matrix.flat().filter((cell) => cell !== null).length;
    const coverage = possibleConnections > 0 ? actualConnections / possibleConnections : 0;

    return {
      states: stateIds,
      matrix,
      metadata: {
        generated: new Date().toISOString(),
        totalTransitions,
        coverage,
      },
    };
  }

  // ==========================================================================
  // Optimization
  // ==========================================================================

  /**
   * Find redundant transitions
   */
  findRedundantTransitions(transitions: Transition[]): RedundantTransition[] {
    const redundant: RedundantTransition[] = [];

    for (let i = 0; i < transitions.length; i++) {
      const t1 = transitions[i];
      const duplicates: string[] = [];

      for (let j = i + 1; j < transitions.length; j++) {
        const t2 = transitions[j];

        // Check for exact duplicates
        if (this.areTransitionsIdentical(t1, t2)) {
          duplicates.push(t2.id);
        }
      }

      if (duplicates.length > 0) {
        redundant.push({
          transitionId: t1.id,
          duplicateIds: duplicates,
          reason: 'exact-duplicate',
          confidence: 1.0,
        });
      }
    }

    // Find similar configurations
    for (let i = 0; i < transitions.length; i++) {
      const t1 = transitions[i];
      const similar: string[] = [];

      for (let j = i + 1; j < transitions.length; j++) {
        const t2 = transitions[j];

        const similarity = this.calculateTransitionSimilarity(t1, t2);
        if (similarity > 0.8 && similarity < 1.0) {
          similar.push(t2.id);
        }
      }

      if (similar.length > 0) {
        redundant.push({
          transitionId: t1.id,
          duplicateIds: similar,
          reason: 'similar-config',
          confidence: 0.8,
        });
      }
    }

    return redundant;
  }

  /**
   * Suggest transitions that could be merged
   */
  suggestMergableTransitions(transitions: Transition[]): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Group transitions by similar paths
    const pathGroups = new Map<string, string[]>();

    for (const transition of transitions) {
      if (transition.type === 'OutgoingTransition') {
        const outgoing = transition as OutgoingTransition;
        const pathKey = `${outgoing.fromState}->${outgoing.toState}`;
        const group = pathGroups.get(pathKey) || [];
        group.push(transition.id);
        pathGroups.set(pathKey, group);
      }
    }

    // Suggest merging transitions with same path
    for (const [path, transitionIds] of pathGroups.entries()) {
      if (transitionIds.length > 1) {
        suggestions.push({
          type: 'merge',
          description: `Multiple transitions found for path ${path}`,
          transitionIds,
          impact: 'medium',
          action: 'Merge workflows into a single transition',
          autoApplicable: false,
        });
      }
    }

    // Find redundant transitions
    const redundant = this.findRedundantTransitions(transitions);
    for (const r of redundant) {
      if (r.reason === 'exact-duplicate') {
        suggestions.push({
          type: 'remove',
          description: 'Exact duplicate transition detected',
          transitionIds: [r.transitionId, ...r.duplicateIds],
          impact: 'high',
          action: 'Remove duplicate transitions',
          autoApplicable: true,
        });
      }
    }

    return suggestions;
  }

  /**
   * Suggest optimal transition ordering
   */
  optimizeTransitionOrder(
    transitions: Transition[],
    states: State[]
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Check for timeout inconsistencies
    const timeoutGroups = new Map<number, string[]>();
    for (const transition of transitions) {
      const group = timeoutGroups.get(transition.timeout) || [];
      group.push(transition.id);
      timeoutGroups.set(transition.timeout, group);
    }

    // Suggest standardizing timeouts
    if (timeoutGroups.size > 5) {
      suggestions.push({
        type: 'timeout-adjustment',
        description: 'Many different timeout values detected',
        transitionIds: transitions.map((t) => t.id),
        impact: 'low',
        action: 'Consider standardizing timeout values',
        autoApplicable: false,
      });
    }

    // Suggest grouping related transitions
    const ungroupedTransitions = transitions.filter((t) => {
      const groups = this.getGroupsForTransition(t.id);
      return groups.length === 0;
    });

    if (ungroupedTransitions.length > 10) {
      suggestions.push({
        type: 'add-group',
        description: `${ungroupedTransitions.length} transitions are not organized in groups`,
        transitionIds: ungroupedTransitions.map((t) => t.id),
        impact: 'medium',
        action: 'Organize transitions into logical groups',
        autoApplicable: false,
      });
    }

    return suggestions;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Build a transition graph for analysis
   */
  private buildTransitionGraph(
    transitions: Transition[]
  ): Map<string, Array<{ toState: string; transitionId: string }>> {
    const graph = new Map<string, Array<{ toState: string; transitionId: string }>>();

    for (const transition of transitions) {
      if (transition.type === 'OutgoingTransition') {
        const outgoing = transition as OutgoingTransition;
        if (!outgoing.toState) continue;

        const edges = graph.get(outgoing.fromState) || [];
        edges.push({ toState: outgoing.toState, transitionId: transition.id });
        graph.set(outgoing.fromState, edges);
      }
    }

    return graph;
  }

  /**
   * Check if two transitions are identical
   */
  private areTransitionsIdentical(t1: Transition, t2: Transition): boolean {
    if (t1.type !== t2.type) return false;

    if (
      t1.timeout !== t2.timeout ||
      t1.retryCount !== t2.retryCount ||
      JSON.stringify(t1.workflows) !== JSON.stringify(t2.workflows)
    ) {
      return false;
    }

    if (t1.type === 'OutgoingTransition' && t2.type === 'OutgoingTransition') {
      const o1 = t1 as OutgoingTransition;
      const o2 = t2 as OutgoingTransition;

      return (
        o1.fromState === o2.fromState &&
        o1.toState === o2.toState &&
        o1.staysVisible === o2.staysVisible &&
        JSON.stringify(o1.activateStates) === JSON.stringify(o2.activateStates) &&
        JSON.stringify(o1.deactivateStates) === JSON.stringify(o2.deactivateStates)
      );
    } else if (t1.type === 'IncomingTransition' && t2.type === 'IncomingTransition') {
      const i1 = t1 as IncomingTransition;
      const i2 = t2 as IncomingTransition;

      return i1.toState === i2.toState;
    }

    return false;
  }

  /**
   * Calculate similarity score between two transitions (0-1)
   */
  private calculateTransitionSimilarity(t1: Transition, t2: Transition): number {
    if (t1.type !== t2.type) return 0;

    let score = 0;
    let factors = 0;

    // Compare workflows
    factors++;
    const workflowSimilarity = this.calculateArraySimilarity(t1.workflows, t2.workflows);
    score += workflowSimilarity;

    // Compare timeout
    factors++;
    if (t1.timeout === t2.timeout) score += 1;

    // Compare retry count
    factors++;
    if (t1.retryCount === t2.retryCount) score += 1;

    if (t1.type === 'OutgoingTransition' && t2.type === 'OutgoingTransition') {
      const o1 = t1 as OutgoingTransition;
      const o2 = t2 as OutgoingTransition;

      // Compare states
      factors++;
      if (o1.fromState === o2.fromState && o1.toState === o2.toState) score += 1;

      // Compare state activations
      factors++;
      const activateSimilarity = this.calculateArraySimilarity(
        o1.activateStates,
        o2.activateStates
      );
      score += activateSimilarity;

      // Compare state deactivations
      factors++;
      const deactivateSimilarity = this.calculateArraySimilarity(
        o1.deactivateStates,
        o2.deactivateStates
      );
      score += deactivateSimilarity;

      // Compare staysVisible
      factors++;
      if (o1.staysVisible === o2.staysVisible) score += 1;
    } else if (t1.type === 'IncomingTransition' && t2.type === 'IncomingTransition') {
      const i1 = t1 as IncomingTransition;
      const i2 = t2 as IncomingTransition;

      factors++;
      if (i1.toState === i2.toState) score += 1;
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Calculate similarity between two arrays (Jaccard index)
   */
  private calculateArraySimilarity(arr1: string[], arr2: string[]): number {
    const set1 = new Set(arr1);
    const set2 = new Set(arr2);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Get transition metadata
   */
  private getTransitionMetadata(transitionId: string): any {
    return this.transitionMetadata.get(transitionId);
  }

  /**
   * Set transition metadata
   */
  setTransitionMetadata(transitionId: string, metadata: any): void {
    this.transitionMetadata.set(transitionId, metadata);
    this.saveMetadata();
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load templates from localStorage
   */
  private loadTemplates(): void {
    try {
      const json = localStorage.getItem('transition-templates');
      if (json) {
        const templates = JSON.parse(json) as TransitionTemplate[];
        templates.forEach((t) => this.templates.set(t.id, t));
      }
    } catch (error) {
      console.error('Failed to load transition templates:', error);
    }
  }

  /**
   * Save templates to localStorage
   */
  private saveTemplates(): void {
    try {
      const templates = Array.from(this.templates.values());
      localStorage.setItem('transition-templates', JSON.stringify(templates));
    } catch (error) {
      console.error('Failed to save transition templates:', error);
    }
  }

  /**
   * Load groups from localStorage
   */
  private loadGroups(): void {
    try {
      const json = localStorage.getItem('transition-groups');
      if (json) {
        const groups = JSON.parse(json) as TransitionGroup[];
        groups.forEach((g) => this.groups.set(g.id, g));
      }
    } catch (error) {
      console.error('Failed to load transition groups:', error);
    }
  }

  /**
   * Save groups to localStorage
   */
  private saveGroups(): void {
    try {
      const groups = Array.from(this.groups.values());
      localStorage.setItem('transition-groups', JSON.stringify(groups));
    } catch (error) {
      console.error('Failed to save transition groups:', error);
    }
  }

  /**
   * Load metadata from localStorage
   */
  private loadMetadata(): void {
    try {
      const json = localStorage.getItem('transition-metadata');
      if (json) {
        const data = JSON.parse(json);
        Object.entries(data).forEach(([id, metadata]) => {
          this.transitionMetadata.set(id, metadata);
        });
      }
    } catch (error) {
      console.error('Failed to load transition metadata:', error);
    }
  }

  /**
   * Save metadata to localStorage
   */
  private saveMetadata(): void {
    try {
      const data: any = {};
      this.transitionMetadata.forEach((metadata, id) => {
        data[id] = metadata;
      });
      localStorage.setItem('transition-metadata', JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save transition metadata:', error);
    }
  }

  // ==========================================================================
  // Built-in Templates
  // ==========================================================================

  /**
   * Initialize built-in transition templates
   */
  private initializeBuiltinTemplates(): void {
    // Only initialize if not already loaded
    const hasBuiltins = Array.from(this.templates.values()).some((t) => t.builtin);
    if (hasBuiltins) {
      return;
    }

    this.createBuiltinClickButtonTemplate();
    this.createBuiltinFormSubmitTemplate();
    this.createBuiltinNavigationTemplate();
    this.createBuiltinTimeoutAutoTemplate();
    this.createBuiltinConditionalTemplate();
    this.createBuiltinErrorHandlerTemplate();

    this.saveTemplates();
  }

  /**
   * Built-in: Click Button Template
   */
  private createBuiltinClickButtonTemplate(): void {
    const template: TransitionTemplate = {
      id: 'builtin-click-button',
      name: 'Click Button',
      description: 'Standard button click transition with default timeout',
      category: 'interaction',
      icon: '🖱️',
      builtin: true,
      config: {
        type: 'OutgoingTransition',
        workflows: [],
        timeout: 5000,
        retryCount: 3,
        staysVisible: false,
        activateStates: [],
        deactivateStates: [],
      },
      tags: ['click', 'button', 'interaction'],
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.templates.set(template.id, template);
  }

  /**
   * Built-in: Form Submit Template
   */
  private createBuiltinFormSubmitTemplate(): void {
    const template: TransitionTemplate = {
      id: 'builtin-form-submit',
      name: 'Form Submit',
      description: 'Form submission with validation and longer timeout',
      category: 'interaction',
      icon: '📝',
      builtin: true,
      config: {
        type: 'OutgoingTransition',
        workflows: [],
        timeout: 10000,
        retryCount: 2,
        staysVisible: false,
        activateStates: [],
        deactivateStates: [],
      },
      tags: ['form', 'submit', 'validation'],
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.templates.set(template.id, template);
  }

  /**
   * Built-in: Navigation Template
   */
  private createBuiltinNavigationTemplate(): void {
    const template: TransitionTemplate = {
      id: 'builtin-navigation',
      name: 'Navigation',
      description: 'Menu or link click navigation with page load timeout',
      category: 'navigation',
      icon: '🧭',
      builtin: true,
      config: {
        type: 'OutgoingTransition',
        workflows: [],
        timeout: 15000,
        retryCount: 2,
        staysVisible: false,
        activateStates: [],
        deactivateStates: [],
      },
      tags: ['navigation', 'menu', 'link'],
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.templates.set(template.id, template);
  }

  /**
   * Built-in: Timeout/Auto Template
   */
  private createBuiltinTimeoutAutoTemplate(): void {
    const template: TransitionTemplate = {
      id: 'builtin-timeout-auto',
      name: 'Timeout/Auto',
      description: 'Automatic transition after delay with no interaction',
      category: 'automation',
      icon: '⏱️',
      builtin: true,
      config: {
        type: 'OutgoingTransition',
        workflows: [],
        timeout: 3000,
        retryCount: 0,
        staysVisible: true,
        activateStates: [],
        deactivateStates: [],
      },
      tags: ['timeout', 'automatic', 'delay'],
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.templates.set(template.id, template);
  }

  /**
   * Built-in: Conditional Template
   */
  private createBuiltinConditionalTemplate(): void {
    const template: TransitionTemplate = {
      id: 'builtin-conditional',
      name: 'Conditional',
      description: 'IF-based transition with multiple possible outcomes',
      category: 'conditional',
      icon: '❓',
      builtin: true,
      config: {
        type: 'OutgoingTransition',
        workflows: [],
        timeout: 5000,
        retryCount: 1,
        staysVisible: true,
        activateStates: [],
        deactivateStates: [],
      },
      tags: ['conditional', 'if', 'branching'],
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.templates.set(template.id, template);
  }

  /**
   * Built-in: Error Handler Template
   */
  private createBuiltinErrorHandlerTemplate(): void {
    const template: TransitionTemplate = {
      id: 'builtin-error-handler',
      name: 'Error Handler',
      description: 'Error state transition with recovery workflow',
      category: 'error-handling',
      icon: '⚠️',
      builtin: true,
      config: {
        type: 'OutgoingTransition',
        workflows: [],
        timeout: 10000,
        retryCount: 5,
        staysVisible: false,
        activateStates: [],
        deactivateStates: [],
      },
      tags: ['error', 'recovery', 'fallback'],
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.templates.set(template.id, template);
  }

  /**
   * Clear all custom data (keeps built-ins)
   */
  clearCustomData(): void {
    // Keep built-in templates
    const builtins = Array.from(this.templates.values()).filter((t) => t.builtin);
    this.templates.clear();
    builtins.forEach((t) => this.templates.set(t.id, t));

    // Clear all groups
    this.groups.clear();

    // Clear all metadata
    this.transitionMetadata.clear();

    this.saveTemplates();
    this.saveGroups();
    this.saveMetadata();
  }
}

// ============================================================================
// Exports
// ============================================================================

export const transitionOrganization = TransitionOrganizationService.getInstance();
