/**
 * Migration: v2.0.1 → v2.1.0
 *
 * Consolidates FIND_STATE_IMAGE into FIND with stateImage target
 *
 * Key changes:
 * - Converts FIND_STATE_IMAGE actions to FIND with target.type = "stateImage"
 * - Moves stateId/state field into target.stateId
 * - Adds empty imageIds array (will be populated from state at runtime)
 */

import type { Migration, MigrationContext } from "../migration-types";

export const migrationV201ToV21: Migration = {
  fromVersion: "2.0.1",
  toVersion: "2.1.0",
  description:
    "Consolidate FIND_STATE_IMAGE into FIND with stateImage target type",

  migrate(config: any, context: MigrationContext): any {
    const migrated = structuredClone(config);

    // Track conversion count
    let convertedCount = 0;

    // Ensure workflows array exists
    if (!migrated.workflows) {
      migrated.workflows = [];
    }

    // Migrate each workflow
    for (const workflow of migrated.workflows) {
      // Ensure actions array exists
      if (!workflow.actions) {
        workflow.actions = [];
      }

      // Convert FIND_STATE_IMAGE actions to FIND with stateImage target
      for (const action of workflow.actions) {
        if (action.type === "FIND_STATE_IMAGE") {
          // Get the stateId from either field name
          const stateId =
            action.config?.stateId || action.config?.state || "";

          // Convert action type
          action.type = "FIND";

          // Create new target with stateImage type
          action.config = {
            ...action.config,
            target: {
              type: "stateImage",
              stateId: stateId,
              imageIds: [], // Will be populated from state at runtime
            },
          };

          // Remove legacy fields
          delete action.config.stateId;
          delete action.config.state;
          delete action.config.stateName;

          convertedCount++;
          context.warnings.push(
            `Workflow "${workflow.name || workflow.id}" - Action "${action.name || action.id}": Converted FIND_STATE_IMAGE to FIND with stateImage target`
          );
        }
      }

      // Update workflow version
      workflow.version = "2.1.0";
    }

    // Add summary if conversions occurred
    if (convertedCount > 0) {
      context.warnings.push(
        `Converted ${convertedCount} FIND_STATE_IMAGE action(s) to FIND with stateImage target. The "Find State" functionality now uses target.type = "stateImage" within the unified FIND action.`
      );
    }

    // Update config version
    migrated.version = "2.1.0";

    return migrated;
  },

  /**
   * Only apply this migration if FIND_STATE_IMAGE actions exist
   */
  isApplicable(config: any): boolean {
    if (!config.workflows) return false;

    // Check if any workflow has FIND_STATE_IMAGE actions
    for (const workflow of config.workflows) {
      if (workflow.actions) {
        for (const action of workflow.actions) {
          if (action.type === "FIND_STATE_IMAGE") {
            return true;
          }
        }
      }
    }

    return false;
  },

  /**
   * Validate the migrated config
   */
  validate(migratedConfig: any): boolean {
    // Ensure no FIND_STATE_IMAGE actions remain
    if (migratedConfig.workflows) {
      for (const workflow of migratedConfig.workflows) {
        if (workflow.actions) {
          for (const action of workflow.actions) {
            if (action.type === "FIND_STATE_IMAGE") {
              console.error(
                "Validation failed: FIND_STATE_IMAGE action still exists after migration"
              );
              return false;
            }
          }
        }
      }
    }

    // Ensure converted actions have proper stateImage target structure
    if (migratedConfig.workflows) {
      for (const workflow of migratedConfig.workflows) {
        if (workflow.actions) {
          for (const action of workflow.actions) {
            if (
              action.type === "FIND" &&
              action.config?.target?.type === "stateImage"
            ) {
              // Validate stateImage target structure
              if (typeof action.config.target.stateId !== "string") {
                console.error(
                  "Validation failed: stateImage target missing stateId"
                );
                return false;
              }
              if (!Array.isArray(action.config.target.imageIds)) {
                console.error(
                  "Validation failed: stateImage target missing imageIds array"
                );
                return false;
              }
            }
          }
        }
      }
    }

    return true;
  },
};
