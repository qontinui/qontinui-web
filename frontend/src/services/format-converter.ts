/**
 * Format Converter Service
 *
 * High-level service for converting between sequential and graph workflow formats.
 * Handles conversion, validation, preview, and integration with stores.
 */

import type { Workflow, Action } from "../lib/action-schema/action-types";
import {
  SequentialToGraphConverter,
  type ConverterOptions as SeqToGraphOptions,
  type ConversionResult as SeqToGraphResult,
} from "../lib/workflow-converter/sequential-to-graph-converter";
import {
  GraphToSequentialConverter,
  type ConversionOptions as GraphToSeqOptions,
} from "../lib/workflow-converter/graph-to-sequential-converter";
import {
  LinearizabilityChecker,
  type LinearizabilityResult,
} from "../lib/workflow-converter/linearizability-checker";
import {
  validateConversion,
  type ConversionValidationResult,
  type ValidationIssue,
} from "./conversion-validation";

// ============================================================================
// Types
// ============================================================================

export interface ConversionError {
  code: string;
  message: string;
  details?: any;
}

export interface ConversionWarning {
  code: string;
  message: string;
  details?: any;
}

export interface ConversionStatistics {
  /** Number of actions added during conversion */
  actionsAdded: number;

  /** Number of actions removed during conversion */
  actionsRemoved: number;

  /** Number of actions with modified configs */
  actionsModified: number;

  /** Number of connections added/changed */
  connectionsChanged: number;

  /** Estimated change in execution time (milliseconds) */
  estimatedExecutionDiff: number;

  /** Time taken to perform conversion (milliseconds) */
  conversionTime: number;
}

export interface ConversionResult {
  /** Whether conversion was successful */
  success: boolean;

  /** The converted workflow (undefined if conversion failed) */
  workflow?: Workflow;

  /** Critical errors that prevented conversion */
  errors?: ConversionError[];

  /** Warnings about potential issues */
  warnings?: ConversionWarning[];

  /** Statistics about the conversion */
  statistics?: ConversionStatistics;

  /** Validation results */
  validation?: ConversionValidationResult;
}

export interface ConversionPreview {
  /** Whether conversion is possible */
  canConvert: boolean;

  /** Source format */
  fromFormat: "sequential" | "graph";

  /** Target format */
  toFormat: "sequential" | "graph";

  /** Linearizability check (for graph to sequential) */
  linearizability?: LinearizabilityResult;

  /** Predicted changes */
  changes: {
    actionsAdded: number;
    actionsRemoved: number;
    actionsModified: number;
    connectionsChanged: number;
  };

  /** Warnings about the conversion */
  warnings: ConversionWarning[];

  /** Estimated impact */
  impact: "none" | "low" | "medium" | "high";

  /** Recommended action */
  recommendation: "safe" | "review" | "caution" | "not_recommended";
}

export interface ConversionOptions {
  /** Validate conversion after completion */
  validate?: boolean;

  /** Apply auto-layout to graph workflows */
  autoLayout?: boolean;

  /** Layout style for auto-layout */
  layoutStyle?: "hierarchical" | "horizontal" | "tree";

  /** Preserve action IDs */
  preserveIds?: boolean;

  /** Preserve action names */
  preserveNames?: boolean;
}

// ============================================================================
// Format Converter Service
// ============================================================================

export class FormatConverter {
  private seqToGraphConverter: SequentialToGraphConverter;
  private graphToSeqConverter: GraphToSequentialConverter;
  private linearizabilityChecker: LinearizabilityChecker;

  constructor() {
    this.seqToGraphConverter = new SequentialToGraphConverter();
    this.graphToSeqConverter = new GraphToSequentialConverter();
    this.linearizabilityChecker = new LinearizabilityChecker();
  }

  // ==========================================================================
  // Conversion Methods
  // ==========================================================================

  /**
   * Convert a workflow to graph format
   */
  async convertToGraph(
    workflow: Workflow,
    options: ConversionOptions = {}
  ): Promise<ConversionResult> {
    const startTime = Date.now();

    try {
      // If already in graph format, return as-is
      if (workflow.format === "graph") {
        return {
          success: true,
          workflow,
          warnings: [
            {
              code: "ALREADY_GRAPH_FORMAT",
              message: "Workflow is already in graph format",
            },
          ],
          statistics: {
            actionsAdded: 0,
            actionsRemoved: 0,
            actionsModified: 0,
            connectionsChanged: 0,
            estimatedExecutionDiff: 0,
            conversionTime: Date.now() - startTime,
          },
        };
      }

      // Convert sequential to graph
      const converterOptions: SeqToGraphOptions = {
        workflowName: workflow.name,
        workflowId: workflow.id,
        version: workflow.version,
        preserveActionIds: options.preserveIds ?? true,
        layout: {
          horizontalSpacing: 200,
          verticalSpacing: 150,
        },
      };

      const result = this.seqToGraphConverter.convert(workflow.actions);

      // Transfer workflow metadata
      const convertedWorkflow: Workflow = {
        ...result.workflow,
        variables: workflow.variables,
        settings: workflow.settings,
        metadata: {
          ...workflow.metadata,
          ...result.workflow.metadata,
          converted: new Date().toISOString(),
          convertedFrom: "sequential",
        },
        tags: workflow.tags,
      };

      // Calculate statistics
      const statistics: ConversionStatistics = {
        actionsAdded: result.stats.actionsConverted - workflow.actions.length,
        actionsRemoved: 0,
        actionsModified: result.stats.controlFlowExpanded,
        connectionsChanged: result.stats.connectionsCreated,
        estimatedExecutionDiff: 0,
        conversionTime: Date.now() - startTime,
      };

      // Validate if requested
      let validation: ConversionValidationResult | undefined;
      if (options.validate) {
        validation = validateConversion(workflow, convertedWorkflow);
      }

      // Convert warnings
      const warnings: ConversionWarning[] = result.warnings.map((w) => ({
        code: "CONVERTER_WARNING",
        message: w,
      }));

      return {
        success: true,
        workflow: convertedWorkflow,
        warnings,
        statistics,
        validation,
      };
    } catch (error: any) {
      return {
        success: false,
        errors: [
          {
            code: "CONVERSION_FAILED",
            message:
              error.message || "Failed to convert workflow to graph format",
            details: error,
          },
        ],
        statistics: {
          actionsAdded: 0,
          actionsRemoved: 0,
          actionsModified: 0,
          connectionsChanged: 0,
          estimatedExecutionDiff: 0,
          conversionTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Convert a workflow to sequential format
   */
  async convertToSequential(
    workflow: Workflow,
    options: ConversionOptions = {}
  ): Promise<ConversionResult> {
    const startTime = Date.now();

    try {
      // Check if workflow can be linearized
      const linearizability = this.canConvertToSequential(workflow);
      if (!linearizability.linearizable) {
        return {
          success: false,
          errors: [
            {
              code: "NOT_LINEARIZABLE",
              message: "Workflow cannot be converted to sequential format",
              details: linearizability.issues,
            },
          ],
          warnings: linearizability.issues.map((issue) => ({
            code: "LINEARIZABILITY_ISSUE",
            message: issue,
          })),
        };
      }

      // Convert graph to sequential
      const converterOptions: GraphToSeqOptions = {
        preserveIds: options.preserveIds ?? true,
        preserveNames: options.preserveNames ?? true,
        validateOutput: options.validate ?? true,
      };

      const actions = this.graphToSeqConverter.convert(
        workflow,
        converterOptions
      );

      // Create sequential workflow
      // Note: Sequential format uses same Workflow structure but without connections
      const convertedWorkflow: Workflow = {
        id: workflow.id,
        name: workflow.name,
        version: workflow.version,
        format: "graph", // Still use graph format (sequential is just a special case)
        actions,
        connections: {}, // Empty connections for sequential
        variables: workflow.variables,
        settings: workflow.settings,
        metadata: {
          ...workflow.metadata,
          converted: new Date().toISOString(),
          convertedFrom: "graph",
        },
        tags: workflow.tags,
      };

      // Calculate statistics
      const statistics: ConversionStatistics = {
        actionsAdded: Math.max(0, actions.length - workflow.actions.length),
        actionsRemoved: Math.max(0, workflow.actions.length - actions.length),
        actionsModified: 0, // TODO: Calculate actual modifications
        connectionsChanged: Object.keys(workflow.connections || {}).length,
        estimatedExecutionDiff: 0,
        conversionTime: Date.now() - startTime,
      };

      // Validate if requested
      let validation: ConversionValidationResult | undefined;
      if (options.validate) {
        validation = validateConversion(workflow, convertedWorkflow);
      }

      return {
        success: true,
        workflow: convertedWorkflow,
        warnings: [],
        statistics,
        validation,
      };
    } catch (error: any) {
      return {
        success: false,
        errors: [
          {
            code: "CONVERSION_FAILED",
            message:
              error.message ||
              "Failed to convert workflow to sequential format",
            details: error,
          },
        ],
        statistics: {
          actionsAdded: 0,
          actionsRemoved: 0,
          actionsModified: 0,
          connectionsChanged: 0,
          estimatedExecutionDiff: 0,
          conversionTime: Date.now() - startTime,
        },
      };
    }
  }

  // ==========================================================================
  // Linearizability Check
  // ==========================================================================

  /**
   * Check if a graph workflow can be converted to sequential format
   */
  canConvertToSequential(workflow: Workflow): LinearizabilityResult {
    return this.linearizabilityChecker.check(workflow);
  }

  // ==========================================================================
  // Preview Methods
  // ==========================================================================

  /**
   * Preview conversion without actually converting
   */
  previewConversion(
    workflow: Workflow,
    toFormat: "sequential" | "graph"
  ): ConversionPreview {
    const fromFormat = workflow.format === "graph" ? "graph" : "sequential";

    if (toFormat === "graph") {
      return this.previewToGraph(workflow);
    } else {
      return this.previewToSequential(workflow);
    }
  }

  /**
   * Preview conversion to graph format
   */
  private previewToGraph(workflow: Workflow): ConversionPreview {
    // Sequential to graph is always possible
    const warnings: ConversionWarning[] = [];

    // Check for control flow that will become explicit connections
    const controlFlowCount = workflow.actions.filter((a) =>
      ["IF", "LOOP", "SWITCH", "TRY_CATCH"].includes(a.type)
    ).length;

    if (controlFlowCount > 0) {
      warnings.push({
        code: "CONTROL_FLOW_EXPANSION",
        message: `${controlFlowCount} control flow actions will be expanded into graph connections`,
      });
    }

    // Estimate connection count
    const estimatedConnections =
      workflow.actions.length - 1 + controlFlowCount * 2;

    return {
      canConvert: true,
      fromFormat: "sequential",
      toFormat: "graph",
      changes: {
        actionsAdded: 0,
        actionsRemoved: 0,
        actionsModified: controlFlowCount,
        connectionsChanged: estimatedConnections,
      },
      warnings,
      impact: controlFlowCount > 5 ? "medium" : "low",
      recommendation: "safe",
    };
  }

  /**
   * Preview conversion to sequential format
   */
  private previewToSequential(workflow: Workflow): ConversionPreview {
    const linearizability = this.canConvertToSequential(workflow);
    const warnings: ConversionWarning[] = [];

    if (!linearizability.linearizable) {
      return {
        canConvert: false,
        fromFormat: "graph",
        toFormat: "sequential",
        linearizability,
        changes: {
          actionsAdded: 0,
          actionsRemoved: 0,
          actionsModified: 0,
          connectionsChanged: 0,
        },
        warnings: linearizability.issues.map((issue) => ({
          code: "LINEARIZABILITY_ISSUE",
          message: issue,
        })),
        impact: "high",
        recommendation: "not_recommended",
      };
    }

    // Check for potential issues
    const details = linearizability.details;
    if (details) {
      if (details.mergeNodeCount > 0) {
        warnings.push({
          code: "MERGE_NODES",
          message: `${details.mergeNodeCount} merge nodes will need to be linearized`,
        });
      }

      if (details.parallelBranchCount > 0) {
        warnings.push({
          code: "PARALLEL_BRANCHES",
          message: `${details.parallelBranchCount} parallel branches will be serialized`,
        });
      }
    }

    // Estimate changes
    const connectionCount = Object.keys(workflow.connections || {}).length;

    // Determine impact and recommendation
    let impact: ConversionPreview["impact"] = "low";
    let recommendation: ConversionPreview["recommendation"] = "safe";

    if (details) {
      if (details.mergeNodeCount > 0 || details.parallelBranchCount > 0) {
        impact = "medium";
        recommendation = "review";
      }

      if (details.mergeNodeCount > 3 || details.parallelBranchCount > 3) {
        impact = "high";
        recommendation = "caution";
      }
    }

    return {
      canConvert: true,
      fromFormat: "graph",
      toFormat: "sequential",
      linearizability,
      changes: {
        actionsAdded: 0,
        actionsRemoved: 0,
        actionsModified: 0,
        connectionsChanged: connectionCount,
      },
      warnings,
      impact,
      recommendation,
    };
  }

  // ==========================================================================
  // Validation Methods
  // ==========================================================================

  /**
   * Validate a converted workflow
   */
  validateConversion(
    original: Workflow,
    converted: Workflow
  ): ConversionValidationResult {
    return validateConversion(original, converted);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let formatConverterInstance: FormatConverter | null = null;

/**
 * Get the format converter singleton instance
 */
export function getFormatConverter(): FormatConverter {
  if (!formatConverterInstance) {
    formatConverterInstance = new FormatConverter();
  }
  return formatConverterInstance;
}

/**
 * Reset the format converter instance (for testing)
 */
export function resetFormatConverter(): void {
  formatConverterInstance = null;
}
