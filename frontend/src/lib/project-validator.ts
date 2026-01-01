/**
 * Project Validator
 *
 * Consolidated validation for entire project configuration.
 * Used by both the Verify button and Export validation.
 */

import type { Workflow } from "./action-schema/action-types";
import type {
  State,
  Transition,
  ImageAsset,
} from "@/contexts/automation-context/types";
import {
  validateMonitorAssociations,
  type MonitorValidationError,
} from "./monitor-validation";
import { validateWorkflowConnections } from "./workflow-validator";

/**
 * Issue severity levels
 */
export type IssueSeverity = "error" | "warning";

/**
 * Issue category for grouping
 */
export type IssueCategory =
  | "workflow"
  | "monitor"
  | "image_reference"
  | "action_config"
  | "state";

/**
 * A single validation issue
 */
export interface ValidationIssue {
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  /** Workflow ID if issue is related to a workflow */
  workflowId?: string;
  /** Workflow name for display */
  workflowName?: string;
  /** Action ID if issue is related to an action */
  actionId?: string;
  /** State ID if issue is related to a state */
  stateId?: string;
  /** State name for display */
  stateName?: string;
  /** Image ID if issue involves a missing image */
  imageId?: string;
}

/**
 * Complete validation result
 */
export interface ProjectValidationResult {
  isValid: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
  /** Issues grouped by workflow for easy navigation */
  issuesByWorkflow: Map<string, ValidationIssue[]>;
  /** Monitor-specific errors (for backward compatibility) */
  monitorErrors: MonitorValidationError[];
}

/**
 * Input data for project validation
 */
export interface ProjectValidationInput {
  workflows: Workflow[];
  states: State[];
  transitions: Transition[];
  images: ImageAsset[];
}

/**
 * Get a human-readable display name for an action
 */
function getActionDisplayName(action: { name?: string; type: string }): string {
  if (action.name) return action.name;
  return action.type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Validate entire project configuration
 */
export function validateProject(
  input: ProjectValidationInput
): ProjectValidationResult {
  const issues: ValidationIssue[] = [];
  const issuesByWorkflow = new Map<string, ValidationIssue[]>();

  const { workflows, states, images } = input;

  // Build set of valid image IDs
  const validImageIds = new Set<string>();
  images.forEach((img) => validImageIds.add(img.id));

  // 1. Monitor validation
  const monitorErrors = validateMonitorAssociations(states);
  monitorErrors.forEach((error) => {
    issues.push({
      severity: "error",
      category: "monitor",
      message: `State "${error.stateName}": ${error.elementType} "${error.elementName}" - ${
        error.error === "missing"
          ? "No monitors assigned"
          : "Cannot use 'All Monitors' - specific monitor required"
      }`,
      stateId: error.stateId,
      stateName: error.stateName,
    });
  });

  // 2. Workflow validation (connections + action configs)
  for (const workflow of workflows) {
    const workflowIssues: ValidationIssue[] = [];

    // 2a. Connection validation (skip "will execute sequentially" for sequential workflows)
    const connectionResult = validateWorkflowConnections(
      workflow as unknown as import("./export-schema").Workflow
    );

    // Filter warnings for sequential workflows
    const isSequentialWorkflow = workflow.metadata?.viewMode === "sequential";
    const filteredWarnings = connectionResult.warnings.filter((w) => {
      if (
        isSequentialWorkflow &&
        w.message.includes("will execute sequentially")
      ) {
        return false;
      }
      return true;
    });

    connectionResult.errors.forEach((error) => {
      const issue: ValidationIssue = {
        severity: "error",
        category: "workflow",
        message: error.message,
        workflowId: workflow.id,
        workflowName: workflow.name,
        actionId: error.actionId,
      };
      issues.push(issue);
      workflowIssues.push(issue);
    });

    filteredWarnings.forEach((warning) => {
      const issue: ValidationIssue = {
        severity: "warning",
        category: "workflow",
        message: warning.message,
        workflowId: workflow.id,
        workflowName: workflow.name,
        actionId: warning.actionId,
      };
      issues.push(issue);
      workflowIssues.push(issue);
    });

    // 2b. Action config validation + image reference validation
    for (const action of workflow.actions || []) {
      if (!action || !action.config) continue;

      const actionName = getActionDisplayName(action);
      const config = action.config as Record<string, unknown>;

      // Validate IF actions
      if (action.type === "IF") {
        const condition = config.condition as
          | Record<string, unknown>
          | undefined;
        if (condition) {
          const conditionType = condition.type as string | undefined;
          const imageId = condition.imageId as string | undefined;

          if (
            (conditionType === "image_exists" ||
              conditionType === "image_vanished") &&
            (!imageId || imageId.trim() === "")
          ) {
            const issue: ValidationIssue = {
              severity: "error",
              category: "action_config",
              message: `Action "${actionName}" has condition "${formatConditionType(conditionType)}" but no image selected`,
              workflowId: workflow.id,
              workflowName: workflow.name,
              actionId: action.id,
            };
            issues.push(issue);
            workflowIssues.push(issue);
          } else if (
            (conditionType === "image_exists" ||
              conditionType === "image_vanished") &&
            imageId &&
            !validImageIds.has(imageId)
          ) {
            const issue: ValidationIssue = {
              severity: "error",
              category: "image_reference",
              message: `Action "${actionName}" references non-existent image`,
              workflowId: workflow.id,
              workflowName: workflow.name,
              actionId: action.id,
              imageId,
            };
            issues.push(issue);
            workflowIssues.push(issue);
          }

          if (conditionType === "text_exists" && !condition.text) {
            const issue: ValidationIssue = {
              severity: "error",
              category: "action_config",
              message: `Action "${actionName}" has condition "Text Exists" but no text specified`,
              workflowId: workflow.id,
              workflowName: workflow.name,
              actionId: action.id,
            };
            issues.push(issue);
            workflowIssues.push(issue);
          }

          if (conditionType === "variable" && !condition.variableName) {
            const issue: ValidationIssue = {
              severity: "error",
              category: "action_config",
              message: `Action "${actionName}" has condition "Variable" but no variable name specified`,
              workflowId: workflow.id,
              workflowName: workflow.name,
              actionId: action.id,
            };
            issues.push(issue);
            workflowIssues.push(issue);
          }

          if (conditionType === "expression" && !condition.expression) {
            const issue: ValidationIssue = {
              severity: "error",
              category: "action_config",
              message: `Action "${actionName}" has condition "Expression" but no expression specified`,
              workflowId: workflow.id,
              workflowName: workflow.name,
              actionId: action.id,
            };
            issues.push(issue);
            workflowIssues.push(issue);
          }
        }
      }

      // Validate target-based actions (FIND, CLICK, etc.)
      const target = config.target as Record<string, unknown> | undefined;
      if (target && target.type) {
        const targetValidation = validateTargetConfig(
          target,
          actionName,
          validImageIds
        );
        if (targetValidation) {
          const issue: ValidationIssue = {
            severity: "error",
            category: targetValidation.isImageRef
              ? "image_reference"
              : "action_config",
            message: targetValidation.message,
            workflowId: workflow.id,
            workflowName: workflow.name,
            actionId: action.id,
            imageId: targetValidation.imageId,
          };
          issues.push(issue);
          workflowIssues.push(issue);
        }
      } else if (action.type === "FIND" && !target) {
        const issue: ValidationIssue = {
          severity: "error",
          category: "action_config",
          message: `Action "${actionName}" has no target configured`,
          workflowId: workflow.id,
          workflowName: workflow.name,
          actionId: action.id,
        };
        issues.push(issue);
        workflowIssues.push(issue);
      } else if (action.type === "CLICK") {
        // CLICK actions need comprehensive target validation
        const stringTarget = config.target as string | undefined;
        const hasPosition = config.x !== undefined && config.y !== undefined;

        // Check for missing target entirely (no target and no position)
        if (!target && !stringTarget && !hasPosition) {
          // CLICK without target defaults to "currentPosition" which is valid
          // Only warn if the action seems incomplete
        } else if (typeof stringTarget === "string") {
          // String target like "StateImage" requires image reference in config
          if (
            stringTarget === "StateImage" ||
            stringTarget === "image" ||
            stringTarget === "stateImage"
          ) {
            const hasImageRef =
              config.stateImageId ||
              config.imageId ||
              (Array.isArray(config.imageIds) &&
                (config.imageIds as unknown[]).length > 0);
            if (!hasImageRef) {
              const issue: ValidationIssue = {
                severity: "error",
                category: "action_config",
                message: `Action "${actionName}" has target "${stringTarget}" but no image selected`,
                workflowId: workflow.id,
                workflowName: workflow.name,
                actionId: action.id,
              };
              issues.push(issue);
              workflowIssues.push(issue);
            }
          }
        } else if (target && !target.type) {
          // Object target without type field
          const issue: ValidationIssue = {
            severity: "warning",
            category: "action_config",
            message: `Action "${actionName}" has target but no target type specified`,
            workflowId: workflow.id,
            workflowName: workflow.name,
            actionId: action.id,
          };
          issues.push(issue);
          workflowIssues.push(issue);
        }
      } else if (action.type === "DRAG") {
        // DRAG actions need source and destination validation
        const source = config.source as
          | Record<string, unknown>
          | string
          | undefined;
        const destination = config.destination as
          | Record<string, unknown>
          | string
          | undefined;

        // Validate source
        if (!source) {
          const issue: ValidationIssue = {
            severity: "error",
            category: "action_config",
            message: `Action "${actionName}" must have a source location`,
            workflowId: workflow.id,
            workflowName: workflow.name,
            actionId: action.id,
          };
          issues.push(issue);
          workflowIssues.push(issue);
        } else if (typeof source === "string") {
          // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
          if (
            source === "StateImage" ||
            source === "image" ||
            source === "stateImage"
          ) {
            const hasSourceImageRef =
              config.sourceStateImageId ||
              config.sourceImageId ||
              (Array.isArray(config.sourceImageIds) &&
                (config.sourceImageIds as unknown[]).length > 0);
            if (!hasSourceImageRef) {
              const issue: ValidationIssue = {
                severity: "error",
                category: "action_config",
                message: `Action "${actionName}" has source "${source}" but no image selected`,
                workflowId: workflow.id,
                workflowName: workflow.name,
                actionId: action.id,
              };
              issues.push(issue);
              workflowIssues.push(issue);
            }
          }
        } else if (typeof source === "object" && source !== null) {
          const sourceType = source.type as string | undefined;
          // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
          if (
            sourceType === "StateImage" ||
            sourceType === "image" ||
            sourceType === "stateImage"
          ) {
            const hasSourceImageRef =
              source.stateImageId ||
              source.imageId ||
              (Array.isArray(source.imageIds) &&
                (source.imageIds as unknown[]).length > 0);
            if (!hasSourceImageRef) {
              const issue: ValidationIssue = {
                severity: "error",
                category: "action_config",
                message: `Action "${actionName}" has source type "${sourceType}" but no image selected`,
                workflowId: workflow.id,
                workflowName: workflow.name,
                actionId: action.id,
              };
              issues.push(issue);
              workflowIssues.push(issue);
            }
          }
        }

        // Validate destination
        if (!destination) {
          const issue: ValidationIssue = {
            severity: "error",
            category: "action_config",
            message: `Action "${actionName}" must have a destination location`,
            workflowId: workflow.id,
            workflowName: workflow.name,
            actionId: action.id,
          };
          issues.push(issue);
          workflowIssues.push(issue);
        } else if (typeof destination === "string") {
          // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
          if (
            destination === "StateImage" ||
            destination === "image" ||
            destination === "stateImage"
          ) {
            const hasDestImageRef =
              config.destStateImageId ||
              config.destImageId ||
              (Array.isArray(config.destImageIds) &&
                (config.destImageIds as unknown[]).length > 0);
            if (!hasDestImageRef) {
              const issue: ValidationIssue = {
                severity: "error",
                category: "action_config",
                message: `Action "${actionName}" has destination "${destination}" but no image selected`,
                workflowId: workflow.id,
                workflowName: workflow.name,
                actionId: action.id,
              };
              issues.push(issue);
              workflowIssues.push(issue);
            }
          }
        } else if (typeof destination === "object" && destination !== null) {
          const destType = destination.type as string | undefined;
          // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
          if (
            destType === "StateImage" ||
            destType === "image" ||
            destType === "stateImage"
          ) {
            const hasDestImageRef =
              destination.stateImageId ||
              destination.imageId ||
              (Array.isArray(destination.imageIds) &&
                (destination.imageIds as unknown[]).length > 0);
            if (!hasDestImageRef) {
              const issue: ValidationIssue = {
                severity: "error",
                category: "action_config",
                message: `Action "${actionName}" has destination type "${destType}" but no image selected`,
                workflowId: workflow.id,
                workflowName: workflow.name,
                actionId: action.id,
              };
              issues.push(issue);
              workflowIssues.push(issue);
            }
          }
        }
      }

      // Validate LOOP actions with conditions
      if (action.type === "LOOP") {
        const loopType = config.loopType as string | undefined;
        if (loopType === "WHILE") {
          const condition = config.condition as
            | Record<string, unknown>
            | undefined;
          if (condition) {
            const conditionType = condition.type as string | undefined;
            const imageId = condition.imageId as string | undefined;
            if (
              (conditionType === "image_exists" ||
                conditionType === "image_vanished") &&
              (!imageId || imageId.trim() === "")
            ) {
              const issue: ValidationIssue = {
                severity: "error",
                category: "action_config",
                message: `Action "${actionName}" has WHILE condition "${formatConditionType(conditionType)}" but no image selected`,
                workflowId: workflow.id,
                workflowName: workflow.name,
                actionId: action.id,
              };
              issues.push(issue);
              workflowIssues.push(issue);
            } else if (
              (conditionType === "image_exists" ||
                conditionType === "image_vanished") &&
              imageId &&
              !validImageIds.has(imageId)
            ) {
              const issue: ValidationIssue = {
                severity: "error",
                category: "image_reference",
                message: `Action "${actionName}" WHILE condition references non-existent image`,
                workflowId: workflow.id,
                workflowName: workflow.name,
                actionId: action.id,
                imageId,
              };
              issues.push(issue);
              workflowIssues.push(issue);
            }
          }
        }
      }
    }

    if (workflowIssues.length > 0) {
      issuesByWorkflow.set(workflow.id, workflowIssues);
    }
  }

  // 3. State image reference validation
  for (const state of states) {
    for (const stateImage of state.stateImages || []) {
      for (const pattern of stateImage.patterns || []) {
        const patternObj = pattern as unknown as Record<string, unknown>;
        const imageRef =
          (patternObj.imageId as string) || (patternObj.image as string);
        if (imageRef && !validImageIds.has(imageRef)) {
          issues.push({
            severity: "error",
            category: "image_reference",
            message: `State "${state.name}": Pattern "${stateImage.name}" references non-existent image`,
            stateId: state.id,
            stateName: state.name,
            imageId: imageRef,
          });
        }
      }
    }
  }

  // Calculate counts
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    isValid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    issuesByWorkflow,
    monitorErrors,
  };
}

/**
 * Format condition type for display
 */
function formatConditionType(type: string): string {
  switch (type) {
    case "image_exists":
      return "Image Exists";
    case "image_vanished":
      return "Image Vanished";
    case "text_exists":
      return "Text Exists";
    case "variable":
      return "Variable";
    case "expression":
      return "Expression";
    default:
      return type;
  }
}

/**
 * Validate target configuration
 * Returns error info if invalid, null if valid
 */
function validateTargetConfig(
  target: Record<string, unknown>,
  actionName: string,
  validImageIds: Set<string>
): { message: string; isImageRef: boolean; imageId?: string } | null {
  const targetType = target.type as string;

  // These target types don't require additional configuration
  const selfContainedTypes = [
    "lastFindResult",
    "currentPosition",
    "allResults",
  ];
  if (selfContainedTypes.includes(targetType)) {
    return null;
  }

  switch (targetType) {
    case "image": {
      const imageId = target.imageId as string | undefined;
      const imageIds = target.imageIds as string[] | undefined;

      // Check if any image is selected
      if (!imageId && (!imageIds || imageIds.length === 0)) {
        return {
          message: `Action "${actionName}" has target type "Image" but no image selected`,
          isImageRef: false,
        };
      }

      // Helper to check if an ID is a StateImage ID (not a library image ID)
      // StateImage IDs typically start with "stateimage-" prefix
      const isStateImageId = (id: string) => id.startsWith("stateimage-");

      // Check if selected image exists (skip StateImage IDs - they're validated elsewhere)
      if (imageId && !isStateImageId(imageId) && !validImageIds.has(imageId)) {
        return {
          message: `Action "${actionName}" references non-existent image`,
          isImageRef: true,
          imageId,
        };
      }

      // Check all imageIds in array (skip StateImage IDs)
      if (imageIds) {
        for (const id of imageIds) {
          if (!isStateImageId(id) && !validImageIds.has(id)) {
            return {
              message: `Action "${actionName}" references non-existent image`,
              isImageRef: true,
              imageId: id,
            };
          }
        }
      }
      break;
    }

    case "stateImage": {
      // For stateImage targets:
      // - stateId references a State (to get all its images)
      // - imageIds contains StateImage IDs (not library image IDs)
      // We only validate that at least one selection method is present
      const stateId = target.stateId as string | undefined;
      const imageIds = target.imageIds as string[] | undefined;
      if (!stateId && (!imageIds || imageIds.length === 0)) {
        return {
          message: `Action "${actionName}" has target type "State Image" but no state selected`,
          isImageRef: false,
        };
      }
      // Note: imageIds here are StateImage IDs, not library image IDs
      // Library image validation happens at the Pattern level within StateImages
      break;
    }

    case "text":
      if (!target.text) {
        return {
          message: `Action "${actionName}" has target type "Text" but no text specified`,
          isImageRef: false,
        };
      }
      break;

    case "coordinates":
      if (!target.coordinates) {
        return {
          message: `Action "${actionName}" has target type "Coordinates" but no coordinates specified`,
          isImageRef: false,
        };
      }
      break;

    case "region":
      if (!target.region) {
        return {
          message: `Action "${actionName}" has target type "Region" but no region specified`,
          isImageRef: false,
        };
      }
      break;

    case "resultIndex":
      if (target.index === undefined || target.index === null) {
        return {
          message: `Action "${actionName}" has target type "Result Index" but no index specified`,
          isImageRef: false,
        };
      }
      break;

    case "resultByImage": {
      const imageId = target.imageId as string | undefined;
      if (!imageId) {
        return {
          message: `Action "${actionName}" has target type "Result By Image" but no image specified`,
          isImageRef: false,
        };
      }
      // Skip validation for StateImage IDs - they reference StateImages, not library images
      const isStateImageId = imageId.startsWith("stateimage-");
      if (!isStateImageId && !validImageIds.has(imageId)) {
        return {
          message: `Action "${actionName}" references non-existent image`,
          isImageRef: true,
          imageId,
        };
      }
      break;
    }

    case "stateString": {
      const stateId = target.stateId as string | undefined;
      const stringIds = target.stringIds as string[] | undefined;
      if (!stateId && (!stringIds || stringIds.length === 0)) {
        return {
          message: `Action "${actionName}" has target type "State String" but no state selected`,
          isImageRef: false,
        };
      }
      break;
    }
  }

  return null;
}
