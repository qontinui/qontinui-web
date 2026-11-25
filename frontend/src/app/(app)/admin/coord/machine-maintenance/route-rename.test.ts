/**
 * The `/admin/coord/runners` → `/admin/coord/machine-maintenance` rename —
 * plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place` §D7.
 *
 * "Runner Drain" became "Maintenance": one page that pauses a machine's agent
 * work AND its CI. A rename is only safe if the old address still resolves
 * and nothing in the tree still points at it, so both halves are asserted:
 *
 *  1. `next.config.mjs` 308s the old path, carrying `?device=<id>` over as
 *     `?machine=<id>` — the page is keyed on `?machine=`, so a bookmark to a
 *     device must land on that device, not on an empty picker.
 *  2. No module, Playwright spec or Spec-CI route list still names the old
 *     route or its testids.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FRONTEND = join(__dirname, "..", "..", "..", "..", "..", "..");

interface RedirectEntry {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: { type: string; key: string; value?: string }[];
}

async function redirects(): Promise<RedirectEntry[]> {
  const config = (await import(
    /* @vite-ignore */ join(FRONTEND, "next.config.mjs")
  )) as { default: { redirects?: () => Promise<RedirectEntry[]> } };
  expect(typeof config.default.redirects).toBe("function");
  return config.default.redirects!();
}

describe("the old /admin/coord/runners path", () => {
  it("308s a ?device= link to ?machine=, BEFORE the bare redirect", async () => {
    const all = await redirects();
    const entries = all.filter((r) => r.source === "/admin/coord/runners");
    expect(entries).toHaveLength(2);
    const [withDevice, bare] = entries;
    // Order is the contract: Next takes the first match, so the query-carrying
    // entry must precede the bare one or it never fires.
    expect(withDevice.has).toEqual([
      { type: "query", key: "device", value: "(?<device>.+)" },
    ]);
    expect(withDevice.destination).toBe(
      "/admin/coord/machine-maintenance?machine=:device"
    );
    expect(withDevice.permanent).toBe(true);
    expect(bare.has).toBeUndefined();
    expect(bare.destination).toBe("/admin/coord/machine-maintenance");
    expect(bare.permanent).toBe(true);
  });

  it("has a page at the new path and none at the old one", () => {
    expect(existsSync(join(__dirname, "page.tsx"))).toBe(true);
    expect(existsSync(join(__dirname, "..", "runners", "page.tsx"))).toBe(
      false
    );
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
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|json)$/.test(entry)) out.push(full);
    }
    return out;
  }

  // Unit tests are excluded (a test may assert an old id is ABSENT);
  // Playwright specs and Spec-CI route lists are not.
  const files = ROOTS.flatMap((r) => walk(r)).filter(
    (f) => !/\.test\.(ts|tsx)$/.test(f)
  );

  it("finds the trees it is asserting over", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  for (const [what, needle] of [
    ["the old route", "/admin/coord/runners"],
    ["the old page testid", "coord-runners-page"],
    ["the old nav testid", "coord-nav-runners"],
  ] as const) {
    it(`no source, spec or route list names ${what}`, () => {
      const offenders = files
        .filter((f) => {
          // Comments explaining the rename may name the old path; a live
          // reference may not. `next.config.mjs` is not scanned (it is .mjs),
          // and it is where the old path legitimately lives, as a source.
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
