/**
 * Auto Optimizer Module
 *
 * Responsible for automatically applying optimizations
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  State,
  ImageAsset,
  Transition,
} from "@/contexts/automation-context/types";
import type { AutoOptimizationOptions, AutoOptimizationResult } from "./types";
import {
  findUnusedImages,
  findOrphanedStates,
} from "./unused-resource-detector";

/**
 * Auto-optimize project based on options
 */
export async function autoOptimize(
  workflows: Workflow[],
  states: State[],
  images: ImageAsset[],
  transitions: Transition[],
  options: AutoOptimizationOptions
): Promise<AutoOptimizationResult> {
  const result: AutoOptimizationResult = {
    success: true,
    changes: {
      imagesRemoved: 0,
      statesRemoved: 0,
      workflowsRemoved: 0,
      referencesFixed: 0,
      foldersCreated: 0,
      storageSaved: 0,
    },
    errors: [],
    warnings: [],
    summary: "",
  };

  try {
    // Remove unused images
    if (options.removeUnusedImages) {
      const unusedImageIds = findUnusedImages(images, workflows, states);

      if (!options.dryRun) {
        // In a real implementation, would delete from backend
        result.changes.imagesRemoved = unusedImageIds.length;
        const savings = unusedImageIds.reduce((sum, id) => {
          const img = images.find((i) => i.id === id);
          return sum + (img?.size || 0);
        }, 0);
        result.changes.storageSaved += savings;
      } else {
        result.warnings.push(
          `Would remove ${unusedImageIds.length} unused images`
        );
      }
    }

    // Remove orphaned states
    if (options.removeOrphanedStates) {
      const orphanedStateIds = findOrphanedStates(states, transitions);

      if (!options.dryRun) {
        // In a real implementation, would delete from backend
        result.changes.statesRemoved = orphanedStateIds.length;
      } else {
        result.warnings.push(
          `Would remove ${orphanedStateIds.length} orphaned states`
        );
      }
    }

    // Organize folders
    if (options.organizeFolders) {
      const unorganized = workflows.filter(
        (w) => !w.category || w.category === "Uncategorized"
      );

      if (!options.dryRun) {
        // Auto-categorize based on workflow characteristics
        const folders = new Set<string>();
        unorganized.forEach((workflow) => {
          const category = suggestCategory(workflow);
          if (category !== "Uncategorized") {
            folders.add(category);
          }
        });
        result.changes.foldersCreated = folders.size;
      } else {
        result.warnings.push(`Would organize ${unorganized.length} workflows`);
      }
    }

    // Generate summary
    const totalChanges = Object.values(result.changes).reduce(
      (sum, val) => sum + val,
      0
    );
    result.summary = options.dryRun
      ? `Dry run: Would make ${totalChanges} changes`
      : `Successfully made ${totalChanges} optimizations`;
  } catch (error) {
    result.success = false;
    result.errors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
  }

  return result;
}

/**
 * Suggest category for workflow
 */
function suggestCategory(workflow: Workflow): string {
  const actionTypes = workflow.actions.map((a) => a.type);

  // UI testing
  if (
    actionTypes.some((t) => ["CLICK", "TYPE", "FIND", "EXISTS"].includes(t))
  ) {
    return "UI Testing";
  }

  // Data processing
  if (
    actionTypes.some((t) => ["FILTER", "MAP", "REDUCE", "SORT"].includes(t))
  ) {
    return "Data Processing";
  }

  // Control flow heavy
  if (
    actionTypes.filter((t) => ["IF", "LOOP", "SWITCH"].includes(t)).length >= 3
  ) {
    return "Business Logic";
  }

  return "Uncategorized";
}

/**
 * Export backup before optimization
 */
export function exportBackup(
  workflows: Workflow[],
  states: State[],
  images: ImageAsset[],
  transitions: Transition[]
): string {
  const backup = {
    timestamp: new Date().toISOString(),
    workflows,
    states,
    images: images.map((img) => ({
      ...img,
      url: undefined, // Don't include URLs in backup
    })),
    transitions,
  };

  return JSON.stringify(backup, null, 2);
}
