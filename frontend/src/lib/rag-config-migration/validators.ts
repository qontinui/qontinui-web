/**
 * Validation functions for RAG configurations
 *
 * Provides runtime validation to ensure data integrity
 */

import type {
  RAGConfig,
} from "./types";

/**
 * Validation result structure
 */
export interface ValidationResult {
  success: boolean;
  errors: string[];
}

/**
 * Validate a complete RAG configuration
 *
 * @param config - RAG configuration to validate
 * @returns Validation result with success flag and errors
 */
export function validateRAGConfig(config: unknown): ValidationResult {
  const errors: string[] = [];

  if (!config || typeof config !== "object") {
    return {
      success: false,
      errors: ["Config must be an object"],
    };
  }

  const cfg = config as Record<string, unknown>;

  // Check required top-level fields
  if (!cfg.version || typeof cfg.version !== "string") {
    errors.push("Config must have a valid version string");
  }

  if (!cfg.configType || cfg.configType !== "rag") {
    errors.push("Config must have configType set to 'rag'");
  }

  if (!cfg.metadata || typeof cfg.metadata !== "object") {
    errors.push("Config must have metadata object");
  } else {
    const metadata = cfg.metadata as Record<string, unknown>;
    if (!metadata.name || typeof metadata.name !== "string") {
      errors.push("Config metadata must have a name");
    }
    if (!metadata.createdAt || typeof metadata.createdAt !== "string") {
      errors.push("Config metadata must have createdAt timestamp");
    }
    if (!metadata.modifiedAt || typeof metadata.modifiedAt !== "string") {
      errors.push("Config metadata must have modifiedAt timestamp");
    }
  }

  if (!cfg.embeddingConfig || typeof cfg.embeddingConfig !== "object") {
    errors.push("Config must have embeddingConfig object");
  } else {
    const embeddingResult = validateEmbeddingConfig(cfg.embeddingConfig);
    if (!embeddingResult.success) {
      errors.push(...embeddingResult.errors);
    }
  }

  // Validate arrays exist (can be empty)
  if (!Array.isArray(cfg.elements)) {
    errors.push("Config must have elements array");
  } else {
    // Validate each element
    for (let i = 0; i < (cfg.elements as unknown[]).length; i++) {
      const elementResult = validateRAGElement(
        (cfg.elements as unknown[])[i]
      );
      if (!elementResult.success) {
        errors.push(
          `Element ${i}: ${elementResult.errors.join(", ")}`
        );
      }
    }
  }

  if (!Array.isArray(cfg.states)) {
    errors.push("Config must have states array");
  }

  if (!Array.isArray(cfg.workflows)) {
    errors.push("Config must have workflows array");
  }

  if (!Array.isArray(cfg.transitions)) {
    errors.push("Config must have transitions array");
  }

  if (!cfg.screenshots || typeof cfg.screenshots !== "object") {
    errors.push("Config must have screenshots object");
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single RAG element
 *
 * @param element - Element to validate
 * @returns Validation result
 */
export function validateRAGElement(element: unknown): ValidationResult {
  const errors: string[] = [];

  if (!element || typeof element !== "object") {
    return {
      success: false,
      errors: ["Element must be an object"],
    };
  }

  const el = element as Record<string, unknown>;

  // Required string fields
  const requiredStrings = [
    "id",
    "name",
    "elementType",
    "stateId",
    "stateName",
    "sourceScreenshotId",
    "elementHash",
    "createdAt",
    "updatedAt",
  ];

  for (const field of requiredStrings) {
    if (!el[field] || typeof el[field] !== "string") {
      errors.push(`Element must have ${field} as string`);
    }
  }

  // Required boolean fields
  if (typeof el.isInteractive !== "boolean") {
    errors.push("Element must have isInteractive as boolean");
  }

  if (typeof el.isDefiningElement !== "boolean") {
    errors.push("Element must have isDefiningElement as boolean");
  }

  // Validate bounding box
  if (!el.boundingBox || typeof el.boundingBox !== "object") {
    errors.push("Element must have boundingBox object");
  } else {
    const bboxResult = validateBoundingBox(el.boundingBox);
    if (!bboxResult.success) {
      errors.push(...bboxResult.errors);
    }
  }

  // Optional arrays
  if (el.dominantColors !== undefined && !Array.isArray(el.dominantColors)) {
    errors.push("Element dominantColors must be an array if present");
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Validate embedding configuration
 *
 * @param config - Embedding config to validate
 * @returns Validation result
 */
export function validateEmbeddingConfig(config: unknown): ValidationResult {
  const errors: string[] = [];

  if (!config || typeof config !== "object") {
    return {
      success: false,
      errors: ["EmbeddingConfig must be an object"],
    };
  }

  const cfg = config as Record<string, unknown>;

  // Required string fields
  const requiredStrings = [
    "textModel",
    "textModelVersion",
    "clipModel",
    "clipModelVersion",
    "dinov2Model",
    "dinov2ModelVersion",
  ];

  for (const field of requiredStrings) {
    if (!cfg[field] || typeof cfg[field] !== "string") {
      errors.push(`EmbeddingConfig must have ${field} as string`);
    }
  }

  // Required number fields
  const requiredNumbers = [
    "textEmbeddingDim",
    "clipEmbeddingDim",
    "dinov2EmbeddingDim",
  ];

  for (const field of requiredNumbers) {
    if (
      typeof cfg[field] !== "number" ||
      !Number.isInteger(cfg[field]) ||
      (cfg[field] as number) <= 0
    ) {
      errors.push(`EmbeddingConfig must have ${field} as positive integer`);
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Validate bounding box
 *
 * @param bbox - Bounding box to validate
 * @returns Validation result
 */
export function validateBoundingBox(bbox: unknown): ValidationResult {
  const errors: string[] = [];

  if (!bbox || typeof bbox !== "object") {
    return {
      success: false,
      errors: ["BoundingBox must be an object"],
    };
  }

  const box = bbox as Record<string, unknown>;

  const requiredNumbers = ["x", "y", "width", "height"];

  for (const field of requiredNumbers) {
    if (typeof box[field] !== "number") {
      errors.push(`BoundingBox must have ${field} as number`);
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Validate version format (semantic versioning)
 *
 * @param version - Version string to validate
 * @returns true if valid semantic version (X.Y.Z)
 */
export function isValidVersionFormat(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * Validate state references in elements
 *
 * Ensures all elements reference valid states
 *
 * @param config - RAG configuration
 * @returns Validation result
 */
export function validateStateReferences(config: RAGConfig): ValidationResult {
  const errors: string[] = [];

  // Build set of valid state IDs
  const stateIds = new Set(config.states.map((s) => s.id));

  // Check each element's stateId
  for (const element of config.elements) {
    if (!stateIds.has(element.stateId)) {
      errors.push(
        `Element '${element.id}' references non-existent state '${element.stateId}'`
      );
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Validate workflow references in transitions
 *
 * Ensures all transitions reference valid workflows
 *
 * @param config - RAG configuration
 * @returns Validation result
 */
export function validateWorkflowReferences(
  config: RAGConfig
): ValidationResult {
  const errors: string[] = [];

  // Build set of valid workflow IDs
  const workflowIds = new Set(config.workflows.map((w) => w.id));

  // Check each transition's workflowId
  for (const transition of config.transitions) {
    if (!workflowIds.has(transition.workflowId)) {
      errors.push(
        `Transition '${transition.id}' references non-existent workflow '${transition.workflowId}'`
      );
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Validate element references in states
 *
 * Ensures all state element references are valid
 *
 * @param config - RAG configuration
 * @returns Validation result
 */
export function validateElementReferences(config: RAGConfig): ValidationResult {
  const errors: string[] = [];

  // Build set of valid element IDs
  const elementIds = new Set(config.elements.map((e) => e.id));

  // Check defining and optional element IDs in states
  for (const state of config.states) {
    for (const elementId of state.definingElementIds) {
      if (!elementIds.has(elementId)) {
        errors.push(
          `State '${state.id}' references non-existent defining element '${elementId}'`
        );
      }
    }

    if (state.optionalElementIds) {
      for (const elementId of state.optionalElementIds) {
        if (!elementIds.has(elementId)) {
          errors.push(
            `State '${state.id}' references non-existent optional element '${elementId}'`
          );
        }
      }
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Comprehensive validation of a RAG config
 *
 * Validates structure, types, and references
 *
 * @param config - RAG configuration to validate
 * @returns Validation result with all errors
 */
export function validateRAGConfigComprehensive(
  config: RAGConfig
): ValidationResult {
  const results: ValidationResult[] = [
    validateRAGConfig(config),
    validateStateReferences(config),
    validateWorkflowReferences(config),
    validateElementReferences(config),
  ];

  const allErrors = results.flatMap((r) => r.errors);

  return {
    success: allErrors.length === 0,
    errors: allErrors,
  };
}
