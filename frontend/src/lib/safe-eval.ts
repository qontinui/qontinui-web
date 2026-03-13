/**
 * Safe expression evaluation utilities.
 *
 * These replace raw `new Function()` / `eval()` calls with structured,
 * restricted alternatives that limit the operations a condition string can
 * perform.
 */

// ---------------------------------------------------------------------------
// Simple expression evaluator (for breakpoint-style conditions)
// ---------------------------------------------------------------------------

/** Supported binary operators for simple comparisons. */
const COMPARISON_OPS: Record<string, (a: unknown, b: unknown) => boolean> = {
  "===": (a, b) => a === b,
  "!==": (a, b) => a !== b,
  "==": (a, b) => a == b, // eslint-disable-line eqeqeq
  "!=": (a, b) => a != b, // eslint-disable-line eqeqeq
  ">": (a, b) => Number(a) > Number(b),
  "<": (a, b) => Number(a) < Number(b),
  ">=": (a, b) => Number(a) >= Number(b),
  "<=": (a, b) => Number(a) <= Number(b),
};

const LOGICAL_OPS = ["&&", "||"] as const;

/**
 * Resolve a dotted property path on an object (e.g. "user.name").
 */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && acc !== undefined && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Parse a single token into its JS value, resolving against `variables`.
 * Handles: numbers, booleans, single/double-quoted strings, null, undefined,
 * and variable lookups (possibly dotted paths).
 */
function parseToken(token: string, variables: Record<string, unknown>): unknown {
  const trimmed = token.trim();

  // Boolean literals
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed === "undefined") return undefined;

  // Numeric literals
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") return num;

  // String literals (single or double quotes)
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Variable lookup (supports dotted paths like "obj.prop")
  return resolvePath(variables, trimmed);
}

interface SimpleClause {
  left: string;
  op: string;
  right: string;
}

/**
 * Try to parse a simple comparison expression such as `x > 5` or `status === "ok"`.
 * Returns null if it cannot be parsed.
 */
function parseComparison(expr: string): SimpleClause | null {
  // Sort operators longest-first so `===` is tried before `==`, etc.
  const sortedOps = Object.keys(COMPARISON_OPS).sort(
    (a, b) => b.length - a.length
  );

  for (const op of sortedOps) {
    const idx = expr.indexOf(op);
    if (idx > 0) {
      const left = expr.slice(0, idx).trim();
      const right = expr.slice(idx + op.length).trim();
      if (left && right) {
        return { left, op, right };
      }
    }
  }
  return null;
}

/**
 * Evaluate a simple condition expression against a set of variables.
 *
 * Supported forms:
 *   - `variableName`  (truthy check)
 *   - `a > b`, `a === b`, etc.
 *   - `a > 1 && b === "ok"` (logical AND / OR chains)
 *
 * Returns a boolean.  Throws if the expression cannot be parsed.
 */
export function evaluateCondition(
  expression: string,
  variables: Record<string, unknown> = {}
): boolean {
  const expr = expression.trim();
  if (!expr) return false;

  // Handle logical operators (simple left-to-right, no precedence mixing)
  for (const logOp of LOGICAL_OPS) {
    // Only split on the logical op if it's not inside a string literal
    const parts = splitOnLogicalOp(expr, logOp);
    if (parts.length > 1) {
      if (logOp === "&&") {
        return parts.every((p) => evaluateCondition(p, variables));
      } else {
        return parts.some((p) => evaluateCondition(p, variables));
      }
    }
  }

  // Handle negation prefix
  if (expr.startsWith("!") && !expr.startsWith("!=")) {
    return !evaluateCondition(expr.slice(1), variables);
  }

  // Try to parse as a comparison (e.g. `count > 5`)
  const clause = parseComparison(expr);
  if (clause) {
    const left = parseToken(clause.left, variables);
    const right = parseToken(clause.right, variables);
    const fn = COMPARISON_OPS[clause.op];
    return fn ? fn(left, right) : false;
  }

  // Fall back to truthy check on a single variable
  return Boolean(parseToken(expr, variables));
}

/**
 * Split an expression on a logical operator, respecting quoted strings.
 */
function splitOnLogicalOp(expr: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let start = 0;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      if (ch === inStr && expr[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(expr.slice(start, i));
      i += op.length - 1;
      start = i + 1;
    }
  }
  parts.push(expr.slice(start));

  // Only return split result if we actually found the operator
  return parts.length > 1 ? parts : [expr];
}

// ---------------------------------------------------------------------------
// Safe custom assertion evaluator (for workflow-testing custom assertions)
// ---------------------------------------------------------------------------

/**
 * Built-in assertion helpers that custom assertion strings can reference.
 * Instead of executing arbitrary code, we provide a structured allowlist
 * of operations.
 */
const ASSERTION_CHECKS: Record<
  string,
  (value: unknown, ...args: unknown[]) => boolean
> = {
  isString: (v) => typeof v === "string",
  isNumber: (v) => typeof v === "number" && !isNaN(v as number),
  isBoolean: (v) => typeof v === "boolean",
  isArray: (v) => Array.isArray(v),
  isObject: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  isNull: (v) => v === null,
  isUndefined: (v) => v === undefined,
  isTruthy: (v) => Boolean(v),
  isFalsy: (v) => !v,
  isEmpty: (v) =>
    v === null ||
    v === undefined ||
    v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && v !== null && Object.keys(v).length === 0),
  isNotEmpty: (v) =>
    v !== null &&
    v !== undefined &&
    v !== "" &&
    !(Array.isArray(v) && v.length === 0),
  hasLength: (v, len) => Array.isArray(v) && v.length === Number(len),
  minLength: (v, min) =>
    (typeof v === "string" || Array.isArray(v)) &&
    v.length >= Number(min),
  maxLength: (v, max) =>
    (typeof v === "string" || Array.isArray(v)) &&
    v.length <= Number(max),
  contains: (v, item) => {
    if (typeof v === "string") return v.includes(String(item));
    if (Array.isArray(v)) return v.includes(item);
    return false;
  },
  matches: (v, pattern) => {
    try {
      return new RegExp(String(pattern)).test(String(v));
    } catch {
      return false;
    }
  },
  gt: (v, n) => Number(v) > Number(n),
  gte: (v, n) => Number(v) >= Number(n),
  lt: (v, n) => Number(v) < Number(n),
  lte: (v, n) => Number(v) <= Number(n),
  eq: (v, expected) => v === expected,
  neq: (v, expected) => v !== expected,
  between: (v, lo, hi) => Number(v) >= Number(lo) && Number(v) <= Number(hi),
  hasProperty: (v, prop) =>
    v !== null && typeof v === "object" && String(prop) in (v as object),
};

/**
 * Evaluate a custom assertion string against a value and optional context.
 *
 * Supported assertion string formats:
 *   - A simple check name: `"isString"`, `"isTruthy"`
 *   - A check with arguments: `"minLength:3"`, `"between:1:100"`
 *   - A comparison expression: `"value > 5"`, `"value === 'hello'"`
 *   - A pipe chain: `"isString | minLength:3"`
 *
 * Returns true/false. Never throws.
 */
export function evaluateCustomAssertion(
  assertion: string,
  value: unknown,
  _context?: Record<string, unknown>
): boolean {
  const trimmed = assertion.trim();
  if (!trimmed) return false;

  try {
    // Handle pipe chains: "isString | minLength:3"
    if (trimmed.includes("|")) {
      return trimmed.split("|").every((part) =>
        evaluateCustomAssertion(part.trim(), value, _context)
      );
    }

    // Handle comparison expressions: "value > 5"
    const comparisonMatch = trimmed.match(
      /^value\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/
    );
    if (comparisonMatch) {
      const op = comparisonMatch[1]!;
      const right = comparisonMatch[2]!;
      const rightVal = parseToken(right, {});
      const fn = COMPARISON_OPS[op];
      return fn ? fn(value, rightVal) : false;
    }

    // Handle "return true/false" patterns
    if (trimmed === "return true") return true;
    if (trimmed === "return false") return false;

    // Handle named check with optional args: "minLength:3"
    const [checkNameRaw, ...args] = trimmed.split(":");
    const checkName = checkNameRaw ?? "";
    const check = ASSERTION_CHECKS[checkName.trim()];
    if (check) {
      const parsedArgs = args.map((a) => {
        const n = Number(a);
        return isNaN(n) ? a : n;
      });
      return check(value, ...parsedArgs);
    }

    // Fallback: try evaluating as a condition expression
    return evaluateCondition(trimmed, { value });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tutorial action / condition registry
// ---------------------------------------------------------------------------

type TutorialActionFn = () => void | Promise<void>;
type TutorialConditionFn = () => boolean | Promise<boolean>;

const actionRegistry = new Map<string, TutorialActionFn>();
const conditionRegistry = new Map<string, TutorialConditionFn>();

/**
 * Register a named action that tutorial steps can reference.
 * Call this from application code to make actions available to tutorials.
 */
export function registerTutorialAction(
  name: string,
  fn: TutorialActionFn
): void {
  actionRegistry.set(name, fn);
}

/**
 * Register a named condition that tutorial steps/triggers can reference.
 * Call this from application code to make conditions available to tutorials.
 */
export function registerTutorialCondition(
  name: string,
  fn: TutorialConditionFn
): void {
  conditionRegistry.set(name, fn);
}

/**
 * Execute a registered tutorial action by name.
 * Logs a warning if the action is not found.
 */
export function executeTutorialAction(name: string): void {
  const fn = actionRegistry.get(name);
  if (fn) {
    fn();
  } else {
    console.warn(`Tutorial action "${name}" is not registered.`);
  }
}

/**
 * Evaluate a registered tutorial condition by name.
 * Returns false if the condition is not found.
 */
export async function evaluateTutorialCondition(
  name: string
): Promise<boolean> {
  const fn = conditionRegistry.get(name);
  if (fn) {
    return Boolean(await fn());
  }
  console.warn(`Tutorial condition "${name}" is not registered.`);
  return false;
}
