/**
 * Migration: v2.9.0 → v2.10.0
 *
 * Renames TRIGGER_AI_ANALYSIS action type to AI_PROMPT
 *
 * Key changes:
 * - Renames action type "TRIGGER_AI_ANALYSIS" to "AI_PROMPT"
 * - This is a cleaner, more descriptive name for AI-powered actions
 *
 * Data transformation:
 * - Iterates through all workflows
 * - For each workflow, iterates through actions array
 * - Renames any TRIGGER_AI_ANALYSIS action type to AI_PROMPT
 */

import type { Migration, MigrationContext } from "../migration-types";

export const migrationV29ToV210: Migration = {
  fromVersion: "2.9.0",
  toVersion: "2.10.0",
  description:
    "Rename TRIGGER_AI_ANALYSIS action type to AI_PROMPT for cleaner naming",

  migrate(
    config: Record<string, unknown>,
    context: MigrationContext
  ): Record<string, unknown> {
    const migrated = structuredClone(config);

    // Rename TRIGGER_AI_ANALYSIS to AI_PROMPT in workflows
    let actionsRenamed = 0;
    if (migrated.workflows && Array.isArray(migrated.workflows)) {
      for (const workflow of migrated.workflows) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions) {
            if (action.type === "TRIGGER_AI_ANALYSIS") {
              action.type = "AI_PROMPT";
              actionsRenamed++;
            }
          }
        }
      }
    }

    if (actionsRenamed > 0) {
      context.warnings.push(
        `Renamed ${actionsRenamed} TRIGGER_AI_ANALYSIS action(s) to AI_PROMPT. ` +
          "This is a naming change only - functionality remains the same."
      );
    }

    // Update config version
    migrated.version = "2.10.0";

    return migrated;
  },

  /**
   * This migration is always applicable
   */
  isApplicable(): boolean {
    return true;
  },

  /**
   * Validate the migrated config
   * - Ensure no TRIGGER_AI_ANALYSIS actions remain
   */
  validate(migratedConfig: Record<string, unknown>): boolean {
    if (migratedConfig.workflows && Array.isArray(migratedConfig.workflows)) {
      for (const workflow of migratedConfig.workflows) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions) {
            if (action.type === "TRIGGER_AI_ANALYSIS") {
              console.error(
                `Validation failed: Action "${action.id}" in workflow "${workflow.id}" still has TRIGGER_AI_ANALYSIS type after migration.`
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
