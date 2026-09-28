import { describe, expect, it } from "vitest";

import {
  DEV_DEFAULTS,
  isDeployBuild,
  resolveUpstream,
  rewriteDestination,
  unresolvedRoute,
} from "./backend-rewrite.mjs";

describe("resolveUpstream", () => {
  it("prefers BACKEND_URL, then NEXT_PUBLIC_API_URL, trimming a trailing slash", () => {
    expect(
      resolveUpstream("backend", {
        BACKEND_URL: "http://b.internal/",
        NEXT_PUBLIC_API_URL: "https://api.example.com",
      })
    ).toEqual({ kind: "url", url: "http://b.internal" });
    expect(
      resolveUpstream("backend", {
        NEXT_PUBLIC_API_URL: "https://api.example.com",
      })
    ).toEqual({ kind: "url", url: "https://api.example.com" });
    expect(
      resolveUpstream("coord", { COORD_URL: "https://coord.example" })
    ).toEqual({
      kind: "url",
      url: "https://coord.example",
    });
  });

  it.each([
    [{ VERCEL_ENV: "production" }],
    [{ VERCEL_ENV: "preview" }],
    [{ QONTINUI_DEPLOY_BUILD: "1", NODE_ENV: "production" }],
    // A deploy build refuses even if something set NODE_ENV=development.
    [{ QONTINUI_DEPLOY_BUILD: "1", NODE_ENV: "development" }],
  ])("throws on a deploy build with the upstream unset (%o)", (env) => {
    expect(() => resolveUpstream("backend", env)).toThrow(
      /misconfigured.*Set BACKEND_URL \(or NEXT_PUBLIC_API_URL\)/
    );
    expect(() => resolveUpstream("coord", env)).toThrow(/Set COORD_URL/);
  });

  it("treats a blank value as unset", () => {
    expect(() =>
      resolveUpstream("backend", {
        VERCEL_ENV: "production",
        BACKEND_URL: "  ",
      })
    ).toThrow(/BACKEND_URL/);
  });

  it("keeps the dev default only under NODE_ENV=development", () => {
    expect(resolveUpstream("backend", { NODE_ENV: "development" })).toEqual({
      kind: "url",
      url: DEV_DEFAULTS.backend,
    });
    expect(resolveUpstream("coord", { NODE_ENV: "development" })).toEqual({
      kind: "url",
      url: DEV_DEFAULTS.coord,
    });
  });

  it("rewrites to the internal 503 route on a non-deploy production build", () => {
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "test" }, {}]) {
      expect(resolveUpstream("backend", env)).toEqual({
        kind: "unresolved",
        route: "/api/endpoint-unresolved/backend",
      });
      expect(resolveUpstream("coord", env)).toEqual({
        kind: "unresolved",
        route: "/api/endpoint-unresolved/coord",
      });
    }
  });

  it("never yields a loopback destination outside development", () => {
    const r = resolveUpstream("backend", { NODE_ENV: "production" });
    expect(rewriteDestination(r, "/api/:path*")).not.toMatch(
      /localhost|127\.0\.0\.1/
    );
  });
});

describe("helpers", () => {
  it("isDeployBuild", () => {
    expect(isDeployBuild({ VERCEL_ENV: "development" })).toBe(false);
    expect(isDeployBuild({})).toBe(false);
    expect(isDeployBuild({ QONTINUI_DEPLOY_BUILD: "1" })).toBe(true);
  });

  it("rewriteDestination", () => {
    expect(
      rewriteDestination({ kind: "url", url: "http://b" }, "/api/:path*")
    ).toBe("http://b/api/:path*");
    expect(
      rewriteDestination(
        { kind: "unresolved", route: unresolvedRoute("backend") },
        "/x"
      )
    ).toBe("/api/endpoint-unresolved/backend");
  });
});
