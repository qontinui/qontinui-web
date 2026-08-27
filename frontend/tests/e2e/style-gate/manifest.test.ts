/**
 * Unit tests for the style-gate routes-manifest contract
 * (tests/e2e/style-gate/manifest.ts). Pure functions, no Playwright — runs
 * under vitest (`npm test`) via the dedicated `tests/e2e/**\/*.test.ts` include
 * in vitest.config.ts, same as `normalize.test.ts`.
 *
 * The load-bearing assertion is the lane selection: `public: true` MUST select
 * the relay-INDEPENDENT (injected) capture and `public: false` MUST still
 * select the relay capture. Getting that backwards would either 503 every
 * public route (relay on a signed-out tab) or silently swap the three
 * authenticated seed routes onto an unauthenticated context — capturing the
 * login screen byte-for-byte, which is the exact P0 the relay lane's
 * `assertNotLoginSurface` guard exists to prevent.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  capturePathFor,
  parseRoutesManifest,
  partitionRoutesByCapturePath,
  type StyleGateRoute,
} from "./manifest";

/** Minimal valid route; each test overrides only what it is about. */
function route(overrides: Partial<StyleGateRoute> = {}): StyleGateRoute {
  return {
    id: "example",
    path: "/example",
    public: false,
    settleMs: 3000,
    ...overrides,
  };
}

describe("capturePathFor", () => {
  it("selects the relay-INDEPENDENT (injected) path for public: true", () => {
    expect(capturePathFor(route({ public: true }))).toBe("injected");
  });

  it("selects the relay path for public: false", () => {
    expect(capturePathFor(route({ public: false }))).toBe("relay");
  });

  it("throws on a missing `public` field rather than defaulting", () => {
    const malformed = { id: "oops", path: "/oops", settleMs: 0 };
    expect(() =>
      capturePathFor(malformed as unknown as StyleGateRoute)
    ).toThrow(/public=undefined/);
  });

  it("throws on a non-boolean `public` field", () => {
    expect(() =>
      capturePathFor(route({ public: "true" as unknown as boolean }))
    ).toThrow(/must be a boolean/);
  });
});

describe("partitionRoutesByCapturePath", () => {
  it("splits routes into the two lanes, preserving order", () => {
    const routes = [
      route({ id: "a", public: false }),
      route({ id: "b", public: true }),
      route({ id: "c", public: false }),
      route({ id: "d", public: true }),
    ];
    const { relay, injected } = partitionRoutesByCapturePath(routes);
    expect(relay.map((r) => r.id)).toEqual(["a", "c"]);
    expect(injected.map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("returns empty lanes for an empty manifest", () => {
    expect(partitionRoutesByCapturePath([])).toEqual({
      relay: [],
      injected: [],
    });
  });

  it("propagates the malformed-entry error instead of dropping the route", () => {
    // The pre-injected-lane code was `routes.filter(r => r.public === false)`,
    // which silently DROPPED an entry with no `public` field — a gated route
    // vanishing from CI with no signal. Partition must be loud instead.
    const routes = [
      route({ id: "ok" }),
      { id: "bad", path: "/bad", settleMs: 0 } as unknown as StyleGateRoute,
    ];
    expect(() => partitionRoutesByCapturePath(routes)).toThrow(/"bad"/);
  });
});

describe("parseRoutesManifest", () => {
  it("parses a well-formed manifest", () => {
    const raw = JSON.stringify({ routes: [route({ id: "x" })] });
    expect(parseRoutesManifest(raw).map((r) => r.id)).toEqual(["x"]);
  });

  it("rejects a manifest without a routes array", () => {
    expect(() => parseRoutesManifest(JSON.stringify({}))).toThrow(/malformed/);
    expect(() => parseRoutesManifest(JSON.stringify({ routes: {} }))).toThrow(
      /malformed/
    );
  });
});

describe("the COMMITTED routes.json", () => {
  const routes = parseRoutesManifest(
    readFileSync(join(__dirname, "routes.json"), "utf8")
  );

  it("parses and declares a boolean `public` on every entry", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(typeof r.public, `route ${r.id}`).toBe("boolean");
      expect(typeof r.id).toBe("string");
      expect(r.path.startsWith("/"), `route ${r.id} path`).toBe(true);
    }
  });

  it("keeps every authenticated seed route on the relay lane", () => {
    const { relay } = partitionRoutesByCapturePath(routes);
    // These three are the burn-in set the workflow scores; moving any of them
    // to the injected lane would capture them signed-out.
    expect(relay.map((r) => r.id)).toEqual(
      expect.arrayContaining(["co-pilot", "build-workflows", "library"])
    );
  });

  it("captures the /login seed route through the injected lane", () => {
    const { injected } = partitionRoutesByCapturePath(routes);
    const login = injected.find((r) => r.id === "login");
    expect(
      login,
      "routes.json must declare the public /login seed"
    ).toBeDefined();
    expect(login?.path).toBe("/login");
    expect(capturePathFor(login as StyleGateRoute)).toBe("injected");
  });

  it("gives every route a unique id (ids are artifact basenames)", () => {
    const ids = routes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
