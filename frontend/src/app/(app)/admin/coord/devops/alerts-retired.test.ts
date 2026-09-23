/**
 * The retired `/admin/coord/alerts` page — plan
 * `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work` D7
 * and Phase 8.
 *
 * The raw alert list is agents' work, so its operator page is deleted; the
 * operator's rollup of it is the Conditions panel on this route. A retirement
 * is only safe if the old address still resolves and nothing still points at
 * it, so both halves are asserted — the same shape as
 * `pipeline/route-rename.test.ts`:
 *
 *  1. `next.config.mjs` 308s `/admin/coord/alerts` to `/admin/coord/devops`.
 *  2. No page exists at the old path, and no module, Playwright spec or
 *     Spec-CI route list names the old route or its page testid.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FRONTEND = join(__dirname, "..", "..", "..", "..", "..", "..");

interface RedirectEntry {
  source: string;
  destination: string;
  permanent?: boolean;
}

describe("the retired /admin/coord/alerts path", () => {
  it("308s to /admin/coord/devops", async () => {
    const config = (await import(
      /* @vite-ignore */ join(FRONTEND, "next.config.mjs")
    )) as {
      default: { redirects?: () => Promise<RedirectEntry[]> };
    };
    expect(typeof config.default.redirects).toBe("function");
    const redirects = await config.default.redirects!();
    const entry = redirects.find((r) => r.source === "/admin/coord/alerts");
    expect(entry).toBeDefined();
    expect(entry!.destination).toBe("/admin/coord/devops");
    // `permanent: true` is the 308 — a bookmark should stop asking.
    expect(entry!.permanent).toBe(true);
  });

  it("has no page at the old path, and a page at the new one", () => {
    expect(existsSync(join(__dirname, "page.tsx"))).toBe(true);
    expect(existsSync(join(__dirname, "..", "alerts", "page.tsx"))).toBe(false);
  });
});

describe("nothing still points at the retired route or its page testid", () => {
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
   * Unit tests are excluded — several assert the old route is ABSENT, which is
   * the opposite of a stale reference. The generated OpenAPI snapshots are
   * excluded too: they carry backend docstrings as prose, not links. A
   * `.spec.ts` or a Spec-CI route list naming the route is a live selector
   * that would go red against the running app, which is what this sweep is
   * for.
   */
  /**
   * The one Playwright spec allowed to name the retired route: it asserts the
   * redirect against the running app, and a redirect test has to name its
   * source. Exempted by exact path, so a SECOND spec naming it still fails.
   */
  const REDIRECT_SPEC = join(
    FRONTEND,
    "tests",
    "e2e",
    "pages",
    "admin-coord-retired-routes.spec.ts"
  );

  const files = ROOTS.flatMap((r) => walk(r)).filter(
    (f) =>
      !/\.test\.(ts|tsx)$/.test(f) &&
      !/openapi-schema[^/\\]*\.json$/.test(f) &&
      f !== REDIRECT_SPEC
  );

  it("still sees the redirect spec it exempts (the exemption is not stale)", () => {
    expect(existsSync(REDIRECT_SPEC)).toBe(true);
  });

  it("finds the trees it is asserting over", () => {
    // Without this the sweeps below would pass vacuously on an empty list.
    expect(files.length).toBeGreaterThan(300);
  });

  for (const [what, needle] of [
    ["the retired route", "/admin/coord/alerts"],
    ["the retired page testid", "coord-alerts-page"],
  ] as const) {
    it(`no source, spec or route list names ${what}`, () => {
      const offenders = files
        .filter((f) => {
          // Comments explaining the retirement may name the old path; what
          // must not survive is a live reference.
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
