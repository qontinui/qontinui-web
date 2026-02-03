/**
 * Migration: v2.2.0 → v2.3.0
 *
 * Adds initialStateIds field to workflows
 *
 * Key changes:
 * - Adds optional initialStateIds array to workflows for model-based GUI automation
 * - This field specifies which states should be active when a workflow starts
 * - Required for Main category workflows that use state machine navigation
 *
 * No data transformation needed - this is a schema extension.
 * Existing configs without initialStateIds will work as-is (field is optional).
 */

import type { Migration, MigrationContext } from "../migration-types";

export const migrationV22ToV23: Migration = {
  fromVersion: "2.2.0",
  toVersion: "2.3.0",
  description: "Add initialStateIds support for workflow initial states",

  migrate(config: unknown, context: MigrationContext): unknown {
    interface ConfigV22 {
      workflows?: Array<{
        name?: string;
        id: string;
        category?: string;
        [key: string]: unknown;
      }>;
      version?: string;
      [key: string]: unknown;
    }
    const migrated = structuredClone(config) as ConfigV22;

    // Count workflows for informational purposes
    let _workflowCount = 0;
    let mainCategoryCount = 0;

    if (migrated.workflows && Array.isArray(migrated.workflows)) {
      for (const workflow of migrated.workflows) {
        _workflowCount++;

        // Count Main category workflows (these are the ones that typically need initialStateIds)
        if (workflow.category === "Main") {
          mainCategoryCount++;
        }

        // Note: We don't add initialStateIds automatically because:
        // 1. It's optional - workflows without it work fine
        // 2. The user should explicitly choose which states are initial
        // 3. Adding empty arrays would bloat the config unnecessarily
      }
    }

    // Add informational warning about the new feature
    if (mainCategoryCount > 0) {
      context.warnings.push(
        `Found ${mainCategoryCount} Main category workflow(s). You can now set initial states for these workflows in the workflow properties panel.`
      );
    }

    // Update config version
    migrated.version = "2.3.0";

    return migrated;
  },

  /**
   * This migration is always applicable - it's a schema extension
   */
  isApplicable(_config: unknown): boolean {
    return true;
  },

  /**
   * Validate the migrated config
   * - If initialStateIds exists, it should be an array of strings
   */
  validate(migratedConfig: unknown): boolean {
    interface ConfigV22 {
      workflows?: Array<{
        name?: string;
        id: string;
        initialStateIds?: unknown[];
      }>;
    }
    const cfg = migratedConfig as ConfigV22;
    if (cfg.workflows && Array.isArray(cfg.workflows)) {
      for (const workflow of cfg.workflows) {
        if (workflow.initialStateIds !== undefined) {
          // Must be an array
          if (!Array.isArray(workflow.initialStateIds)) {
            console.error(
              `Validation failed: Workflow "${workflow.name || workflow.id}" has non-array initialStateIds`
            );
            return false;
          }

          // All elements must be strings
          for (const stateId of workflow.initialStateIds) {
            if (typeof stateId !== "string") {
              console.error(
                `Validation failed: Workflow "${workflow.name || workflow.id}" has non-string element in initialStateIds`
              );
              return false;
            }
          }
        }
      }
    }

    return true;
  },
};
