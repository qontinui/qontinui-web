/**
 * Migration: v2.3.0 → v2.4.0
 *
 * Adds SHELL and SHELL_SCRIPT action types
 *
 * Key changes:
 * - Adds SHELL action type for executing shell commands
 * - Adds SHELL_SCRIPT action type for executing multi-line scripts
 * - Both support multiple shells (bash, sh, powershell, cmd, zsh)
 * - Output can be captured as text, JSON, or lines
 *
 * No data transformation needed - this is a schema extension.
 * Existing configs without SHELL actions will work as-is.
 */

import type { Migration, MigrationContext } from "../migration-types";

export const migrationV23ToV24: Migration = {
  fromVersion: "2.3.0",
  toVersion: "2.4.0",
  description: "Add SHELL and SHELL_SCRIPT action types for command execution",

  migrate(config: unknown, context: MigrationContext): unknown {
    const migrated = structuredClone(config);

    // This migration is purely additive - no transformation needed
    // SHELL and SHELL_SCRIPT are new action types that can now be used

    // Add informational message about the new feature
    context.warnings.push(
      "New SHELL and SHELL_SCRIPT action types are now available. " +
        "Use them to execute shell commands and scripts within workflows."
    );

    // Update config version
    migrated.version = "2.4.0";

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
   * - If SHELL or SHELL_SCRIPT actions exist, validate their configs
   */
  validate(migratedConfig: unknown): boolean {
    if (migratedConfig.workflows && Array.isArray(migratedConfig.workflows)) {
      for (const workflow of migratedConfig.workflows) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions) {
            if (action.type === "SHELL") {
              // SHELL action must have a command
              if (!action.config?.command) {
                console.error(
                  `Validation failed: SHELL action "${action.id}" is missing required 'command' field`
                );
                return false;
              }
            }

            if (action.type === "SHELL_SCRIPT") {
              // SHELL_SCRIPT action must have a script
              if (!action.config?.script) {
                console.error(
                  `Validation failed: SHELL_SCRIPT action "${action.id}" is missing required 'script' field`
                );
                return false;
              }
            }

            // Validate shell type if specified
            if (
              (action.type === "SHELL" || action.type === "SHELL_SCRIPT") &&
              action.config?.shell
            ) {
              const validShells = ["bash", "sh", "powershell", "cmd", "zsh"];
              if (!validShells.includes(action.config.shell)) {
                console.error(
                  `Validation failed: Action "${action.id}" has invalid shell type "${action.config.shell}"`
                );
                return false;
              }
            }

            // Validate output format if specified
            if (
              (action.type === "SHELL" || action.type === "SHELL_SCRIPT") &&
              action.config?.outputFormat
            ) {
              const validFormats = ["text", "json", "lines", "none"];
              if (!validFormats.includes(action.config.outputFormat)) {
                console.error(
                  `Validation failed: Action "${action.id}" has invalid outputFormat "${action.config.outputFormat}"`
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
