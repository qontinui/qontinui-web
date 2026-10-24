/**
 * Where the presentation lens applies, and which pages may render in it (plan
 * `2026-10-23-console-presentation-spaces` D3 — fails closed by construction).
 *
 * Two self-enforcing checks read the source tree, because each catches an
 * ABSENCE the module graph cannot see:
 *
 * - `LENS_TREES` must be exactly the routes whose layouts mount
 *   `PresentationLens`. A lens layout missing from it leaves the app shell
 *   around that tree in operator mode (`PresentationShell` keys on it); an
 *   entry with no lens layout puts the shell in a mode no page shares.
 * - every `PRESENTATION_READY_ROUTES` entry must name a page test that
 *   ASSERTS the helper — `expectPresentationSafe(…)`, or
 *   `expect(findPresentationViolations(…)).toEqual([])`; a finder whose
 *   answer is discarded asserts nothing — AND imports that route's own page
 *   module without mocking it. A test that renders some other page, one panel
 *   of it, or a stand-in `vi.mock` put in the page's place proves nothing
 *   about the page the entry un-withholds. The file is read as TypeScript, so
 *   a call in a comment or a string is no call. Phase 1 registers only the
 *   console's landing redirect; the check is proven able to fail on fixtures
 *   below.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  LENS_TREES,
  PRESENTATION_READY_ROUTES,
  isLensTreePath,
  isPresentationReady,
  normalizePath,
  routeMatches,
  type PresentationReadyRoute,
} from "./presentationReadiness";

/** `src/`, resolved from this file. */
const SRC = join(__dirname, "..", "..");
const APP = join(SRC, "app");

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
}

function filesNamed(name: string, dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) filesNamed(name, path, out);
    else if (entry === name) out.push(path);
  }
  return out;
}

function layoutsUnder(dir: string): string[] {
  return filesNamed("layout.tsx", dir);
}

/** A layout's or a page's route: its directory under `app/`, route groups dropped. */
function routeOfLayout(layout: string): string {
  const segments = relative(APP, dirname(layout))
    .split(sep)
    .filter((s) => s && !/^\(.*\)$/.test(s));
  return `/${segments.join("/")}`;
}

/** Each app route's page module, `src/`-relative and without its extension. */
const PAGE_MODULES: ReadonlyMap<string, string> = new Map(
  filesNamed("page.tsx", APP).map((page) => [
    routeOfLayout(page),
    relative(SRC, page)
      .split(sep)
      .join("/")
      .replace(/\.tsx$/, ""),
  ])
);

/** What a proof file does, read from its syntax tree (comments and strings are not code). */
interface ProofFacts {
  /** The modules it imports for their values — statically or by `import()`. */
  readonly imports: readonly string[];
  /** The modules it puts a stand-in in place of (`vi.mock`, `vi.doMock`). */
  readonly mocked: readonly string[];
  /** Whether it ASSERTS the helper (see {@link isHelperAssertion}). */
  readonly assertsHelper: boolean;
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

/**
 * Whether `call` runs the helper AS AN ASSERTION: `expectPresentationSafe(…)`,
 * or `findPresentationViolations(…)` — optionally `.map(describeViolation)`
 * — as the value of `expect(…)` asserted empty with `.toEqual([])`,
 * `.toStrictEqual([])` or `.toHaveLength(0)`. A finder whose answer is
 * discarded, kept in a variable, or asserted anything else asserts nothing.
 */
function isHelperAssertion(call: ts.CallExpression): boolean {
  if (calls(call, "expectPresentationSafe")) return true;
  if (!calls(call, "findPresentationViolations")) return false;
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
    return false;
  }
  const matcher = expectCall.parent;
  if (
    !ts.isPropertyAccessExpression(matcher) ||
    matcher.expression !== expectCall ||
    !ts.isCallExpression(matcher.parent) ||
    matcher.parent.expression !== matcher
  ) {
    return false;
  }
  const args = matcher.parent.arguments;
  const only = args.length === 1 ? args[0] : undefined;
  switch (matcher.name.text) {
    case "toEqual":
    case "toStrictEqual":
      return (
        only !== undefined &&
        ts.isArrayLiteralExpression(only) &&
        only.elements.length === 0
      );
    case "toHaveLength":
      return (
        only !== undefined && ts.isNumericLiteral(only) && only.text === "0"
      );
    default:
      return false;
  }
}

function proofFacts(file: string, text: string): ProofFacts {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const imports: string[] = [];
  const mocked: string[] = [];
  let assertsHelper = false;
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
      if (isHelperAssertion(node)) assertsHelper = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, mocked, assertsHelper };
}

/** `specifier`, imported from the `src/`-relative `from`, as a `src/`-relative module path. */
function resolvedModule(specifier: string, from: string): string | null {
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
 * the route's `src/`-relative page module, or `null` when there is none.
 */
function readyRouteProblems(
  entry: PresentationReadyRoute,
  read: (srcRelative: string) => string | null,
  pageOf: (route: string) => string | null = (route) =>
    PAGE_MODULES.get(route) ?? null
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
  const facts = proofFacts(entry.provenBy, source);
  if (!facts.assertsHelper) {
    problems.push(
      `${entry.route}: ${entry.provenBy} never calls expectPresentationSafe, nor asserts findPresentationViolations empty`
    );
  }
  const isPage = (specifier: string) =>
    resolvedModule(specifier, entry.provenBy) === page;
  if (page !== null && !facts.imports.some(isPage)) {
    problems.push(
      `${entry.route}: ${entry.provenBy} does not render the page — it never imports ${page}`
    );
  } else if (page !== null && facts.mocked.some(isPage)) {
    problems.push(
      `${entry.route}: ${entry.provenBy} does not render the page — it mocks ${page}, so what renders is a stand-in`
    );
  }
  return problems;
}

function readSrc(srcRelative: string): string | null {
  const path = join(SRC, srcRelative);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

describe("normalizePath / routeMatches", () => {
  it("drops the query, the hash and a trailing slash", () => {
    expect(normalizePath("/admin/coord/devops/?present=1#rows")).toBe(
      "/admin/coord/devops"
    );
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("");
  });

  it.each<[string, string, boolean]>([
    ["/admin/coord/devops", "/admin/coord/devops", true],
    ["/admin/coord/devops", "/admin/coord/devops/?present=1", true],
    ["/admin/coord/devops", "/admin/coord/devops/machines", false],
    ["/admin/coord/devops", "/admin/coord", false],
    ["/admin/coord/work-units/[slug]", "/admin/coord/work-units/abc", true],
    ["/admin/coord/work-units/[slug]", "/admin/coord/work-units", false],
    ["/admin/coord/work-units/[slug]", "/admin/coord/work-units/a/b", false],
    ["/admin/coord/[a]/x", "/admin/coord/home/x", true],
    ["/admin/coord/[a]/x", "/admin/coord/home/y", false],
  ])("%s matches %s → %s", (pattern, pathname, expected) => {
    expect(routeMatches(pattern, pathname)).toBe(expected);
  });
});

describe("isLensTreePath", () => {
  it("is a lens tree's root and everything below it", () => {
    expect(isLensTreePath("/admin/coord")).toBe(true);
    expect(isLensTreePath("/admin/coord/devops?present=1")).toBe(true);
    expect(isLensTreePath("/digital-twin")).toBe(true);
    expect(isLensTreePath("/digital-twin/")).toBe(true);
  });

  it("is not a sibling route that merely shares a prefix, nor any other page", () => {
    expect(isLensTreePath("/admin/coordinator")).toBe(false);
    expect(isLensTreePath("/digital-twins")).toBe(false);
    expect(isLensTreePath("/settings")).toBe(false);
    expect(isLensTreePath("/admin")).toBe(false);
    expect(isLensTreePath("")).toBe(false);
  });
});

describe("isPresentationReady", () => {
  const routes: PresentationReadyRoute[] = [
    { route: "/admin/coord/devops", provenBy: "x.test.tsx" },
    { route: "/admin/coord/work-units/[slug]", provenBy: "y.test.tsx" },
  ];

  it("is ready only for a registered route", () => {
    expect(isPresentationReady("/admin/coord/devops?present=1", routes)).toBe(
      true
    );
    expect(isPresentationReady("/admin/coord/work-units/abc", routes)).toBe(
      true
    );
    expect(isPresentationReady("/admin/coord/pipeline", routes)).toBe(false);
    expect(isPresentationReady("/admin/coord/devops/sub", routes)).toBe(false);
  });

  it("withholds every page when nothing is registered", () => {
    expect(isPresentationReady("/admin/coord/devops", [])).toBe(false);
  });
});

describe("LENS_TREES are exactly the layouts that mount the lens", () => {
  it("names every layout rendering <PresentationLens>, and nothing else", () => {
    const lensLayouts = layoutsUnder(APP).filter((layout) =>
      /<PresentationLens\b/.test(withoutComments(readFileSync(layout, "utf8")))
    );
    // Not vacuous: the console and the twin both mount it today.
    expect(lensLayouts.length).toBeGreaterThanOrEqual(2);
    expect(lensLayouts.map(routeOfLayout).sort()).toEqual(
      [...LENS_TREES].sort()
    );
  });

  it("gates every lens layout's page body with <PresentationPage>", () => {
    for (const layout of layoutsUnder(APP)) {
      const source = withoutComments(readFileSync(layout, "utf8"));
      if (!/<PresentationLens\b/.test(source)) continue;
      expect(/<PresentationPage\b/.test(source), layout).toBe(true);
    }
  });

  it("mounts the shell's provider around the authenticated app", () => {
    const shell = withoutComments(
      readFileSync(join(APP, "(app)", "layout.tsx"), "utf8")
    );
    expect(shell).toMatch(/<PresentationShell>/);
  });
});

describe("every presentation-ready route is proven", () => {
  it("names a page test that runs expectPresentationSafe, for a route inside a lens tree", () => {
    expect(
      PRESENTATION_READY_ROUTES.flatMap((entry) =>
        readyRouteProblems(entry, readSrc)
      )
    ).toEqual([]);
  });

  it("registers each route once", () => {
    const routes = PRESENTATION_READY_ROUTES.map((e) => e.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  describe("the proof check itself can fail", () => {
    const DEVOPS_PAGE = "app/(app)/admin/coord/devops/page";
    const files: Record<string, string> = {
      "app/(app)/admin/coord/devops/page.test.tsx":
        'import DevOpsPage from "./page";\nexpectPresentationSafe(view, {});',
      "app/(app)/admin/coord/devops/aliased.test.tsx":
        'import Page from "@/app/(app)/admin/coord/devops/page";\nexpect(findPresentationViolations(view)).toEqual([]);',
      "app/(app)/admin/coord/devops/panel.test.tsx":
        'import { HealthPanel } from "./_components/HealthPanel";\nexpectPresentationSafe(view, {});',
      "app/(app)/admin/coord/devops/other.test.tsx":
        'import Page from "../spawns/page";\nexpectPresentationSafe(view, {});',
      "app/(app)/admin/coord/devops/mocked.test.tsx":
        'vi.mock("./page");\nexpectPresentationSafe(view, {});',
      "app/(app)/admin/coord/devops/stand-in.test.tsx":
        'vi.mock("./page", () => ({ default: () => null }));\nimport Page from "./page";\nexpectPresentationSafe(view, {});',
      "app/(app)/admin/coord/devops/stand-in-by-import.test.tsx":
        'import Page from "@/app/(app)/admin/coord/devops/page";\nvi.mock(import("./page"), () => ({ default: () => null }));\nexpectPresentationSafe(view, {});',
      "app/(app)/admin/coord/devops/discarded.test.tsx":
        'import DevOpsPage from "./page";\nfindPresentationViolations(view);',
      "app/(app)/admin/coord/devops/kept.test.tsx":
        'import DevOpsPage from "./page";\nconst found = findPresentationViolations(view);\nexpect(found).toBeDefined();',
      "app/(app)/admin/coord/devops/not-empty.test.tsx":
        'import DevOpsPage from "./page";\nexpect(findPresentationViolations(view)).not.toEqual([]);',
      "app/(app)/admin/coord/devops/equal-to-a-list.test.tsx":
        'import DevOpsPage from "./page";\nexpect(findPresentationViolations(view)).toEqual(expected);',
      "app/(app)/admin/coord/devops/in-a-string.test.tsx":
        'import DevOpsPage from "./page";\nconst s = "expectPresentationSafe(view)";',
      "app/(app)/admin/coord/devops/mapped.test.tsx":
        'import DevOpsPage from "./page";\nexpect(\n  findPresentationViolations(view, { forbidden }).map(describeViolation)\n).toEqual([]);',
      "app/(app)/admin/coord/devops/mocks-another.test.tsx":
        'vi.mock("@/services/service-factory", () => ({}));\nimport DevOpsPage from "./page";\nexpect(findPresentationViolations(view)).toHaveLength(0);',
      "app/(app)/admin/coord/devops/commented.test.tsx":
        'import DevOpsPage from "./page";\n// expectPresentationSafe(view);',
      "app/(app)/admin/coord/devops/silent.test.tsx":
        'import DevOpsPage from "./page";\nexpect(view).toBeTruthy();',
      // The generic helper suite runs the helper, but over no page at all.
      "test/presentation.test.tsx": "expectPresentationSafe(view, {});",
    };
    const read = (f: string) => files[f] ?? null;
    const pageOf = (route: string) =>
      route === "/admin/coord/devops" ? DEVOPS_PAGE : null;
    const devops = (provenBy: string): PresentationReadyRoute => ({
      route: "/admin/coord/devops",
      provenBy,
    });

    it.each<[string, string]>([
      ["imports its page and runs the assertion", "page.test.tsx"],
      [
        "imports its page by alias and asserts the finder is empty",
        "aliased.test.tsx",
      ],
      [
        "asserts the finder's described violations are empty",
        "mapped.test.tsx",
      ],
      [
        "mocks a service, not the page, and asserts the finder has none",
        "mocks-another.test.tsx",
      ],
    ])("passes a lens route whose test %s", (_name, file) => {
      expect(
        readyRouteProblems(
          devops(`app/(app)/admin/coord/devops/${file}`),
          read,
          pageOf
        )
      ).toEqual([]);
    });

    it.each<[string, PresentationReadyRoute, string]>([
      [
        "a missing test",
        devops("app/(app)/admin/coord/devops/none.test.tsx"),
        "does not exist",
      ],
      [
        "a test that never runs the helper",
        devops("app/(app)/admin/coord/devops/silent.test.tsx"),
        "never calls expectPresentationSafe",
      ],
      [
        "a helper call that is only a comment",
        devops("app/(app)/admin/coord/devops/commented.test.tsx"),
        "never calls expectPresentationSafe",
      ],
      [
        "a test that runs the helper over one panel of the page",
        devops("app/(app)/admin/coord/devops/panel.test.tsx"),
        "does not render the page",
      ],
      [
        "a test that renders another route's page",
        devops("app/(app)/admin/coord/devops/other.test.tsx"),
        "does not render the page",
      ],
      [
        "a test that only mocks the page",
        devops("app/(app)/admin/coord/devops/mocked.test.tsx"),
        "does not render the page",
      ],
      [
        "a test that imports the page and mocks it with a stand-in",
        devops("app/(app)/admin/coord/devops/stand-in.test.tsx"),
        "it mocks app/(app)/admin/coord/devops/page",
      ],
      [
        "a test that mocks the page by import() under another spelling",
        devops("app/(app)/admin/coord/devops/stand-in-by-import.test.tsx"),
        "it mocks app/(app)/admin/coord/devops/page",
      ],
      [
        "a finder whose answer is discarded",
        devops("app/(app)/admin/coord/devops/discarded.test.tsx"),
        "never calls expectPresentationSafe",
      ],
      [
        "a finder whose answer is kept but never asserted empty",
        devops("app/(app)/admin/coord/devops/kept.test.tsx"),
        "never calls expectPresentationSafe",
      ],
      [
        "a finder asserted NOT empty",
        devops("app/(app)/admin/coord/devops/not-empty.test.tsx"),
        "never calls expectPresentationSafe",
      ],
      [
        "a finder asserted equal to a list that may not be empty",
        devops("app/(app)/admin/coord/devops/equal-to-a-list.test.tsx"),
        "never calls expectPresentationSafe",
      ],
      [
        "a helper call that is only a string",
        devops("app/(app)/admin/coord/devops/in-a-string.test.tsx"),
        "never calls expectPresentationSafe",
      ],
      [
        "the helper's own suite, which renders no page",
        devops("test/presentation.test.tsx"),
        "does not render the page",
      ],
      [
        "a route outside every lens tree",
        {
          route: "/settings",
          provenBy: "app/(app)/admin/coord/devops/page.test.tsx",
        },
        "not under a lens tree",
      ],
      [
        "a route no page serves",
        {
          route: "/admin/coord/nowhere",
          provenBy: "app/(app)/admin/coord/devops/page.test.tsx",
        },
        "no page module serves this route",
      ],
      [
        "a proof that is not a test",
        devops("app/(app)/admin/coord/devops/page.tsx"),
        "is not a test file",
      ],
    ])("fails %s", (_name, entry, problem) => {
      expect(readyRouteProblems(entry, read, pageOf).join("\n")).toContain(
        problem
      );
    });

    it("finds the real page modules (the route map is not vacuous)", () => {
      expect(PAGE_MODULES.get("/admin/coord")).toBe(
        "app/(app)/admin/coord/page"
      );
      expect(PAGE_MODULES.get("/digital-twin")).toBe(
        "app/(app)/digital-twin/page"
      );
    });
  });
});
