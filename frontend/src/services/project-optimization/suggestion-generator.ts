/**
 * Suggestion Generator Module
 *
 * Responsible for generating actionable optimization suggestions
 * based on analysis results
 */

import type {
  WorkflowAnalysis,
  StateAnalysis,
  ImageAnalysis,
  OptimizationSuggestion,
} from "./types";
import { formatBytes } from "./utils";

/**
 * Generate actionable optimization suggestions
 */
export function generateSuggestions(
  workflows: WorkflowAnalysis[],
  states: StateAnalysis[],
  images: ImageAnalysis[]
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  let suggestionId = 1;

  // Unused images
  const unusedImages = images.filter((i) => !i.isUsed);
  if (unusedImages.length > 0) {
    const totalSize = unusedImages.reduce((sum, i) => sum + i.size, 0);
    suggestions.push({
      id: `opt-${suggestionId++}`,
      type: "delete-unused-images",
      priority: totalSize > 10_000_000 ? "high" : "medium",
      title: `Delete ${unusedImages.length} unused images`,
      description: `Found ${unusedImages.length} images that are not referenced anywhere. Removing them will save ${formatBytes(totalSize)}.`,
      affectedResources: unusedImages.map((i) => ({
        type: "image",
        id: i.imageId,
        name: i.name,
      })),
      impact: {
        storageSavings: totalSize,
        maintainabilityGain: "medium",
      },
      autoFixable: true,
    });
  }

  // Workflows without tests
  const untestedWorkflows = workflows.filter((w) => !w.hasTesting);
  if (untestedWorkflows.length > 0) {
    suggestions.push({
      id: `opt-${suggestionId++}`,
      type: "add-tests",
      priority: untestedWorkflows.length > 10 ? "high" : "medium",
      title: `Add tests to ${untestedWorkflows.length} workflows`,
      description: `${untestedWorkflows.length} workflows lack automated tests. Adding tests will improve reliability.`,
      affectedResources: untestedWorkflows.map((w) => ({
        type: "workflow",
        id: w.workflowId,
        name: w.name,
      })),
      impact: {
        maintainabilityGain: "high",
      },
      autoFixable: false,
    });
  }

  // Workflows without documentation
  const undocumentedWorkflows = workflows.filter((w) => !w.hasDocumentation);
  if (undocumentedWorkflows.length > 0) {
    suggestions.push({
      id: `opt-${suggestionId++}`,
      type: "add-documentation",
      priority: undocumentedWorkflows.length > 10 ? "high" : "medium",
      title: `Document ${undocumentedWorkflows.length} workflows`,
      description: `${undocumentedWorkflows.length} workflows lack documentation. Adding documentation will improve maintainability.`,
      affectedResources: undocumentedWorkflows.map((w) => ({
        type: "workflow",
        id: w.workflowId,
        name: w.name,
      })),
      impact: {
        maintainabilityGain: "high",
      },
      autoFixable: true, // Can auto-generate
    });
  }

  // Unorganized workflows
  const unorganizedWorkflows = workflows.filter((w) => !w.isOrganized);
  if (unorganizedWorkflows.length > 0) {
    suggestions.push({
      id: `opt-${suggestionId++}`,
      type: "organize-folders",
      priority: unorganizedWorkflows.length > 20 ? "high" : "low",
      title: `Organize ${unorganizedWorkflows.length} workflows into folders`,
      description: `${unorganizedWorkflows.length} workflows are not organized. Organizing them will improve navigation.`,
      affectedResources: unorganizedWorkflows.map((w) => ({
        type: "workflow",
        id: w.workflowId,
        name: w.name,
      })),
      impact: {
        maintainabilityGain: "medium",
      },
      autoFixable: true,
    });
  }

  // Broken references
  const withBrokenRefs = [
    ...workflows
      .filter((w) => w.brokenReferences.length > 0)
      .map((w) => ({
        type: "workflow" as const,
        id: w.workflowId,
        name: w.name,
        count: w.brokenReferences.length,
      })),
    ...states
      .filter((s) => s.brokenReferences.length > 0)
      .map((s) => ({
        type: "state" as const,
        id: s.stateId,
        name: s.name,
        count: s.brokenReferences.length,
      })),
  ];

  if (withBrokenRefs.length > 0) {
    const totalBroken = withBrokenRefs.reduce((sum, r) => sum + r.count, 0);
    suggestions.push({
      id: `opt-${suggestionId++}`,
      type: "fix-broken-references",
      priority: "critical",
      title: `Fix ${totalBroken} broken references`,
      description: `Found ${totalBroken} broken references across ${withBrokenRefs.length} resources. These can cause runtime errors.`,
      affectedResources: withBrokenRefs.map((r) => ({
        type: r.type,
        id: r.id,
        name: r.name,
      })),
      impact: {
        maintainabilityGain: "high",
      },
      autoFixable: false,
    });
  }

  // High complexity workflows
  const highComplexity = workflows.filter(
    (w) => w.complexity.complexityScore > 75
  );
  if (highComplexity.length > 0) {
    suggestions.push({
      id: `opt-${suggestionId++}`,
      type: "reduce-complexity",
      priority: highComplexity.length > 5 ? "high" : "medium",
      title: `Reduce complexity in ${highComplexity.length} workflows`,
      description: `${highComplexity.length} workflows have high complexity. Consider breaking them into smaller workflows.`,
      affectedResources: highComplexity.map((w) => ({
        type: "workflow",
        id: w.workflowId,
        name: w.name,
      })),
      impact: {
        maintainabilityGain: "high",
      },
      autoFixable: false,
    });
  }

  // Orphaned states
  const orphanedStates = states.filter(
    (s) => !s.isUsed && !s.brokenReferences.length
  );
  if (orphanedStates.length > 0) {
    suggestions.push({
      id: `opt-${suggestionId++}`,
      type: "remove-orphaned-states",
      priority: "medium",
      title: `Remove ${orphanedStates.length} orphaned states`,
      description: `${orphanedStates.length} states are not referenced by any transitions. Consider removing them.`,
      affectedResources: orphanedStates.map((s) => ({
        type: "state",
        id: s.stateId,
        name: s.name,
      })),
      impact: {
        maintainabilityGain: "medium",
      },
      autoFixable: true,
    });
  }

  // Duplicate images
  const withDuplicates = images.filter((i) => i.duplicates.length > 0);
  if (withDuplicates.length > 0) {
    suggestions.push({
      id: `opt-${suggestionId++}`,
      type: "consolidate-duplicates",
      priority: "low",
      title: `Consolidate ${withDuplicates.length} potential duplicate images`,
      description: `Found ${withDuplicates.length} images with potential duplicates. Review and consolidate to save space.`,
      affectedResources: withDuplicates.map((i) => ({
        type: "image",
        id: i.imageId,
        name: i.name,
      })),
      impact: {
        storageSavings: withDuplicates.reduce((sum, i) => sum + i.size, 0) / 2,
        maintainabilityGain: "low",
      },
      autoFixable: false,
    });
  }

  // Large images
  const largeImages = images.filter((i) => i.canOptimize);
  if (largeImages.length > 0) {
    const totalSavings = largeImages.reduce(
      (sum, i) => sum + i.potentialSavings,
      0
    );
    suggestions.push({
      id: `opt-${suggestionId++}`,
      type: "optimize-storage",
      priority: totalSavings > 50_000_000 ? "high" : "low",
      title: `Optimize ${largeImages.length} large images`,
      description: `${largeImages.length} images are larger than 500KB. Optimizing them could save ${formatBytes(totalSavings)}.`,
      affectedResources: largeImages.map((i) => ({
        type: "image",
        id: i.imageId,
        name: i.name,
      })),
      impact: {
        storageSavings: totalSavings,
        performanceGain: "medium",
      },
      autoFixable: true,
    });
  }

  return suggestions.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}
