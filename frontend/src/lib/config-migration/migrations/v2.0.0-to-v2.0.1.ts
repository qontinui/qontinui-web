/**
 * Migration: v2.0.0 → v2.0.1
 *
 * Removes deprecated parallel execution connections
 *
 * Key changes:
 * - Removes 'parallel' field from all action outputs (GUI automation is sequential)
 * - Adds warning if parallel connections were present
 */

import type { Migration, MigrationContext } from "../migration-types";
import { validateConfig, validateWorkflows } from "../validation-schemas";

export const migrationV2ToV201: Migration = {
  fromVersion: "2.0.0",
  toVersion: "2.0.1",
  description:
    "Remove deprecated parallel execution connections (GUI automation is sequential)",

  migrate(config: unknown, context: MigrationContext): unknown {
    const migrated = structuredClone(config);

    // Track if any parallel connections were found
    let foundParallelConnections = false;

    // Ensure workflows array exists
    if (!migrated.workflows) {
      migrated.workflows = [];
    }

    // Migrate each workflow
    for (const workflow of migrated.workflows) {
      // Check and remove parallel connections
      if (workflow.connections) {
        for (const [actionId, outputs] of Object.entries(
          workflow.connections
        )) {
          if (outputs && typeof outputs === "object") {
            // Check if parallel field exists and has connections
            if (
              (outputs as unknown).parallel &&
              (outputs as unknown).parallel.length > 0
            ) {
              foundParallelConnections = true;
              context.warnings.push(
                `Workflow ${workflow.id} - Action ${actionId}: Removed ${(outputs as unknown).parallel.length} parallel connection(s). GUI automation requires sequential execution.`
              );
            }

            // Remove parallel field
            delete (outputs as unknown).parallel;
          }
        }
      }

      // Update workflow version
      workflow.version = "2.0.1";
    }

    // Add summary warning if parallel connections were found
    if (foundParallelConnections) {
      context.warnings.push(
        "Parallel execution connections have been removed. Qontinui uses sequential execution for GUI automation (single mouse/keyboard). FIND actions can still search multiple patterns concurrently."
      );
    }

    // Update config version
    migrated.version = "2.0.1";

    return migrated;
  },

  /**
   * Optional: Only apply this migration if parallel connections exist
   */
  isApplicable(config: unknown): boolean {
    if (!config.workflows) return false;

    // Check if any workflow has parallel connections
    for (const workflow of config.workflows) {
      if (workflow.connections) {
        for (const outputs of Object.values(workflow.connections)) {
          if (outputs && typeof outputs === "object") {
            if (
              (outputs as unknown).parallel &&
              (outputs as unknown).parallel.length > 0
            ) {
              return true;
            }
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
    // Use Zod schema validation for v2.0.1
    const schemaResult = validateConfig(migratedConfig, "2.0.1");
    if (!schemaResult.success) {
      console.error(
        "v2.0.0→v2.0.1 migration validation errors:",
        schemaResult.errors
      );
      return false;
    }

    // Additional workflow-specific validation
    const workflowResult = validateWorkflows(migratedConfig);
    if (!workflowResult.success) {
      console.error(
        "v2.0.0→v2.0.1 workflow validation errors:",
        workflowResult.errors
      );
      return false;
    }

    // Double-check: ensure no parallel connections remain
    if (migratedConfig.workflows) {
      for (const workflow of migratedConfig.workflows) {
        if (workflow.connections) {
          for (const outputs of Object.values(workflow.connections)) {
            if (outputs && typeof outputs === "object") {
              if ((outputs as unknown).parallel !== undefined) {
                console.error(
                  "Validation failed: parallel field still exists after migration"
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
