/**
 * readinessProof — whether a page test PROVES what a
 * `PRESENTATION_READY_ROUTES` entry claims: that a presentation-mode render
 * of the route's own page passes the page check (plan
 * `2026-10-23-console-presentation-spaces` D3.2; served policy `testing`
 * `a-green-run-must-prove-it-ran` and `a-test-must-be-able-to-fail`).
 *
 * The test file is read as TypeScript, so a call in a comment or a string is
 * no call. It proves the route only when ALL of these hold:
 *
 * 1. **It asserts the helper** — `expectPresentationSafe(…)`, or
 *    `findPresentationViolations(…)` (optionally `.map(describeViolation)`) as
 *    the value of `expect(…)` asserted empty. A finder whose answer is
 *    discarded, kept, or asserted anything else asserts nothing. The helper
 *    module (`src/test/presentation`) is not mocked: a stand-in asserts
 *    nothing either.
 * 2. **That assertion runs where its failure fails a test that runs**, every
 *    time that test runs (`proofRuns.ts` reads it): on the unconditional path
 *    of the test's own body — not under an `if`, `?:`, `&&`, loop or `switch`,
 *    nor after an early `return`, nor in a `try` whose `catch` swallows it; or
 *    of a helper the test calls (awaited, when the helper is async), or of a
 *    callback handed to `waitFor` / `vi.waitFor` / `act` that is awaited or
 *    returned (in a file that does not mock Testing Library) — never of a
 *    callback handed to anything else (`expect(() => …).toThrow()` would pass
 *    on an unsafe page; a `.then`, a timer or a `forEach` runs it late or not
 *    at all). The test itself runs: no `.skip`, `.todo`, `.skipIf`, `.runIf`
 *    or `.fails` (nor `xit` / `xdescribe`), no options that set `skip`, `todo`
 *    or `fails`, its own `.only` when anything else in the file has one, no
 *    context `skip` it or a `beforeEach` / `aroundEach` could call, no `.each`
 *    over a table that may be empty, and registered on the unconditional path
 *    of the module or of a suite that is registered the same way. A build that
 *    skips its own proof proves nothing for the build it skips in, so no
 *    condition — at collection or at run time — counts.
 * 3. **It runs over a render of the page** — the asserted view is a render
 *    whose JSX names the page module's binding (`<DevOpsPage />`, however
 *    deep in wrappers) where evaluating the render evaluates it — not in one
 *    branch of a `?:` or `&&`, nor in a callback such as a render prop —
 *    directly, through the variable it was assigned to (every value it can
 *    hold), or through a local function every one of whose returns renders it.
 *    The binding is the page module's default export, imported
 *    (`import Page from`, `{ default as Page }`, `* as ns` → `<ns.default />`)
 *    or loaded (`await import(…)`, `require(…)`). A view of one panel of the
 *    page — or of anything else — is not one, even while the page module is
 *    imported beside it. A view that is a function's parameter is not traced
 *    back to its callers, so it fails closed: assert where the render is.
 * 4. **It imports that page, and does not mock it** (`vi.mock`, `vi.doMock`,
 *    by specifier or `import()`): a stand-in renders in the page's place.
 *
 * Names are read as this repo's tests use them (`it`, `describe`, `waitFor`,
 * `expectPresentationSafe`, …): a file that defines its own function under one
 * of those names is not what this guards against.
 */

import { posix } from "node:path";
import ts from "typescript";
import {
  LENS_TREES,
  isLensTreePath,
  type PresentationReadyRoute,
} from "@/components/presentation/presentationReadiness";
import { RunReader } from "./proofRuns";
import {
  declarationOf,
  isFunctionNode,
  lineOf,
  localFunction,
  mockTarget,
  outermost,
  returnedValues,
  stepProblem,
  unwrap,
} from "./proofSyntax";

/** The page check's module, `src/`-relative: mocking it mocks the assertion. */
const HELPER_MODULE = "test/presentation";

/** One helper assertion in a proof file, and what is known about it. */
export interface HelperAssertion {
  /** The line it is on, 1-based. */
  readonly line: number;
  /** Whether it runs where its failure fails a test that runs (rule 2). */
  readonly runs: boolean;
  /** Why it does not (rule 2); `null` when it does. */
  readonly why: string | null;
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

function calls(node: ts.CallExpression, name: string): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === name;
}

// ---------------------------------------------------------------------------
// Rule 1: is this call a helper assertion?
// ---------------------------------------------------------------------------

/** A helper assertion: what it checks, and the call whose throw is its failure. */
interface Asserted {
  /** The view it checks: the helper's first argument (`undefined` when it has none). */
  readonly view: ts.Expression | undefined;
  /** The helper call, or the `expect(…).toEqual([])` matcher call around the finder. */
  readonly assertion: ts.CallExpression;
}

/** `call` as a helper assertion (rule 1); `null` when it is not one. */
function assertedView(call: ts.CallExpression): Asserted | null {
  if (calls(call, "expectPresentationSafe")) {
    return { view: call.arguments[0], assertion: call };
  }
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
  return assertsEmpty
    ? { view: call.arguments[0], assertion: matcher.parent }
    : null;
}

// ---------------------------------------------------------------------------
// Rule 3: is the asserted view a render of the page?
// ---------------------------------------------------------------------------

/** Whether `node` is evaluated every time its ancestor `root` is. */
function evaluatedWith(node: ts.Node, root: ts.Node): boolean {
  for (let child = node; child !== root; child = child.parent) {
    const parent: ts.Node | undefined = child.parent;
    if (
      parent === undefined ||
      isFunctionNode(parent) ||
      stepProblem(parent, child, "the page") !== null
    ) {
      return false;
    }
  }
  return true;
}

/** Whether evaluating `value` evaluates a JSX element named one of `tags`. */
function rendersTag(value: ts.Node, tags: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tags.has(node.tagName.getText()) &&
      evaluatedWith(node, value)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(value);
  return found;
}

/**
 * Every value the variable `id` reads can hold: its declaration's
 * initializer and each assignment to it. Empty when it is a parameter or
 * is not declared in this file.
 */
function valuesOf(id: ts.Identifier): ts.Expression[] {
  const declaration = declarationOf(id);
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

/**
 * Whether `expression` is, or is made from, a render that evaluates JSX
 * naming one of `pageTags`: directly, through the variable it reads (every
 * value it can hold), or through a local function every one of whose returns
 * is such a render. `path` holds what is being traced, against cycles.
 */
function rendersPage(
  expression: ts.Expression,
  pageTags: ReadonlySet<string>,
  path: Set<ts.Node> = new Set()
): boolean {
  const value = unwrap(expression);
  if (path.has(value)) return false;
  path.add(value);
  try {
    if (rendersTag(value, pageTags)) return true;
    if (ts.isIdentifier(value)) {
      const sources = valuesOf(value);
      return (
        sources.length > 0 &&
        sources.every((s) => rendersPage(s, pageTags, path))
      );
    }
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
      const fn = localFunction(value.expression);
      const returned = fn === null ? [] : returnedValues(fn);
      return (
        returned.length > 0 &&
        returned.every((r) => rendersPage(r, pageTags, path))
      );
    }
    return false;
  } finally {
    path.delete(value);
  }
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
  const runs = new RunReader(source);
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
      const target = mockTarget(node);
      if (target !== null) mocked.push(target);
      const asserted = assertedView(node);
      if (asserted !== null) {
        const why = runs.assertionProblem(asserted.assertion);
        assertions.push({
          line: lineOf(node),
          runs: why === null,
          why,
          overPage:
            asserted.view !== undefined && rendersPage(asserted.view, pageTags),
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
    const reasons = [
      ...new Set(facts.assertions.map((a) => `line ${a.line}: ${a.why}`)),
    ];
    problems.push(
      `${entry.route}: ${entry.provenBy} never runs its helper assertion where a failure fails a test that runs — ${reasons.join("; ")}`
    );
  }
  if (
    facts.mocked.some(
      (s) => resolvedModule(s, entry.provenBy) === HELPER_MODULE
    )
  ) {
    problems.push(
      `${entry.route}: ${entry.provenBy} mocks the page check (src/${HELPER_MODULE}), so what asserts is a stand-in`
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
      `${entry.route}: ${entry.provenBy} does not render the page — no test that runs asserts the helper over a render naming ${page}'s export where the render always evaluates it (not in one branch of a \`?:\` or \`&&\`, nor in a callback)`
    );
  }
  return problems;
}
