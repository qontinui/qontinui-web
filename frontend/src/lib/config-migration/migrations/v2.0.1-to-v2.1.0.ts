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

  migrate(config: unknown, context: MigrationContext): unknown {
    const migrated = structuredClone(config) as Record<string, unknown>;

    // Track conversion count
    let convertedCount = 0;

    // Ensure workflows array exists
    if (!migrated.workflows) {
      migrated.workflows = [];
    }

    // Migrate each workflow
    for (const workflow of migrated.workflows as Array<Record<string, unknown>>) {
      // Ensure actions array exists
      if (!workflow.actions) {
        workflow.actions = [];
      }

      // Convert FIND_STATE_IMAGE actions to FIND with stateImage target
      for (const action of workflow.actions as Array<Record<string, unknown>>) {
        if (action.type === "FIND_STATE_IMAGE") {
          // Get the stateId from either field name
          const actionConfig = action.config as Record<string, unknown> | undefined;
          const stateId = actionConfig?.stateId || actionConfig?.state || "";

          // Convert action type
          action.type = "FIND";

          // Create new target with stateImage type
          action.config = {
            ...actionConfig,
            target: {
              type: "stateImage",
              stateId: stateId,
              imageIds: [], // Will be populated from state at runtime
            },
          };

          // Remove legacy fields
          const newConfig = action.config as Record<string, unknown>;
          delete newConfig.stateId;
          delete newConfig.state;
          delete newConfig.stateName;

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
  isApplicable(config: unknown): boolean {
    const configObj = config as Record<string, unknown>;
    if (!configObj.workflows) return false;

    // Check if any workflow has FIND_STATE_IMAGE actions
    for (const workflow of configObj.workflows as Array<Record<string, unknown>>) {
      if (workflow.actions) {
        for (const action of workflow.actions as Array<Record<string, unknown>>) {
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
  validate(migratedConfig: unknown): boolean {
    const configObj = migratedConfig as Record<string, unknown>;
    // Ensure no FIND_STATE_IMAGE actions remain
    if (configObj.workflows) {
      for (const workflow of configObj.workflows as Array<Record<string, unknown>>) {
        if (workflow.actions) {
          for (const action of workflow.actions as Array<Record<string, unknown>>) {
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
    if (configObj.workflows) {
      for (const workflow of configObj.workflows as Array<Record<string, unknown>>) {
        if (workflow.actions) {
          for (const action of workflow.actions as Array<Record<string, unknown>>) {
            const actionConfig = action.config as Record<string, unknown> | undefined;
            const target = actionConfig?.target as Record<string, unknown> | undefined;
            if (
              action.type === "FIND" &&
              target?.type === "stateImage"
            ) {
              // Validate stateImage target structure
              if (typeof target.stateId !== "string") {
                console.error(
                  "Validation failed: stateImage target missing stateId"
                );
                return false;
              }
              if (!Array.isArray(target.imageIds)) {
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
