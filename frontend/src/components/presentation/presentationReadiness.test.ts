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
 * - every `PRESENTATION_READY_ROUTES` entry must be a route inside a lens
 *   tree that a page module serves, proven by a test file that exists.
 *
 * Whether that test PROVES the route is not read here, and not from its
 * source: it is the run's to show (`src/test/readinessEvidence.ts`). Running
 * this file arms that requirement — the run must also run every entry's
 * proof, and in it a test that FINISHED passed must have run the page check
 * over the route's own page under a presenting lens, finding nothing — and
 * the end-of-run step fails the run otherwise. The last test below fails when
 * that step is not armed in this run.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, inject, it } from "vitest";
import {
  appFilesNamed,
  appPageModules,
  routeOfAppFile,
} from "@/test/appRoutes";
import { READINESS_PROVIDE_KEY } from "@/test/readinessEvidence";
import { readyRouteTargets } from "@/test/readinessReporter";
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

function layoutsUnder(dir: string): string[] {
  return appFilesNamed("layout.tsx", dir);
}

/** Each app route's page module, `src/`-relative and without its extension. */
const PAGE_MODULES = appPageModules(SRC);

/**
 * Why `entry` is not a well-formed ready route; empty when it is. `exists`
 * says whether a `src/`-relative file exists; `pageOf` names the route's page
 * module, or `null` when no page serves it.
 */
function entryProblems(
  entry: PresentationReadyRoute,
  exists: (srcRelative: string) => boolean,
  pageOf: (route: string) => string | null
): string[] {
  const problems: string[] = [];
  if (!isLensTreePath(entry.route)) {
    problems.push(
      `${entry.route}: not under a lens tree (${LENS_TREES.join(", ")})`
    );
  }
  if (pageOf(entry.route) === null) {
    problems.push(`${entry.route}: no page module serves this route`);
  }
  if (!/\.test\.tsx?$/.test(entry.provenBy)) {
    problems.push(
      `${entry.route}: provenBy ${entry.provenBy} is not a test file`
    );
  } else if (!exists(entry.provenBy)) {
    problems.push(`${entry.route}: provenBy ${entry.provenBy} does not exist`);
  }
  return problems;
}

const existsInSrc = (srcRelative: string) => existsSync(join(SRC, srcRelative));
const realPageOf = (route: string) => PAGE_MODULES.get(route) ?? null;

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
    expect(lensLayouts.map((l) => routeOfAppFile(APP, l)).sort()).toEqual(
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
  it("names, for a route inside a lens tree that a page serves, a test file that exists", () => {
    expect(
      PRESENTATION_READY_ROUTES.flatMap((entry) =>
        entryProblems(entry, existsInSrc, realPageOf)
      )
    ).toEqual([]);
  });

  it.each<[string, PresentationReadyRoute, string]>([
    [
      "a route outside every lens tree",
      { route: "/settings", provenBy: "app/(app)/settings/page.test.tsx" },
      "/settings: not under a lens tree",
    ],
    [
      "a route no page serves",
      {
        route: "/admin/coord/nowhere",
        provenBy: "app/(app)/admin/coord/page.test.tsx",
      },
      "/admin/coord/nowhere: no page module serves this route",
    ],
    [
      "a proof that is not a test file",
      { route: "/admin/coord", provenBy: "app/(app)/admin/coord/page.tsx" },
      "provenBy app/(app)/admin/coord/page.tsx is not a test file",
    ],
    [
      "a proof that does not exist",
      {
        route: "/admin/coord",
        provenBy: "app/(app)/admin/coord/missing.test.tsx",
      },
      "provenBy app/(app)/admin/coord/missing.test.tsx does not exist",
    ],
  ])("refuses %s", (_what, entry, problem) => {
    expect(entryProblems(entry, existsInSrc, realPageOf).join("\n")).toContain(
      problem
    );
  });

  it("registers each route once", () => {
    const routes = PRESENTATION_READY_ROUTES.map((e) => e.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("finds the real page modules (the route map is not vacuous)", () => {
    expect(PAGE_MODULES.get("/admin/coord")).toBe("app/(app)/admin/coord/page");
    expect(PAGE_MODULES.get("/digital-twin")).toBe(
      "app/(app)/digital-twin/page"
    );
  });

  it("is armed in this run: the end-of-run step that requires every route's evidence provided the routes it will check", () => {
    // Provided by the reporter `presentationReadiness()` adds in
    // vitest.config.ts; absent when the plugin is not in the run's config.
    expect(inject(READINESS_PROVIDE_KEY)).toEqual({
      srcDir: SRC,
      targets: readyRouteTargets(SRC),
    });
  });
});
