/**
 * Migration: v2.5.0 → v2.6.0
 *
 * Adds CAPTURE_CONTEXT action, template variable support, and monitor metadata
 *
 * Key changes:
 * - Adds CAPTURE_CONTEXT action type for capturing text into workflow context
 * - Adds template variable support in TRIGGER_AI_ANALYSIS prompts:
 *   - {{context.key}} - User-defined values from CAPTURE_CONTEXT
 *   - {{execution.lastError}} - Auto-populated error messages
 *   - {{execution.failedActions}} - Array of failed actions
 *   - {{execution.consoleErrors}} - Console error output
 *   - {{execution.lastScreenshot}} - Path to last screenshot
 *   - {{execution.workflowName}} - Current workflow name
 * - Adds monitor metadata to state elements (images, regions, locations)
 *   - All existing elements default to monitors: [0] (primary monitor)
 *
 * Data transformation:
 * - Adds monitors: [0] to all StateImage, StateRegion, and StateLocation elements
 */

import type { Migration, MigrationContext } from "../migration-types";

export const migrationV25ToV26: Migration = {
  fromVersion: "2.5.0",
  toVersion: "2.6.0",
  description:
    "Add CAPTURE_CONTEXT action, template variable support, and monitor metadata to state elements",

  migrate(
    config: Record<string, unknown>,
    context: MigrationContext
  ): Record<string, unknown> {
    const migrated = structuredClone(config);

    // Add monitors field to all state elements
    let elementsUpdated = 0;
    if (migrated.states && Array.isArray(migrated.states)) {
      for (const state of migrated.states) {
        // Add monitors to state images
        if (state.stateImages && Array.isArray(state.stateImages)) {
          for (const stateImage of state.stateImages) {
            if (!stateImage.monitors) {
              stateImage.monitors = [0]; // Default to primary monitor
              elementsUpdated++;
            }
          }
        }

        // Add monitors to regions
        if (state.regions && Array.isArray(state.regions)) {
          for (const region of state.regions) {
            if (!region.monitors) {
              region.monitors = [0]; // Default to primary monitor
              elementsUpdated++;
            }
          }
        }

        // Add monitors to locations (clickLocations in some contexts)
        if (state.locations && Array.isArray(state.locations)) {
          for (const location of state.locations) {
            if (!location.monitors) {
              location.monitors = [0]; // Default to primary monitor
              elementsUpdated++;
            }
          }
        }
      }
    }

    // Add informational messages about the new features
    context.warnings.push(
      "New CAPTURE_CONTEXT action type is now available. " +
        "Use it to capture text from selectors, clipboard, files, or console into workflow context."
    );
    context.warnings.push(
      "TRIGGER_AI_ANALYSIS now supports template variables. " +
        "Use {{context.key}} for captured values and {{execution.lastError}} for auto-populated execution data."
    );
    if (elementsUpdated > 0) {
      context.warnings.push(
        `Added monitor metadata to ${elementsUpdated} state elements (images, regions, locations). ` +
          "All elements default to monitors: [0] (primary monitor)."
      );
    }

    // Update config version
    migrated.version = "2.6.0";

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
   * - If CAPTURE_CONTEXT actions exist, validate their configs
   */
  validate(migratedConfig: Record<string, unknown>): boolean {
    if (migratedConfig.workflows && Array.isArray(migratedConfig.workflows)) {
      for (const workflow of migratedConfig.workflows) {
        if (workflow.actions && Array.isArray(workflow.actions)) {
          for (const action of workflow.actions) {
            if (action.type === "CAPTURE_CONTEXT") {
              // Validate required 'key' field
              if (
                !action.config?.key ||
                typeof action.config.key !== "string"
              ) {
                console.error(
                  `Validation failed: CAPTURE_CONTEXT action "${action.id}" requires a 'key' string in config`
                );
                return false;
              }

              // Validate source if specified
              if (action.config?.source) {
                const validSources = [
                  "selector",
                  "clipboard",
                  "file",
                  "console",
                ];
                if (!validSources.includes(action.config.source)) {
                  console.error(
                    `Validation failed: CAPTURE_CONTEXT action "${action.id}" has invalid source "${action.config.source}". Valid sources: ${validSources.join(", ")}`
                  );
                  return false;
                }

                // Validate source-specific required fields
                if (
                  action.config.source === "selector" &&
                  !action.config.selector
                ) {
                  console.error(
                    `Validation failed: CAPTURE_CONTEXT action "${action.id}" with source "selector" requires a 'selector' field`
                  );
                  return false;
                }
                if (
                  action.config.source === "file" &&
                  !action.config.filePath
                ) {
                  console.error(
                    `Validation failed: CAPTURE_CONTEXT action "${action.id}" with source "file" requires a 'filePath' field`
                  );
                  return false;
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
