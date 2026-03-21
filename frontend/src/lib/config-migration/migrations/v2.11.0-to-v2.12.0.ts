/**
 * Migration: v2.11.0 → v2.12.0
 *
 * Normalizes target type from "StateImage" (uppercase I) to "stateImage" (lowercase i)
 *
 * Key changes:
 * - Target type discriminator is now consistently "stateImage" (lowercase)
 * - This fixes a case sensitivity bug where Python expects lowercase but
 *   some frontend code was producing uppercase
 *
 * Data transformation:
 * - Converts target.type: "StateImage" to target.type: "stateImage"
 * - Applies to all action configs in all workflows
 */

import type { Migration, MigrationContext } from "../migration-types";
import { createLogger } from "@/lib/logger";

const log = createLogger("MigrationV2.11.0");

/**
 * Recursively normalize target types in an object
 */
function normalizeTargetTypes(
  obj: Record<string, unknown>,
  context: MigrationContext,
  path: string = ""
): void {
  // Handle target string value
  if (obj.target === "StateImage") {
    obj.target = "stateImage";
    context.warnings.push(
      `Normalized target string from "StateImage" to "stateImage" at ${path || "root"}`
    );
  }

  // Handle target object with type field
  if (obj.target && typeof obj.target === "object" && obj.target !== null) {
    const targetObj = obj.target as Record<string, unknown>;
    if (targetObj.type === "StateImage") {
      targetObj.type = "stateImage";
      context.warnings.push(
        `Normalized target.type from "StateImage" to "stateImage" at ${path || "root"}`
      );
    }
  }

  // Handle source/destination for DRAG actions
  if (obj.source && typeof obj.source === "object" && obj.source !== null) {
    const sourceObj = obj.source as Record<string, unknown>;
    if (sourceObj.type === "StateImage") {
      sourceObj.type = "stateImage";
      context.warnings.push(
        `Normalized source.type from "StateImage" to "stateImage" at ${path || "root"}`
      );
    }
  }

  if (
    obj.destination &&
    typeof obj.destination === "object" &&
    obj.destination !== null
  ) {
    const destObj = obj.destination as Record<string, unknown>;
    if (destObj.type === "StateImage") {
      destObj.type = "stateImage";
      context.warnings.push(
        `Normalized destination.type from "StateImage" to "stateImage" at ${path || "root"}`
      );
    }
  }
}

export const migrationV211ToV212: Migration = {
  fromVersion: "2.11.0",
  toVersion: "2.12.0",
  description:
    'Normalize target type from "StateImage" to "stateImage" (lowercase)',

  migrate(
    config: Record<string, unknown>,
    context: MigrationContext
  ): Record<string, unknown> {
    const migrated = structuredClone(config);
    let normalizedCount = 0;

    // Process all workflows
    if (migrated.workflows && Array.isArray(migrated.workflows)) {
      for (const workflow of migrated.workflows as Record<string, unknown>[]) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions as Record<string, unknown>[]) {
            if (action.config && typeof action.config === "object") {
              const configObj = action.config as Record<string, unknown>;
              const warningsBefore = context.warnings.length;
              normalizeTargetTypes(
                configObj,
                context,
                `workflow "${workflow.name || workflow.id}".action "${action.name || action.id}"`
              );
              if (context.warnings.length > warningsBefore) {
                normalizedCount++;
              }
            }
          }
        }
      }
    }

    if (normalizedCount > 0) {
      log.debug(
        `Normalized ${normalizedCount} action(s) with uppercase "StateImage" target type`
      );
    }

    // Update config version
    migrated.version = "2.12.0";

    return migrated;
  },

  /**
   * This migration is always applicable for v2.11.0 configs
   */
  isApplicable(_config: Record<string, unknown>): boolean {
    return true;
  },

  /**
   * Validate the migrated config - ensure no uppercase "StateImage" remains
   */
  validate(migratedConfig: Record<string, unknown>): boolean {
    // Check workflows for any remaining uppercase StateImage
    if (migratedConfig.workflows && Array.isArray(migratedConfig.workflows)) {
      for (const workflow of migratedConfig.workflows as Record<
        string,
        unknown
      >[]) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions as Record<string, unknown>[]) {
            if (action.config && typeof action.config === "object") {
              const configObj = action.config as Record<string, unknown>;

              // Check target string
              if (configObj.target === "StateImage") {
                console.error(
                  `Validation failed: Found uppercase "StateImage" at action ${action.id}`
                );
                return false;
              }

              // Check target object
              if (
                configObj.target &&
                typeof configObj.target === "object" &&
                (configObj.target as Record<string, unknown>).type ===
                  "StateImage"
              ) {
                console.error(
                  `Validation failed: Found uppercase "StateImage" in target.type at action ${action.id}`
                );
                return false;
              }

              // Check source/destination
              if (
                configObj.source &&
                typeof configObj.source === "object" &&
                (configObj.source as Record<string, unknown>).type ===
                  "StateImage"
              ) {
                console.error(
                  `Validation failed: Found uppercase "StateImage" in source.type at action ${action.id}`
                );
                return false;
              }

              if (
                configObj.destination &&
                typeof configObj.destination === "object" &&
                (configObj.destination as Record<string, unknown>).type ===
                  "StateImage"
              ) {
                console.error(
                  `Validation failed: Found uppercase "StateImage" in destination.type at action ${action.id}`
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
