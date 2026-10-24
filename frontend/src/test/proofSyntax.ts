/**
 * proofSyntax — reading a proof file's syntax tree, shared by
 * `readinessProof.ts` (what a proof asserts, and over what) and `proofRuns.ts`
 * (whether that assertion runs where a failure fails a test).
 *
 * The one judgement here is {@link stepProblem}: whether a parent node
 * evaluates a child EVERY time the parent itself is evaluated, and lets what
 * the child throws out. It is an allow-list — a node kind it does not name is
 * read as not running its child — so a construct nobody thought of fails
 * closed instead of open.
 */

import ts from "typescript";

export type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration;

export function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
}

export function isAsync(fn: FunctionNode): boolean {
  return (
    ts.getModifiers(fn)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ??
    false
  );
}

/** `x` without the parentheses around it, upward: the node its parent sees. */
export function outermost(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
}

/** `x`, `(x)`, `await x`, `x as T`, `x!`, `x satisfies T` — down to `x`. */
export function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The local name a function is bound to: `function f`, `const f = () =>`. */
export function functionName(fn: FunctionNode): string | null {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? null;
  const parent = outermost(fn).parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : null;
}

export function isWithin(node: ts.Node, ancestor: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (at === ancestor) return true;
  }
  return false;
}

/** Whether `id` is the name a declaration binds rather than a reference. */
export function isDeclarationName(id: ts.Identifier): boolean {
  const parent = id.parent;
  return (
    (ts.isFunctionDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === id
  );
}

export function bindsName(name: ts.BindingName, wanted: string): boolean {
  if (ts.isIdentifier(name)) return name.text === wanted;
  return name.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindsName(element.name, wanted)
  );
}

/** The 1-based line `node` starts on. */
export function lineOf(node: ts.Node): number {
  const source = node.getSourceFile();
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** "(line N)", for a reason a proof is refused. */
export function at(node: ts.Node): string {
  return `(line ${lineOf(node)})`;
}

/** The innermost `const` / `let` / `var` declaring `id`'s name in scope of `id`. */
export function declarationOf(
  id: ts.Identifier
): ts.VariableDeclaration | null {
  for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
    if (isFunctionNode(node)) {
      const isParameter = node.parameters.some((p) =>
        bindsName(p.name, id.text)
      );
      if (isParameter) return null;
    }
    if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node)) {
      for (const statement of node.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === id.text
          ) {
            return declaration;
          }
        }
      }
    }
  }
  return null;
}

/** `"./page"` or `import("./page")` — the module a `vi.mock` names. */
export function mockedSpecifier(arg: ts.Expression | undefined): string | null {
  if (arg === undefined) return null;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (
    ts.isCallExpression(arg) &&
    arg.expression.kind === ts.SyntaxKind.ImportKeyword &&
    arg.arguments[0] !== undefined &&
    ts.isStringLiteralLike(arg.arguments[0])
  ) {
    return arg.arguments[0].text;
  }
  return null;
}

/** The module `call` puts a stand-in in place of (`vi.mock`, `vi.doMock`); `null` when it is no mock. */
export function mockTarget(call: ts.CallExpression): string | null {
  const callee = call.expression;
  return ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "vi" &&
    (callee.name.text === "mock" || callee.name.text === "doMock")
    ? mockedSpecifier(call.arguments[0])
    : null;
}

/** Whether `declaration` is a `const` (so its initializer is its only value). */
export function isConst(declaration: ts.VariableDeclaration): boolean {
  return (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0;
}

/** The local function `name` calls: `function f() {}` or `const f = () => …`. */
export function localFunction(name: ts.Identifier): FunctionNode | null {
  for (let node: ts.Node | undefined = name.parent; node; node = node.parent) {
    if (!(ts.isBlock(node) || ts.isSourceFile(node))) continue;
    for (const statement of node.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === name.text &&
        statement.body
      ) {
        return statement;
      }
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer && unwrap(declaration.initializer);
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name.text &&
          init !== undefined &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          return init;
        }
      }
    }
  }
  return null;
}

/**
 * Calls `visit` on `root` and every node under it that belongs to the same
 * function: a nested function (or `root` itself, when it is one) is visited
 * but not entered, since its statements are its own.
 */
function forEachInFunction(root: ts.Node, visit: (node: ts.Node) => void) {
  const walk = (node: ts.Node): void => {
    visit(node);
    if (ts.isFunctionLike(node)) return;
    ts.forEachChild(node, walk);
  };
  walk(root);
}

/** The values `fn` returns: its expression body, or each `return x;` of its own. */
export function returnedValues(fn: FunctionNode): ts.Expression[] {
  const body = fn.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [body];
  const out: ts.Expression[] = [];
  forEachInFunction(body, (node) => {
    if (ts.isReturnStatement(node) && node.expression) {
      out.push(node.expression);
    }
  });
  return out;
}

/** The first `return` in `statement` that leaves the function holding it. */
function returnIn(statement: ts.Statement): ts.ReturnStatement | null {
  let found: ts.ReturnStatement | null = null;
  forEachInFunction(statement, (node) => {
    if (found === null && ts.isReturnStatement(node)) found = node;
  });
  return found;
}

/** A `return` / `break` / `continue` that can end `block` abruptly — discarding an exception passing through it. */
function endsAbruptly(block: ts.Block): ts.Node | null {
  let found: ts.Node | null = null;
  forEachInFunction(block, (node) => {
    if (
      found === null &&
      (ts.isReturnStatement(node) ||
        ts.isBreakStatement(node) ||
        ts.isContinueStatement(node))
    ) {
      found = node;
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Callees: `it`, `it.only`, `it.each(table)`, `describe.skip`, `it.skipIf(c)`.
// ---------------------------------------------------------------------------

/** The table an `.each(table)` / `.for(table)` link in a callee is handed. */
export interface TableLink {
  readonly link: string;
  /** `undefined` for no argument, or a template table this check does not read. */
  readonly table: ts.Expression | undefined;
}

export interface CalleeChain {
  readonly base: string;
  readonly modifiers: readonly string[];
  readonly tables: readonly TableLink[];
}

const TABLE_LINKS: ReadonlySet<string> = new Set(["each", "for"]);

function tableLinkName(callee: ts.Expression): string | null {
  return ts.isPropertyAccessExpression(callee) &&
    TABLE_LINKS.has(callee.name.text)
    ? callee.name.text
    : null;
}

/** The base name, the modifiers in order, and each table; `null` for any other callee. */
export function calleeChain(callee: ts.Expression): CalleeChain | null {
  const modifiers: string[] = [];
  const tables: TableLink[] = [];
  let current = callee;
  for (;;) {
    if (ts.isIdentifier(current)) {
      return { base: current.text, modifiers, tables };
    }
    if (ts.isPropertyAccessExpression(current)) {
      modifiers.unshift(current.name.text);
      current = current.expression;
    } else if (ts.isCallExpression(current)) {
      // `it.each(table)(name, fn)`, `it.skipIf(cond)(name, fn)`.
      const link = tableLinkName(current.expression);
      if (link !== null) tables.push({ link, table: current.arguments[0] });
      current = current.expression;
    } else if (ts.isTaggedTemplateExpression(current)) {
      // ``it.each`a | b ${1} | ${2}`(name, fn)``: a table this check does not read.
      const link = tableLinkName(current.tag);
      if (link !== null) tables.push({ link, table: undefined });
      current = current.tag;
    } else {
      return null;
    }
  }
}

/** The callee's text, for a reason: `waitFor`, `Promise.resolve().then`. */
export function calleeText(call: ts.CallExpression): string {
  const text = call.expression.getText();
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

// ---------------------------------------------------------------------------
// The one judgement: does `parent` run `child` whenever it runs?
// ---------------------------------------------------------------------------

/** Operators whose right side runs only when the left side lets it. */
const SHORT_CIRCUITS: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.AmpersandAmpersandToken, "&&"],
  [ts.SyntaxKind.BarBarToken, "||"],
  [ts.SyntaxKind.QuestionQuestionToken, "??"],
  [ts.SyntaxKind.AmpersandAmpersandEqualsToken, "&&="],
  [ts.SyntaxKind.BarBarEqualsToken, "||="],
  [ts.SyntaxKind.QuestionQuestionEqualsToken, "??="],
]);

/**
 * Node kinds that evaluate every child they hold, in order, each time they are
 * evaluated, and let what a child throws out. Each is a plain expression or
 * declaration step; nothing that branches, loops, catches or defers is here.
 */
const PLAIN_STEPS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.TypeAssertionExpression,
  ts.SyntaxKind.AwaitExpression,
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.PrefixUnaryExpression,
  ts.SyntaxKind.PostfixUnaryExpression,
  ts.SyntaxKind.VoidExpression,
  ts.SyntaxKind.TypeOfExpression,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.SpreadElement,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.SpreadAssignment,
  ts.SyntaxKind.TemplateExpression,
  ts.SyntaxKind.TemplateSpan,
  ts.SyntaxKind.TaggedTemplateExpression,
  // A declaration evaluates its initializer; a default inside its binding
  // pattern sits under a BindingElement, which is not plain.
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.VariableDeclarationList,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.ReturnStatement,
  // JSX is `createElement(type, props, ...children)`: every attribute and child
  // expression is evaluated with the element.
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxOpeningElement,
  ts.SyntaxKind.JsxFragment,
  ts.SyntaxKind.JsxAttributes,
  ts.SyntaxKind.JsxAttribute,
  ts.SyntaxKind.JsxSpreadAttribute,
  ts.SyntaxKind.JsxExpression,
]);

const LOOPS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
]);

/**
 * `null` when `parent` evaluates `child` every time `parent` is evaluated and
 * lets what it throws out; otherwise why not, worded about `subject` (the
 * assertion, a call, a test). `parent` is never a function: a walk stops at
 * the function holding the node, which is read by where it is called.
 */
export function stepProblem(
  parent: ts.Node,
  child: ts.Node,
  subject: string
): string | null {
  if (PLAIN_STEPS.has(parent.kind)) return null;
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    if (parent.expression === child) return null;
    return ts.isCallExpression(parent) && ts.isOptionalChain(parent)
      ? `${subject} is an argument of an optional call ${at(parent)}, which is not made when the \`?.\` chain stops`
      : null;
  }
  if (ts.isElementAccessExpression(parent)) {
    return parent.expression === child || !ts.isOptionalChain(parent)
      ? null
      : `${subject} is the key of an optional element access ${at(parent)}, which is not read when the \`?.\` chain stops`;
  }
  if (ts.isBinaryExpression(parent)) {
    const operator = SHORT_CIRCUITS.get(parent.operatorToken.kind);
    if (operator !== undefined && parent.right === child) {
      return `${subject} is on the right of \`${operator}\` ${at(parent)}, so it runs only when the left side lets it`;
    }
    const destructures =
      parent.left === child &&
      (ts.isArrayLiteralExpression(child) ||
        ts.isObjectLiteralExpression(child));
    return destructures
      ? `${subject} is in a destructuring target ${at(parent)}, whose defaults run only for a missing value`
      : null;
  }
  if (ts.isConditionalExpression(parent)) {
    return parent.condition === child
      ? null
      : `${subject} is one branch of a \`?:\` ${at(parent)}, so it runs only on a condition`;
  }
  if (ts.isParameter(parent)) {
    return `${subject} is in a parameter's default value ${at(parent)}, which runs only when that argument is left out`;
  }
  if (ts.isBindingElement(parent)) {
    return `${subject} is a destructuring default ${at(parent)}, which runs only for a missing value`;
  }
  if (ts.isBlock(parent)) {
    const index = parent.statements.findIndex((s) => s === child);
    for (const earlier of parent.statements.slice(0, Math.max(index, 0))) {
      const exit = returnIn(earlier);
      if (exit !== null) {
        return `${subject} comes after a \`return\` ${at(exit)} that can end its function before it runs`;
      }
    }
    return null;
  }
  if (ts.isCatchClause(parent)) {
    return `${subject} is in a \`catch\` block ${at(parent)}, which runs only when its \`try\` throws`;
  }
  if (ts.isTryStatement(parent)) {
    // A `finally` block runs every time its `try` statement does, and what it
    // throws replaces whatever was leaving — a return or another exception.
    if (parent.finallyBlock === child) return null;
    if (parent.catchClause) {
      return `${subject} is in a \`try\` with a \`catch\` ${at(parent)}, which swallows what it throws`;
    }
    const exit = parent.finallyBlock && endsAbruptly(parent.finallyBlock);
    return exit
      ? `${subject} is in a \`try\` whose \`finally\` block can end abruptly ${at(exit)}, which discards what it throws`
      : null;
  }
  if (ts.isIfStatement(parent)) {
    return parent.expression === child
      ? null
      : `${subject} is under an \`if\` ${at(parent)}, so it runs only on a condition`;
  }
  if (LOOPS.has(parent.kind)) {
    return `${subject} is in a loop ${at(parent)}, which may run it no times`;
  }
  if (
    ts.isSwitchStatement(parent) ||
    ts.isCaseBlock(parent) ||
    ts.isCaseClause(parent) ||
    ts.isDefaultClause(parent)
  ) {
    return `${subject} is in a \`switch\` ${at(parent)}, so it runs only in one case`;
  }
  if (ts.isLabeledStatement(parent)) {
    return `${subject} is in a labeled statement ${at(parent)}, which a \`break\` can leave`;
  }
  const kind = ts.SyntaxKind[parent.kind]
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return `${subject} is inside a ${kind} ${at(parent)}, which this check does not read as running it`;
}
