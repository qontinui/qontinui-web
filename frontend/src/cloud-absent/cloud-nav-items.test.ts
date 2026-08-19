/**
 * Reachability guard for the sidebar entries cloud-control contributes.
 *
 * This is the regression test for the defect Phase 4 fixed: `navItems`
 * advertised `/billing` and no route ever existed at that path, so the link
 * 404'd in every deployment for as long as the extension surface had one. A
 * nav entry pointing at nothing is invisible until someone clicks it, which
 * is exactly the failure a build-time assertion should catch.
 *
 * The route side has its own guard (`cloud-route-shims.test.ts`); this one
 * closes the loop by checking that every advertised destination is a path the
 * App Router actually serves. Both are build-time facts — file existence —
 * for the same reason: a mis-targeted nav item should be a red build, not a
 * 404 found in production.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cloudNavItems } from "@cloud/nav-items";

const FRONTEND = process.cwd();
const OVERLAY = path.resolve(FRONTEND, "node_modules/@qontinui/cloud-control");
const composed = fs.existsSync(path.join(OVERLAY, "package.json"));

/**
 * Every URL path the App Router serves, derived from the `page.tsx` tree.
 *
 * Route groups (`(app)`, `(marketing)`) and private folders (`_components`)
 * are not URL segments, so they are dropped; a `[param]` segment matches any
 * single value, so it becomes a `*` wildcard the comparison understands.
 */
function servedPaths(): string[] {
  const app = path.resolve(FRONTEND, "src/app");
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("_")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "page.tsx") {
        const segments = path
          .relative(app, path.dirname(full))
          .split(path.sep)
          .filter((s) => s.length > 0 && !s.startsWith("("))
          .map((s) => (s.startsWith("[") ? "*" : s));
        out.push("/" + segments.join("/"));
      }
    }
  };
  walk(app);
  return out;
}

function isServed(route: string, served: Set<string>): boolean {
  if (served.has(route)) return true;
  // A nav entry may target a dynamic route with a concrete id substituted in.
  const parts = route.split("/");
  return [...served].some((candidate) => {
    const c = candidate.split("/");
    return (
      c.length === parts.length &&
      c.every((seg, i) => seg === "*" || seg === parts[i])
    );
  });
}

describe("cloud nav items", () => {
  it.skipIf(!composed)("contributes entries in the composed build", () => {
    // Guards against the alias silently resolving to the OSS stub, which
    // would make every assertion below vacuously true.
    expect(cloudNavItems.length).toBeGreaterThan(0);
  });

  it.skipIf(composed)("contributes nothing in the OSS build", () => {
    expect(cloudNavItems).toEqual([]);
  });

  it("points every entry at a path the App Router serves", () => {
    const served = new Set(servedPaths());
    for (const item of cloudNavItems) {
      expect(
        isServed(item.route, served),
        `nav item "${item.label}" targets ${item.route}, which no page.tsx serves`
      ).toBe(true);
    }
  });

  it("does not duplicate a nav id the host already defines", async () => {
    // The host's own `/admin` entry is why cloud-control stopped contributing
    // one; a collision would render the item twice rather than fail.
    const { devNavItems } = await import(
      "@/components/navigation/sidebar/nav-items"
    );
    const hostIds = new Set(devNavItems.map((i) => i.id));
    const hostRoutes = new Set(devNavItems.map((i) => i.route));
    for (const item of cloudNavItems) {
      expect(hostIds.has(item.id), `duplicate nav id: ${item.id}`).toBe(false);
      expect(
        hostRoutes.has(item.route),
        `nav route ${item.route} is already a host entry (${item.id})`
      ).toBe(false);
    }
  });
});
