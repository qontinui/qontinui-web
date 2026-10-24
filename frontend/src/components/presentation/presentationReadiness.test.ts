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
 *   answer is discarded asserts nothing — where a failure fails a test that
 *   RUNS, every time it runs (on the test body's unconditional path: no
 *   condition, early `return`, swallowing `catch` or deferring callback
 *   between them, in a test no modifier, option, context `skip` or
 *   registration condition can stop), over a render that always evaluates the
 *   route's own page module, imported and not mocked. A test that renders
 *   some other page, one panel of it while merely importing the page, or a
 *   stand-in `vi.mock` put in the page's place, proves nothing about the page
 *   the entry un-withholds; nor does one that never runs, or runs only in some
 *   builds. Phase 1 registers only the console's landing redirect; the check
 *   is proven able to fail on the fixtures in `src/test/readinessProof.test.ts`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, inject, it } from "vitest";
import { READINESS_PROVIDE_KEY } from "@/test/readinessEvidence";
import { readyRouteProblems } from "@/test/readinessProof";
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

  it("is armed in this run: the end-of-run step that requires every route's evidence provided the routes it will check", () => {
    // Provided by the reporter `presentationReadiness()` adds in
    // vitest.config.ts; absent when the plugin is not in the run's config.
    expect(inject(READINESS_PROVIDE_KEY)).toEqual({
      srcDir: SRC,
      targets: readyRouteTargets(SRC),
    });
  });

  it("finds the real page modules (the route map is not vacuous)", () => {
    expect(PAGE_MODULES.get("/admin/coord")).toBe("app/(app)/admin/coord/page");
    expect(PAGE_MODULES.get("/digital-twin")).toBe(
      "app/(app)/digital-twin/page"
    );
  });
});
