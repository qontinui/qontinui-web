/**
 * Zod Validation Schemas for Config Versions
 *
 * Provides runtime validation for each config version to ensure data integrity
 * and catch invalid data before it enters the application.
 */

import { z } from "zod";

/**
 * Common schemas used across versions
 */

// Position in workflow canvas [x, y]
const positionSchema = z.tuple([z.number(), z.number()]);

// Base action schema (common fields across all versions)
const baseActionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  position: positionSchema.optional(),
});

// Connection in workflow graph
const connectionSchema = z.object({
  action: z.string(), // Target action ID
  type: z.string(),
  index: z.number(),
});

// Action outputs (connections from an action)
const actionOutputsSchema = z
  .object({
    main: z.array(z.array(connectionSchema)).optional(),
    success: z.array(z.array(connectionSchema)).optional(),
    error: z.array(z.array(connectionSchema)).optional(),
    true: z.array(z.array(connectionSchema)).optional(),
    false: z.array(z.array(connectionSchema)).optional(),
  })
  .catchall(z.array(z.array(connectionSchema))); // Allow SWITCH case outputs

/**
 * Version 1.0.0 Schema (Legacy Format)
 */

const workflowV1Schema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  version: z.string(),
  actions: z.array(baseActionSchema),
  // V1 may not have format or connections
  format: z.enum(["sequential", "graph"]).optional(),
  connections: z.record(actionOutputsSchema).optional(),
});

export const configV1Schema = z.object({
  version: z.string().regex(/^1\.\d+\.\d+$/), // Must be 1.x.x
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      author: z.string().optional(),
      created: z.string().optional(),
      modified: z.string().optional(),
      migrationHistory: z.array(z.any()).optional(),
    })
    .optional(),
  workflows: z.array(workflowV1Schema),
  states: z.array(z.any()).optional(),
  transitions: z.array(z.any()).optional(),
  categories: z.array(z.string()).optional(),
  images: z.array(z.any()).optional(),
});

/**
 * Version 2.0.0 Schema (Graph Format)
 */

const workflowV2Schema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  format: z.literal("graph"), // Must be 'graph' in v2.0.0+
  version: z.string(),
  actions: z.array(
    baseActionSchema.extend({
      position: positionSchema, // Required in v2.0.0+
    })
  ),
  connections: z.record(actionOutputsSchema), // Required in v2.0.0+
  metadata: z
    .object({
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
});

export const configV2Schema = z.object({
  version: z.string().regex(/^2\.0\.0$/),
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      author: z.string().optional(),
      created: z.string().optional(),
      modified: z.string().optional(),
      migrationHistory: z.array(z.any()).optional(),
    })
    .optional(),
  workflows: z.array(workflowV2Schema),
  states: z.array(z.any()).optional(),
  transitions: z.array(z.any()).optional(),
  categories: z.array(z.string()).optional(),
  images: z.array(z.any()).optional(),
  settings: z.any().optional(),
  schedules: z.array(z.any()).optional(),
  executionRecords: z.array(z.any()).optional(),
});

/**
 * Version 2.0.1 Schema (Current - No Parallel Connections)
 */

const workflowV201Schema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  format: z.literal("graph"),
  version: z.string(),
  actions: z.array(
    baseActionSchema.extend({
      position: positionSchema,
    })
  ),
  connections: z.record(
    // Ensure no 'parallel' field exists in v2.0.1
    z
      .object({
        main: z.array(z.array(connectionSchema)).optional(),
        success: z.array(z.array(connectionSchema)).optional(),
        error: z.array(z.array(connectionSchema)).optional(),
        true: z.array(z.array(connectionSchema)).optional(),
        false: z.array(z.array(connectionSchema)).optional(),
      })
      .catchall(z.array(z.array(connectionSchema)))
      .refine((outputs) => !("parallel" in outputs), {
        message: "Parallel connections not allowed in v2.0.1+",
      })
  ),
  metadata: z
    .object({
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
});

export const configV201Schema = z.object({
  version: z.string().regex(/^2\.0\.1$/),
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      author: z.string().optional(),
      created: z.string().optional(),
      modified: z.string().optional(),
      migrationHistory: z.array(z.any()).optional(),
    })
    .optional(),
  workflows: z.array(workflowV201Schema),
  states: z.array(z.any()).optional(),
  transitions: z.array(z.any()).optional(),
  categories: z.array(z.string()).optional(),
  images: z.array(z.any()).optional(),
  settings: z.any().optional(),
  schedules: z.array(z.any()).optional(),
  executionRecords: z.array(z.any()).optional(),
});

/**
 * Map of version strings to their Zod schemas
 */
export const versionSchemas = {
  "1.0.0": configV1Schema,
  "2.0.0": configV2Schema,
  "2.0.1": configV201Schema,
} as const;

/**
 * Validate a config against its version schema
 *
 * @param config - Config object to validate
 * @param version - Specific version to validate against (optional, uses config.version if not provided)
 * @returns Validation result with success flag and errors
 */
export function validateConfig(
  config: unknown,
  version?: string
): {
  success: boolean;
  errors: string[];
} {
  const targetVersion = version || config.version;

  // Get schema for version
  const schema = versionSchemas[targetVersion as keyof typeof versionSchemas];

  if (!schema) {
    return {
      success: false,
      errors: [`No validation schema found for version ${targetVersion}`],
    };
  }

  // Validate
  const result = schema.safeParse(config);

  if (result.success) {
    return {
      success: true,
      errors: [],
    };
  }

  // Extract error messages
  const errors = result.error.errors.map((err) => {
    const path = err.path.join(".");
    return `${path}: ${err.message}`;
  });

  return {
    success: false,
    errors,
  };
}

/**
 * Validate workflows in a config
 *
 * Checks that all workflows match the expected format for the config version
 *
 * @param config - Config object with workflows
 * @returns Validation result
 */
export function validateWorkflows(config: unknown): {
  success: boolean;
  errors: string[];
} {
  const version = config.version;
  const workflows = config.workflows || [];

  if (workflows.length === 0) {
    return { success: true, errors: [] };
  }

  const errors: string[] = [];

  // Version-specific workflow validation
  if (version.startsWith("2.")) {
    // v2.x.x requires graph format
    for (const workflow of workflows) {
      if (workflow.format !== "graph") {
        errors.push(
          `Workflow "${workflow.name}": format must be 'graph' in v${version}`
        );
      }

      if (!workflow.connections) {
        errors.push(
          `Workflow "${workflow.name}": connections object is required in v${version}`
        );
      }

      // Check all actions have positions
      for (const action of workflow.actions || []) {
        if (!action.position) {
          errors.push(
            `Workflow "${workflow.name}", Action "${action.name}": position is required in v${version}`
          );
        }
      }

      // v2.0.1+ specific: no parallel connections
      if (version === "2.0.1" && workflow.connections) {
        for (const [actionId, outputs] of Object.entries(
          workflow.connections
        )) {
          if ((outputs as unknown).parallel) {
            errors.push(
              `Workflow "${workflow.name}", Action ${actionId}: parallel connections not allowed in v2.0.1+`
            );
          }
        }
      }
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}
