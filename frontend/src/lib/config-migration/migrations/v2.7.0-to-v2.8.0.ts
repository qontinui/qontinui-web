/**
 * Migration: v2.7.0 → v2.8.0
 *
 * Adds RAG_FIND action and monitors metadata to StateString elements
 *
 * Key changes:
 * - Adds RAG_FIND action type for semantic/AI-powered element search
 * - Adds monitor metadata to StateString elements (StateImage, StateRegion, StateLocation already have it from v2.6.0)
 * - All existing StateString elements default to monitors: [0] (primary monitor)
 *
 * Data transformation:
 * - Iterates through all states
 * - For each state, iterates through strings array if it exists
 * - Adds monitors: [0] to any StateString that doesn't have it
 */

import type { Migration, MigrationContext } from "../migration-types";

export const migrationV27ToV28: Migration = {
  fromVersion: "2.7.0",
  toVersion: "2.8.0",
  description:
    "Add RAG_FIND action type and monitors metadata to StateString elements",

  migrate(
    config: Record<string, unknown>,
    context: MigrationContext
  ): Record<string, unknown> {
    const migrated = structuredClone(config);

    // Add monitors field to StateString elements
    let stringsUpdated = 0;
    if (migrated.states && Array.isArray(migrated.states)) {
      for (const state of migrated.states) {
        // Add monitors to strings
        if (state.strings && Array.isArray(state.strings)) {
          for (const stateString of state.strings) {
            if (!stateString.monitors) {
              stateString.monitors = [0]; // Default to primary monitor
              stringsUpdated++;
            }
          }
        }
      }
    }

    // Check if there are any RAG_FIND actions that need validation info
    let ragFindCount = 0;
    if (migrated.workflows && Array.isArray(migrated.workflows)) {
      for (const workflow of migrated.workflows) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions) {
            if (action.type === "RAG_FIND") {
              ragFindCount++;
            }
          }
        }
      }
    }

    // Add informational messages about the new features
    context.warnings.push(
      "New RAG_FIND action type is now available. " +
        "Use it for semantic/AI-powered element search using natural language descriptions."
    );

    if (stringsUpdated > 0) {
      context.warnings.push(
        `Added monitor metadata to ${stringsUpdated} StateString element(s). ` +
          "All StateString elements default to monitors: [0] (primary monitor)."
      );
    }

    if (ragFindCount > 0) {
      context.warnings.push(
        `Found ${ragFindCount} RAG_FIND action(s). ` +
          "Ensure each has proper semantic search configuration."
      );
    }

    // Update config version
    migrated.version = "2.8.0";

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
   * - If RAG_FIND actions exist, validate their configs
   */
  validate(migratedConfig: Record<string, unknown>): boolean {
    if (migratedConfig.workflows && Array.isArray(migratedConfig.workflows)) {
      for (const workflow of migratedConfig.workflows) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions) {
            if (action.type === "RAG_FIND") {
              // Validate that RAG_FIND has proper config
              // The action should have target configuration for semantic search
              if (!action.config) {
                console.error(
                  `Validation failed: RAG_FIND action "${action.id}" requires a config object`
                );
                return false;
              }

              // RAG_FIND should have either:
              // - target.text (for semantic text search)
              // - target.description (for semantic visual element search)
              if (action.config.target) {
                const hasText = action.config.target.text;
                const hasDescription = action.config.target.description;

                if (!hasText && !hasDescription) {
                  console.error(
                    `Validation failed: RAG_FIND action "${action.id}" requires either target.text or target.description for semantic search`
                  );
                  return false;
                }
              }
            }
          }
        }
      }
    }

    // Validate that all StateString elements have monitors field
    if (migratedConfig.states && Array.isArray(migratedConfig.states)) {
      for (const state of migratedConfig.states) {
        if (state.strings && Array.isArray(state.strings)) {
          for (const stateString of state.strings) {
            if (!stateString.monitors || !Array.isArray(stateString.monitors)) {
              console.error(
                `Validation failed: StateString "${stateString.id}" in state "${state.id}" is missing monitors array`
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
