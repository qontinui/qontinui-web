/**
 * Property Validation System
 *
 * Provides real-time validation for action properties with:
 * - Type checking
 * - Range validation
 * - Required field validation
 * - Custom validation rules
 * - Cross-property validation
 */

import type { Action, ActionType } from '@/lib/action-schema/action-types';

// ============================================================================
// Validation Types
// ============================================================================

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationError {
  property: string;
  message: string;
  severity: ValidationSeverity;
  code?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export type ValidatorFunction = (
  value: any,
  config: Record<string, any>,
  action: Action
) => ValidationError | null;

// ============================================================================
// Common Validators
// ============================================================================

/**
 * Validate required field
 */
export function required(fieldName: string, message?: string): ValidatorFunction {
  return (value: any) => {
    if (value === undefined || value === null || value === '') {
      return {
        property: fieldName,
        message: message || `${fieldName} is required`,
        severity: 'error',
        code: 'REQUIRED',
      };
    }
    return null;
  };
}

/**
 * Validate number range
 */
export function numberRange(
  fieldName: string,
  min: number,
  max: number,
  message?: string
): ValidatorFunction {
  return (value: any) => {
    if (typeof value !== 'number') return null;

    if (value < min || value > max) {
      return {
        property: fieldName,
        message: message || `${fieldName} must be between ${min} and ${max}`,
        severity: 'error',
        code: 'OUT_OF_RANGE',
      };
    }
    return null;
  };
}

/**
 * Validate minimum value
 */
export function minValue(fieldName: string, min: number, message?: string): ValidatorFunction {
  return (value: any) => {
    if (typeof value !== 'number') return null;

    if (value < min) {
      return {
        property: fieldName,
        message: message || `${fieldName} must be at least ${min}`,
        severity: 'error',
        code: 'MIN_VALUE',
      };
    }
    return null;
  };
}

/**
 * Validate maximum value
 */
export function maxValue(fieldName: string, max: number, message?: string): ValidatorFunction {
  return (value: any) => {
    if (typeof value !== 'number') return null;

    if (value > max) {
      return {
        property: fieldName,
        message: message || `${fieldName} must be at most ${max}`,
        severity: 'error',
        code: 'MAX_VALUE',
      };
    }
    return null;
  };
}

/**
 * Validate string length
 */
export function stringLength(
  fieldName: string,
  minLength: number,
  maxLength?: number,
  message?: string
): ValidatorFunction {
  return (value: any) => {
    if (typeof value !== 'string') return null;

    if (value.length < minLength) {
      return {
        property: fieldName,
        message: message || `${fieldName} must be at least ${minLength} characters`,
        severity: 'error',
        code: 'MIN_LENGTH',
      };
    }

    if (maxLength !== undefined && value.length > maxLength) {
      return {
        property: fieldName,
        message: message || `${fieldName} must be at most ${maxLength} characters`,
        severity: 'error',
        code: 'MAX_LENGTH',
      };
    }

    return null;
  };
}

/**
 * Validate pattern (regex)
 */
export function pattern(
  fieldName: string,
  regex: RegExp,
  message?: string
): ValidatorFunction {
  return (value: any) => {
    if (typeof value !== 'string') return null;

    if (!regex.test(value)) {
      return {
        property: fieldName,
        message: message || `${fieldName} has invalid format`,
        severity: 'error',
        code: 'PATTERN',
      };
    }
    return null;
  };
}

/**
 * Validate enum value
 */
export function enumValue(
  fieldName: string,
  allowedValues: any[],
  message?: string
): ValidatorFunction {
  return (value: any) => {
    if (!allowedValues.includes(value)) {
      return {
        property: fieldName,
        message: message || `${fieldName} must be one of: ${allowedValues.join(', ')}`,
        severity: 'error',
        code: 'INVALID_ENUM',
      };
    }
    return null;
  };
}

/**
 * Validate array length
 */
export function arrayLength(
  fieldName: string,
  minLength: number,
  maxLength?: number,
  message?: string
): ValidatorFunction {
  return (value: any) => {
    if (!Array.isArray(value)) return null;

    if (value.length < minLength) {
      return {
        property: fieldName,
        message: message || `${fieldName} must have at least ${minLength} items`,
        severity: 'error',
        code: 'MIN_ARRAY_LENGTH',
      };
    }

    if (maxLength !== undefined && value.length > maxLength) {
      return {
        property: fieldName,
        message: message || `${fieldName} must have at most ${maxLength} items`,
        severity: 'error',
        code: 'MAX_ARRAY_LENGTH',
      };
    }

    return null;
  };
}

/**
 * Create custom validator
 */
export function custom(
  fieldName: string,
  validatorFn: (value: any, config: Record<string, any>, action: Action) => boolean,
  message: string,
  severity: ValidationSeverity = 'error'
): ValidatorFunction {
  return (value: any, config: Record<string, any>, action: Action) => {
    if (!validatorFn(value, config, action)) {
      return {
        property: fieldName,
        message,
        severity,
      };
    }
    return null;
  };
}

// ============================================================================
// Action Type Validators
// ============================================================================

/**
 * Validation rules for each action type
 */
const ACTION_VALIDATORS: Partial<Record<ActionType, ValidatorFunction[]>> = {
  CLICK: [
    // Target is optional - defaults to current position (pure action)
    enumValue('clickType', ['left', 'right', 'middle', 'double'], 'Invalid click type'),
    minValue('clickCount', 1, 'Click count must be at least 1'),
    minValue('hold_duration', 0, 'Hold duration cannot be negative'),
  ],

  TYPE: [
    required('text', 'Text to type is required'),
    minValue('delay', 0, 'Delay cannot be negative'),
    minValue('interval', 0, 'Interval cannot be negative'),
  ],

  FIND: [
    required('targetImages', 'At least one target image is required'),
    custom(
      'targetImages',
      (value) => Array.isArray(value) && value.length > 0,
      'At least one target image is required',
      'error'
    ),
    numberRange('similarity', 0, 1, 'Similarity must be between 0 and 1'),
    minValue('timeout', 0, 'Timeout cannot be negative'),
  ],

  WAIT: [
    required('duration', 'Wait duration is required'),
    minValue('duration', 0, 'Duration cannot be negative'),
  ],

  IF: [
    required('condition', 'Condition is required'),
    stringLength('condition', 1, undefined, 'Condition cannot be empty'),
  ],

  LOOP: [
    required('loopType', 'Loop type is required'),
    enumValue('loopType', ['count', 'while', 'foreach'], 'Invalid loop type'),
    custom(
      'count',
      (value, config) => {
        if (config.loopType === 'count') {
          return typeof value === 'number' && value > 0;
        }
        return true;
      },
      'Loop count must be a positive number',
      'error'
    ),
    custom(
      'condition',
      (value, config) => {
        if (config.loopType === 'while') {
          return typeof value === 'string' && value.length > 0;
        }
        return true;
      },
      'While condition is required',
      'error'
    ),
  ],

  SET_VARIABLE: [
    required('variableName', 'Variable name is required'),
    pattern(
      'variableName',
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      'Variable name must start with letter or underscore and contain only letters, numbers, and underscores'
    ),
    required('value', 'Value is required'),
  ],

  GET_VARIABLE: [
    required('variableName', 'Variable name is required'),
    pattern(
      'variableName',
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      'Variable name must start with letter or underscore'
    ),
  ],

  DRAG: [
    required('startPoint', 'Start point is required'),
    required('endPoint', 'End point is required'),
    minValue('duration', 0, 'Duration cannot be negative'),
  ],

  SCROLL: [
    required('direction', 'Scroll direction is required'),
    enumValue('direction', ['up', 'down', 'left', 'right'], 'Invalid scroll direction'),
    minValue('amount', 1, 'Scroll amount must be at least 1'),
  ],

  SWITCH: [
    required('expression', 'Switch expression is required'),
    custom(
      'cases',
      (value) => Array.isArray(value) && value.length > 0,
      'At least one case is required',
      'error'
    ),
  ],

  RUN_WORKFLOW: [
    required('workflowId', 'Workflow ID is required'),
  ],

  GO_TO_STATE: [
    required('stateId', 'State ID is required'),
  ],
};

// ============================================================================
// Validation Engine
// ============================================================================

/**
 * Validate an action's configuration
 */
export function validateAction(action: Action): ValidationResult {
  const errors: ValidationError[] = [];

  // Get validators for this action type
  const validators = ACTION_VALIDATORS[action.type] || [];

  // Run each validator
  for (const validator of validators) {
    const config = action.config as Record<string, any>;

    // Extract the property name from the validator (first parameter)
    // This is a bit hacky but works for our validators
    const validatorStr = validator.toString();
    const propertyMatch = validatorStr.match(/property:\s*["']([^"']+)["']/);
    const propertyName = propertyMatch ? propertyMatch[1] : 'unknown';

    const value = config[propertyName];
    const error = validator(value, config, action);

    if (error) {
      errors.push(error);
    }
  }

  // Validate base settings if present
  if (action.base) {
    if (action.base.pauseBefore !== undefined && action.base.pauseBefore < 0) {
      errors.push({
        property: 'base.pauseBefore',
        message: 'Pause before cannot be negative',
        severity: 'error',
        code: 'INVALID_VALUE',
      });
    }

    if (action.base.pauseAfter !== undefined && action.base.pauseAfter < 0) {
      errors.push({
        property: 'base.pauseAfter',
        message: 'Pause after cannot be negative',
        severity: 'error',
        code: 'INVALID_VALUE',
      });
    }
  }

  // Validate execution settings if present
  if (action.execution) {
    if (action.execution.timeout !== undefined && action.execution.timeout < 0) {
      errors.push({
        property: 'execution.timeout',
        message: 'Timeout cannot be negative',
        severity: 'error',
        code: 'INVALID_VALUE',
      });
    }

    if (action.execution.maxRetries !== undefined && action.execution.maxRetries < 0) {
      errors.push({
        property: 'execution.maxRetries',
        message: 'Max retries cannot be negative',
        severity: 'error',
        code: 'INVALID_VALUE',
      });
    }
  }

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
  };
}

/**
 * Validate a single property of an action
 */
export function validateProperty(
  action: Action,
  propertyPath: string,
  value: any
): ValidationError | null {
  const validators = ACTION_VALIDATORS[action.type] || [];

  // Find validator for this property
  for (const validator of validators) {
    const validatorStr = validator.toString();
    const propertyMatch = validatorStr.match(/property:\s*["']([^"']+)["']/);
    const propertyName = propertyMatch ? propertyMatch[1] : null;

    if (propertyName === propertyPath) {
      const config = action.config as Record<string, any>;
      return validator(value, config, action);
    }
  }

  return null;
}

/**
 * Get validation rules for an action type
 */
export function getValidationRules(actionType: ActionType): ValidatorFunction[] {
  return ACTION_VALIDATORS[actionType] || [];
}

/**
 * Register custom validator for action type
 */
export function registerValidator(
  actionType: ActionType,
  validator: ValidatorFunction
): void {
  if (!ACTION_VALIDATORS[actionType]) {
    ACTION_VALIDATORS[actionType] = [];
  }
  ACTION_VALIDATORS[actionType]!.push(validator);
}

/**
 * Clear validators for action type
 */
export function clearValidators(actionType: ActionType): void {
  delete ACTION_VALIDATORS[actionType];
}
