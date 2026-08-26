/**
 * The `/admin/coord/fleet` → `/admin/coord/pipeline` rename — Verification 10
 * of plan `2026-08-25-coord-console-intent-and-devops-sections` Phase 4.
 *
 * The tab has read `Pipeline` since the 2026-07-14 redesign. After Phase 4
 * "fleet" means Dev Ops and only Dev Ops, and one word meaning two things in
 * one console is exactly the predictability cost the style guide exists to
 * prevent.
 *
 * A rename is only safe if the old address still resolves and nothing in the
 * tree still points at it, so both halves are asserted:
 *
 *  1. `next.config.mjs` 308s the old path to the new one. Read from the config
 *     itself rather than trusted from a comment — a `redirects()` entry is
 *     matched before the filesystem, so this is the only thing making an old
 *     bookmark work.
 *  2. No module, Playwright spec or Spec-CI route list still names
 *     `/admin/coord/fleet`, `coord-fleet-page` or `coord-nav-fleet`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const FRONTEND = join(__dirname, "..", "..", "..", "..", "..", "..");

interface RedirectEntry {
  source: string;
  destination: string;
  permanent?: boolean;
}

describe("the old /admin/coord/fleet path", () => {
  it("308s to /admin/coord/pipeline", async () => {
    const config = (await import(
      /* @vite-ignore */ join(FRONTEND, "next.config.mjs")
    )) as {
      default: { redirects?: () => Promise<RedirectEntry[]> };
    };
    expect(typeof config.default.redirects).toBe("function");
    const redirects = await config.default.redirects!();
    const entry = redirects.find((r) => r.source === "/admin/coord/fleet");
    expect(entry).toBeDefined();
    expect(entry!.destination).toBe("/admin/coord/pipeline");
    // `permanent: true` is the 308 — a bookmark should stop asking.
    expect(entry!.permanent).toBe(true);
  });

  it("has a page at the new path and none at the old one", () => {
    expect(existsSync(join(__dirname, "page.tsx"))).toBe(true);
    expect(existsSync(join(__dirname, "..", "fleet", "page.tsx"))).toBe(false);
  });
});

describe("nothing still points at the old route or its testids", () => {
  const ROOTS = [
    join(FRONTEND, "src"),
    join(FRONTEND, "tests"),
    join(FRONTEND, "specs"),
  ];

  function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, out);
      } else if (/\.(ts|tsx|json)$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  /**
   * Unit tests are excluded, Playwright specs and Spec-CI route lists are not.
   *
   * A unit test may legitimately name an old id — `CoordNav.test.tsx` asserts
   * `coord-nav-fleet` is ABSENT, which is the opposite of a stale reference.
   * A `.spec.ts` or a derived `.json` naming it is a live selector that would
   * go red against the running app, which is exactly what this sweep is for.
   */
  const files = ROOTS.flatMap((r) => walk(r)).filter(
    (f) => !/\.test\.(ts|tsx)$/.test(f)
  );

  it("finds the trees it is asserting over", () => {
    // Without this the sweeps below would pass vacuously on an empty list.
    expect(files.length).toBeGreaterThan(300);
  });

  for (const [what, needle] of [
    ["the old route", "/admin/coord/fleet"],
    ["the old page testid", "coord-fleet-page"],
    ["the old nav testid", "coord-nav-fleet"],
  ] as const) {
    it(`no source, spec or route list names ${what}`, () => {
      const offenders = files
        .filter((f) => f !== __filename)
        .filter((f) => {
          // Comments explaining the rename are allowed to name the old path;
          // what must not survive is a live reference.
          const code = readFileSync(f, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/.*$/gm, "$1")
            .replace(/^\s*\*.*$/gm, "");
          return code.includes(needle);
        })
        .map((f) => f.slice(FRONTEND.length + 1));
      expect(offenders).toEqual([]);
    });
  }
});
