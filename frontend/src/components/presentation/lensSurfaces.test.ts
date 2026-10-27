/**
 * The lens-surface registry (plan `2026-10-23-console-presentation-spaces`
 * D4, D5): the five lens pages in tour order, each titled from its caption —
 * and each one under a layout that actually mounts the lens.
 *
 * That last clause is a filesystem scan, because the defect it catches is an
 * ABSENCE: a lens page whose layout chain mounts no `PresentationLens` would
 * render every `OperatorOnly` child and every real hostname with
 * `?present=1` on its URL — the lens failing open — and nothing in the module
 * graph would notice. A route added to `LENS_SURFACES` later is checked with
 * no new test. The routes that do not exist yet (Phases 2, 6, 8 build them)
 * are checked through the layouts their directory will sit under.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTIONS } from "./captions";
import {
  LENS_SURFACES,
  TOUR_SURFACE,
  lensSurfaceForPath,
  presentationHref,
} from "./lensSurfaces";

/** `src/app/(app)` — every lens route lives in the authenticated group. */
const APP_GROUP = join(__dirname, "..", "..", "app", "(app)");
const APP_ROOT = dirname(APP_GROUP);

/** Every `layout.tsx` from the route's directory up to `src/app`. */
function layoutChain(route: string): {
  layouts: string[];
  deepestExisting: string;
} {
  const segments = route.split("/").filter(Boolean);
  let dir = join(APP_GROUP, ...segments);
  let deepestExisting = "";
  const layouts: string[] = [];
  for (;;) {
    if (existsSync(dir)) {
      if (!deepestExisting) deepestExisting = dir;
      const layout = join(dir, "layout.tsx");
      if (existsSync(layout)) layouts.push(layout);
    }
    if (dir === APP_ROOT) break;
    dir = dirname(dir);
  }
  return { layouts, deepestExisting };
}

function mountsLens(layout: string): boolean {
  const source = readFileSync(layout, "utf8").replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    ""
  );
  return /<PresentationLens\b/.test(source);
}

describe("LENS_SURFACES", () => {
  it("lists the five lens surfaces in tour order", () => {
    expect(LENS_SURFACES.map((s) => [s.id, s.route])).toEqual([
      ["digital-twin", "/digital-twin"],
      ["coordination-overview", "/admin/coord/home"],
      ["agentic-activity", "/admin/coord/spawns"],
      ["ui-bridge", "/admin/coord/ui-bridge"],
      ["dev-ops", "/admin/coord/devops"],
    ]);
  });

  it("captions each surface with its page caption, and takes the title from it", () => {
    for (const surface of [...LENS_SURFACES, TOUR_SURFACE]) {
      expect(surface.captionKey).toBe(`${surface.id}.page`);
      expect(surface.title).toBe(CAPTIONS[surface.captionKey].title);
    }
  });

  it("mounts the lens above every lens route and the tour", () => {
    for (const { route } of [...LENS_SURFACES, TOUR_SURFACE]) {
      const { layouts, deepestExisting } = layoutChain(route);
      // Not vacuous: the route's own tree exists below the group, even where
      // the leaf page is a later phase's.
      expect(deepestExisting, route).not.toBe("");
      expect(deepestExisting.length, route).toBeGreaterThan(APP_GROUP.length);
      expect(
        layouts.some(mountsLens),
        `${route}: no layout in [${layouts.join(", ")}] mounts <PresentationLens>`
      ).toBe(true);
    }
  });
});

describe("lensSurfaceForPath", () => {
  it("finds the surface for its route and anything below it", () => {
    expect(lensSurfaceForPath("/admin/coord/devops")?.id).toBe("dev-ops");
    expect(lensSurfaceForPath("/admin/coord/spawns/abc")?.id).toBe(
      "agentic-activity"
    );
    expect(lensSurfaceForPath("/digital-twin?present=1")?.id).toBe(
      "digital-twin"
    );
  });

  it("does not match a sibling route that merely shares a prefix", () => {
    expect(lensSurfaceForPath("/admin/coord/spawn")).toBeNull();
    expect(lensSurfaceForPath("/admin/coord/devops-old")).toBeNull();
    expect(lensSurfaceForPath("/admin/coord/pipeline")).toBeNull();
  });
});

describe("presentationHref", () => {
  it("adds ?present=1, or =0, keeping an existing query and hash", () => {
    expect(presentationHref("/admin/coord/devops")).toBe(
      "/admin/coord/devops?present=1"
    );
    expect(presentationHref("/digital-twin", false)).toBe(
      "/digital-twin?present=0"
    );
    expect(presentationHref("/admin/coord/spawns?window=24h#rows")).toBe(
      "/admin/coord/spawns?window=24h&present=1#rows"
    );
  });
});
