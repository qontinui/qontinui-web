/**
 * Migration: v1.0.0 → v2.0.0
 *
 * Handles legacy config formats and brings them up to v2.0.0
 *
 * Key changes:
 * - Ensures workflow format is 'graph' (not 'sequential' or 'node-edge')
 * - Ensures connections object exists
 * - Ensures actions have positions
 * - Normalizes action config structures
 */

import type { Migration, MigrationContext } from "../migration-types";
import { validateConfig, validateWorkflows } from "../validation-schemas";

export const migrationV1ToV2: Migration = {
  fromVersion: "1.0.0",
  toVersion: "2.0.0",
  description: "Migrate legacy formats to modern v2.0.0 graph format",

  migrate(config: any, context: MigrationContext): any {
    const migrated = structuredClone(config);

    // Ensure workflows array exists
    if (!migrated.workflows) {
      migrated.workflows = [];
    }

    // Migrate each workflow
    for (const workflow of migrated.workflows) {
      // Ensure format is 'graph'
      if (!workflow.format || workflow.format !== "graph") {
        workflow.format = "graph";
        context.warnings.push(
          `Workflow ${workflow.id}: Updated format to 'graph'`
        );
      }

      // Ensure connections object exists
      if (!workflow.connections) {
        workflow.connections = {};
        context.warnings.push(
          `Workflow ${workflow.id}: Added missing connections object`
        );
      }

      // Ensure actions array exists
      if (!workflow.actions) {
        workflow.actions = [];
      }

      // Ensure each action has a position
      let needsPosition = false;
      for (let i = 0; i < workflow.actions.length; i++) {
        const action = workflow.actions[i];

        if (
          !action.position ||
          !Array.isArray(action.position) ||
          action.position.length !== 2
        ) {
          // Auto-generate position in a grid layout
          const col = i % 4;
          const row = Math.floor(i / 4);
          action.position = [100 + col * 300, 100 + row * 200];
          needsPosition = true;
        }
      }

      if (needsPosition) {
        context.warnings.push(
          `Workflow ${workflow.id}: Added missing action positions`
        );
      }

      // Ensure workflow version field exists
      if (!workflow.version) {
        workflow.version = "1.0.0";
      }
    }

    // Update config version
    migrated.version = "2.0.0";

    return migrated;
  },

  isApplicable(config: any): boolean {
    // Check if any workflows need migration
    for (const workflow of config.workflows || []) {
      // Check for missing format or non-graph format
      if (!workflow.format || workflow.format !== "graph") {
        return true;
      }
      // Check for missing connections
      if (!workflow.connections) {
        return true;
      }
      // Check for actions without positions
      for (const action of workflow.actions || []) {
        if (!action.position || !Array.isArray(action.position)) {
          return true;
        }
      }
    }
    return false;
  },

  validate(config: any): boolean {
    // Use Zod schema validation for strict type checking
    const schemaResult = validateConfig(config, "2.0.0");
    if (!schemaResult.success) {
      console.error("v1→v2 migration validation errors:", schemaResult.errors);
      return false;
    }

    // Additional workflow-specific validation
    const workflowResult = validateWorkflows(config);
    if (!workflowResult.success) {
      console.error("v1→v2 workflow validation errors:", workflowResult.errors);
      return false;
    }

    return true;
  },
};
