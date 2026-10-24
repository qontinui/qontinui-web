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
 * - every `PRESENTATION_READY_ROUTES` entry must name a page test that runs
 *   the helper (`expectPresentationSafe`, or `findPresentationViolations`
 *   under an assertion) AND imports that route's own page module — a test
 *   that renders some other page, or one panel of it, proves nothing about
 *   the page the entry un-withholds. Phase 1 registers only the console's
 *   landing redirect; the check is proven able to fail on fixtures below.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
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

/** The module specifiers `source` imports statically or dynamically. */
function importedSpecifiers(source: string): string[] {
  const code = withoutComments(source);
  return [
    ...code.matchAll(/\bimport\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g),
    ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
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

/** A call of the helper's: the assertion, or the finder under an assertion. */
const HELPER_CALL = /\b(?:expectPresentationSafe|findPresentationViolations)\(/;

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
  if (!HELPER_CALL.test(withoutComments(source))) {
    problems.push(
      `${entry.route}: ${entry.provenBy} never calls expectPresentationSafe`
    );
  }
  if (
    page !== null &&
    !importedSpecifiers(source).some(
      (specifier) => resolvedModule(specifier, entry.provenBy) === page
    )
  ) {
    problems.push(
      `${entry.route}: ${entry.provenBy} does not render the page — it never imports ${page}`
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
