/**
 * Migration: v2.4.0 → v2.5.0
 *
 * Adds TRIGGER_AI_ANALYSIS action type for autonomous debugging
 *
 * Key changes:
 * - Adds TRIGGER_AI_ANALYSIS action type for invoking AI assistants
 * - AI assistants can analyze automation results and fix issues
 * - Supports provider selection (currently: claude)
 *
 * No data transformation needed - this is a schema extension.
 * Existing configs without TRIGGER_AI_ANALYSIS actions will work as-is.
 */

import type { Migration, MigrationContext } from "../migration-types";

export const migrationV24ToV25: Migration = {
  fromVersion: "2.4.0",
  toVersion: "2.5.0",
  description:
    "Add TRIGGER_AI_ANALYSIS action type for autonomous debugging with AI assistants",

  migrate(config: any, context: MigrationContext): any {
    const migrated = structuredClone(config);

    // This migration is purely additive - no transformation needed
    // TRIGGER_AI_ANALYSIS is a new action type that can now be used

    // Add informational message about the new feature
    context.warnings.push(
      "New TRIGGER_AI_ANALYSIS action type is now available. " +
        "Use it to invoke AI assistants (like Claude) to analyze automation results and autonomously fix issues."
    );

    // Update config version
    migrated.version = "2.5.0";

    return migrated;
  },

  /**
   * This migration is always applicable - it's a schema extension
   */
  isApplicable(_config: any): boolean {
    return true;
  },

  /**
   * Validate the migrated config
   * - If TRIGGER_AI_ANALYSIS actions exist, validate their configs
   */
  validate(migratedConfig: any): boolean {
    if (migratedConfig.workflows && Array.isArray(migratedConfig.workflows)) {
      for (const workflow of migratedConfig.workflows) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions) {
            if (action.type === "TRIGGER_AI_ANALYSIS") {
              // Validate provider if specified
              if (action.config?.provider) {
                const validProviders = ["claude"];
                if (!validProviders.includes(action.config.provider)) {
                  console.error(
                    `Validation failed: TRIGGER_AI_ANALYSIS action "${action.id}" has invalid provider "${action.config.provider}". Valid providers: ${validProviders.join(", ")}`
                  );
                  return false;
                }
              }

              // Validate timeout if specified (must be positive number)
              if (
                action.config?.timeout !== undefined &&
                (typeof action.config.timeout !== "number" ||
                  action.config.timeout <= 0)
              ) {
                console.error(
                  `Validation failed: TRIGGER_AI_ANALYSIS action "${action.id}" has invalid timeout "${action.config.timeout}". Must be a positive number.`
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
