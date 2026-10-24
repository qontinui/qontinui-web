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
 *   PROVES it (`src/test/readinessProof.ts` says how it is read): it asserts
 *   the helper — `expectPresentationSafe(…)`, or
 *   `expect(findPresentationViolations(…)).toEqual([])`; a finder whose
 *   answer is discarded asserts nothing — in a test that RUNS (not skipped,
 *   todo, conditional or expected to fail, nor in a function nobody calls),
 *   over a render whose JSX names the route's own page module, imported and
 *   not mocked. A test that renders some other page, one panel of it while
 *   merely importing the page, or a stand-in `vi.mock` put in the page's
 *   place, proves nothing about the page the entry un-withholds; nor does one
 *   that never runs. Phase 1 registers only the console's landing redirect;
 *   the check is proven able to fail on fixtures below.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { readyRouteProblems } from "@/test/readinessProof";
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

/** The route's page module, from the real tree. */
function realPageOf(route: string): string | null {
  return PAGE_MODULES.get(route) ?? null;
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
        readyRouteProblems(entry, readSrc, realPageOf)
      )
    ).toEqual([]);
  });

  it("registers each route once", () => {
    const routes = PRESENTATION_READY_ROUTES.map((e) => e.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  describe("the proof check itself can fail", () => {
    const DEVOPS_PAGE = "app/(app)/admin/coord/devops/page";
    const PAGE = 'import DevOpsPage from "./page";\n';
    const PANEL_IMPORT =
      'import { HealthPanel } from "./_components/HealthPanel";\n';
    const RENDER = "const view = renderInPresentationMode(<DevOpsPage />);";
    const PANEL = "const view = renderInPresentationMode(<HealthPanel />);";
    /** `body` inside a test that runs. */
    const inTest = (body: string) =>
      `it("is safe to show", () => {\n${body}\n});`;
    const files: Record<string, string> = {
      // ── proofs ──────────────────────────────────────────────────────────
      "page.test.tsx":
        PAGE + inTest(`${RENDER}\nexpectPresentationSafe(view, {});`),
      "aliased.test.tsx":
        'import Page from "@/app/(app)/admin/coord/devops/page";\n' +
        inTest(
          "expect(findPresentationViolations(renderInPresentationMode(<Page />))).toEqual([]);"
        ),
      "mapped.test.tsx":
        PAGE +
        inTest(
          `${RENDER}\nexpect(\n  findPresentationViolations(view, { forbidden }).map(describeViolation)\n).toEqual([]);`
        ),
      "mocks-another.test.tsx":
        'vi.mock("@/services/service-factory", () => ({}));\n' +
        PAGE +
        'test("is safe", async () => {\n  const view = renderInPresentationMode(<Providers><DevOpsPage /></Providers>);\n  await screen.findByTestId("coord-devops");\n  expect(findPresentationViolations(view)).toHaveLength(0);\n});',
      "in-describe.test.tsx":
        PAGE +
        `describe("dev ops", () => {\n  it.only("is safe", () => {\n    ${RENDER}\n    expectPresentationSafe(view);\n  });\n});`,
      "each.test.tsx":
        PAGE +
        'it.each(["a", "b"])("is safe with %s", () => {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n});',
      "before-each.test.tsx":
        PAGE +
        "let view: PresentationView;\nbeforeEach(() => {\n  view = renderInPresentationMode(<DevOpsPage />);\n});\n" +
        'it("is safe", () => {\n  expectPresentationSafe(view);\n});',
      "render-helper.test.tsx":
        PAGE +
        "function renderPage() {\n  return renderInPresentationMode(<DevOpsPage />);\n}\n" +
        inTest("const view = renderPage();\nexpectPresentationSafe(view);"),
      "assert-helper.test.tsx":
        PAGE +
        "const proveSafe = () => {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n};\n" +
        'it("is safe", () => proveSafe());',
      "handed.test.tsx":
        PAGE +
        "function proveSafe() {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n}\n" +
        'it("is safe", proveSafe);',
      "waited.test.tsx":
        PAGE +
        'it("is safe", async () => {\n  const view = renderInPresentationMode(<DevOpsPage />);\n  await waitFor(() => expectPresentationSafe(view));\n});',
      "loaded.test.tsx":
        'it("is safe", async () => {\n  const { default: Page } = await import("./page");\n  expectPresentationSafe(renderInPresentationMode(<Page />));\n});',
      "namespace.test.tsx":
        'import * as devops from "./page";\n' +
        inTest(
          "expectPresentationSafe(renderInPresentationMode(<devops.default />));"
        ),
      // ── not proofs: the helper is not asserted ──────────────────────────
      "silent.test.tsx": PAGE + inTest(`${RENDER}\nexpect(view).toBeTruthy();`),
      "commented.test.tsx":
        PAGE + inTest(`${RENDER}\n// expectPresentationSafe(view);`),
      "discarded.test.tsx":
        PAGE + inTest(`${RENDER}\nfindPresentationViolations(view);`),
      "kept.test.tsx":
        PAGE +
        inTest(
          `${RENDER}\nconst found = findPresentationViolations(view);\nexpect(found).toBeDefined();`
        ),
      "not-empty.test.tsx":
        PAGE +
        inTest(
          `${RENDER}\nexpect(findPresentationViolations(view)).not.toEqual([]);`
        ),
      "equal-to-a-list.test.tsx":
        PAGE +
        inTest(
          `${RENDER}\nexpect(findPresentationViolations(view)).toEqual(expected);`
        ),
      "in-a-string.test.tsx":
        PAGE + inTest(`${RENDER}\nconst s = "expectPresentationSafe(view)";`),
      // ── not proofs: the assertion never runs ────────────────────────────
      "skipped.test.tsx":
        PAGE +
        `it.skip("is safe", () => {\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
      "skipped-describe.test.tsx":
        PAGE +
        `describe.skip("dev ops", () => {\n  it("is safe", () => {\n    ${RENDER}\n    expectPresentationSafe(view);\n  });\n});`,
      "uncalled.test.tsx":
        PAGE +
        "function proveSafe() {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n}\n" +
        'it.todo("is safe");',
      "skip-if.test.tsx":
        PAGE +
        `it.skipIf(!composed)("is safe", () => {\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
      "run-if.test.tsx":
        PAGE +
        `it.runIf(composed)("is safe", () => {\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
      "xit.test.tsx":
        PAGE +
        `xit("is safe", () => {\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
      "xdescribe.test.tsx":
        PAGE +
        `xdescribe("dev ops", () => {\n  it("is safe", () => {\n    ${RENDER}\n    expectPresentationSafe(view);\n  });\n});`,
      "describe-skip-if.test.tsx":
        PAGE +
        `describe.skipIf(ci)("dev ops", () => {\n  it("is safe", () => {\n    ${RENDER}\n    expectPresentationSafe(view);\n  });\n});`,
      "fails.test.tsx":
        PAGE +
        `it.fails("is safe", () => {\n  ${RENDER}\n  expectPresentationSafe(view);\n});`,
      "module-level.test.tsx":
        PAGE +
        "expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));",
      "in-a-hook.test.tsx":
        PAGE +
        "beforeEach(() => {\n  expectPresentationSafe(renderInPresentationMode(<DevOpsPage />));\n});\n" +
        'it("renders", () => {});',
      // ── not proofs: the assertion runs over something else ──────────────
      "panel.test.tsx":
        PANEL_IMPORT + inTest(`${PANEL}\nexpectPresentationSafe(view, {});`),
      "panel-beside-page.test.tsx":
        PAGE + PANEL_IMPORT + inTest(`${PANEL}\nexpectPresentationSafe(view);`),
      "page-then-panel.test.tsx":
        PAGE +
        PANEL_IMPORT +
        inTest(
          "const page = renderInPresentationMode(<DevOpsPage />);\nconst panel = renderInPresentationMode(<HealthPanel />);\nexpectPresentationSafe(panel);"
        ),
      "reassigned.test.tsx":
        PAGE +
        PANEL_IMPORT +
        "let view: PresentationView;\nbeforeEach(() => {\n  view = renderInPresentationMode(<DevOpsPage />);\n});\n" +
        'it("is safe", () => {\n  view = renderInPresentationMode(<HealthPanel />);\n  expectPresentationSafe(view);\n});',
      "other.test.tsx":
        'import Page from "../spawns/page";\n' +
        inTest(
          "expectPresentationSafe(renderInPresentationMode(<Page />), {});"
        ),
      "mocked.test.tsx":
        'vi.mock("./page");\n' + inTest("expectPresentationSafe(view, {});"),
      "stand-in.test.tsx":
        'vi.mock("./page", () => ({ default: () => null }));\nimport Page from "./page";\n' +
        inTest(
          "expectPresentationSafe(renderInPresentationMode(<Page />), {});"
        ),
      "stand-in-by-import.test.tsx":
        'import Page from "@/app/(app)/admin/coord/devops/page";\nvi.mock(import("./page"), () => ({ default: () => null }));\n' +
        inTest(
          "expectPresentationSafe(renderInPresentationMode(<Page />), {});"
        ),
    };
    const DIR = "app/(app)/admin/coord/devops/";
    // The generic helper suite runs the helper, but over no page at all.
    const HELPER_SUITE = "test/presentation.test.tsx";
    const read = (f: string) =>
      f === HELPER_SUITE
        ? inTest(
            "expectPresentationSafe(renderInPresentationMode(<p>x</p>), {});"
          )
        : f.startsWith(DIR)
          ? (files[f.slice(DIR.length)] ?? null)
          : null;
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
      ["asserts inside a describe, in an it.only", "in-describe.test.tsx"],
      ["asserts in every row of an it.each", "each.test.tsx"],
      [
        "renders in a beforeEach and asserts in the test",
        "before-each.test.tsx",
      ],
      ["renders through a helper of its own", "render-helper.test.tsx"],
      ["asserts in a helper a running test calls", "assert-helper.test.tsx"],
      ["hands its assertion to the test by name", "handed.test.tsx"],
      ["asserts inside waitFor", "waited.test.tsx"],
      ["loads its page with import()", "loaded.test.tsx"],
      ["imports its page as a namespace", "namespace.test.tsx"],
    ])("passes a lens route whose test %s", (_name, file) => {
      expect(readyRouteProblems(devops(`${DIR}${file}`), read, pageOf)).toEqual(
        []
      );
    });

    const NEVER_CALLS = "never calls expectPresentationSafe";
    const NEVER_RUNS = "never runs its helper assertion";
    const NOT_THE_PAGE = "does not render the page";
    const OVER_SOMETHING_ELSE =
      "no test that runs asserts the helper over a render naming";

    it.each<[string, PresentationReadyRoute, string]>([
      ["a missing test", devops(`${DIR}none.test.tsx`), "does not exist"],
      [
        "a test that never runs the helper",
        devops(`${DIR}silent.test.tsx`),
        NEVER_CALLS,
      ],
      [
        "a helper call that is only a comment",
        devops(`${DIR}commented.test.tsx`),
        NEVER_CALLS,
      ],
      [
        "a finder whose answer is discarded",
        devops(`${DIR}discarded.test.tsx`),
        NEVER_CALLS,
      ],
      [
        "a finder whose answer is kept but never asserted empty",
        devops(`${DIR}kept.test.tsx`),
        NEVER_CALLS,
      ],
      [
        "a finder asserted NOT empty",
        devops(`${DIR}not-empty.test.tsx`),
        NEVER_CALLS,
      ],
      [
        "a finder asserted equal to a list that may not be empty",
        devops(`${DIR}equal-to-a-list.test.tsx`),
        NEVER_CALLS,
      ],
      [
        "a helper call that is only a string",
        devops(`${DIR}in-a-string.test.tsx`),
        NEVER_CALLS,
      ],
      [
        "its only assertion in an it.skip",
        devops(`${DIR}skipped.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "its only assertion under a describe.skip",
        devops(`${DIR}skipped-describe.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "its only assertion in a function nobody calls, beside an it.todo",
        devops(`${DIR}uncalled.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "its only assertion in a test skipped on a condition",
        devops(`${DIR}skip-if.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "its only assertion in a test run on a condition",
        devops(`${DIR}run-if.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "its only assertion in an xit",
        devops(`${DIR}xit.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "its only assertion under an xdescribe",
        devops(`${DIR}xdescribe.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "its only assertion under a describe skipped on a condition",
        devops(`${DIR}describe-skip-if.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "its only assertion in a test expected to fail",
        devops(`${DIR}fails.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "its only assertion at module level, in no test",
        devops(`${DIR}module-level.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "its only assertion in a hook",
        devops(`${DIR}in-a-hook.test.tsx`),
        NEVER_RUNS,
      ],
      [
        "a test that runs the helper over one panel of the page",
        devops(`${DIR}panel.test.tsx`),
        NOT_THE_PAGE,
      ],
      [
        "a test that imports the page but asserts over one panel of it",
        devops(`${DIR}panel-beside-page.test.tsx`),
        OVER_SOMETHING_ELSE,
      ],
      [
        "a test that renders the page but asserts over a panel's render",
        devops(`${DIR}page-then-panel.test.tsx`),
        OVER_SOMETHING_ELSE,
      ],
      [
        "a test that re-assigns the page's view to a panel before asserting",
        devops(`${DIR}reassigned.test.tsx`),
        OVER_SOMETHING_ELSE,
      ],
      [
        "a test that renders another route's page",
        devops(`${DIR}other.test.tsx`),
        NOT_THE_PAGE,
      ],
      [
        "a test that only mocks the page",
        devops(`${DIR}mocked.test.tsx`),
        NOT_THE_PAGE,
      ],
      [
        "a test that imports the page and mocks it with a stand-in",
        devops(`${DIR}stand-in.test.tsx`),
        "it mocks app/(app)/admin/coord/devops/page",
      ],
      [
        "a test that mocks the page by import() under another spelling",
        devops(`${DIR}stand-in-by-import.test.tsx`),
        "it mocks app/(app)/admin/coord/devops/page",
      ],
      [
        "the helper's own suite, which renders no page",
        devops(HELPER_SUITE),
        NOT_THE_PAGE,
      ],
      [
        "a route outside every lens tree",
        { route: "/settings", provenBy: `${DIR}page.test.tsx` },
        "not under a lens tree",
      ],
      [
        "a route no page serves",
        { route: "/admin/coord/nowhere", provenBy: `${DIR}page.test.tsx` },
        "no page module serves this route",
      ],
      [
        "a proof that is not a test",
        devops(`${DIR}page.tsx`),
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
