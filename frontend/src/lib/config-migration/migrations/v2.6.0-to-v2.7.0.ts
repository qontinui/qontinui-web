/**
 * Migration: v2.6.0 → v2.7.0
 *
 * Adds RECURSIVE_VERIFY action for AI-powered recursive verification workflows
 *
 * Key changes:
 * - Adds RECURSIVE_VERIFY action type for recursively verifying states with AI
 * - This action takes a list of states, screenshot states, a goal, and iteration limits
 * - AI will iterate through states, taking screenshots, and fixing issues until success
 *
 * The RECURSIVE_VERIFY action config includes:
 * - states: Array of state names to verify in sequence
 * - screenshotStates: Array of state names where screenshots should be captured
 * - goal: Natural language description of what to verify
 * - maxIterations: Maximum number of verification attempts (default: 10)
 * - timeout: Maximum execution time in milliseconds (default: 600000)
 */

import type { Migration, MigrationContext } from "../migration-types";

export const migrationV26ToV27: Migration = {
  fromVersion: "2.6.0",
  toVersion: "2.7.0",
  description:
    "Add RECURSIVE_VERIFY action for AI-powered recursive state verification",

  migrate(
    config: Record<string, unknown>,
    context: MigrationContext
  ): Record<string, unknown> {
    const migrated = structuredClone(config);

    // Check if there are any RECURSIVE_VERIFY actions that need validation info
    let recursiveVerifyCount = 0;
    if (migrated.workflows && Array.isArray(migrated.workflows)) {
      for (const workflow of migrated.workflows) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions) {
            if (action.type === "RECURSIVE_VERIFY") {
              recursiveVerifyCount++;
            }
          }
        }
      }
    }

    // Add informational message about the new action type
    context.warnings.push(
      "New RECURSIVE_VERIFY action type is now available. " +
        "Use it to recursively verify states with AI assistance, automatically fixing issues until success or max iterations."
    );

    if (recursiveVerifyCount > 0) {
      context.warnings.push(
        `Found ${recursiveVerifyCount} RECURSIVE_VERIFY action(s). ` +
          "Ensure each has 'states' array and 'goal' configured."
      );
    }

    // Update config version
    migrated.version = "2.7.0";

    return migrated;
  },

  /**
   * This migration is always applicable - it's a schema extension
   */
  isApplicable(): boolean {
    return true;
  },

  /**
   * Validate the migrated config
   * - If RECURSIVE_VERIFY actions exist, validate their configs
   */
  validate(migratedConfig: Record<string, unknown>): boolean {
    if (migratedConfig.workflows && Array.isArray(migratedConfig.workflows)) {
      for (const workflow of migratedConfig.workflows) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions) {
            if (action.type === "RECURSIVE_VERIFY") {
              // Validate required 'states' array
              if (!action.config?.states || !Array.isArray(action.config.states)) {
                console.error(
                  `Validation failed: RECURSIVE_VERIFY action "${action.id}" requires a 'states' array in config`
                );
                return false;
              }

              // Validate states array is not empty
              if (action.config.states.length === 0) {
                console.error(
                  `Validation failed: RECURSIVE_VERIFY action "${action.id}" requires at least one state in 'states' array`
                );
                return false;
              }

              // Validate goal if specified (should be a string)
              if (action.config?.goal !== undefined && typeof action.config.goal !== "string") {
                console.error(
                  `Validation failed: RECURSIVE_VERIFY action "${action.id}" 'goal' must be a string`
                );
                return false;
              }

              // Validate maxIterations if specified (should be a positive number)
              if (action.config?.maxIterations !== undefined) {
                if (
                  typeof action.config.maxIterations !== "number" ||
                  action.config.maxIterations < 1
                ) {
                  console.error(
                    `Validation failed: RECURSIVE_VERIFY action "${action.id}" 'maxIterations' must be a positive number`
                  );
                  return false;
                }
              }

              // Validate timeout if specified (should be a positive number)
              if (action.config?.timeout !== undefined) {
                if (
                  typeof action.config.timeout !== "number" ||
                  action.config.timeout < 1
                ) {
                  console.error(
                    `Validation failed: RECURSIVE_VERIFY action "${action.id}" 'timeout' must be a positive number in milliseconds`
                  );
                  return false;
                }
              }

              // Validate screenshotStates if specified (should be array of strings)
              if (action.config?.screenshotStates !== undefined) {
                if (!Array.isArray(action.config.screenshotStates)) {
                  console.error(
                    `Validation failed: RECURSIVE_VERIFY action "${action.id}" 'screenshotStates' must be an array`
                  );
                  return false;
                }
                for (const state of action.config.screenshotStates) {
                  if (typeof state !== "string") {
                    console.error(
                      `Validation failed: RECURSIVE_VERIFY action "${action.id}" 'screenshotStates' must contain only strings`
                    );
                    return false;
                  }
                }
              }
            }
          }
        }
      }
    }

    return true;
  },
};
