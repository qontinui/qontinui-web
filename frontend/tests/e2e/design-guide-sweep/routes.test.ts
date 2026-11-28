/**
 * Unit tests for the design-guide sweep's route enumeration (./routes.ts).
 * Pure functions, no Playwright: collected by vitest through the
 * `tests/e2e/**\/*.test.ts` include in vitest.config.ts.
 *
 * The load-bearing assertions are the literals: a route group adds no URL
 * segment, and a dynamic segment is recorded `not_swept`, never swept and never
 * dropped. A sweep that kept `(app)` in its URLs would send every static `(app)`
 * route (223 at 7e3c67a73, of 260 `(app)` pages) to a 404 and report that as
 * the app's design.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { enumerate, listPageFiles, routeOf, slugOf } from "./routes";

describe("routeOf", () => {
  it("strips a route group", () => {
    expect(routeOf("(app)/admin/coord/page.tsx")).toEqual({
      kind: "static",
      route: "/admin/coord",
      file: "(app)/admin/coord/page.tsx",
    });
  });

  it("maps a group's own page to the root", () => {
    expect(routeOf("(marketing)/page.tsx")).toEqual({
      kind: "static",
      route: "/",
      file: "(marketing)/page.tsx",
    });
    expect(routeOf("page.tsx")).toEqual({
      kind: "static",
      route: "/",
      file: "page.tsx",
    });
  });

  it("records a dynamic segment as not_swept, keeping its file", () => {
    expect(routeOf("foo/[id]/page.tsx")).toEqual({
      kind: "not_swept",
      route: "/foo/[id]",
      file: "foo/[id]/page.tsx",
      reason: "dynamic segment",
    });
    expect(routeOf("(app)/docs/[...slug]/page.tsx")).toMatchObject({
      kind: "not_swept",
      route: "/docs/[...slug]",
    });
    expect(routeOf("shop/[[...rest]]/page.tsx")).toMatchObject({
      kind: "not_swept",
      reason: "dynamic segment",
    });
  });

  it("drops a parallel-route slot from the URL", () => {
    expect(routeOf("(app)/dash/@panel/stats/page.tsx")).toMatchObject({
      kind: "static",
      route: "/dash/stats",
    });
    expect(routeOf("@modal/page.tsx")).toMatchObject({
      kind: "static",
      route: "/",
    });
  });

  it("opts a private folder out of routing, and keeps an escaped underscore", () => {
    expect(routeOf("(app)/_components/demo/page.tsx")).toEqual({
      kind: "not_a_route",
      file: "(app)/_components/demo/page.tsx",
      reason: "private folder",
    });
    expect(routeOf("%5Finternal/page.tsx")).toMatchObject({
      kind: "static",
      route: "/_internal",
    });
  });

  it("records an intercepting route as not_swept, under the URL it intercepts", () => {
    expect(routeOf("feed/(..)photo/page.tsx")).toEqual({
      kind: "not_swept",
      route: "/photo",
      file: "feed/(..)photo/page.tsx",
      reason: "intercepting route",
    });
    expect(routeOf("feed/(.)photo/page.tsx")).toMatchObject({
      route: "/feed/photo",
      reason: "intercepting route",
    });
    // Groups and slots are not route segments, so `(..)` climbs past neither.
    expect(routeOf("(app)/a/(shop)/b/(..)(..)x/page.tsx")).toMatchObject({
      route: "/x",
    });
    expect(routeOf("a/b/@m/(...)x/page.tsx")).toMatchObject({ route: "/x" });
  });

  it("accepts either separator and refuses a non-page file", () => {
    expect(routeOf("(app)\\settings\\page.tsx")).toMatchObject({
      route: "/settings",
    });
    expect(() => routeOf("(app)/settings/page.test.tsx")).toThrow(
      /not a page file/
    );
    expect(() => routeOf("(app)/settings/layout.tsx")).toThrow(
      /not a page file/
    );
  });
});

describe("enumerate", () => {
  it("puts every file in exactly one list and merges files that share a URL", () => {
    const files = [
      "(app)/admin/coord/page.tsx",
      "(marketing)/page.tsx",
      "@modal/page.tsx",
      "foo/[id]/page.tsx",
      "_lib/page.tsx",
    ];
    const e = enumerate(files);
    expect(e.page_count).toBe(5);
    expect(e.static_routes).toEqual([
      { route: "/", files: ["(marketing)/page.tsx", "@modal/page.tsx"] },
      { route: "/admin/coord", files: ["(app)/admin/coord/page.tsx"] },
    ]);
    expect(e.not_swept).toEqual([
      {
        route: "/foo/[id]",
        file: "foo/[id]/page.tsx",
        reason: "dynamic segment",
      },
    ]);
    expect(e.not_a_route).toEqual([
      { file: "_lib/page.tsx", reason: "private folder" },
    ]);
  });

  it("enumerates the real app tree without throwing, and finds its root page", () => {
    const appDir = path.resolve(__dirname, "../../../src/app");
    const e = enumerate(listPageFiles(appDir));
    expect(e.page_count).toBeGreaterThan(0);
    expect(e.static_routes.map((r) => r.route)).toContain("/");
    const listed =
      e.static_routes.reduce((n, r) => n + r.files.length, 0) +
      e.not_swept.length +
      e.not_a_route.length;
    expect(listed).toBe(e.page_count);
  });
});

describe("slugOf", () => {
  it("is file-name safe", () => {
    expect(slugOf("/")).toBe("r~");
    expect(slugOf("/index")).toBe("r~index");
    expect(slugOf("/admin/coord")).toBe("r~admin~coord");
    expect(slugOf("/a~b")).toBe("r~a%7Eb");
    expect(slugOf("/a%7Eb")).toBe("r~a%257Eb");
  });

  it("escapes non-ASCII at a fixed width, so code-unit lengths cannot collide", () => {
    // U+0011 then "9" versus U+0119: a variable-width code-unit escape writes
    // both as `%119`.
    const a = "/\u00119";
    const b = "/ę";
    expect(slugOf(a)).toBe("r~%119");
    expect(slugOf(b)).toBe("r~%C4%99");
    expect(slugOf(a)).not.toBe(slugOf(b));
    expect(slugOf("/café")).toBe("r~caf%C3%A9");
    expect(slugOf("/\u{1F600}")).toBe("r~%F0%9F%98%80");
  });

  it("never gives two routes one slug", () => {
    const routes = [
      "/",
      "/index",
      "/root",
      "/r",
      "/a/b",
      "/a~b",
      "/a%7Eb",
      "/a%2Fb",
      "/_x",
      "/%5Fx",
    ];
    expect(new Set(routes.map(slugOf)).size).toBe(routes.length);
    const real = enumerate(
      listPageFiles(path.resolve(__dirname, "../../../src/app"))
    );
    const slugs = real.static_routes.map((r) => slugOf(r.route));
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
