/**
 * proofRuns — rule 2 of `readinessProof.ts`: whether a helper assertion runs
 * where its failure FAILS A TEST THAT RUNS, every time that test runs (plan
 * `2026-10-23-console-presentation-spaces` D3; served policy `testing`
 * `a-green-run-must-prove-it-ran` and `a-test-must-be-able-to-fail`).
 *
 * A green proof means the page check passed only if the check ran and its
 * throw reached the runner. So the assertion is traced outward, and every step
 * must hold:
 *
 * - **Within its function** it is on the unconditional path: no `if`, `?:`,
 *   `&&` / `||` / `??`, loop, `switch` or optional call around it, no earlier
 *   `return` that can end the function first, and no `try` whose `catch`
 *   swallows it (`proofSyntax.ts` `stepProblem`). An earlier `throw` is fine: a
 *   throw fails the test, it cannot pass it.
 * - **Its function** delivers the failure: it is a test's own function; or it
 *   is called — a sync function from a place this same rule proves, an async
 *   one (whose failure is a rejected promise) from an `await` or a `return`
 *   this rule proves; or it is handed to `waitFor`, `vi.waitFor` or `act`,
 *   which run it and reject with its failure, themselves awaited or returned
 *   (and `waitFor` / `act` only while the file does not mock Testing Library,
 *   which supplies them). Handed to anything else — `expect(() => …)` (whose
 *   `.toThrow()` would pass on an unsafe page), `.then`, a timer, `forEach` —
 *   it is not read as running, and a hook or a suite body is not a test.
 * - **The test runs**: an `it` / `test` with no modifier but `only`,
 *   `concurrent`, `sequential`, `each` or `for` (an `.each` / `.for` table
 *   must be a literal array with a row, or a `const` naming one — an empty
 *   table registers no test); options, if any, an object literal that sets no
 *   `skip`, `todo` or `fails`; marked `.only` itself when anything else in the
 *   file is (outside CI vitest then runs only what is marked); a function
 *   whose context cannot reach `skip` (`ctx.skip()` skips at run time), in a
 *   file no `beforeEach` / `aroundEach` of which can either; registered on the
 *   unconditional path of the module or of a suite that is itself registered
 *   that way, with the same modifier and option rules.
 *
 * Each refusal says why, with a line, so an author can move the assertion to
 * where it counts: directly in the test's body, after no early `return`.
 */

import ts from "typescript";
import {
  at,
  calleeChain,
  calleeText,
  declarationOf,
  functionName,
  isAsync,
  isConst,
  isDeclarationName,
  isFunctionNode,
  isWithin,
  localFunction,
  mockTarget,
  outermost,
  stepProblem,
  unwrap,
  type CalleeChain,
  type FunctionNode,
} from "./proofSyntax";

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
/** Bases that never run what they are handed. */
const SKIPPING_BASES: ReadonlySet<string> = new Set([
  "xit",
  "xtest",
  "xdescribe",
]);
/**
 * The modifiers a test or suite still runs under. Every other one — `skip`,
 * `todo`, `skipIf`, `runIf`, `fails`, or one this check does not know — is
 * read as not running it.
 */
const RUN_MODIFIERS: ReadonlySet<string> = new Set([
  "only",
  "concurrent",
  "sequential",
  "shuffle",
  "each",
  "for",
]);
const MODIFIER_EFFECTS: ReadonlyMap<string, string> = new Map([
  ["skip", "never runs"],
  ["todo", "never runs"],
  ["skipIf", "runs only on a condition"],
  ["runIf", "runs only on a condition"],
  ["fails", "passes only when it fails"],
]);
/** Options that skip a test or a suite, or make it pass only by failing. */
const RUN_MODE_OPTIONS: ReadonlySet<string> = new Set([
  "skip",
  "todo",
  "fails",
]);
const HOOK_FUNCTIONS: ReadonlySet<string> = new Set([
  "beforeEach",
  "beforeAll",
  "afterEach",
  "afterAll",
  "aroundEach",
  "aroundAll",
  "onTestFinished",
  "onTestFailed",
]);
/** Hooks that run before a test's body, given its context: they can skip it. */
const SKIPPING_HOOKS: ReadonlyMap<string, number> = new Map([
  ["beforeEach", 0],
  ["aroundEach", 1],
]);
/** Calls that run the callback they are handed and reject with its failure. */
const RUNNERS: ReadonlySet<string> = new Set(["waitFor", "act", "vi.waitFor"]);
/** The runners Testing Library supplies: a file that mocks it may have replaced them. */
const TESTING_LIBRARY_RUNNERS: ReadonlySet<string> = new Set([
  "waitFor",
  "act",
]);
const TESTING_LIBRARY: ReadonlySet<string> = new Set([
  "@testing-library/react",
  "@testing-library/dom",
]);
const TIMERS: ReadonlySet<string> = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
]);
const PROMISE_CALLBACKS: ReadonlySet<string> = new Set([
  "then",
  "catch",
  "finally",
]);
const ITERATIONS: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "flatMap",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "reduce",
  "reduceRight",
  "sort",
  "from",
]);

/**
 * The test-context fields that cannot reach `skip`. An allow-list: `task`, for
 * one, reaches it again (`ctx.task.context.skip()`), and so may a field this
 * check has not met.
 */
const SAFE_CONTEXT_FIELDS: ReadonlySet<string> = new Set([
  "expect",
  "onTestFinished",
  "onTestFailed",
  "annotate",
  "signal",
]);

/**
 * `null` for a context field that cannot reach `skip`; `""` for `skip` itself;
 * else the clause saying why it may.
 */
function contextFieldProblem(field: string): string | null {
  if (SAFE_CONTEXT_FIELDS.has(field)) return null;
  return field === "skip"
    ? ""
    : ", which this check does not know cannot reach `skip`";
}

/** How a failure leaves a function: a throw, or the rejection of what it returns. */
type Carrier = "throw" | "rejection";

/** `null` when proven; else why not. */
type Verdict = string | null;

/** The name the last link of a callee chain gives a hook call, if it is one. */
function hookName(chain: CalleeChain | null): string | null {
  if (chain === null) return null;
  const name = chain.modifiers.at(-1) ?? chain.base;
  return HOOK_FUNCTIONS.has(name) ? name : null;
}

/** `waitFor`, `act`, `vi.waitFor` — the dotted name of a call's callee. */
function dottedName(callee: ts.Expression): string | null {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) {
    const left = dottedName(callee.expression);
    return left === null ? null : `${left}.${callee.name.text}`;
  }
  return null;
}

/** The last name a callee ends in: `then` for `p.then`, `setTimeout`. */
function lastName(callee: ts.Expression): string | null {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** The first name a callee starts from: `expect` for `expect.poll`. */
function rootName(callee: ts.Expression): string | null {
  let current = callee;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isCallExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

function label(fn: FunctionNode): string {
  const name = functionName(fn);
  return name !== null ? `\`${name}\`` : `the callback ${at(fn)}`;
}

/** Whether an `.each` / `.for` table provably has a row. */
function hasRows(table: ts.Expression | undefined): boolean {
  if (table === undefined) return false;
  const value = unwrap(table);
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.some(
      (e) => !ts.isSpreadElement(e) && !ts.isOmittedExpression(e)
    );
  }
  if (ts.isIdentifier(value)) {
    const declaration = declarationOf(value);
    return (
      declaration !== null &&
      isConst(declaration) &&
      hasRows(declaration.initializer)
    );
  }
  return false;
}

/**
 * The options a test or suite call is handed: its second argument when a
 * third follows (`it(name, options, fn)`) and it is not the function itself
 * (`it(name, fn, timeout)`).
 */
function optionsOf(call: ts.CallExpression): ts.Expression | undefined {
  const second = call.arguments[1];
  return call.arguments.length >= 3 &&
    second !== undefined &&
    !isFunctionNode(unwrap(second))
    ? second
    : undefined;
}

/** Whether `options` may set `only` (anything this check cannot read may). */
function mayBeOnly(options: ts.Expression): boolean {
  const value = unwrap(options);
  if (ts.isNumericLiteral(value)) return false;
  if (!ts.isObjectLiteralExpression(value)) return true;
  return value.properties.some((property) => {
    if (ts.isSpreadAssignment(property)) return true;
    const name = property.name;
    if (name === undefined || ts.isComputedPropertyName(name)) return true;
    if (!(ts.isIdentifier(name) || ts.isStringLiteral(name))) return false;
    return (
      name.text === "only" &&
      !(
        ts.isPropertyAssignment(property) &&
        property.initializer.kind === ts.SyntaxKind.FalseKeyword
      )
    );
  });
}

/** Whether `options` set `only: true`, literally. */
function setsOnly(options: ts.Expression): boolean {
  const value = unwrap(options);
  return (
    ts.isObjectLiteralExpression(value) &&
    value.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "only" &&
        property.initializer.kind === ts.SyntaxKind.TrueKeyword
    )
  );
}

/** Why the options a test or suite is handed may stop it running; `null` when they cannot. */
function optionsProblem(options: ts.Expression, owner: string): Verdict {
  const value = unwrap(options);
  if (ts.isNumericLiteral(value)) return null; // a timeout
  if (!ts.isObjectLiteralExpression(value)) {
    return `${owner} is handed options ${at(value)} that are not an object literal, so this check cannot see that they do not skip it`;
  }
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) {
      return `${owner} is handed options that spread an object ${at(property)}, which may skip it`;
    }
    const name = property.name;
    const key =
      name !== undefined &&
      (ts.isIdentifier(name) ||
        ts.isStringLiteral(name) ||
        ts.isNumericLiteral(name))
        ? name.text
        : null;
    if (key === null) {
      return `${owner} is handed options with a computed key ${at(property)}, which may skip it`;
    }
    if (!RUN_MODE_OPTIONS.has(key)) continue;
    const off =
      ts.isPropertyAssignment(property) &&
      property.initializer.kind === ts.SyntaxKind.FalseKeyword;
    if (!off) {
      return `${owner} is handed options that set \`${key}\` ${at(property)}, so it ${MODIFIER_EFFECTS.get(key) ?? "may not run"}`;
    }
  }
  return null;
}

/**
 * Reads, for one proof file, where each helper assertion's failure goes. Built
 * once per file; {@link assertionProblem} is the one question it answers.
 */
export class RunReader {
  private readonly identifiers: ts.Identifier[] = [];
  private readonly calls: ts.CallExpression[] = [];
  private readonly delivered = new Map<FunctionNode, Map<Carrier, Verdict>>();
  private readonly collected = new Map<FunctionNode, Verdict>();
  /** Whether the file mocks Testing Library, which supplies `waitFor` and `act`. */
  private readonly runnersMocked: boolean;
  private hooks: Verdict | undefined;
  private onlies: ts.CallExpression[] | undefined;

  constructor(source: ts.SourceFile) {
    const collect = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) this.identifiers.push(node);
      if (ts.isCallExpression(node)) this.calls.push(node);
      ts.forEachChild(node, collect);
    };
    collect(source);
    this.runnersMocked = this.calls.some((call) => {
      const target = mockTarget(call);
      return target !== null && TESTING_LIBRARY.has(target);
    });
  }

  /**
   * `null` when a throw from `assertion` fails a test that runs, every time
   * that test runs; else why not.
   */
  assertionProblem(assertion: ts.Node): Verdict {
    if (ts.isOptionalChain(assertion)) {
      return `the assertion is an optional call ${at(assertion)}, which is not made when the \`?.\` chain stops`;
    }
    return this.throwProblem(assertion, "the assertion");
  }

  /**
   * Walk from `node` to the function holding it (or the module), step by step
   * on the unconditional path.
   */
  private walk(
    node: ts.Node,
    subject: string
  ): { fn: FunctionNode | null; problem: Verdict } {
    let child: ts.Node = node;
    for (let parent = node.parent; parent; parent = parent.parent) {
      // `child` is the body here: a parameter's default stops the walk first.
      if (isFunctionNode(parent)) return { fn: parent, problem: null };
      if (ts.isSourceFile(parent)) return { fn: null, problem: null };
      const problem = stepProblem(parent, child, subject);
      if (problem !== null) return { fn: null, problem };
      child = parent;
    }
    return { fn: null, problem: null };
  }

  /** A throw at `node` fails a test that runs. */
  private throwProblem(node: ts.Node, subject: string): Verdict {
    const { fn, problem } = this.walk(node, subject);
    if (problem !== null) return problem;
    if (fn === null) return `${subject} runs at module level, in no test`;
    return this.deliveryProblem(fn, isAsync(fn) ? "rejection" : "throw");
  }

  /** The rejection of the promise `node` evaluates to fails a test that runs. */
  private rejectionProblem(node: ts.Expression, subject: string): Verdict {
    const site = outermost(node);
    const parent = site.parent;
    if (ts.isAwaitExpression(parent)) return this.throwProblem(parent, subject);
    const returned =
      ts.isReturnStatement(parent) ||
      (isFunctionNode(parent) && parent.body === site);
    if (!returned) {
      return `${subject} is neither awaited nor returned, so a failure in it lands after the test has passed`;
    }
    const { fn, problem } = this.walk(site, subject);
    if (problem !== null) return problem;
    if (fn === null)
      return `${subject} is returned at module level, in no test`;
    return this.deliveryProblem(fn, "rejection");
  }

  /** A failure leaving `fn` by `carrier` fails a test that runs. */
  private deliveryProblem(fn: FunctionNode, carrier: Carrier): Verdict {
    const known = this.delivered.get(fn)?.get(carrier);
    if (known !== undefined) return known;
    const memo = this.delivered.get(fn) ?? new Map<Carrier, Verdict>();
    this.delivered.set(fn, memo);
    // A function that reaches itself is not proven by that path.
    memo.set(carrier, `${label(fn)} is only reached through itself`);
    const verdict = this.computeDelivery(fn, carrier);
    memo.set(carrier, verdict);
    return verdict;
  }

  private computeDelivery(fn: FunctionNode, carrier: Carrier): Verdict {
    if (fn.asteriskToken) {
      // Calling a generator returns an iterator and runs none of its body.
      return `${label(fn)} is a generator, which runs only as far as something iterates it`;
    }
    const site = outermost(fn);
    const parent = site.parent;
    if (ts.isCallExpression(parent)) {
      if (parent.expression === site) {
        // An IIFE: the callback's own line is the call's.
        const subject = `the call of ${label(fn)}`;
        return carrier === "throw"
          ? this.throwProblem(parent, subject)
          : this.rejectionProblem(parent, subject);
      }
      return this.handedProblem(parent, site, fn);
    }
    const name = functionName(fn);
    if (name === null) {
      return `${label(fn)} is not called anywhere this check can follow`;
    }
    const problems: string[] = [];
    for (const id of this.references(name, fn)) {
      const ref = outermost(id);
      const call = ref.parent;
      if (!ts.isCallExpression(call)) continue; // stored or aliased: not followed
      const subject = `the call to \`${name}\` ${at(call)}`;
      const verdict =
        call.expression === ref
          ? carrier === "throw"
            ? this.throwProblem(call, subject)
            : this.rejectionProblem(call, subject)
          : this.handedProblem(call, ref, fn);
      if (verdict === null) return null;
      problems.push(verdict);
    }
    return problems[0] ?? `\`${name}\` is a function nobody calls`;
  }

  /** Where `fn`, handed to `call` as `argument`, runs and fails a test. */
  private handedProblem(
    call: ts.CallExpression,
    argument: ts.Node,
    fn: FunctionNode
  ): Verdict {
    const chain = calleeChain(call.expression);
    const hook = hookName(chain);
    if (hook !== null) {
      return `${label(fn)} runs in a \`${hook}\` hook ${at(call)}, in no test`;
    }
    if (chain !== null && TEST_FUNCTIONS.has(chain.base)) {
      return this.testProblem(call, chain, argument, fn);
    }
    if (chain !== null && SUITE_FUNCTIONS.has(chain.base)) {
      return `${label(fn)} runs while the suite ${at(call)} is collected, in no test`;
    }
    const dotted = dottedName(call.expression);
    if (
      dotted !== null &&
      RUNNERS.has(dotted) &&
      call.arguments[0] === argument
    ) {
      if (this.runnersMocked && TESTING_LIBRARY_RUNNERS.has(dotted)) {
        return `${label(fn)} is handed to \`${dotted}\` ${at(call)}, which this file may have replaced: it mocks Testing Library`;
      }
      return this.rejectionProblem(
        call,
        `the \`${dotted}\` running it ${at(call)}`
      );
    }
    const name = lastName(call.expression);
    if (rootName(call.expression) === "expect") {
      return `${label(fn)} is handed to \`expect\` ${at(call)}, which asserts on what it throws instead of failing the test — \`.toThrow()\` would pass on an unsafe page`;
    }
    if (name !== null && TIMERS.has(name)) {
      return `${label(fn)} is a timer callback (\`${name}\`) ${at(call)}, which fires after the test has finished, if at all`;
    }
    if (name !== null && PROMISE_CALLBACKS.has(name)) {
      return `${label(fn)} is a promise callback (\`.${name}\`) ${at(call)}, which this check does not read as failing the test`;
    }
    if (name !== null && ITERATIONS.has(name)) {
      return `${label(fn)} is an iteration callback (\`.${name}\`) ${at(call)}, which runs once per item — no times for an empty list`;
    }
    return `${label(fn)} is handed to \`${calleeText(call)}\` ${at(call)}, which this check does not read as running it and failing the test (only a test, \`waitFor\`, \`vi.waitFor\` and \`act\` are)`;
  }

  /** The test `call` runs `fn` (handed as `argument`) every time the file runs. */
  private testProblem(
    call: ts.CallExpression,
    chain: CalleeChain,
    argument: ts.Node,
    fn: FunctionNode
  ): Verdict {
    const owner = `the test ${at(call)}`;
    const registration = this.registrationProblem(call, chain, argument, owner);
    if (registration !== null) return registration;
    const only = this.onlyProblem(call, chain, owner);
    if (only !== null) return only;
    // An `.each` handler is handed the row, not the context; `.for` the row, then the context.
    const contextAt = chain.modifiers.includes("each")
      ? null
      : chain.modifiers.includes("for")
        ? 1
        : 0;
    if (contextAt !== null) {
      const skips = this.contextSkipProblem(fn, contextAt);
      if (skips !== null)
        return `${owner} can skip itself at run time: ${skips}`;
    }
    const hooks = this.hookProblem();
    if (hooks !== null) return hooks;
    return this.collectionProblem(call, owner);
  }

  /**
   * The modifiers, tables, argument position and options of a test or suite
   * call let it run what it is handed as `argument`.
   */
  private registrationProblem(
    call: ts.CallExpression,
    chain: CalleeChain,
    argument: ts.Node,
    owner: string
  ): Verdict {
    if (SKIPPING_BASES.has(chain.base)) {
      return `${owner} is \`${chain.base}\`, which never runs`;
    }
    const off = chain.modifiers.find((m) => !RUN_MODIFIERS.has(m));
    if (off !== undefined) {
      return `${owner} is \`${chain.base}.${off}\`, which ${MODIFIER_EFFECTS.get(off) ?? "this check does not read as running"}`;
    }
    const empty = chain.tables.find((t) => !hasRows(t.table));
    if (empty !== undefined) {
      return `${owner} is \`${chain.base}.${empty.link}\` over a table this check cannot see has a row (a literal array, or a \`const\` naming one) — an empty table registers nothing`;
    }
    const index = call.arguments.findIndex((a) => a === argument);
    if (index === 2) {
      const options = call.arguments[1];
      return options === undefined ? null : optionsProblem(options, owner);
    }
    return index === 1
      ? null
      : `the function at argument ${index + 1} of ${owner} is not the one it runs (vitest runs the function after the name, or after the options)`;
  }

  /**
   * Why a `.only` elsewhere in the file skips the test `call`: in a file with
   * one, vitest runs only what is marked (`allowOnly` is on outside CI), and
   * only a test marked itself is sure to be among it.
   */
  private onlyProblem(
    call: ts.CallExpression,
    chain: CalleeChain,
    owner: string
  ): Verdict {
    const options = optionsOf(call);
    if (
      chain.modifiers.includes("only") ||
      (options !== undefined && setsOnly(options))
    ) {
      return null;
    }
    if (this.onlies === undefined) {
      this.onlies = this.calls.filter((other) => {
        const otherChain = calleeChain(other.expression);
        if (
          otherChain === null ||
          hookName(otherChain) !== null ||
          !(
            TEST_FUNCTIONS.has(otherChain.base) ||
            SUITE_FUNCTIONS.has(otherChain.base)
          )
        ) {
          return false;
        }
        const otherOptions = optionsOf(other);
        return (
          otherChain.modifiers.includes("only") ||
          (otherOptions !== undefined && mayBeOnly(otherOptions))
        );
      });
    }
    const other = this.onlies.find((marker) => marker !== call);
    return other === undefined
      ? null
      : `a \`.only\` ${at(other)} elsewhere in the file skips ${owner}, which is not marked \`.only\` itself`;
  }

  /** Why the context parameter at `index` of `fn` can reach `skip`; `null` when it cannot. */
  private contextSkipProblem(fn: FunctionNode, index: number): Verdict {
    const param = fn.parameters[index];
    if (param === undefined) return null;
    if (param.dotDotDotToken) {
      return `its context is gathered by a rest parameter ${at(param)}, which this check cannot follow to \`skip\``;
    }
    const name = param.name;
    if (ts.isIdentifier(name)) {
      for (const id of this.identifiers) {
        if (
          id === name ||
          id.text !== name.text ||
          !isWithin(id, fn) ||
          isDeclarationName(id)
        ) {
          continue;
        }
        const ref = outermost(id);
        const use = ref.parent;
        if (!(ts.isPropertyAccessExpression(use) && use.expression === ref)) {
          return `its context \`${name.text}\` is handed on or aliased ${at(use)}, which this check cannot follow to \`skip\``;
        }
        const field = contextFieldProblem(use.name.text);
        if (field !== null) {
          return `it reads \`${name.text}.${use.name.text}\` ${at(use)}${field}`;
        }
      }
      return null;
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (element.dotDotDotToken) {
          return `it gathers its context's remaining fields ${at(element)}, \`skip\` among them`;
        }
        const key = element.propertyName ?? element.name;
        if (!(ts.isIdentifier(key) || ts.isStringLiteral(key))) {
          return `it reads a computed field of its context ${at(element)}`;
        }
        const field = contextFieldProblem(key.text);
        if (field !== null) {
          return `it takes \`${key.text}\` from its context ${at(element)}${field}`;
        }
      }
      return null;
    }
    return `its context is destructured as an array ${at(param)}`;
  }

  /** Why a hook in this file can skip a test before its body runs; `null` when none can. */
  private hookProblem(): Verdict {
    if (this.hooks !== undefined) return this.hooks;
    this.hooks = null;
    for (const call of this.calls) {
      const hook = hookName(calleeChain(call.expression));
      const contextAt = hook === null ? undefined : SKIPPING_HOOKS.get(hook);
      if (hook === null || contextAt === undefined) continue;
      const handed = call.arguments[0] && unwrap(call.arguments[0]);
      const fn =
        handed === undefined
          ? null
          : isFunctionNode(handed)
            ? handed
            : ts.isIdentifier(handed)
              ? localFunction(handed)
              : null;
      if (fn === null) {
        this.hooks = `the \`${hook}\` hook ${at(call)} is handed a function this check cannot read, which may skip every test in the file`;
        break;
      }
      const skips = this.contextSkipProblem(fn, contextAt);
      if (skips !== null) {
        this.hooks = `the \`${hook}\` hook ${at(call)} can skip every test in the file at run time: ${skips}`;
        break;
      }
    }
    return this.hooks;
  }

  /** The test or suite `call` is registered every time its file is collected. */
  private collectionProblem(call: ts.CallExpression, owner: string): Verdict {
    const { fn, problem } = this.walk(call, owner);
    if (problem !== null) return problem;
    return fn === null ? null : this.collectsProblem(fn);
  }

  /** The body of `fn` runs every time the file is collected. */
  private collectsProblem(fn: FunctionNode): Verdict {
    const known = this.collected.get(fn);
    if (known !== undefined) return known;
    this.collected.set(fn, `${label(fn)} is only reached through itself`);
    const verdict = this.computeCollects(fn);
    this.collected.set(fn, verdict);
    return verdict;
  }

  private computeCollects(fn: FunctionNode): Verdict {
    const site = outermost(fn);
    const parent = site.parent;
    if (ts.isCallExpression(parent)) {
      if (parent.expression === site) {
        return isAsync(fn)
          ? `${label(fn)} registers tests from an async function, which may register them after collection`
          : this.collectionProblem(parent, `the call of ${label(fn)}`);
      }
      return this.registeredInProblem(parent, site, fn);
    }
    const name = functionName(fn);
    if (name === null) {
      return `${label(fn)} registers tests but is not called anywhere this check can follow`;
    }
    if (isAsync(fn)) {
      return `\`${name}\` registers tests from an async function, which may register them after collection`;
    }
    const problems: string[] = [];
    for (const id of this.references(name, fn)) {
      const ref = outermost(id);
      const call = ref.parent;
      if (!ts.isCallExpression(call)) continue;
      const verdict =
        call.expression === ref
          ? this.collectionProblem(call, `the call to \`${name}\` ${at(call)}`)
          : this.registeredInProblem(call, ref, fn);
      if (verdict === null) return null;
      problems.push(verdict);
    }
    return problems[0] ?? `\`${name}\` registers tests but nobody calls it`;
  }

  /** `fn`, handed to `call` as `argument`, runs at collection: it is a suite's body. */
  private registeredInProblem(
    call: ts.CallExpression,
    argument: ts.Node,
    fn: FunctionNode
  ): Verdict {
    const chain = calleeChain(call.expression);
    const hook = hookName(chain);
    if (hook !== null) {
      return `${label(fn)} registers tests in a \`${hook}\` hook ${at(call)}, which runs after collection`;
    }
    if (chain !== null && SUITE_FUNCTIONS.has(chain.base)) {
      const owner = `the suite ${at(call)}`;
      return (
        this.registrationProblem(call, chain, argument, owner) ??
        this.collectionProblem(call, owner)
      );
    }
    if (chain !== null && TEST_FUNCTIONS.has(chain.base)) {
      return `${label(fn)} registers tests inside a test ${at(call)}, which vitest does not collect`;
    }
    return `${label(fn)} registers tests in a callback handed to \`${calleeText(call)}\` ${at(call)}, which this check does not read as running it`;
  }

  /** Every reference to the local `name` outside `fn` itself. */
  private references(name: string, fn: FunctionNode): ts.Identifier[] {
    return this.identifiers.filter(
      (id) => id.text === name && !isWithin(id, fn) && !isDeclarationName(id)
    );
  }
}
