/**
 * Data manipulation action configurations - NEW action types for data operations
 */

import { TargetConfig } from '../shared/target-config';

/**
 * SET_VARIABLE - Set a variable value
 */
export interface SetVariableActionConfig {
  /** Variable name */
  variableName: string;

  /** Value to set */
  value?: any;

  /** Get value from another source */
  valueSource?: {
    type: 'target' | 'expression' | 'ocr' | 'clipboard';
    target?: TargetConfig; // Extract value from screen
    expression?: string; // JavaScript expression
  };

  /** Variable type hint */
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /** Variable scope */
  scope?: 'local' | 'global' | 'process';
}

/**
 * GET_VARIABLE - Get a variable value and store it
 */
export interface GetVariableActionConfig {
  /** Variable name to get */
  variableName: string;

  /** Where to store the value */
  outputVariable?: string;

  /** Default value if variable doesn't exist */
  defaultValue?: any;
}

/**
 * SORT - Sort a collection
 */
export interface SortActionConfig {
  /** Target collection type */
  target: 'variable' | 'matches' | 'list';

  /** Variable name containing array to sort */
  variableName?: string;

  /** Target to find and sort matches */
  matchTarget?: TargetConfig;

  /** Property name(s) to sort by */
  sortBy?: string | string[];

  /** Sort order */
  order: 'ASC' | 'DESC';

  /** Comparator type */
  comparator?: 'NUMERIC' | 'ALPHABETIC' | 'DATE' | 'CUSTOM';

  /** Custom comparator function (JavaScript) */
  customComparator?: string;

  /** Variable to store sorted result */
  outputVariable?: string;
}

/**
 * FILTER - Filter a collection
 */
export interface FilterActionConfig {
  /** Variable name containing array to filter */
  variableName: string;

  /** Filter condition */
  condition: {
    type: 'expression' | 'property' | 'custom';
    expression?: string; // JavaScript expression
    property?: string; // Property name
    operator?: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'matches';
    value?: any; // Expected value
    customFunction?: string; // JavaScript function
  };

  /** Variable to store filtered result */
  outputVariable?: string;
}

/**
 * MAP - Transform each element in a collection
 */
export interface MapActionConfig {
  /** Variable name containing array to map */
  variableName: string;

  /** Transformation to apply */
  transform: {
    type: 'expression' | 'property' | 'custom';
    expression?: string; // JavaScript expression (can use 'item' variable)
    property?: string; // Extract this property from each item
    customFunction?: string; // JavaScript function
  };

  /** Variable to store mapped result */
  outputVariable?: string;
}

/**
 * REDUCE - Reduce collection to single value
 */
export interface ReduceActionConfig {
  /** Variable name containing array to reduce */
  variableName: string;

  /** Reduction operation */
  operation: 'sum' | 'average' | 'min' | 'max' | 'count' | 'custom';

  /** Initial value for accumulator */
  initialValue?: any;

  /** Custom reducer function (JavaScript) */
  customReducer?: string;

  /** Variable to store result */
  outputVariable?: string;
}

/**
 * STRING_OPERATION - String manipulation
 */
export interface StringOperationActionConfig {
  /** Input string or variable */
  input: string | { variableName: string };

  /** Operation to perform */
  operation:
    | 'CONCAT'
    | 'SUBSTRING'
    | 'REPLACE'
    | 'SPLIT'
    | 'TRIM'
    | 'UPPERCASE'
    | 'LOWERCASE'
    | 'MATCH'
    | 'PARSE_JSON';

  /** Operation-specific parameters */
  parameters?: {
    // For CONCAT
    strings?: string[];
    // For SUBSTRING
    start?: number;
    end?: number;
    // For REPLACE
    search?: string;
    replacement?: string;
    // For SPLIT
    delimiter?: string;
    // For MATCH
    pattern?: string;
  };

  /** Variable to store result */
  outputVariable?: string;
}

/**
 * MATH_OPERATION - Mathematical calculations
 */
export interface MathOperationActionConfig {
  /** Operation to perform */
  operation: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'MODULO' | 'POWER' | 'SQRT' | 'ABS' | 'ROUND' | 'CUSTOM';

  /** Operands (can be numbers or variable names) */
  operands: (number | { variableName: string })[];

  /** Custom expression (JavaScript) */
  customExpression?: string;

  /** Variable to store result */
  outputVariable?: string;
}
