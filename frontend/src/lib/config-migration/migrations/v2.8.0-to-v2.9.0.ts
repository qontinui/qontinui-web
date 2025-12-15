/**
 * Migration: v2.8.0 → v2.9.0
 *
 * Adds searchMode field to StateImage for controlling how multiple patterns are searched
 *
 * Key changes:
 * - Adds searchMode?: "separate" | "combined" to StateImage
 * - "separate" (default): Search each pattern individually in RAG system
 * - "combined": Use a single combined embedding of all patterns for RAG search
 * - All existing StateImages default to "separate" mode for backward compatibility
 *
 * Data transformation:
 * - Iterates through all states
 * - For each state, iterates through stateImages array if it exists
 * - Adds searchMode: "separate" to any StateImage that doesn't have it
 */

import type { Migration, MigrationContext } from "../migration-types";

export const migrationV28ToV29: Migration = {
  fromVersion: "2.8.0",
  toVersion: "2.9.0",
  description:
    "Add searchMode field to StateImage for controlling pattern search behavior in RAG system",

  migrate(
    config: Record<string, unknown>,
    context: MigrationContext
  ): Record<string, unknown> {
    const migrated = structuredClone(config);

    // Add searchMode field to StateImage elements
    let stateImagesUpdated = 0;
    if (migrated.states && Array.isArray(migrated.states)) {
      for (const state of migrated.states) {
        // Add searchMode to stateImages
        if (state.stateImages && Array.isArray(state.stateImages)) {
          for (const stateImage of state.stateImages) {
            if (!stateImage.searchMode) {
              stateImage.searchMode = "separate"; // Default to separate for backward compatibility
              stateImagesUpdated++;
            }
          }
        }
      }
    }

    // Add informational messages about the new feature
    if (stateImagesUpdated > 0) {
      context.warnings.push(
        `Added searchMode field to ${stateImagesUpdated} StateImage element(s). ` +
          'All StateImages default to searchMode: "separate" (search each pattern individually). ' +
          'You can change this to "combined" in the Advanced Properties section to use a combined embedding vector.'
      );
    }

    context.warnings.push(
      "New searchMode option is now available for StateImages with multiple patterns. " +
        "Use this to control whether patterns are searched separately or as a combined vector in the RAG system."
    );

    // Update config version
    migrated.version = "2.9.0";

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
   * - Ensure all StateImage elements have a valid searchMode field
   */
  validate(migratedConfig: Record<string, unknown>): boolean {
    if (migratedConfig.states && Array.isArray(migratedConfig.states)) {
      for (const state of migratedConfig.states) {
        if (state.stateImages && Array.isArray(state.stateImages)) {
          for (const stateImage of state.stateImages) {
            // searchMode is optional, but if present, must be valid
            if (stateImage.searchMode !== undefined) {
              if (
                stateImage.searchMode !== "separate" &&
                stateImage.searchMode !== "combined"
              ) {
                console.error(
                  `Validation failed: StateImage "${stateImage.id}" in state "${state.id}" has invalid searchMode: "${stateImage.searchMode}". Must be "separate" or "combined".`
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
