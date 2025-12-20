/**
 * Conversion Validation Service
 *
 * Validates that workflow conversions preserve data integrity and
 * maintain equivalent execution behavior.
 */

import type { Workflow, Action } from "../lib/action-schema/action-types";
import { getNextActions } from "../lib/action-schema/workflow-utils";

// ============================================================================
// Types
// ============================================================================

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  type: string;
  message: string;
  actionId?: string;
  details?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
}

export interface ConversionValidationResult extends ValidationResult {
  actionPreservation: {
    passed: boolean;
    original: number;
    converted: number;
    added: number;
    removed: number;
    modified: number;
  };
  connectionEquivalence: {
    passed: boolean;
    details: string;
  };
  controlFlowIntegrity: {
    passed: boolean;
    details: string;
  };
  variablePreservation: {
    passed: boolean;
    details: string;
  };
  metadataPreservation: {
    passed: boolean;
    details: string;
  };
}

// ============================================================================
// Main Validation Functions
// ============================================================================

/**
 * Validate a workflow conversion
 * Checks that all data is preserved and execution behavior is equivalent
 */
export function validateConversion(
  original: Workflow,
  converted: Workflow
): ConversionValidationResult {
  const issues: ValidationIssue[] = [];

  // Validate action preservation
  const actionResult = validateActionPreservation(original, converted);
  issues.push(...actionResult.issues);

  // Validate connection equivalence
  const connectionResult = validateConnectionEquivalence(original, converted);
  issues.push(...connectionResult.issues);

  // Validate control flow integrity
  const controlFlowResult = validateControlFlowIntegrity(original, converted);
  issues.push(...controlFlowResult.issues);

  // Validate variable preservation
  const variableResult = validateVariablePreservation(original, converted);
  issues.push(...variableResult.issues);

  // Validate metadata preservation
  const metadataResult = validateMetadataPreservation(original, converted);
  issues.push(...metadataResult.issues);

  // Categorize issues
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const info = issues.filter((i) => i.severity === "info");

  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
    info,
    summary: {
      totalIssues: issues.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: info.length,
    },
    actionPreservation: actionResult,
    connectionEquivalence: connectionResult,
    controlFlowIntegrity: controlFlowResult,
    variablePreservation: variableResult,
    metadataPreservation: metadataResult,
  };
}

// ============================================================================
// Action Preservation Validation
// ============================================================================

/**
 * Validate that all actions are preserved during conversion
 */
export function validateActionPreservation(
  original: Workflow,
  converted: Workflow
): ConversionValidationResult["actionPreservation"] & {
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const originalActions = new Map(original.actions.map((a) => [a.id, a]));
  const convertedActions = new Map(converted.actions.map((a) => [a.id, a]));

  let added = 0;
  let removed = 0;
  let modified = 0;

  // Check for removed actions
  for (const [id, action] of originalActions) {
    if (!convertedActions.has(id)) {
      removed++;
      issues.push({
        severity: "error",
        type: "action_removed",
        message: `Action ${id} (${action.type}) was removed during conversion`,
        actionId: id,
      });
    }
  }

  // Check for added actions
  for (const [id, action] of convertedActions) {
    if (!originalActions.has(id)) {
      added++;
      issues.push({
        severity: "info",
        type: "action_added",
        message: `Action ${id} (${action.type}) was added during conversion`,
        actionId: id,
      });
    }
  }

  // Check for modified actions
  for (const [id, originalAction] of originalActions) {
    const convertedAction = convertedActions.get(id);
    if (!convertedAction) continue;

    // Check if type changed
    if (originalAction.type !== convertedAction.type) {
      modified++;
      issues.push({
        severity: "error",
        type: "action_type_changed",
        message: `Action ${id} type changed from ${originalAction.type} to ${convertedAction.type}`,
        actionId: id,
      });
    }

    // Check if config changed significantly
    if (
      JSON.stringify(originalAction.config) !==
      JSON.stringify(convertedAction.config)
    ) {
      // Only warn if it's not a control flow action (those configs are expected to change)
      if (
        !["IF", "LOOP", "SWITCH", "TRY_CATCH"].includes(originalAction.type)
      ) {
        modified++;
        issues.push({
          severity: "warning",
          type: "action_config_changed",
          message: `Action ${id} configuration changed during conversion`,
          actionId: id,
        });
      }
    }
  }

  const passed = removed === 0 && modified === 0;

  return {
    passed,
    original: original.actions.length,
    converted: converted.actions.length,
    added,
    removed,
    modified,
    issues,
  };
}

// ============================================================================
// Connection Equivalence Validation
// ============================================================================

/**
 * Validate that connections represent equivalent execution flow
 */
export function validateConnectionEquivalence(
  original: Workflow,
  converted: Workflow
): ConversionValidationResult["connectionEquivalence"] & {
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];

  // For each action in original, check that it connects to the same next actions
  for (const action of original.actions) {
    const originalNext = getNextActions(original, action.id);
    const convertedNext = getNextActions(converted, action.id);

    // Convert to sets for comparison
    const originalNextSet = new Set(originalNext);
    const convertedNextSet = new Set(convertedNext);

    // Check for missing connections
    for (const nextId of originalNextSet) {
      if (!convertedNextSet.has(nextId)) {
        issues.push({
          severity: "error",
          type: "connection_removed",
          message: `Connection from ${action.id} to ${nextId} was removed`,
          actionId: action.id,
        });
      }
    }

    // Check for added connections
    for (const nextId of convertedNextSet) {
      if (!originalNextSet.has(nextId)) {
        issues.push({
          severity: "warning",
          type: "connection_added",
          message: `Connection from ${action.id} to ${nextId} was added`,
          actionId: action.id,
        });
      }
    }
  }

  const passed = issues.filter((i) => i.severity === "error").length === 0;

  return {
    passed,
    details: passed
      ? "All connections preserved"
      : `${issues.filter((i) => i.severity === "error").length} connection issues found`,
    issues,
  };
}

// ============================================================================
// Control Flow Integrity Validation
// ============================================================================

/**
 * Validate that control flow structures (IF, LOOP, etc.) are preserved
 */
export function validateControlFlowIntegrity(
  original: Workflow,
  converted: Workflow
): ConversionValidationResult["controlFlowIntegrity"] & {
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];

  const originalControlFlow = original.actions.filter((a) =>
    ["IF", "LOOP", "SWITCH", "TRY_CATCH"].includes(a.type)
  );

  // Check that control flow actions are preserved
  for (const action of originalControlFlow) {
    const convertedAction = converted.actions.find((a) => a.id === action.id);
    if (!convertedAction) {
      issues.push({
        severity: "error",
        type: "control_flow_removed",
        message: `Control flow action ${action.id} (${action.type}) was removed`,
        actionId: action.id,
      });
      continue;
    }

    // Validate IF actions
    if (action.type === "IF") {
      validateIfAction(action, convertedAction, issues);
    }

    // Validate LOOP actions
    if (action.type === "LOOP") {
      validateLoopAction(action, convertedAction, issues);
    }

    // Validate SWITCH actions
    if (action.type === "SWITCH") {
      validateSwitchAction(action, convertedAction, issues);
    }

    // Validate TRY_CATCH actions
    if (action.type === "TRY_CATCH") {
      validateTryCatchAction(action, convertedAction, issues);
    }
  }

  const passed = issues.filter((i) => i.severity === "error").length === 0;

  return {
    passed,
    details: passed
      ? "All control flow structures preserved"
      : `${issues.filter((i) => i.severity === "error").length} control flow issues found`,
    issues,
  };
}

/**
 * Validate IF action structure
 */
function validateIfAction(
  original: Action,
  converted: Action,
  issues: ValidationIssue[]
): void {
  const originalConfig = original.config as {
    condition?: unknown;
    thenActions?: unknown[];
    elseActions?: unknown[];
  };
  const convertedConfig = converted.config as {
    condition?: unknown;
    thenActions?: unknown[];
    elseActions?: unknown[];
  };

  // Check condition preservation
  if (
    JSON.stringify(originalConfig.condition) !==
    JSON.stringify(convertedConfig.condition)
  ) {
    issues.push({
      severity: "error",
      type: "if_condition_changed",
      message: `IF action ${original.id} condition was modified`,
      actionId: original.id,
    });
  }

  // Branches may be represented differently between formats
  // (inline actions in sequential vs action IDs in graph)
  // Just check that branches exist
  const hasThen =
    (originalConfig.thenActions?.length ?? 0) > 0 ||
    (convertedConfig.thenActions?.length ?? 0) > 0;
  const hasElse =
    (originalConfig.elseActions?.length ?? 0) > 0 ||
    (convertedConfig.elseActions?.length ?? 0) > 0;

  if (!hasThen && !hasElse) {
    issues.push({
      severity: "warning",
      type: "if_empty_branches",
      message: `IF action ${original.id} has no branches`,
      actionId: original.id,
    });
  }
}

/**
 * Validate LOOP action structure
 */
function validateLoopAction(
  original: Action,
  converted: Action,
  issues: ValidationIssue[]
): void {
  const originalConfig = original.config as {
    condition?: unknown;
    loopType?: string;
  };
  const convertedConfig = converted.config as {
    condition?: unknown;
    loopType?: string;
  };

  // Check condition preservation
  if (
    JSON.stringify(originalConfig.condition) !==
    JSON.stringify(convertedConfig.condition)
  ) {
    issues.push({
      severity: "error",
      type: "loop_condition_changed",
      message: `LOOP action ${original.id} condition was modified`,
      actionId: original.id,
    });
  }

  // Check loop type preservation
  if (originalConfig.loopType !== convertedConfig.loopType) {
    issues.push({
      severity: "error",
      type: "loop_type_changed",
      message: `LOOP action ${original.id} type changed from ${originalConfig.loopType} to ${convertedConfig.loopType}`,
      actionId: original.id,
    });
  }
}

/**
 * Validate SWITCH action structure
 */
function validateSwitchAction(
  original: Action,
  converted: Action,
  issues: ValidationIssue[]
): void {
  const originalConfig = original.config as { cases?: unknown[] };
  const convertedConfig = converted.config as { cases?: unknown[] };

  // Check case count preservation
  if (originalConfig.cases?.length !== convertedConfig.cases?.length) {
    issues.push({
      severity: "error",
      type: "switch_cases_changed",
      message: `SWITCH action ${original.id} case count changed`,
      actionId: original.id,
    });
  }
}

/**
 * Validate TRY_CATCH action structure
 */
function validateTryCatchAction(
  original: Action,
  converted: Action,
  issues: ValidationIssue[]
): void {
  const originalConfig = original.config as {
    tryActions?: unknown[];
    catchActions?: unknown[];
  };
  const convertedConfig = converted.config as {
    tryActions?: unknown[];
    catchActions?: unknown[];
  };

  // Check that try/catch blocks exist
  const hasTry =
    (originalConfig.tryActions?.length ?? 0) > 0 ||
    (convertedConfig.tryActions?.length ?? 0) > 0;
  const hasCatch =
    (originalConfig.catchActions?.length ?? 0) > 0 ||
    (convertedConfig.catchActions?.length ?? 0) > 0;

  if (!hasTry) {
    issues.push({
      severity: "warning",
      type: "try_catch_empty_try",
      message: `TRY_CATCH action ${original.id} has no try actions`,
      actionId: original.id,
    });
  }

  if (!hasCatch) {
    issues.push({
      severity: "warning",
      type: "try_catch_empty_catch",
      message: `TRY_CATCH action ${original.id} has no catch actions`,
      actionId: original.id,
    });
  }
}

// ============================================================================
// Variable Preservation Validation
// ============================================================================

/**
 * Validate that workflow variables are preserved
 */
export function validateVariablePreservation(
  original: Workflow,
  converted: Workflow
): ConversionValidationResult["variablePreservation"] & {
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];

  // Check local variables
  const originalLocal = Object.keys(original.variables?.local || {});
  const convertedLocal = Object.keys(converted.variables?.local || {});

  for (const varName of originalLocal) {
    if (!convertedLocal.includes(varName)) {
      issues.push({
        severity: "warning",
        type: "variable_removed",
        message: `Local variable "${varName}" was removed`,
      });
    }
  }

  // Check process variables
  const originalProcess = Object.keys(original.variables?.process || {});
  const convertedProcess = Object.keys(converted.variables?.process || {});

  for (const varName of originalProcess) {
    if (!convertedProcess.includes(varName)) {
      issues.push({
        severity: "warning",
        type: "variable_removed",
        message: `Process variable "${varName}" was removed`,
      });
    }
  }

  // Check global variables
  const originalGlobal = Object.keys(original.variables?.global || {});
  const convertedGlobal = Object.keys(converted.variables?.global || {});

  for (const varName of originalGlobal) {
    if (!convertedGlobal.includes(varName)) {
      issues.push({
        severity: "warning",
        type: "variable_removed",
        message: `Global variable "${varName}" was removed`,
      });
    }
  }

  const passed = issues.filter((i) => i.severity === "error").length === 0;

  return {
    passed,
    details: passed
      ? "All variables preserved"
      : `${issues.length} variable issues found`,
    issues,
  };
}

// ============================================================================
// Metadata Preservation Validation
// ============================================================================

/**
 * Validate that workflow metadata is preserved
 */
export function validateMetadataPreservation(
  original: Workflow,
  converted: Workflow
): ConversionValidationResult["metadataPreservation"] & {
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];

  // Check name preservation
  if (original.name !== converted.name) {
    issues.push({
      severity: "warning",
      type: "metadata_name_changed",
      message: `Workflow name changed from "${original.name}" to "${converted.name}"`,
    });
  }

  // Check version preservation
  if (original.version !== converted.version) {
    issues.push({
      severity: "info",
      type: "metadata_version_changed",
      message: `Workflow version changed from "${original.version}" to "${converted.version}"`,
    });
  }

  // Check tags preservation
  const originalTags = original.tags || [];
  const convertedTags = converted.tags || [];

  if (JSON.stringify(originalTags) !== JSON.stringify(convertedTags)) {
    issues.push({
      severity: "info",
      type: "metadata_tags_changed",
      message: "Workflow tags were modified",
    });
  }

  const passed = issues.filter((i) => i.severity === "error").length === 0;

  return {
    passed,
    details: passed
      ? "All metadata preserved"
      : `${issues.length} metadata issues found`,
    issues,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get a summary of validation results
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.valid) {
    return "Conversion validation passed with no errors.";
  }

  const parts: string[] = [];

  if (result.errors.length > 0) {
    parts.push(
      `${result.errors.length} error${result.errors.length !== 1 ? "s" : ""}`
    );
  }

  if (result.warnings.length > 0) {
    parts.push(
      `${result.warnings.length} warning${result.warnings.length !== 1 ? "s" : ""}`
    );
  }

  if (result.info.length > 0) {
    parts.push(
      `${result.info.length} info message${result.info.length !== 1 ? "s" : ""}`
    );
  }

  return `Conversion validation found ${parts.join(", ")}.`;
}

/**
 * Check if conversion is safe (no errors)
 */
export function isConversionSafe(result: ConversionValidationResult): boolean {
  return result.valid && result.errors.length === 0;
}

/**
 * Get critical issues that should block conversion
 */
export function getCriticalIssues(
  result: ConversionValidationResult
): ValidationIssue[] {
  return result.errors;
}

/**
 * Get all issues sorted by severity
 */
export function getIssuesSortedBySeverity(
  result: ValidationResult
): ValidationIssue[] {
  const severityOrder: Record<ValidationIssue["severity"], number> = {
    error: 0,
    warning: 1,
    info: 2,
  };

  return [...result.issues].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );
}
