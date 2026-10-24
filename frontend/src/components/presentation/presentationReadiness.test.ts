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
 *   actually runs `expectPresentationSafe`. Phase 1 registers none; the check
 *   is proven able to fail on fixtures below, so it is not vacuous when a
 *   later phase adds the first.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
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

function layoutsUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) layoutsUnder(path, out);
    else if (entry === "layout.tsx") out.push(path);
  }
  return out;
}

/** A layout's route: its directory under `app/`, route groups dropped. */
function routeOfLayout(layout: string): string {
  const segments = relative(APP, dirname(layout))
    .split(sep)
    .filter((s) => s && !/^\(.*\)$/.test(s));
  return `/${segments.join("/")}`;
}

/**
 * Why `entry` is not a proven ready route; empty when it is. `read` returns a
 * `src/`-relative file's text, or `null` when there is no such file.
 */
function readyRouteProblems(
  entry: PresentationReadyRoute,
  read: (srcRelative: string) => string | null
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
  const source = read(entry.provenBy);
  if (source === null) {
    problems.push(`${entry.route}: provenBy ${entry.provenBy} does not exist`);
  } else if (!/\bexpectPresentationSafe\(/.test(withoutComments(source))) {
    problems.push(
      `${entry.route}: ${entry.provenBy} never calls expectPresentationSafe`
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
    const files: Record<string, string> = {
      "app/ok/page.test.tsx": "expectPresentationSafe(view, {});",
      "app/commented/page.test.tsx": "// expectPresentationSafe(view);",
      "app/silent/page.test.tsx": "expect(view).toBeTruthy();",
    };
    const read = (f: string) => files[f] ?? null;

    it("passes a lens route whose test runs the helper", () => {
      expect(
        readyRouteProblems(
          { route: "/admin/coord/devops", provenBy: "app/ok/page.test.tsx" },
          read
        )
      ).toEqual([]);
    });

    it.each<[string, PresentationReadyRoute, string]>([
      [
        "a missing test",
        { route: "/admin/coord/devops", provenBy: "app/none/page.test.tsx" },
        "does not exist",
      ],
      [
        "a test that never runs the helper",
        { route: "/admin/coord/devops", provenBy: "app/silent/page.test.tsx" },
        "never calls expectPresentationSafe",
      ],
      [
        "a helper call that is only a comment",
        {
          route: "/admin/coord/devops",
          provenBy: "app/commented/page.test.tsx",
        },
        "never calls expectPresentationSafe",
      ],
      [
        "a route outside every lens tree",
        { route: "/settings", provenBy: "app/ok/page.test.tsx" },
        "not under a lens tree",
      ],
      [
        "a proof that is not a test",
        { route: "/admin/coord/devops", provenBy: "app/ok/page.tsx" },
        "is not a test file",
      ],
    ])("fails %s", (_name, entry, problem) => {
      expect(readyRouteProblems(entry, read).join("\n")).toContain(problem);
    });
  });
});
