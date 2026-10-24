/**
 * The proof check can fail (plan `2026-10-23-console-presentation-spaces` D3;
 * served policy `testing` `a-test-must-be-able-to-fail`).
 *
 * Every source below is a page test a `PRESENTATION_READY_ROUTES` entry could
 * name, read by `readyRouteProblems` as if it sat beside the Dev Ops page. A
 * proof is accepted only when it asserts the page check (rule 1), where a
 * failure fails a test that runs, every time it runs (rule 2), over a render
 * of the page (rule 3), with the page imported and not mocked (rule 4) —
 * `readinessProof.ts` and `proofRuns.ts` say how each is read. Each refusal
 * names the reason it must give, so a guard that stops firing turns its own
 * row red, and each accepted shape keeps a guard from over-reaching.
 */

import { describe, expect, it } from "vitest";
import type { PresentationReadyRoute } from "@/components/presentation/presentationReadiness";
import { readyRouteProblems } from "./readinessProof";

const DIR = "app/(app)/admin/coord/devops/";
const DEVOPS_PAGE = `${DIR}page`;
const PAGE = 'import DevOpsPage from "./page";\n';
const PANEL_IMPORT =
  'import { HealthPanel } from "./_components/HealthPanel";\n';
const RENDER = "const view = renderInPresentationMode(<DevOpsPage />);";
const PANEL = "const view = renderInPresentationMode(<HealthPanel />);";
/** The page rendered and checked, as a test's function. */
const CHECKED = `() => {\n  ${RENDER}\n  expectPresentationSafe(view);\n}`;
/** `body` inside a test that runs. */
const inTest = (body: string) => `it("is safe to show", () => {\n${body}\n});`;
/** `body` inside an async test that runs. */
const inAsyncTest = (body: string) =>
  `it("is safe to show", async () => {\n${body}\n});`;

const NEVER_CALLS = "never calls expectPresentationSafe";
const NEVER_RUNS =
  "never runs its helper assertion where a failure fails a test that runs";
const NOT_THE_PAGE = "does not render the page";
const OVER_SOMETHING_ELSE =
  "no test that runs asserts the helper over a render naming";

/** Page tests the check accepts: [what the test does, its source]. */
const PROOFS: ReadonlyArray<readonly [string, string]> = [
  // ── rule 1: the two ways to assert the page check ───────────────────────
  [
    "imports its page and runs the assertion",
    PAGE + inTest(`${RENDER}\nexpectPresentationSafe(view, {});`),
  ],
  [
    "imports its page by alias and asserts the finder is empty",
    'import Page from "@/app/(app)/admin/coord/devops/page";\n' +
      inTest(
        "expect(findPresentationViolations(renderInPresentationMode(<Page />))).toEqual([]);"
      ),
  ],
  [
    "asserts the finder's described violations are empty",
    PAGE +
      inTest(
        `${RENDER}\nexpect(\n  findPresentationViolations(view, { forbidden }).map(describeViolation)\n).toEqual([]);`
      ),
  ],
  [
    "mocks a service, not the page, and asserts the finder has none",
    'vi.mock("@/services/service-factory", () => ({}));\n' +
      PAGE +
      inAsyncTest(
        'const view = renderInPresentationMode(<Providers><DevOpsPage /></Providers>);\nawait screen.findByTestId("coord-devops");\nexpect(findPresentationViolations(view)).toHaveLength(0);'
      ),
  ],
  // ── rule 2: where the assertion runs ────────────────────────────────────
  [
    "asserts inside a describe, in an it.only",
    PAGE +
      `describe("dev ops", () => {\n  it.only("is safe", () => {\n    ${RENDER}\n    expectPresentationSafe(view);\n  });\n});`,
  ],
  [
    "asserts in an it.only beside another it.only",
    PAGE + `it.only("debugs", () => {});\nit.only("is safe", ${CHECKED});`,
  ],
  [
    "asserts in a test whose options set only, beside an it.only",
    PAGE +
      `it.only("debugs", () => {});\nit("is safe", { only: true }, ${CHECKED});`,
  ],
  [
    "asserts beside a test whose options set only to false",
    PAGE +
      `it("debugs", { only: false }, () => {});\nit("is safe", ${CHECKED});`,
  ],
  [
    "asserts in every row of an it.each",
    PAGE +
      'it.each(["a", "b"])("is safe with %s", () => {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n});',
  ],
  [
    "asserts in every row of an it.each over a const table",
    PAGE +
      `const ROWS = ["a", "b"] as const;\nit.each(ROWS)("is safe with %s", ${CHECKED});`,
  ],
  [
    "asserts in an it.for, reading another field of its context",
    PAGE +
      `it.for(["a"])("is safe with %s", (row, ctx) => {\n  ctx.annotate(row);\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
  ],
  [
    "asserts in a test of a describe.each",
    PAGE +
      `describe.each([1])("dev ops %s", () => {\n  it("is safe", ${CHECKED});\n});`,
  ],
  [
    "asserts in a test registered after an await in an async describe",
    PAGE +
      `describe("dev ops", async () => {\n  await Promise.resolve();\n  it("is safe", ${CHECKED});\n});`,
  ],
  [
    "asserts in a test a registering helper adds, called by a suite",
    PAGE +
      `function definePageTests() {\n  it("is safe", ${CHECKED});\n}\ndescribe("dev ops", () => {\n  definePageTests();\n});`,
  ],
  [
    "asserts after a guard that throws, which can fail the test but not pass it",
    PAGE +
      inTest(
        `${RENDER}\nif (!view) throw new Error("no render");\nexpectPresentationSafe(view);`
      ),
  ],
  [
    "asserts after other assertions",
    PAGE +
      inTest(
        `${RENDER}\nexpect(screen.getByTestId("coord-devops")).toBeVisible();\nexpectPresentationSafe(view);`
      ),
  ],
  [
    "asserts in a nested block",
    PAGE + inTest(`{\n  ${RENDER}\n  expectPresentationSafe(view);\n}`),
  ],
  [
    "asserts in a try with only a finally",
    PAGE +
      inTest(
        `${RENDER}\ntry {\n  expectPresentationSafe(view);\n} finally {\n  view.unmount();\n}`
      ),
  ],
  [
    "asserts in a finally block, which runs every time its try does",
    PAGE +
      inTest(
        `${RENDER}\ntry {\n  if (!view) return;\n} finally {\n  expectPresentationSafe(view);\n}`
      ),
  ],
  [
    "asserts after a local function whose own return does not end the test",
    PAGE +
      inTest(
        `const first = (rows: string[]) => {\n  return rows[0];\n};\n${RENDER}\nexpect(first(["a"])).toBe("a");\nexpectPresentationSafe(view);`
      ),
  ],
  [
    "asserts in an it.each whose handler takes its row, not a context",
    PAGE +
      `it.each(["a"])("is safe with %s", (row) => {\n  expect(row).toBe("a");\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
  ],
  [
    "asserts through a function called on the spot",
    PAGE +
      inTest(`(() => {\n  ${RENDER}\n  expectPresentationSafe(view);\n})();`),
  ],
  [
    "keeps the helper's result",
    PAGE + inTest(`${RENDER}\nconst checked = expectPresentationSafe(view);`),
  ],
  [
    "asserts in a test whose options skip nothing",
    PAGE +
      `it("is safe", { timeout: 5000, retry: 0, skip: false }, ${CHECKED});`,
  ],
  [
    "asserts with its context's own expect",
    PAGE +
      `it("is safe", ({ expect, onTestFinished }) => {\n  ${RENDER}\n  expect(findPresentationViolations(view)).toEqual([]);\n});`,
  ],
  [
    "asserts in a test whose context it reads only for other fields",
    PAGE +
      `it("is safe", (ctx) => {\n  ctx.onTestFinished(() => {});\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
  ],
  [
    "asserts beside hooks that cannot skip it",
    PAGE +
      "beforeEach(() => {\n  vi.clearAllMocks();\n});\naroundEach(async (runTest) => {\n  await runTest();\n});\n// After the body: it cannot un-run the assertion.\nafterEach((ctx) => {\n  ctx.skip();\n});\n" +
      inTest(`${RENDER}\nexpectPresentationSafe(view);`),
  ],
  [
    "asserts in a function test",
    PAGE +
      `it("is safe", function () {\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
  ],
  [
    "asserts in a function test whose nested function reads its own arguments",
    PAGE +
      `it("is safe", function () {\n  const count = function (...rows: string[]) {\n    return arguments.length + rows.length;\n  };\n  expect(count("a")).toBe(2);\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
  ],
  [
    "asserts inside an awaited waitFor",
    PAGE +
      inAsyncTest(
        `${RENDER}\nawait waitFor(() => expectPresentationSafe(view));`
      ),
  ],
  [
    "asserts inside a waitFor the test returns",
    PAGE +
      inTest(`${RENDER}\nreturn waitFor(() => expectPresentationSafe(view));`),
  ],
  [
    "asserts inside a waitFor that is the test's whole body",
    PAGE +
      'it("is safe", () =>\n  waitFor(() => expectPresentationSafe(renderInPresentationMode(<DevOpsPage />)))\n);',
  ],
  [
    "asserts inside an awaited vi.waitFor",
    PAGE +
      inAsyncTest(
        `${RENDER}\nawait vi.waitFor(() => expectPresentationSafe(view));`
      ),
  ],
  [
    "asserts inside an awaited act",
    PAGE +
      inAsyncTest(
        `${RENDER}\nawait act(async () => {\n  expectPresentationSafe(view);\n});`
      ),
  ],
  // ── rule 2: helpers ─────────────────────────────────────────────────────
  [
    "renders in a beforeEach and asserts in the test",
    PAGE +
      "let view: PresentationView;\nbeforeEach(() => {\n  view = renderInPresentationMode(<DevOpsPage />);\n});\n" +
      'it("is safe", () => {\n  expectPresentationSafe(view);\n});',
  ],
  [
    "renders through a helper of its own",
    PAGE +
      "function renderPage() {\n  return renderInPresentationMode(<DevOpsPage />);\n}\n" +
      inTest("const view = renderPage();\nexpectPresentationSafe(view);"),
  ],
  [
    "renders through a helper every return of which is the page",
    PAGE +
      "function renderPage() {\n  const rendered = renderInPresentationMode(<Providers><DevOpsPage /></Providers>);\n  return rendered;\n}\n" +
      inTest("expectPresentationSafe(renderPage());"),
  ],
  [
    "asserts in a helper a running test calls",
    PAGE +
      "const proveSafe = () => {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n};\n" +
      'it("is safe", () => proveSafe());',
  ],
  [
    "hands its assertion to the test by name",
    PAGE +
      "function proveSafe() {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n}\n" +
      'it("is safe", proveSafe);',
  ],
  [
    "asserts in an async helper the test awaits",
    PAGE +
      "async function proveSafe() {\n  const view = renderInPresentationMode(<DevOpsPage />);\n  await waitFor(() => expectPresentationSafe(view));\n}\n" +
      inAsyncTest("await proveSafe();"),
  ],
  [
    "asserts in a helper that returns its waitFor, awaited by the test",
    PAGE +
      "const check = () =>\n  waitFor(() =>\n    expect(findPresentationViolations(renderInPresentationMode(<DevOpsPage />))).toEqual([])\n  );\n" +
      inAsyncTest("await check();"),
  ],
  // ── rule 3: how the page is reached ─────────────────────────────────────
  [
    "loads its page with import()",
    'it("is safe", async () => {\n  const { default: Page } = await import("./page");\n  expectPresentationSafe(renderInPresentationMode(<Page />));\n});',
  ],
  [
    "imports its page as a namespace",
    'import * as devops from "./page";\n' +
      inTest(
        "expectPresentationSafe(renderInPresentationMode(<devops.default />));"
      ),
  ],
];

/** Page tests the check refuses: [what the test does, its source, the reason it gives]. */
const REFUSALS: ReadonlyArray<readonly [string, string, string]> = [
  // ── rule 1: the helper is not asserted ──────────────────────────────────
  [
    "a test that never runs the helper",
    PAGE + inTest(`${RENDER}\nexpect(view).toBeTruthy();`),
    NEVER_CALLS,
  ],
  [
    "a helper call that is only a comment",
    PAGE + inTest(`${RENDER}\n// expectPresentationSafe(view);`),
    NEVER_CALLS,
  ],
  [
    "a finder whose answer is discarded",
    PAGE + inTest(`${RENDER}\nfindPresentationViolations(view);`),
    NEVER_CALLS,
  ],
  [
    "a finder whose answer is kept but never asserted empty",
    PAGE +
      inTest(
        `${RENDER}\nconst found = findPresentationViolations(view);\nexpect(found).toBeDefined();`
      ),
    NEVER_CALLS,
  ],
  [
    "a finder asserted NOT empty",
    PAGE +
      inTest(
        `${RENDER}\nexpect(findPresentationViolations(view)).not.toEqual([]);`
      ),
    NEVER_CALLS,
  ],
  [
    "a finder asserted equal to a list that may not be empty",
    PAGE +
      inTest(
        `${RENDER}\nexpect(findPresentationViolations(view)).toEqual(expected);`
      ),
    NEVER_CALLS,
  ],
  [
    "a helper call that is only a string",
    PAGE + inTest(`${RENDER}\nconst s = "expectPresentationSafe(view)";`),
    NEVER_CALLS,
  ],
  [
    "a mocked page check",
    'vi.mock("@/test/presentation");\n' +
      PAGE +
      inTest(`${RENDER}\nexpectPresentationSafe(view);`),
    "mocks the page check (src/test/presentation), so what asserts is a stand-in",
  ],
  [
    "a page check mocked by a relative path",
    'vi.mock("../../../../../test/presentation", () => ({ expectPresentationSafe: () => {} }));\n' +
      PAGE +
      inTest(`${RENDER}\nexpectPresentationSafe(view);`),
    "mocks the page check (src/test/presentation)",
  ],
  // ── rule 2: a condition inside the test ─────────────────────────────────
  [
    "its only assertion under an if",
    PAGE + inTest(`${RENDER}\nif (composed) expectPresentationSafe(view);`),
    "line 4: the assertion is under an `if` (line 4), so it runs only on a condition",
  ],
  [
    "its only assertion under an if that never holds",
    PAGE +
      inTest(`${RENDER}\nif (false) {\n  expectPresentationSafe(view);\n}`),
    "the assertion is under an `if`",
  ],
  [
    "its only assertion on the right of &&",
    PAGE + inTest(`${RENDER}\ncomposed && expectPresentationSafe(view);`),
    "the assertion is on the right of `&&`",
  ],
  [
    "its only assertion on the right of ||",
    PAGE + inTest(`${RENDER}\nskipped || expectPresentationSafe(view);`),
    "the assertion is on the right of `||`",
  ],
  [
    "its only assertion on the right of ??",
    PAGE + inTest(`${RENDER}\nskipped ?? expectPresentationSafe(view);`),
    "the assertion is on the right of `??`",
  ],
  [
    "its only assertion on the right of &&=",
    PAGE +
      inTest(
        `${RENDER}\nlet ok = composed;\nok &&= expectPresentationSafe(view);`
      ),
    "the assertion is on the right of `&&=`",
  ],
  [
    "its only assertion one branch of a ?:",
    PAGE +
      inTest(`${RENDER}\ncomposed ? expectPresentationSafe(view) : undefined;`),
    "the assertion is one branch of a `?:`",
  ],
  [
    "its only assertion in a loop",
    PAGE +
      inTest(
        `${RENDER}\nfor (const row of rows) expectPresentationSafe(view);`
      ),
    "the assertion is in a loop",
  ],
  [
    "its only assertion in a while loop",
    PAGE +
      inTest(
        `${RENDER}\nwhile (pending) {\n  expectPresentationSafe(view);\n  pending = false;\n}`
      ),
    "the assertion is in a loop",
  ],
  [
    "its only assertion in one case of a switch",
    PAGE +
      inTest(
        `${RENDER}\nswitch (mode) {\n  case "x":\n    expectPresentationSafe(view);\n}`
      ),
    "the assertion is in a `switch`",
  ],
  [
    "its only assertion after an early return",
    PAGE +
      'const composed = existsSync("node_modules/@qontinui/cloud-control/package.json");\n' +
      inTest(
        `if (!composed) return;\n${RENDER}\nexpectPresentationSafe(view);`
      ),
    "the assertion comes after a `return` (line 4) that can end its function before it runs",
  ],
  [
    "its only assertion after a return nested in a block",
    PAGE +
      inTest(
        `${RENDER}\n{\n  if (!composed) {\n    return;\n  }\n}\nexpectPresentationSafe(view);`
      ),
    "the assertion comes after a `return`",
  ],
  [
    "its only assertion in a try whose catch swallows it",
    PAGE +
      inTest(
        `${RENDER}\ntry {\n  expectPresentationSafe(view);\n} catch {\n  // tolerated\n}`
      ),
    "the assertion is in a `try` with a `catch`",
  ],
  [
    "its only assertion in a catch block",
    PAGE +
      inTest(
        `${RENDER}\ntry {\n  view.rerender();\n} catch {\n  expectPresentationSafe(view);\n}`
      ),
    "the assertion is in a `catch` block (line 6), which runs only when its `try` throws",
  ],
  [
    "its only assertion in a try whose finally can return",
    PAGE +
      inTest(
        `${RENDER}\ntry {\n  expectPresentationSafe(view);\n} finally {\n  return;\n}`
      ),
    "the assertion is in a `try` whose `finally` block can end abruptly",
  ],
  [
    "its only assertion in a labeled block a break can leave",
    PAGE +
      inTest(
        `${RENDER}\nout: {\n  if (!composed) break out;\n  expectPresentationSafe(view);\n}`
      ),
    "the assertion is in a labeled statement",
  ],
  [
    "its only assertion an optional call",
    PAGE + inTest(`${RENDER}\nexpectPresentationSafe?.(view);`),
    "the assertion is an optional call",
  ],
  [
    "its only assertion the finder under an optional matcher",
    PAGE +
      inTest(
        `${RENDER}\nexpect(findPresentationViolations(view))?.toEqual([]);`
      ),
    "the assertion is an optional call",
  ],
  [
    "its only assertion an argument of an optional call",
    PAGE + inTest(`${RENDER}\nmaybe?.(expectPresentationSafe(view));`),
    "the assertion is an argument of an optional call",
  ],
  [
    "its only assertion the key of an optional element access",
    PAGE + inTest(`${RENDER}\ntable?.[String(expectPresentationSafe(view))];`),
    "the assertion is the key of an optional element access",
  ],
  [
    "its only assertion a destructuring default",
    PAGE +
      inTest(`${RENDER}\nconst [done = expectPresentationSafe(view)] = [1];`),
    "the assertion is a destructuring default",
  ],
  [
    "its only assertion a default in a destructuring assignment",
    PAGE +
      inTest(
        `${RENDER}\nlet done;\n[done = expectPresentationSafe(view)] = [1];`
      ),
    "the assertion is in a destructuring target",
  ],
  [
    "its only assertion a parameter's default value",
    PAGE +
      'it("is safe", (ctx, checked = expectPresentationSafe(renderInPresentationMode(<DevOpsPage />))) => {});',
    "the assertion is in a parameter's default value",
  ],
  [
    "its only assertion in an object's method",
    PAGE +
      "const helpers = {\n  check() {\n    expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n  },\n};\n" +
      inTest("helpers.check();"),
    "the assertion is inside a method declaration",
  ],
  // ── rule 2: what the function holding it is handed to ───────────────────
  [
    "its only assertion inverted by expect(…).toThrow()",
    PAGE +
      inTest(
        `${RENDER}\nexpect(() => expectPresentationSafe(view)).toThrow();`
      ),
    "is handed to `expect` (line 4), which asserts on what it throws instead of failing the test",
  ],
  [
    "its only finder assertion inverted by expect(…).toThrow()",
    PAGE +
      inTest(
        `${RENDER}\nexpect(() => expect(findPresentationViolations(view)).toEqual([])).toThrow();`
      ),
    "is handed to `expect`",
  ],
  [
    "its only assertion handed to expect(…).not.toThrow()",
    PAGE +
      inTest(
        `${RENDER}\nexpect(() => expectPresentationSafe(view)).not.toThrow();`
      ),
    "is handed to `expect`",
  ],
  [
    "its only assertion in a .then whose rejection expect(…).rejects asserts",
    PAGE +
      inAsyncTest(
        `${RENDER}\nawait expect(Promise.resolve().then(() => expectPresentationSafe(view))).rejects.toThrow();`
      ),
    "is a promise callback (`.then`)",
  ],
  [
    "its only assertion in an awaited .then",
    PAGE +
      inAsyncTest(
        `${RENDER}\nawait Promise.resolve().then(() => expectPresentationSafe(view));`
      ),
    "is a promise callback (`.then`)",
  ],
  [
    "its only assertion in a .then nobody awaits",
    PAGE +
      inTest(
        `${RENDER}\nPromise.resolve().then(() => expectPresentationSafe(view));`
      ),
    "is a promise callback (`.then`)",
  ],
  [
    "its only assertion in a timer",
    PAGE +
      inTest(`${RENDER}\nsetTimeout(() => expectPresentationSafe(view), 0);`),
    "is a timer callback (`setTimeout`)",
  ],
  [
    "its only assertion in a forEach over an empty list",
    PAGE + inTest(`${RENDER}\n[].forEach(() => expectPresentationSafe(view));`),
    "is an iteration callback (`.forEach`)",
  ],
  [
    "its only assertion handed to a function this check does not know",
    PAGE + inTest(`${RENDER}\nwithRetry(() => expectPresentationSafe(view));`),
    "is handed to `withRetry` (line 4), which this check does not read as running it",
  ],
  [
    "its only assertion in a waitFor nobody awaits",
    PAGE + inTest(`${RENDER}\nwaitFor(() => expectPresentationSafe(view));`),
    "the `waitFor` running it (line 4) is neither awaited nor returned",
  ],
  [
    "its only assertion in a waitFor of a mocked Testing Library",
    'vi.mock("@testing-library/react", () => ({ waitFor: async () => {} }));\n' +
      PAGE +
      inAsyncTest(
        `${RENDER}\nawait waitFor(() => expectPresentationSafe(view));`
      ),
    "is handed to `waitFor` (line 5), which this file may have replaced: it mocks Testing Library",
  ],
  [
    "its only assertion handed to waitFor as its second argument",
    PAGE +
      inAsyncTest(
        `${RENDER}\nawait waitFor(noop, () => expectPresentationSafe(view));`
      ),
    "is handed to `waitFor` (line 4), which this check does not read as running it",
  ],
  [
    "its only assertion in a waitFor returned at module level",
    PAGE +
      "return waitFor(() => expectPresentationSafe(renderInPresentationMode(<DevOpsPage />)));",
    "the `waitFor` running it (line 2) is returned at module level, in no test",
  ],
  [
    "its only assertion in an act nobody awaits",
    PAGE + inTest(`${RENDER}\nact(() => expectPresentationSafe(view));`),
    "the `act` running it (line 4) is neither awaited nor returned",
  ],
  [
    "its only assertion in a callback stored but never called",
    PAGE +
      "const checks = [() => expectPresentationSafe(renderInPresentationMode(<DevOpsPage />))];\n" +
      inTest("expect(checks).toHaveLength(1);"),
    "is not called anywhere this check can follow",
  ],
  [
    "its only assertion in an async helper the test does not await",
    PAGE +
      "async function proveSafe() {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n}\n" +
      inTest("proveSafe();"),
    "the call to `proveSafe` (line 6) is neither awaited nor returned",
  ],
  [
    "its only assertion in an async function called on the spot and not awaited",
    PAGE +
      inTest(
        `(async () => {\n  ${RENDER}\n  expectPresentationSafe(view);\n})();`
      ),
    "the call of the callback (line 3) is neither awaited nor returned",
  ],
  [
    "its only assertion in a helper with an early return",
    PAGE +
      "function proveSafe() {\n  if (!composed) return;\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n}\n" +
      inTest("proveSafe();"),
    "the assertion comes after a `return` (line 3)",
  ],
  [
    "its only assertion in a helper the test calls on a condition",
    PAGE +
      "function proveSafe() {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n}\n" +
      inTest("if (composed) proveSafe();"),
    "the call to `proveSafe` (line 6) is under an `if`",
  ],
  [
    "its only assertion in a generator the test is",
    PAGE +
      `it("is safe", function* () {\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "is a generator, which runs only as far as something iterates it",
  ],
  [
    "its only assertion in a function nobody calls, beside an it.todo",
    PAGE +
      "function proveSafe() {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n}\n" +
      'it.todo("is safe");',
    "`proveSafe` is a function nobody calls",
  ],
  [
    "its only assertion at module level, in no test",
    PAGE + "expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));",
    "the assertion runs at module level, in no test",
  ],
  [
    "its only assertion in a hook",
    PAGE +
      "beforeEach(() => {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n});\n" +
      'it("renders", () => {});',
    "runs in a `beforeEach` hook (line 2), in no test",
  ],
  [
    "its only assertion in a suite's body",
    PAGE +
      'describe("dev ops", () => {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n});',
    "runs while the suite (line 2) is collected, in no test",
  ],
  // ── rule 2: the test does not run ───────────────────────────────────────
  [
    "its only assertion in an it.skip",
    PAGE + `it.skip("is safe", ${CHECKED});`,
    "the test (line 2) is `it.skip`, which never runs",
  ],
  [
    "its only assertion in an it.todo handed a function",
    PAGE + `it.todo("is safe", ${CHECKED});`,
    "is `it.todo`, which never runs",
  ],
  [
    "its only assertion under a describe.skip",
    PAGE +
      `describe.skip("dev ops", () => {\n  it("is safe", ${CHECKED});\n});`,
    "the suite (line 2) is `describe.skip`, which never runs",
  ],
  [
    "its only assertion in a test skipped on a condition",
    PAGE + `it.skipIf(!composed)("is safe", ${CHECKED});`,
    "is `it.skipIf`, which runs only on a condition",
  ],
  [
    "its only assertion in a test run on a condition",
    PAGE + `it.runIf(composed)("is safe", ${CHECKED});`,
    "is `it.runIf`, which runs only on a condition",
  ],
  [
    "its only assertion in an xit",
    PAGE + `xit("is safe", ${CHECKED});`,
    "is `xit`, which never runs",
  ],
  [
    "its only assertion under an xdescribe",
    PAGE + `xdescribe("dev ops", () => {\n  it("is safe", ${CHECKED});\n});`,
    "the suite (line 2) is `xdescribe`, which never runs",
  ],
  [
    "its only assertion under a describe skipped on a condition",
    PAGE +
      `describe.skipIf(ci)("dev ops", () => {\n  it("is safe", ${CHECKED});\n});`,
    "the suite (line 2) is `describe.skipIf`",
  ],
  [
    "its only assertion in a test expected to fail",
    PAGE + `it.fails("is safe", ${CHECKED});`,
    "is `it.fails`, which passes only when it fails",
  ],
  [
    "its only assertion in a test made by a modifier this check does not know",
    PAGE + `it.extend({})("is safe", ${CHECKED});`,
    "is `it.extend`, which this check does not read as running",
  ],
  [
    "its only assertion in a test whose options skip it on a condition",
    PAGE + `it("is safe", { skip: !composed }, ${CHECKED});`,
    "is handed options that set `skip` (line 2), so it never runs",
  ],
  [
    "its only assertion in a test whose options make it todo",
    PAGE + `it("is safe", { todo: true }, ${CHECKED});`,
    "is handed options that set `todo`",
  ],
  [
    "its only assertion in a test whose options expect it to fail",
    PAGE + `it("is safe", { fails: true }, ${CHECKED});`,
    "is handed options that set `fails` (line 2), so it passes only when it fails",
  ],
  [
    "its only assertion in a test handed options it cannot read",
    PAGE + `it("is safe", OPTIONS, ${CHECKED});`,
    "is handed options (line 2) that are not an object literal",
  ],
  [
    "its only assertion in a test whose options spread an object",
    PAGE + `it("is safe", { ...OPTIONS }, ${CHECKED});`,
    "is handed options that spread an object",
  ],
  [
    "its only assertion in a test whose options have a computed key",
    PAGE + `it("is safe", { [MODE]: true }, ${CHECKED});`,
    "is handed options with a computed key",
  ],
  [
    "its only assertion under a suite whose options expect its tests to fail",
    PAGE +
      `describe("dev ops", { fails: true }, () => {\n  it("is safe", ${CHECKED});\n});`,
    "the suite (line 2) is handed options that set `fails`",
  ],
  [
    "its only assertion in a test beside an it.only",
    PAGE + `it.only("debugs", () => {});\nit("is safe", ${CHECKED});`,
    "a `.only` (line 2) elsewhere in the file skips the test (line 3), which is not marked `.only` itself",
  ],
  [
    "its only assertion in an unmarked test under a describe.only",
    PAGE +
      `describe.only("dev ops", () => {\n  it("is safe", ${CHECKED});\n});`,
    "a `.only` (line 2) elsewhere in the file skips the test (line 3)",
  ],
  [
    "its only assertion beside a test whose options may set only",
    PAGE + `it("debugs", OPTIONS, () => {});\nit("is safe", ${CHECKED});`,
    "a `.only` (line 2) elsewhere in the file skips the test (line 3)",
  ],
  [
    "its only assertion in an it.each over an empty table",
    PAGE + `it.each([])("is safe with %s", ${CHECKED});`,
    "the test (line 2) is `it.each` over a table this check cannot see has a row",
  ],
  [
    "its only assertion in an it.each over a spread table",
    PAGE + `it.each([...ROWS])("is safe with %s", ${CHECKED});`,
    "is `it.each` over a table this check cannot see has a row",
  ],
  [
    "its only assertion in an it.each over a table that may be reassigned",
    PAGE + `let ROWS = ["a"];\nit.each(ROWS)("is safe with %s", ${CHECKED});`,
    "is `it.each` over a table this check cannot see has a row",
  ],
  [
    "its only assertion in an it.each over a template table",
    PAGE + 'it.each`a\n${1}`("is safe", ' + CHECKED + ");",
    "is `it.each` over a table this check cannot see has a row",
  ],
  [
    "its only assertion in a describe.each over an empty table",
    PAGE +
      `describe.each([])("dev ops %s", () => {\n  it("is safe", ${CHECKED});\n});`,
    "the suite (line 2) is `describe.each` over a table",
  ],
  [
    "its only assertion in a function handed as a test's name",
    PAGE + `it(${CHECKED});`,
    "is not the one it runs",
  ],
  [
    "its only assertion after its context skips it on a condition",
    PAGE +
      `it("is safe", (ctx) => {\n  if (!composed) ctx.skip();\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "the test (line 2) can skip itself at run time: it reads `ctx.skip` (line 3)",
  ],
  [
    "its only assertion in a test that takes skip from its context",
    PAGE +
      `it("is safe", ({ skip }) => {\n  skip(!composed);\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "can skip itself at run time: it takes `skip` from its context",
  ],
  [
    "its only assertion in a test that reads its context's task",
    PAGE +
      `it("is safe", (ctx) => {\n  ctx.task.context.skip();\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "it reads `ctx.task` (line 3), which this check does not know cannot reach `skip`",
  ],
  [
    "its only assertion in a test that takes task from its context",
    PAGE +
      `it("is safe", ({ task }) => {\n  task.context.skip();\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "it takes `task` from its context (line 2), which this check does not know cannot reach `skip`",
  ],
  [
    "its only assertion in an it.for whose rest parameter gathers row and context",
    PAGE +
      `it.for(["a"])("is safe with %s", (...all) => {\n  all.at(1).skip();\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "it reads `all.at` (line 3), which this check does not know cannot reach `skip`",
  ],
  [
    "its only assertion in a function test that reads its arguments",
    PAGE +
      `it("is safe", function () {\n  arguments[0].skip();\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "it reads `arguments` (line 3), which holds its context",
  ],
  [
    "its only assertion in a test that hands its context on",
    PAGE +
      `it("is safe", (ctx) => {\n  skipUnlessComposed(ctx);\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "its context `ctx` is handed on or aliased (line 3)",
  ],
  [
    "its only assertion in a test that gathers its context in a rest parameter",
    PAGE +
      `it("is safe", (...args) => {\n  args.at(0).skip();\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "it reads `args.at` (line 3), which this check does not know cannot reach `skip`",
  ],
  [
    "its only assertion in a test that gathers its context's remaining fields",
    PAGE +
      `it("is safe", ({ ...expect }) => {\n  expect.skip();\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "it gathers its context's remaining fields",
  ],
  [
    "its only assertion in a test that reads a computed field of its context",
    PAGE +
      `it("is safe", ({ [FIELD]: field }) => {\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "it reads a computed field of its context",
  ],
  [
    "its only assertion in a test that destructures its context as an array",
    PAGE +
      `it("is safe", ([first]) => {\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "its context is destructured as an array",
  ],
  [
    "its only assertion in an it.for whose context is its second parameter",
    PAGE +
      `it.for(["a"])("is safe with %s", (row, { skip }) => {\n  skip(!composed);\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
    "it takes `skip` from its context (line 2)",
  ],
  [
    "a beforeEach that can skip every test",
    PAGE +
      "beforeEach((ctx) => {\n  if (!composed) ctx.skip();\n});\n" +
      inTest(`${RENDER}\nexpectPresentationSafe(view);`),
    "the `beforeEach` hook (line 2) can skip every test in the file at run time: it reads `ctx.skip` (line 3)",
  ],
  [
    "an aroundEach that can skip every test",
    PAGE +
      "aroundEach(async (runTest, { skip }) => {\n  skip(!composed);\n  await runTest();\n});\n" +
      inTest(`${RENDER}\nexpectPresentationSafe(view);`),
    "the `aroundEach` hook (line 2) can skip every test in the file at run time: it takes `skip` from its context",
  ],
  [
    "a beforeEach handed a function this check cannot read",
    PAGE +
      'import { skipUnlessComposed } from "@/test/skips";\nbeforeEach(skipUnlessComposed);\n' +
      inTest(`${RENDER}\nexpectPresentationSafe(view);`),
    "the `beforeEach` hook (line 3) is handed a function this check cannot read",
  ],
  // ── rule 2: the test is not registered every time ───────────────────────
  [
    "its only assertion in a test registered under an if",
    PAGE + `if (composed) {\n  it("is safe", ${CHECKED});\n}`,
    "the test (line 3) is under an `if` (line 2), so it runs only on a condition",
  ],
  [
    "its only assertion in a test registered in a loop",
    PAGE + `for (const row of ROWS) {\n  it("is safe", ${CHECKED});\n}`,
    "the test (line 3) is in a loop (line 2)",
  ],
  [
    "its only assertion in a test registered from a forEach",
    PAGE + `ROWS.forEach(() => {\n  it("is safe", ${CHECKED});\n});`,
    "registers tests in a callback handed to `ROWS.forEach` (line 2)",
  ],
  [
    "its only assertion in a test after an early return in its suite",
    PAGE +
      `describe("dev ops", () => {\n  if (!composed) return;\n  it("is safe", ${CHECKED});\n});`,
    "the test (line 4) comes after a `return` (line 3)",
  ],
  [
    "its only assertion in a test inside a test",
    PAGE + `it("outer", () => {\n  it("is safe", ${CHECKED});\n});`,
    "registers tests inside a test (line 2), which vitest does not collect",
  ],
  [
    "its only assertion in a test a hook registers",
    PAGE + `beforeAll(() => {\n  it("is safe", ${CHECKED});\n});`,
    "registers tests in a `beforeAll` hook (line 2), which runs after collection",
  ],
  [
    "its only assertion in a test an async helper registers",
    PAGE +
      `async function definePageTests() {\n  it("is safe", ${CHECKED});\n}\ndefinePageTests();`,
    "`definePageTests` registers tests from an async function",
  ],
  [
    "its only assertion in a test an async function called on the spot registers",
    PAGE + `(async () => {\n  it("is safe", ${CHECKED});\n})();`,
    "registers tests from an async function",
  ],
  [
    "its only assertion in a test a helper registers, called on a condition",
    PAGE +
      `function definePageTests() {\n  it("is safe", ${CHECKED});\n}\nif (composed) definePageTests();`,
    "the call to `definePageTests` (line 8) is under an `if`",
  ],
  [
    "its only assertion in a test registered by a callback stored but never called",
    PAGE +
      `const registrars = [\n  () => {\n    it("is safe", ${CHECKED});\n  },\n];`,
    "registers tests but is not called anywhere this check can follow",
  ],
  [
    "its only assertion in a test a helper nobody calls registers",
    PAGE + `function definePageTests() {\n  it("is safe", ${CHECKED});\n}`,
    "`definePageTests` registers tests but nobody calls it",
  ],
  // ── rule 3: the assertion runs over something else ──────────────────────
  [
    "a test that runs the helper over one panel of the page",
    PANEL_IMPORT + inTest(`${PANEL}\nexpectPresentationSafe(view, {});`),
    NOT_THE_PAGE,
  ],
  [
    "a test that imports the page but asserts over one panel of it",
    PAGE + PANEL_IMPORT + inTest(`${PANEL}\nexpectPresentationSafe(view);`),
    OVER_SOMETHING_ELSE,
  ],
  [
    "a test that renders the page but asserts over a panel's render",
    PAGE +
      PANEL_IMPORT +
      inTest(
        "const page = renderInPresentationMode(<DevOpsPage />);\nconst panel = renderInPresentationMode(<HealthPanel />);\nexpectPresentationSafe(panel);"
      ),
    OVER_SOMETHING_ELSE,
  ],
  [
    "a test that re-assigns the page's view to a panel before asserting",
    PAGE +
      PANEL_IMPORT +
      "let view: PresentationView;\nbeforeEach(() => {\n  view = renderInPresentationMode(<DevOpsPage />);\n});\n" +
      'it("is safe", () => {\n  view = renderInPresentationMode(<HealthPanel />);\n  expectPresentationSafe(view);\n});',
    OVER_SOMETHING_ELSE,
  ],
  [
    "a test that renders the page in only one branch of a ?:",
    PAGE +
      inTest(
        "const view = renderInPresentationMode(composed ? <DevOpsPage /> : <p />);\nexpectPresentationSafe(view);"
      ),
    `${OVER_SOMETHING_ELSE} ${DEVOPS_PAGE}'s export where the render always evaluates it`,
  ],
  [
    "a test whose view is the page's render in only one branch of a ?:",
    PAGE +
      inTest(
        "const view = composed\n  ? renderInPresentationMode(<DevOpsPage />)\n  : renderInPresentationMode(<p />);\nexpectPresentationSafe(view);"
      ),
    OVER_SOMETHING_ELSE,
  ],
  [
    "a test that renders the page only when the left of && lets it",
    PAGE +
      inTest(
        "const view = renderInPresentationMode(<Providers>{composed && <DevOpsPage />}</Providers>);\nexpectPresentationSafe(view);"
      ),
    OVER_SOMETHING_ELSE,
  ],
  [
    "a test that renders the page only from a render prop",
    PAGE +
      inTest(
        "const view = renderInPresentationMode(<Gate render={() => <DevOpsPage />} />);\nexpectPresentationSafe(view);"
      ),
    OVER_SOMETHING_ELSE,
  ],
  [
    "a test that renders the page once per row of a list",
    PAGE +
      inTest(
        "const view = renderInPresentationMode(<div>{rows.map((row) => <DevOpsPage key={row} />)}</div>);\nexpectPresentationSafe(view);"
      ),
    OVER_SOMETHING_ELSE,
  ],
  [
    "a render helper that renders the page but returns another render",
    PAGE +
      "function renderPage() {\n  renderInPresentationMode(<DevOpsPage />);\n  return renderInPresentationMode(<p />);\n}\n" +
      inTest("expectPresentationSafe(renderPage());"),
    OVER_SOMETHING_ELSE,
  ],
  [
    "a render helper that returns another render on a condition",
    PAGE +
      "function renderPage() {\n  if (!composed) return renderInPresentationMode(<p />);\n  return renderInPresentationMode(<DevOpsPage />);\n}\n" +
      inTest("expectPresentationSafe(renderPage());"),
    OVER_SOMETHING_ELSE,
  ],
  [
    "a test that renders another route's page",
    'import Page from "../spawns/page";\n' +
      inTest("expectPresentationSafe(renderInPresentationMode(<Page />), {});"),
    NOT_THE_PAGE,
  ],
  // ── rule 4: the page is not imported, or is mocked ──────────────────────
  [
    "a test that only mocks the page",
    'vi.mock("./page");\n' + inTest("expectPresentationSafe(view, {});"),
    NOT_THE_PAGE,
  ],
  [
    "a test that imports the page and mocks it with a stand-in",
    'vi.mock("./page", () => ({ default: () => null }));\nimport Page from "./page";\n' +
      inTest("expectPresentationSafe(renderInPresentationMode(<Page />), {});"),
    `it mocks ${DEVOPS_PAGE}`,
  ],
  [
    "a test that mocks the page by import() under another spelling",
    'import Page from "@/app/(app)/admin/coord/devops/page";\nvi.mock(import("./page"), () => ({ default: () => null }));\n' +
      inTest("expectPresentationSafe(renderInPresentationMode(<Page />), {});"),
    `it mocks ${DEVOPS_PAGE}`,
  ],
];

const proofFile = (i: number) => `${DIR}proof-${i}.test.tsx`;
const refusalFile = (i: number) => `${DIR}refusal-${i}.test.tsx`;
const SOURCES: ReadonlyMap<string, string> = new Map([
  ...PROOFS.map(([, source], i) => [proofFile(i), source] as const),
  ...REFUSALS.map(([, source], i) => [refusalFile(i), source] as const),
]);
// The generic helper suite runs the helper, but over no page at all.
const HELPER_SUITE = "test/presentation.test.tsx";
const read = (f: string) =>
  f === HELPER_SUITE
    ? inTest("expectPresentationSafe(renderInPresentationMode(<p>x</p>), {});")
    : (SOURCES.get(f) ?? null);
const pageOf = (route: string) =>
  route === "/admin/coord/devops" ? DEVOPS_PAGE : null;
const devops = (provenBy: string): PresentationReadyRoute => ({
  route: "/admin/coord/devops",
  provenBy,
});

describe("readyRouteProblems — the proof check", () => {
  it.each(PROOFS.map(([what], i) => [what, proofFile(i)] as const))(
    "passes a lens route whose test %s",
    (_what, file) => {
      expect(readyRouteProblems(devops(file), read, pageOf)).toEqual([]);
    }
  );

  it.each(
    REFUSALS.map(
      ([what, , problem], i) => [what, refusalFile(i), problem] as const
    )
  )("fails %s", (_what, file, problem) => {
    expect(readyRouteProblems(devops(file), read, pageOf).join("\n")).toContain(
      problem
    );
  });

  it.each<[string, PresentationReadyRoute, string]>([
    ["a missing test", devops(`${DIR}none.test.tsx`), "does not exist"],
    [
      "the helper's own suite, which renders no page",
      devops(HELPER_SUITE),
      NOT_THE_PAGE,
    ],
    [
      "a route outside every lens tree",
      { route: "/settings", provenBy: proofFile(0) },
      "not under a lens tree",
    ],
    [
      "a route no page serves",
      { route: "/admin/coord/nowhere", provenBy: proofFile(0) },
      "no page module serves this route",
    ],
    [
      "a proof that is not a test",
      devops(`${DIR}page.tsx`),
      "is not a test file",
    ],
  ])("fails %s", (_what, entry, problem) => {
    expect(readyRouteProblems(entry, read, pageOf).join("\n")).toContain(
      problem
    );
  });

  it("names every assertion it refuses, with its line, in one problem", () => {
    const twice =
      PAGE +
      inTest(
        `${RENDER}\nif (composed) expectPresentationSafe(view);\nsetTimeout(() => expectPresentationSafe(view), 0);`
      );
    const file = `${DIR}twice.test.tsx`;
    const problems = readyRouteProblems(
      devops(file),
      (f) => (f === file ? twice : null),
      pageOf
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(NEVER_RUNS);
    expect(problems[0]).toContain("line 4: the assertion is under an `if`");
    expect(problems[0]).toContain("line 5: the callback (line 5) is a timer");
  });

  it("is not vacuous: every refusal gives a reason, and every proof none", () => {
    expect(PROOFS.length).toBeGreaterThan(30);
    expect(REFUSALS.length).toBeGreaterThan(90);
    for (const [, , problem] of REFUSALS) expect(problem).not.toBe("");
  });
});
