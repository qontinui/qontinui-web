/**
 * Control flow action configurations - NEW action types for programming logic
 */

import { TargetConfig } from "../shared/target-config";

/**
 * Condition configuration for control flow
 */
export interface ConditionConfig {
  type:
    | "image_exists"
    | "image_vanished"
    | "text_exists"
    | "variable"
    | "expression";
  imageId?: string;
  text?: string;
  variableName?: string;
  expression?: string; // JavaScript expression
  expectedValue?: any;
  operator?: "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "matches";
}

/**
 * IF - Conditional execution
 */
export interface IfActionConfig {
  /** Condition to evaluate */
  condition: ConditionConfig;

  /** Actions to execute if condition is true */
  thenActions: string[]; // Action IDs or inline actions

  /** Actions to execute if condition is false */
  elseActions?: string[];
}

/**
 * LOOP - Iterate over a collection or repeat N times
 */
export interface LoopActionConfig {
  /** Type of loop */
  loopType: "FOR" | "WHILE" | "FOREACH";

  /** Number of iterations (for FOR loops) */
  iterations?: number;

  /** Condition to check (for WHILE loops) */
  condition?: ConditionConfig;

  /** Collection to iterate over (for FOREACH loops) */
  collection?: {
    type: "variable" | "range" | "matches";
    variableName?: string; // Variable containing array
    start?: number; // For range
    end?: number; // For range
    step?: number; // For range
    target?: TargetConfig; // For matches (iterate over all matches)
  };

  /** Variable name for loop counter/item */
  iteratorVariable?: string;

  /** Actions to execute in each iteration */
  actions: string[]; // Action IDs

  /** Break on error */
  breakOnError?: boolean;

  /** Maximum iterations (safety limit) */
  maxIterations?: number;
}

/**
 * BREAK - Break out of a loop
 */
export interface BreakActionConfig {
  /** Optional condition - only break if condition is true */
  condition?: ConditionConfig;

  /** Message to log */
  message?: string;
}

/**
 * CONTINUE - Skip to next iteration
 */
export interface ContinueActionConfig {
  /** Optional condition - only continue if condition is true */
  condition?: ConditionConfig;

  /** Message to log */
  message?: string;
}

/**
 * SWITCH - Multi-way conditional
 */
export interface SwitchActionConfig {
  /** Variable or expression to evaluate */
  expression: string;

  /** Cases to match */
  cases: Array<{
    /** Value to match (can be array for multiple values) */
    value: any | any[];
    /** Actions to execute if matched */
    actions: string[];
  }>;

  /** Default case if no match */
  defaultActions?: string[];
}

/**
 * TRY_CATCH - Error handling
 */
export interface TryCatchActionConfig {
  /** Actions to try */
  tryActions: string[];

  /** Actions to execute on error */
  catchActions?: string[];

  /** Actions to always execute */
  finallyActions?: string[];

  /** Variable name to store error information */
  errorVariable?: string;
}
