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
  "==": (a, b) => a == b,
  "!=": (a, b) => a != b,
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
function parseToken(
  token: string,
  variables: Record<string, unknown>
): unknown {
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
