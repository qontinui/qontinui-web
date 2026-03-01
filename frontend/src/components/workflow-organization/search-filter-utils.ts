/**
 * Search & Filter Utility Functions
 *
 * Pure functions and hooks for workflow search filtering.
 */

import { useState, useEffect } from "react";
import { Workflow } from "../../lib/action-schema/action-types";
import { SearchFilter, ComplexityLevel, WorkflowExecutionStats } from "./types";

/**
 * Debounce hook for text input
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Calculate workflow complexity based on action count and types
 */
export function calculateComplexity(workflow: Workflow): ComplexityLevel {
  const actionCount = workflow.actions.length;
  const hasControlFlow = workflow.actions.some((a) =>
    ["IF", "LOOP", "SWITCH", "TRY_CATCH"].includes(a.type)
  );
  const hasDataOps = workflow.actions.some((a) =>
    ["MAP", "REDUCE", "FILTER", "SORT"].includes(a.type)
  );

  if (actionCount <= 5 && !hasControlFlow && !hasDataOps) return "low";
  if (actionCount <= 15 && (!hasControlFlow || !hasDataOps)) return "medium";
  if (actionCount <= 30) return "high";
  return "very-high";
}

/**
 * Check if workflow matches search filter
 */
export function matchesFilter(
  workflow: Workflow,
  filter: SearchFilter,
  executionStats?: Map<string, WorkflowExecutionStats>
): boolean {
  // Text search
  if (filter.query) {
    const query = filter.query.toLowerCase();
    const searchableText = [
      workflow.name,
      workflow.description || "",
      ...(workflow.tags || []),
    ]
      .join(" ")
      .toLowerCase();

    if (!searchableText.includes(query)) {
      return false;
    }
  }

  // Folder filter
  if (filter.folderIds && filter.folderIds.length > 0) {
    const workflowFolderId =
      (workflow as { folderId?: string | null }).folderId || null;
    if (!filter.folderIds.some((id) => id === workflowFolderId)) {
      return false;
    }
  }

  // Tag filter
  if (filter.tags && filter.tags.length > 0) {
    const workflowTags = workflow.tags || [];
    if (filter.tagOperator === "AND") {
      // All tags must match
      if (!filter.tags.every((tag) => workflowTags.includes(tag))) {
        return false;
      }
    } else {
      // At least one tag must match
      if (!filter.tags.some((tag) => workflowTags.includes(tag))) {
        return false;
      }
    }
  }

  // Date range filters
  const created = workflow.metadata?.created
    ? new Date(workflow.metadata.created)
    : null;
  const updated = workflow.metadata?.updated
    ? new Date(workflow.metadata.updated)
    : null;

  if (filter.createdDateRange?.from && created) {
    if (created < filter.createdDateRange.from) {
      return false;
    }
  }

  if (filter.createdDateRange?.to && created) {
    if (created > filter.createdDateRange.to) {
      return false;
    }
  }

  if (filter.modifiedDateRange?.from && updated) {
    if (updated < filter.modifiedDateRange.from) {
      return false;
    }
  }

  if (filter.modifiedDateRange?.to && updated) {
    if (updated > filter.modifiedDateRange.to) {
      return false;
    }
  }

  // Action types filter
  if (filter.actionTypes && filter.actionTypes.length > 0) {
    const workflowActionTypes = new Set(workflow.actions.map((a) => a.type));
    if (
      !filter.actionTypes.some((type) =>
        workflowActionTypes.has(
          type as import("@/lib/action-schema/action-types").ActionType
        )
      )
    ) {
      return false;
    }
  }

  // Complexity filter
  if (filter.complexityLevel && filter.complexityLevel.length > 0) {
    const complexity = calculateComplexity(workflow);
    if (!filter.complexityLevel.includes(complexity)) {
      return false;
    }
  }

  // Category filter
  if (filter.category && workflow.category !== filter.category) {
    return false;
  }

  // Has tests filter
  if (filter.hasTests !== null && filter.hasTests !== undefined) {
    const hasTests = Boolean(workflow.initialScreenshotId);
    if (hasTests !== filter.hasTests) {
      return false;
    }
  }

  // Has documentation filter
  if (
    filter.hasDocumentation !== null &&
    filter.hasDocumentation !== undefined
  ) {
    const hasDoc = Boolean(
      workflow.description && workflow.description.length > 0
    );
    if (hasDoc !== filter.hasDocumentation) {
      return false;
    }
  }

  // ========== Execution History Filters ==========
  const stats = executionStats?.get(workflow.id);

  // Has been executed filter
  if (filter.hasBeenExecuted !== null && filter.hasBeenExecuted !== undefined) {
    const hasBeenExecuted = stats !== undefined && stats.runCount > 0;
    if (hasBeenExecuted !== filter.hasBeenExecuted) {
      return false;
    }
  }

  // Last run date range filter
  if (filter.lastRunDateRange?.from || filter.lastRunDateRange?.to) {
    if (!stats?.lastRunAt) {
      // Workflow has never been run, doesn't match date range
      return false;
    }
    const lastRun = new Date(stats.lastRunAt);
    if (
      filter.lastRunDateRange.from &&
      lastRun < filter.lastRunDateRange.from
    ) {
      return false;
    }
    if (filter.lastRunDateRange.to && lastRun > filter.lastRunDateRange.to) {
      return false;
    }
  }

  // Minimum success rate filter
  if (filter.minSuccessRate !== undefined) {
    if (!stats || stats.runCount === 0) {
      // No execution data, doesn't meet minimum success rate
      return false;
    }
    if (stats.successRate < filter.minSuccessRate) {
      return false;
    }
  }

  // Minimum run count filter
  if (filter.minRunCount !== undefined) {
    const runCount = stats?.runCount ?? 0;
    if (runCount < filter.minRunCount) {
      return false;
    }
  }

  return true;
}

/**
 * Get all unique tags from workflows
 */
export function getAllTags(workflows: Workflow[]): string[] {
  const tagSet = new Set<string>();
  workflows.forEach((w) => {
    (w.tags || []).forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}

/**
 * Get all unique action types from workflows
 */
export function getAllActionTypes(workflows: Workflow[]): string[] {
  const typeSet = new Set<string>();
  workflows.forEach((w) => {
    w.actions.forEach((a) => typeSet.add(a.type));
  });
  return Array.from(typeSet).sort();
}

/**
 * Get all unique categories from workflows
 */
export function getAllCategories(workflows: Workflow[]): string[] {
  const categorySet = new Set<string>();
  workflows.forEach((w) => {
    if (w.category) categorySet.add(w.category);
  });
  return Array.from(categorySet).sort();
}
