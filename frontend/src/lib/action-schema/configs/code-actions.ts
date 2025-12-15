/**
 * Code execution action configurations
 *
 * Enables inline Python code execution within workflows for custom logic,
 * data processing, and complex transformations.
 */

/**
 * CODE_BLOCK - Execute inline Python code
 *
 * Executes Python code with access to ActionResult from previous actions,
 * workflow state, and automation context.
 *
 * Security: Code runs in sandboxed environment with restricted imports
 * and resource limits (30s timeout, 512MB memory).
 */
export interface CodeBlockActionConfig {
  /**
   * Code source type
   * - 'inline': Execute code from 'code' field (Phase 1)
   * - 'file': Execute code from external .py file (Phase 2)
   * Default: 'inline'
   */
  codeSource?: "inline" | "file";

  /**
   * Python code to execute (when codeSource='inline')
   *
   * Available variables in scope:
   * - action_result: ActionResult from previous action
   * - context: AutomationContext with state access
   * - variables: Dict of workflow variables
   *
   * Return value:
   * - Single value (int, str, bool, float)
   * - Dictionary with multiple outputs
   * - None for side-effects only
   *
   * Example:
   * ```python
   * # Extract price from OCR text
   * import re
   * text = action_result.text
   * match = re.search(r'\$(\d+\.\d{2})', text)
   * price = float(match.group(1)) if match else 0.0
   * return {"price": price, "success": match is not None}
   * ```
   */
  code?: string;

  /**
   * Path to Python file to execute (when codeSource='file')
   *
   * Path is relative to project root directory.
   * File must be within project directory (no parent directory access).
   *
   * Examples:
   * - "scripts/civ6_utils.py"
   * - "automation/unit_detector.py"
   * - "lib/vision_helpers.py"
   *
   * Security:
   * - Path traversal (../) is blocked
   * - Absolute paths are blocked
   * - Only .py files allowed
   */
  filePath?: string;

  /**
   * Function name to call from the file (when codeSource='file')
   *
   * If not specified, executes the entire file.
   * If specified, calls the named function with inputs as kwargs.
   *
   * Example file (scripts/detector.py):
   * ```python
   * def detect_unit(image_region, unit_icons):
   *     # ... detection logic
   *     return {"unit": "settler", "confidence": 0.95}
   * ```
   *
   * Action config:
   * {
   *   "filePath": "scripts/detector.py",
   *   "functionName": "detect_unit",
   *   "inputs": {"image_region": "unit_panel", "unit_icons": "icon_list"}
   * }
   */
  functionName?: string;

  /**
   * Input mappings - connect workflow variables to code scope
   *
   * Maps workflow variables to Python variable names.
   *
   * Example:
   * {
   *   "threshold": "price_threshold",  // workflow var -> Python var
   *   "previous_result": "last_action"
   * }
   */
  inputs?: Record<string, string>;

  /**
   * Output variable name(s)
   *
   * Where to store the return value:
   * - String: Single output variable name
   * - Array: Destructure dict return into multiple variables
   *
   * Examples:
   * - Single: "extracted_price"
   * - Multiple: ["price", "success", "message"]
   */
  outputVariable?: string | string[];

  /**
   * Include previous action result as 'action_result' variable
   * Default: true
   */
  includePreviousResult?: boolean;

  /**
   * Allowed imports (whitelist)
   *
   * Default allowed: ['re', 'json', 'math', 'datetime']
   * Additional imports can be requested (requires approval)
   *
   * Blocked: ['os', 'sys', 'subprocess', 'socket', 'eval', 'exec']
   */
  allowedImports?: string[];

  /**
   * Execution timeout in seconds
   * Default: 30
   * Max: 60
   */
  timeout?: number;

  /**
   * Error handling strategy
   */
  errorHandling?: {
    /** What to do on error */
    onError: "fail" | "skip" | "retry" | "fallback";

    /** Number of retries (if onError='retry') */
    retries?: number;

    /** Fallback value (if onError='fallback') */
    fallbackValue?: unknown;

    /** Continue workflow on error (if onError='skip') */
    continueOnError?: boolean;
  };

  /**
   * Description of what this code does (for documentation)
   */
  description?: string;

  /**
   * Debug mode - log execution details
   * Default: false
   */
  debug?: boolean;
}

/**
 * CUSTOM_FUNCTION - Execute uploaded Python function
 *
 * Executes a pre-registered custom function from uploaded .py files.
 * Phase 2 feature (not implemented in Phase 1).
 */
export interface CustomFunctionActionConfig {
  /** Function ID from function library */
  functionId: string;

  /** Function name (for display) */
  functionName: string;

  /** Input parameter mappings */
  inputs: Record<string, unknown>;

  /** Output variable mappings */
  outputs: Record<string, string>;

  /** Error handling */
  errorHandling?: {
    onError: "fail" | "skip" | "retry";
    retries?: number;
  };
}
