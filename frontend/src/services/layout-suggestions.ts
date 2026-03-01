/**
 * Layout Suggestions - Smart recommendations for layout improvements
 *
 * This module analyzes workflows and provides actionable suggestions
 * for improving layout quality with quick-fix actions.
 *
 * Features:
 * - Detect common layout issues
 * - Provide actionable recommendations
 * - Quick-fix functions
 * - Severity levels
 * - Auto-fix capabilities
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import {
  calculateLayoutStatistics,
  type LayoutStatistics,
} from "./layout-statistics";
import { getLayoutService } from "./layout-service";

// ============================================================================
// Types
// ============================================================================

export type SuggestionType =
  | "overlap"
  | "alignment"
  | "spacing"
  | "edge-crossing"
  | "readability"
  | "compactness"
  | "unpositioned"
  | "aspect-ratio"
  | "density"
  | "symmetry";

export type SuggestionSeverity = "error" | "warning" | "info";

export interface LayoutSuggestion {
  /** Unique suggestion ID */
  id: string;

  /** Suggestion type */
  type: SuggestionType;

  /** Severity level */
  severity: SuggestionSeverity;

  /** Human-readable message */
  message: string;

  /** Detailed description */
  description: string;

  /** Suggested action */
  action: string;

  /** Quick-fix function */
  quickFix: (workflow: Workflow) => Workflow;

  /** Affected action IDs */
  affectedActions?: string[];

  /** Icon for UI display */
  icon?: string;
}

export interface SuggestionContext {
  workflow: Workflow;
  statistics: LayoutStatistics;
}

// ============================================================================
// Suggestion Detection
// ============================================================================

/**
 * Get all layout suggestions for a workflow
 */
export function getLayoutSuggestions(workflow: Workflow): LayoutSuggestion[] {
  const statistics = calculateLayoutStatistics(workflow);
  const context: SuggestionContext = { workflow, statistics };

  const suggestions: LayoutSuggestion[] = [
    ...detectOverlapIssues(context),
    ...detectAlignmentIssues(context),
    ...detectSpacingIssues(context),
    ...detectEdgeCrossingIssues(context),
    ...detectReadabilityIssues(context),
    ...detectCompactnessIssues(context),
    ...detectUnpositionedIssues(context),
    ...detectAspectRatioIssues(context),
    ...detectDensityIssues(context),
  ];

  return suggestions.sort((a, b) => {
    // Sort by severity (error > warning > info)
    const severityOrder = { error: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

/**
 * Get high-priority suggestions only
 */
export function getHighPrioritySuggestions(
  workflow: Workflow
): LayoutSuggestion[] {
  return getLayoutSuggestions(workflow).filter(
    (s) => s.severity === "error" || s.severity === "warning"
  );
}

/**
 * Auto-fix all applicable suggestions
 */
export function autoFixSuggestions(
  workflow: Workflow,
  suggestionTypes?: SuggestionType[]
): Workflow {
  let fixed = cloneWorkflow(workflow);
  const suggestions = getLayoutSuggestions(fixed);

  for (const suggestion of suggestions) {
    if (suggestionTypes && !suggestionTypes.includes(suggestion.type)) {
      continue;
    }

    if (suggestion.severity === "error" || suggestion.severity === "warning") {
      fixed = suggestion.quickFix(fixed);
    }
  }

  return fixed;
}

// ============================================================================
// Issue Detectors
// ============================================================================

function detectOverlapIssues(context: SuggestionContext): LayoutSuggestion[] {
  const { statistics } = context;

  if (statistics.nodesOverlapping === 0) {
    return [];
  }

  return [
    {
      id: "overlap-nodes",
      type: "overlap",
      severity: "error",
      message: `${statistics.nodesOverlapping} nodes are overlapping`,
      description:
        "Overlapping nodes make the workflow hard to read and edit. Apply auto-layout to fix spacing.",
      action: "Apply auto-layout to fix overlaps",
      quickFix: (wf) => {
        const layoutService = getLayoutService();
        const fixed = cloneWorkflow(wf);
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
      icon: "alert-circle",
    },
  ];
}

function detectAlignmentIssues(context: SuggestionContext): LayoutSuggestion[] {
  const { statistics } = context;

  if (statistics.alignment >= 0.7) {
    return [];
  }

  return [
    {
      id: "poor-alignment",
      type: "alignment",
      severity: "info",
      message: "Nodes could be better aligned",
      description:
        "Improving alignment makes the workflow cleaner and more professional.",
      action: "Align nodes",
      quickFix: (wf) => {
        const layoutService = getLayoutService();
        const fixed = cloneWorkflow(wf);
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
      icon: "align-center",
    },
  ];
}

function detectSpacingIssues(context: SuggestionContext): LayoutSuggestion[] {
  const { statistics } = context;
  const suggestions: LayoutSuggestion[] = [];

  // Too compact
  if (statistics.compactness > 0.8) {
    suggestions.push({
      id: "too-compact",
      type: "spacing",
      severity: "warning",
      message: "Layout is too dense",
      description:
        "Nodes are packed too tightly, making it hard to read and edit. Increase spacing for better readability.",
      action: "Increase spacing",
      quickFix: (wf) => {
        const layoutService = getLayoutService();
        layoutService.updateDefaultOptions({
          horizontalSpacing: 250,
          verticalSpacing: 150,
        });
        const fixed = cloneWorkflow(wf);
        layoutService.applyLayout(fixed);
        return fixed;
      },
      icon: "maximize",
    });
  }

  // Too spread out
  if (statistics.compactness < 0.2 && statistics.nodeCount > 5) {
    suggestions.push({
      id: "too-spread",
      type: "spacing",
      severity: "info",
      message: "Layout is very spread out",
      description:
        "Nodes are far apart, making the workflow harder to see at once. Consider more compact spacing.",
      action: "Decrease spacing",
      quickFix: (wf) => {
        const layoutService = getLayoutService();
        layoutService.updateDefaultOptions({
          horizontalSpacing: 150,
          verticalSpacing: 100,
        });
        const fixed = cloneWorkflow(wf);
        layoutService.applyLayout(fixed);
        return fixed;
      },
      icon: "minimize",
    });
  }

  return suggestions;
}

function detectEdgeCrossingIssues(
  context: SuggestionContext
): LayoutSuggestion[] {
  const { statistics } = context;

  if (statistics.edgeCrossings === 0) {
    return [];
  }

  const severity: SuggestionSeverity =
    statistics.edgeCrossings > 10 ? "warning" : "info";

  return [
    {
      id: "edge-crossings",
      type: "edge-crossing",
      severity,
      message: `${statistics.edgeCrossings} edge crossings detected`,
      description:
        "Edge crossings reduce readability. Try hierarchical or tree layout to minimize crossings.",
      action: "Minimize edge crossings",
      quickFix: (wf) => {
        const layoutService = getLayoutService();
        const fixed = cloneWorkflow(wf);
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
      icon: "git-branch",
    },
  ];
}

function detectReadabilityIssues(
  context: SuggestionContext
): LayoutSuggestion[] {
  const { statistics } = context;

  if (statistics.readability >= 0.7) {
    return [];
  }

  return [
    {
      id: "low-readability",
      type: "readability",
      severity: "warning",
      message: "Layout readability is low",
      description:
        "The current layout has issues affecting readability. Apply auto-layout for better clarity.",
      action: "Improve readability",
      quickFix: (wf) => {
        const layoutService = getLayoutService();
        const fixed = cloneWorkflow(wf);
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL, {
          horizontalSpacing: 200,
          verticalSpacing: 120,
        });
        return fixed;
      },
      icon: "eye",
    },
  ];
}

function detectCompactnessIssues(
  context: SuggestionContext
): LayoutSuggestion[] {
  const { statistics } = context;

  // Only suggest if extremely unbalanced
  if (statistics.compactness >= 0.15 && statistics.compactness <= 0.85) {
    return [];
  }

  return []; // Handled by spacing issues
}

function detectUnpositionedIssues(
  context: SuggestionContext
): LayoutSuggestion[] {
  const { statistics } = context;

  if (statistics.nodesWithoutPosition === 0) {
    return [];
  }

  return [
    {
      id: "unpositioned-nodes",
      type: "unpositioned",
      severity: "error",
      message: `${statistics.nodesWithoutPosition} nodes are not positioned`,
      description:
        "Some nodes have no position set. Apply auto-layout to position all nodes.",
      action: "Position all nodes",
      quickFix: (wf) => {
        const layoutService = getLayoutService();
        const fixed = cloneWorkflow(wf);
        layoutService.applyLayout(fixed);
        return fixed;
      },
      icon: "map-pin",
    },
  ];
}

function detectAspectRatioIssues(
  context: SuggestionContext
): LayoutSuggestion[] {
  const { statistics } = context;

  const ratio = statistics.boundingBoxAspectRatio;

  if (ratio >= 0.33 && ratio <= 3) {
    return []; // Acceptable range
  }

  const severity: SuggestionSeverity =
    ratio > 5 || ratio < 0.2 ? "warning" : "info";
  const isWide = ratio > 3;

  return [
    {
      id: "unbalanced-aspect-ratio",
      type: "aspect-ratio",
      severity,
      message: `Layout is too ${isWide ? "wide" : "tall"}`,
      description: `The layout has an unbalanced aspect ratio (${ratio.toFixed(2)}:1). Adjust spacing to balance dimensions.`,
      action: "Balance layout dimensions",
      quickFix: (wf) => {
        const layoutService = getLayoutService();
        const fixed = cloneWorkflow(wf);

        if (isWide) {
          // Too wide - increase vertical spacing
          layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL, {
            verticalSpacing: 150,
          });
        } else {
          // Too tall - increase horizontal spacing
          layoutService.applyLayout(fixed, LayoutStyle.HORIZONTAL, {
            horizontalSpacing: 200,
          });
        }

        return fixed;
      },
      icon: "layout",
    },
  ];
}

function detectDensityIssues(context: SuggestionContext): LayoutSuggestion[] {
  const { statistics } = context;

  // Very low density (< 0.001) means nodes are extremely spread out
  if (statistics.averageNodeDensity < 0.001 && statistics.nodeCount > 10) {
    return [
      {
        id: "low-density",
        type: "density",
        severity: "info",
        message: "Nodes are very spread out",
        description:
          "The workflow is using a lot of canvas space. Consider using a more compact layout.",
        action: "Use compact layout",
        quickFix: (wf) => {
          const layoutService = getLayoutService();
          const fixed = cloneWorkflow(wf);
          layoutService.applyLayout(fixed, LayoutStyle.TREE, {
            horizontalSpacing: 150,
            verticalSpacing: 100,
          });
          return fixed;
        },
        icon: "compress",
      },
    ];
  }

  return [];
}

// ============================================================================
// Helper Functions
// ============================================================================

function cloneWorkflow(workflow: Workflow): Workflow {
  return JSON.parse(JSON.stringify(workflow));
}

/**
 * Get suggestion count by severity
 */
export function getSuggestionCounts(suggestions: LayoutSuggestion[]): {
  error: number;
  warning: number;
  info: number;
  total: number;
} {
  return {
    error: suggestions.filter((s) => s.severity === "error").length,
    warning: suggestions.filter((s) => s.severity === "warning").length,
    info: suggestions.filter((s) => s.severity === "info").length,
    total: suggestions.length,
  };
}

/**
 * Check if workflow has any critical issues
 */
export function hasCriticalIssues(workflow: Workflow): boolean {
  const suggestions = getLayoutSuggestions(workflow);
  return suggestions.some((s) => s.severity === "error");
}

/**
 * Get suggested layout style based on issues
 */
export function getSuggestedLayoutStyle(workflow: Workflow): LayoutStyle {
  const statistics = calculateLayoutStatistics(workflow);

  // If many edge crossings, suggest hierarchical
  if (statistics.edgeCrossings > 5) {
    return LayoutStyle.HIERARCHICAL;
  }

  // If nodes overlapping, suggest hierarchical
  if (statistics.nodesOverlapping > 0) {
    return LayoutStyle.HIERARCHICAL;
  }

  // If too spread out, suggest tree
  if (statistics.compactness < 0.2) {
    return LayoutStyle.TREE;
  }

  // If few nodes, circular might be nice
  if (workflow.actions.length <= 10) {
    return LayoutStyle.CIRCULAR;
  }

  // Default to hierarchical
  return LayoutStyle.HIERARCHICAL;
}

/**
 * Format suggestion for display
 */
export function formatSuggestion(suggestion: LayoutSuggestion): string {
  return `[${suggestion.severity.toUpperCase()}] ${suggestion.message}: ${suggestion.description}`;
}

/**
 * Group suggestions by type
 */
export function groupSuggestionsByType(
  suggestions: LayoutSuggestion[]
): Record<SuggestionType, LayoutSuggestion[]> {
  const groups: Record<string, LayoutSuggestion[]> = {};

  for (const suggestion of suggestions) {
    if (!groups[suggestion.type]) {
      groups[suggestion.type] = [];
    }
    const group = groups[suggestion.type];
    if (group) {
      group.push(suggestion);
    }
  }

  return groups as Record<SuggestionType, LayoutSuggestion[]>;
}

/**
 * Get icon for suggestion severity
 */
export function getSeverityIcon(severity: SuggestionSeverity): string {
  switch (severity) {
    case "error":
      return "alert-circle";
    case "warning":
      return "alert-triangle";
    case "info":
      return "info";
  }
}

/**
 * Get color for suggestion severity
 */
export function getSeverityColor(severity: SuggestionSeverity): string {
  switch (severity) {
    case "error":
      return "red";
    case "warning":
      return "yellow";
    case "info":
      return "blue";
  }
}
