/**
 * readinessProof — whether a page test PROVES what a
 * `PRESENTATION_READY_ROUTES` entry claims: that a presentation-mode render
 * of the route's own page passes the page check (plan
 * `2026-10-23-console-presentation-spaces` D3.2; served policy `testing`
 * `a-green-run-must-prove-it-ran`).
 *
 * The test file is read as TypeScript, so a call in a comment or a string is
 * no call. It proves the route only when ALL of these hold:
 *
 * 1. **It asserts the helper** — `expectPresentationSafe(…)`, or
 *    `findPresentationViolations(…)` (optionally `.map(describeViolation)`) as
 *    the value of `expect(…)` asserted empty. A finder whose answer is
 *    discarded, kept, or asserted anything else asserts nothing.
 * 2. **That assertion runs in a test that runs** — inside the callback of an
 *    `it` / `test` (`.each`, `.only`, `.concurrent` and the like included)
 *    that is not `.skip`, `.todo`, `.skipIf`, `.runIf` or `.fails`, nor
 *    `xit` / `xtest`, under no `describe` that is skipped the same ways
 *    (`xdescribe` included). An assertion in a named local function counts
 *    where a test that runs calls that function (or is handed it); one in a
 *    function nobody calls, at module level, or in a hook, does not. A build
 *    that skips its own proof (`it.skipIf(!composed)`) proves nothing for the
 *    build it skips in, so a conditional test does not count either.
 * 3. **It runs over a render of the page** — the asserted view is a render
 *    whose JSX names the page module's binding (`<DevOpsPage />`, however
 *    deep in wrappers), directly, through the variable it was assigned to
 *    (every assignment of it, if it has several), or through a local function
 *    whose body renders it. The binding is the page module's default export,
 *    imported (`import Page from`, `{ default as Page }`, `* as ns` →
 *    `<ns.default />`) or loaded (`await import(…)`, `require(…)`). A view of
 *    one panel of the page — or of anything else — is not one, even while the
 *    page module is imported beside it. A view that is a function's parameter
 *    is not traced back to its callers, so it fails closed: assert where the
 *    render is.
 * 4. **It imports that page, and does not mock it** (`vi.mock`, `vi.doMock`,
 *    by specifier or `import()`): a stand-in renders in the page's place.
 */

import { posix } from "node:path";
import ts from "typescript";
import {
  LENS_TREES,
  isLensTreePath,
  type PresentationReadyRoute,
} from "@/components/presentation/presentationReadiness";

/** One helper assertion in a proof file, and what is known about it. */
export interface HelperAssertion {
  /** Whether it runs in a test that runs (rule 2). */
  readonly runs: boolean;
  /** Whether what it asserts over is a render of the page (rule 3). */
  readonly overPage: boolean;
}

/** What a proof file does, read from its syntax tree. */
export interface ProofFacts {
  /** The modules it imports for their values — statically or by `import()`. */
  readonly imports: readonly string[];
  /** The modules it puts a stand-in in place of (`vi.mock`, `vi.doMock`). */
  readonly mocked: readonly string[];
  /** Every helper assertion in it (rule 1). */
  readonly assertions: readonly HelperAssertion[];
}

/** `"./page"` or `import("./page")` — the module a `vi.mock` names. */
function mockedSpecifier(arg: ts.Expression | undefined): string | null {
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

function calls(node: ts.CallExpression, name: string): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === name;
}

/** `x` without the parentheses around it, upward: the node its parent sees. */
function outermost(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
}

/** `x`, `(x)`, `await x`, `x as T`, `x!`, `x satisfies T` — down to `x`. */
function unwrap(node: ts.Expression): ts.Expression {
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

/**
 * Whether `call` runs the helper AS AN ASSERTION (rule 1): `null` when it does
 * not; else the expression it asserts over (`undefined` when it has none).
 */
function assertedView(
  call: ts.CallExpression
): ts.Expression | undefined | null {
  if (calls(call, "expectPresentationSafe")) return call.arguments[0];
  if (!calls(call, "findPresentationViolations")) return null;
  let value: ts.Node = outermost(call);
  const mapped = value.parent;
  const mapper =
    ts.isPropertyAccessExpression(mapped) &&
    mapped.expression === value &&
    mapped.name.text === "map" &&
    ts.isCallExpression(mapped.parent) &&
    mapped.parent.expression === mapped &&
    mapped.parent.arguments.length === 1
      ? mapped.parent.arguments[0]
      : undefined;
  if (
    mapper !== undefined &&
    ts.isIdentifier(mapper) &&
    mapper.text === "describeViolation"
  ) {
    value = outermost(mapped.parent);
  }
  const expectCall = value.parent;
  if (
    !ts.isCallExpression(expectCall) ||
    !calls(expectCall, "expect") ||
    expectCall.arguments[0] !== value
  ) {
    return null;
  }
  const matcher = expectCall.parent;
  if (
    !ts.isPropertyAccessExpression(matcher) ||
    matcher.expression !== expectCall ||
    !ts.isCallExpression(matcher.parent) ||
    matcher.parent.expression !== matcher
  ) {
    return null;
  }
  const args = matcher.parent.arguments;
  const only = args.length === 1 ? args[0] : undefined;
  const assertsEmpty =
    ((matcher.name.text === "toEqual" ||
      matcher.name.text === "toStrictEqual") &&
      only !== undefined &&
      ts.isArrayLiteralExpression(only) &&
      only.elements.length === 0) ||
    (matcher.name.text === "toHaveLength" &&
      only !== undefined &&
      ts.isNumericLiteral(only) &&
      only.text === "0");
  return assertsEmpty ? call.arguments[0] : null;
}

// ---------------------------------------------------------------------------
// Rule 2: does the assertion run in a test that runs?
// ---------------------------------------------------------------------------

/** Where code runs when the file runs its tests. */
type RunContext =
  /** Inside a test that runs. */
  | "test"
  /** At collection: module level, or the body of a suite that runs. */
  | "collect"
  /** Not at all, or not provably: skipped, conditional, uncalled, a hook. */
  | "never";

const TEST_FUNCTIONS: ReadonlySet<string> = new Set([
  "it",
  "test",
  "xit",
  "xtest",
]);
const SUITE_FUNCTIONS: ReadonlySet<string> = new Set([
  "describe",
  "suite",
  "xdescribe",
]);
const HOOK_FUNCTIONS: ReadonlySet<string> = new Set([
  "beforeEach",
  "beforeAll",
  "afterEach",
  "afterAll",
]);
/** A base name that never runs what it is handed. */
const SKIPPING_BASES: ReadonlySet<string> = new Set([
  "xit",
  "xtest",
  "xdescribe",
]);
/**
 * Modifiers after which the callback does not run, runs only on a condition,
 * or runs expecting to FAIL — a passing assertion inside `it.fails` makes the
 * test red, the opposite of a proof.
 */
const NOT_RUN_MODIFIERS: ReadonlySet<string> = new Set([
  "skip",
  "todo",
  "skipIf",
  "runIf",
  "fails",
]);

/**
 * `it`, `it.only`, `it.each(table)`, `describe.skip`, `it.skipIf(c)`: the base
 * name and the modifiers, in order; `null` for any other callee.
 */
function calleeChain(
  callee: ts.Expression
): { readonly base: string; readonly modifiers: readonly string[] } | null {
  const modifiers: string[] = [];
  let current = callee;
  for (;;) {
    if (ts.isIdentifier(current)) return { base: current.text, modifiers };
    if (ts.isPropertyAccessExpression(current)) {
      modifiers.unshift(current.name.text);
      current = current.expression;
    } else if (ts.isCallExpression(current)) {
      // `it.each(table)(name, fn)`, `it.skipIf(cond)(name, fn)`.
      current = current.expression;
    } else {
      return null;
    }
  }
}

type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
}

/** The local name a function is bound to: `function f`, `const f = () =>`. */
function functionName(fn: FunctionNode): string | null {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? null;
  const parent = outermost(fn).parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : null;
}

/** Reads the analysis needs of one proof file's syntax tree. */
class ProofReader {
  private readonly contexts = new Map<ts.Node, RunContext>();
  private readonly identifiers: ts.Identifier[] = [];

  constructor(readonly source: ts.SourceFile) {
    const collect = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) this.identifiers.push(node);
      ts.forEachChild(node, collect);
    };
    collect(source);
  }

  /** Where `node` runs (see {@link RunContext}). */
  contextOf(node: ts.Node): RunContext {
    let fn: ts.Node | undefined = node.parent;
    while (fn !== undefined && !isFunctionNode(fn)) fn = fn.parent;
    if (fn === undefined) return "collect";
    const known = this.contexts.get(fn);
    if (known !== undefined) return known;
    // A cycle (a function that calls itself) resolves to "never" while it is
    // being worked out.
    this.contexts.set(fn, "never");
    const context = this.functionContext(fn);
    this.contexts.set(fn, context);
    return context;
  }

  /** Where the body of `fn` runs. */
  private functionContext(fn: FunctionNode): RunContext {
    const handedTo = outermost(fn).parent;
    if (ts.isCallExpression(handedTo)) {
      if (handedTo.expression === outermost(fn)) {
        return this.contextOf(handedTo); // an IIFE runs where it is called
      }
      const asCallback = this.callbackContext(handedTo);
      if (asCallback !== null) return asCallback;
    }
    const name = functionName(fn);
    if (name !== null) return this.calledFrom(name, fn);
    // Anything else handed to a call (`waitFor(() => …)`, `act(…)`,
    // `rows.forEach(…)`) runs where that call runs; a function anywhere else
    // (an object's method, a returned closure) is not provably called.
    return ts.isCallExpression(handedTo) ? this.contextOf(handedTo) : "never";
  }

  /**
   * Where a callback handed to `call` runs, when `call` is a test, a suite or
   * a hook; `null` for any other call.
   */
  private callbackContext(call: ts.CallExpression): RunContext | null {
    const chain = calleeChain(call.expression);
    if (chain === null) return null;
    const isTest = TEST_FUNCTIONS.has(chain.base);
    const isSuite = SUITE_FUNCTIONS.has(chain.base);
    if (HOOK_FUNCTIONS.has(chain.base)) return "never";
    if (!isTest && !isSuite) return null;
    if (
      SKIPPING_BASES.has(chain.base) ||
      chain.modifiers.some((m) => NOT_RUN_MODIFIERS.has(m))
    ) {
      return "never";
    }
    // A test or a suite runs what it is handed only where it is collected.
    if (this.contextOf(call) !== "collect") return "never";
    return isTest ? "test" : "collect";
  }

  /**
   * Where a named local function's body runs: the best of where it is called
   * (`f()`) and where it is handed to a test or suite (`it("x", f)`).
   */
  private calledFrom(name: string, fn: FunctionNode): RunContext {
    let best: RunContext = "never";
    for (const id of this.identifiers) {
      if (id.text !== name || isWithin(id, fn) || isDeclarationName(id)) {
        continue;
      }
      const parent = outermost(id).parent;
      let context: RunContext = "never";
      if (ts.isCallExpression(parent)) {
        // Called (`f()`), handed to a test or suite (`it("x", f)`), or handed
        // to any other call (`waitFor(f)`), which runs it where it runs.
        context =
          parent.expression === outermost(id)
            ? this.contextOf(parent)
            : (this.callbackContext(parent) ?? this.contextOf(parent));
      }
      if (context === "test") return "test";
      if (context === "collect") best = "collect";
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Rule 3: is the asserted view a render of the page?
  // -------------------------------------------------------------------------

  /**
   * Whether `expression` is, or is made from, a render whose JSX names one of
   * `pageTags`: directly, through the variable it reads (every assignment of
   * it), or through a local function whose body renders one.
   */
  rendersPage(
    expression: ts.Expression,
    pageTags: ReadonlySet<string>,
    visiting: Set<ts.Node> = new Set()
  ): boolean {
    const value = unwrap(expression);
    if (visiting.has(value)) return false;
    visiting.add(value);
    if (containsTag(value, pageTags)) return true;
    if (ts.isIdentifier(value)) {
      const sources = this.valuesOf(value);
      return (
        sources.length > 0 &&
        sources.every((s) => this.rendersPage(s, pageTags, visiting))
      );
    }
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
      const fn = this.localFunction(value.expression);
      return fn !== null && containsTag(fn, pageTags);
    }
    return false;
  }

  /**
   * Every value the variable `id` reads can hold: its declaration's
   * initializer and each assignment to it. Empty when it is a parameter or
   * is not declared in this file.
   */
  private valuesOf(id: ts.Identifier): ts.Expression[] {
    const declaration = this.declarationOf(id);
    if (declaration === null) return [];
    const out: ts.Expression[] = [];
    if (declaration.initializer) out.push(declaration.initializer);
    const scope = declaration.parent.parent.parent;
    const visit = (node: ts.Node): void => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        node.left.text === id.text
      ) {
        out.push(node.right);
      }
      ts.forEachChild(node, visit);
    };
    visit(scope);
    return out;
  }

  /** The innermost `const` / `let` / `var` declaring `id`'s name in scope of `id`. */
  private declarationOf(id: ts.Identifier): ts.VariableDeclaration | null {
    for (let at: ts.Node | undefined = id.parent; at; at = at.parent) {
      if (isFunctionNode(at)) {
        const isParameter = at.parameters.some((p) =>
          bindsName(p.name, id.text)
        );
        if (isParameter) return null;
      }
      if (ts.isBlock(at) || ts.isSourceFile(at) || ts.isModuleBlock(at)) {
        for (const statement of at.statements) {
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

  /** The local function a call names: `function f() {}` or `const f = () => …`. */
  private localFunction(name: ts.Identifier): ts.Node | null {
    for (let at: ts.Node | undefined = name.parent; at; at = at.parent) {
      if (!(ts.isBlock(at) || ts.isSourceFile(at))) continue;
      for (const statement of at.statements) {
        if (
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text === name.text &&
          statement.body
        ) {
          return statement;
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          const init = declaration.initializer;
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name.text &&
            init !== undefined &&
            (ts.isArrowFunction(unwrap(init)) ||
              ts.isFunctionExpression(unwrap(init)))
          ) {
            return init;
          }
        }
      }
    }
    return null;
  }
}

function isWithin(node: ts.Node, ancestor: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (at === ancestor) return true;
  }
  return false;
}

/** Whether `id` is the name a declaration binds rather than a reference. */
function isDeclarationName(id: ts.Identifier): boolean {
  const parent = id.parent;
  return (
    (ts.isFunctionDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === id
  );
}

function bindsName(name: ts.BindingName, wanted: string): boolean {
  if (ts.isIdentifier(name)) return name.text === wanted;
  return name.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindsName(element.name, wanted)
  );
}

/** Whether a JSX element under `node` is named one of `tags`. */
function containsTag(node: ts.Node, tags: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      tags.has(n.tagName.getText())
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * The JSX tag names the page module's default export is reachable by in a
 * proof file: `import Page from …` → `Page`; `import { default as Page }` →
 * `Page`; `import * as ns` → `ns.default`; `const { default: Page } =
 * await import(…)` (or `require`) → `Page`; `const m = await import(…)` →
 * `m.default`.
 */
function pageTagsIn(
  source: ts.SourceFile,
  isPage: (specifier: string) => boolean
): Set<string> {
  const tags = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isPage(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) tags.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      tags.add(`${bindings.name.text}.default`);
    } else if (bindings) {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === "default") {
          tags.add(element.name.text);
        }
      }
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const loaded = unwrap(node.initializer);
      const specifier =
        ts.isCallExpression(loaded) &&
        (loaded.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(loaded.expression) &&
            loaded.expression.text === "require")) &&
        loaded.arguments[0] !== undefined &&
        ts.isStringLiteralLike(loaded.arguments[0])
          ? loaded.arguments[0].text
          : null;
      if (specifier !== null && isPage(specifier)) {
        if (ts.isIdentifier(node.name)) {
          tags.add(`${node.name.text}.default`);
        } else if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const key = element.propertyName ?? element.name;
            if (
              ts.isIdentifier(key) &&
              key.text === "default" &&
              ts.isIdentifier(element.name)
            ) {
              tags.add(element.name.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return tags;
}

/** Read a proof file (see the module doc). `isPage` says whether a specifier names the route's page. */
export function proofFacts(
  file: string,
  text: string,
  isPage: (specifier: string) => boolean
): ProofFacts {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const reader = new ProofReader(source);
  const pageTags = pageTagsIn(source, isPage);
  const imports: string[] = [];
  const mocked: string[] = [];
  const assertions: HelperAssertion[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        callee.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        imports.push(node.arguments[0].text);
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "vi" &&
        (callee.name.text === "mock" || callee.name.text === "doMock")
      ) {
        const target = mockedSpecifier(node.arguments[0]);
        if (target !== null) mocked.push(target);
      }
      const view = assertedView(node);
      if (view !== null) {
        assertions.push({
          runs: reader.contextOf(node) === "test",
          overPage: view !== undefined && reader.rendersPage(view, pageTags),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, mocked, assertions };
}

/** `specifier`, imported from the `src/`-relative `from`, as a `src/`-relative module path. */
export function resolvedModule(specifier: string, from: string): string | null {
  const bare = specifier.replace(/\.(tsx?|jsx?)$/, "");
  if (bare.startsWith("@/")) return posix.normalize(bare.slice(2));
  if (bare.startsWith("./") || bare.startsWith("../")) {
    return posix.normalize(posix.join(posix.dirname(from), bare));
  }
  return null;
}

/**
 * Why `entry` is not a proven ready route; empty when it is. `read` returns a
 * `src/`-relative file's text, or `null` when there is no such file; `pageOf`
 * the route's `src/`-relative page module (no extension), or `null` when no
 * page serves it.
 */
export function readyRouteProblems(
  entry: PresentationReadyRoute,
  read: (srcRelative: string) => string | null,
  pageOf: (route: string) => string | null
): string[] {
  const problems: string[] = [];
  if (!isLensTreePath(entry.route)) {
    problems.push(
      `${entry.route}: not under a lens tree (${LENS_TREES.join(", ")})`
    );
  }
  if (!/\.test\.tsx?$/.test(entry.provenBy)) {
    problems.push(
      `${entry.route}: provenBy ${entry.provenBy} is not a test file`
    );
  }
  const page = pageOf(entry.route);
  if (page === null) {
    problems.push(`${entry.route}: no page module serves this route`);
  }
  const source = read(entry.provenBy);
  if (source === null) {
    problems.push(`${entry.route}: provenBy ${entry.provenBy} does not exist`);
    return problems;
  }
  const isPage = (specifier: string) =>
    page !== null && resolvedModule(specifier, entry.provenBy) === page;
  const facts = proofFacts(entry.provenBy, source, isPage);
  const running = facts.assertions.filter((a) => a.runs);
  if (facts.assertions.length === 0) {
    problems.push(
      `${entry.route}: ${entry.provenBy} never calls expectPresentationSafe, nor asserts findPresentationViolations empty`
    );
  } else if (running.length === 0) {
    problems.push(
      `${entry.route}: ${entry.provenBy} never runs its helper assertion — none is in a test that runs (an it or test not skipped, todo, conditional or expected to fail, under no skipped describe)`
    );
  }
  if (page !== null && !facts.imports.some(isPage)) {
    problems.push(
      `${entry.route}: ${entry.provenBy} does not render the page — it never imports ${page}`
    );
  } else if (page !== null && facts.mocked.some(isPage)) {
    problems.push(
      `${entry.route}: ${entry.provenBy} does not render the page — it mocks ${page}, so what renders is a stand-in`
    );
  } else if (
    page !== null &&
    running.length > 0 &&
    !running.some((a) => a.overPage)
  ) {
    problems.push(
      `${entry.route}: ${entry.provenBy} does not render the page — no test that runs asserts the helper over a render naming ${page}'s export`
    );
  }
  return problems;
}
