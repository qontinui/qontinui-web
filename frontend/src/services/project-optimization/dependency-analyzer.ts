/**
 * Dependency Analyzer Module
 *
 * Responsible for analyzing dependencies and impact:
 * - Project dependencies
 * - Critical resources
 * - Circular dependencies
 * - Impact analysis
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type { State, ImageAsset } from "@/contexts/automation-context/types";
import { WorkflowDependencyAnalyzer } from "../workflow-dependency-analyzer";

/**
 * Analyze project dependencies
 */
export function analyzeProjectDependencies(workflows: Workflow[]) {
  const dependencyAnalyzer = WorkflowDependencyAnalyzer.getInstance();
  return dependencyAnalyzer.buildDependencyGraph(workflows);
}

/**
 * Find critical resources (most depended-on)
 */
export function findCriticalResources(
  workflows: Workflow[],
  limit: number = 10
): Array<{
  id: string;
  name: string;
  type: "workflow";
  dependentCount: number;
}> {
  const dependencyAnalyzer = WorkflowDependencyAnalyzer.getInstance();
  const graph = dependencyAnalyzer.buildDependencyGraph(workflows);

  return Array.from(graph.nodes.values())
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, limit)
    .map((node) => ({
      id: node.id,
      name: node.name,
      type: "workflow" as const,
      dependentCount: node.inDegree,
    }));
}

/**
 * Find circular dependencies
 */
export function findCircularDependencies(workflows: Workflow[]): string[][] {
  const dependencyAnalyzer = WorkflowDependencyAnalyzer.getInstance();
  return dependencyAnalyzer.findCircularDependencies(workflows);
}

/**
 * Get impact analysis for a resource
 */
export function getImpactAnalysis(
  resourceId: string,
  type: "workflow" | "state" | "image",
  workflows: Workflow[],
  states: State[],
  images: ImageAsset[]
) {
  const dependencyAnalyzer = WorkflowDependencyAnalyzer.getInstance();

  if (type === "workflow") {
    return dependencyAnalyzer.getImpactAnalysis(resourceId, workflows);
  }

  // For states and images, analyze usage
  const affectedWorkflows: string[] = [];
  const affectedStates: string[] = [];

  if (type === "image") {
    // Find states using this image
    states.forEach((state) => {
      const usesImage = state.stateImages.some((si) =>
        si.patterns.some((p) => p.imageId === resourceId)
      );
      if (usesImage) {
        affectedStates.push(state.id);
      }
    });

    // Find workflows using this image
    workflows.forEach((workflow) => {
      const usesImage = workflow.actions.some((action) => {
        const config = action.config as any;
        return (
          config.target?.image === resourceId || config.imageId === resourceId
        );
      });
      if (usesImage) {
        affectedWorkflows.push(workflow.id);
      }
    });
  } else if (type === "state") {
    // Find workflows using this state
    workflows.forEach((workflow) => {
      const usesState = workflow.actions.some((action) => {
        if (action.type === "GO_TO_STATE") {
          const config = action.config as any;
          return config.stateId === resourceId;
        }
        return false;
      });
      if (usesState) {
        affectedWorkflows.push(workflow.id);
      }
    });
  }

  const totalAffected = affectedWorkflows.length + affectedStates.length;

  return {
    workflowId: resourceId,
    directDependents: [...affectedWorkflows, ...affectedStates],
    allDependents: [...affectedWorkflows, ...affectedStates],
    criticalPaths: [],
    impactLevel:
      totalAffected === 0
        ? "low"
        : totalAffected <= 2
          ? "medium"
          : totalAffected <= 5
            ? "high"
            : ("critical" as const),
    affectedCount: totalAffected,
  };
}
