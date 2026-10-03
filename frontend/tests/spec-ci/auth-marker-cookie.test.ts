import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_MARKER_COOKIE,
  type CookieContext,
  seedAuthMarkerCookie,
} from "./auth-marker-cookie";

/**
 * The post-deploy smokes roll production back on a bounce to /login. A marker
 * cookie set only from an init script misses the first request, so the first
 * route transits /login and reads as a bounce. These pin the context-level
 * seed and the cookie name the middleware actually reads.
 */

function recordingContext() {
  const calls: Parameters<CookieContext["addCookies"]>[0][] = [];
  const context: CookieContext = {
    addCookies: async (cookies) => {
      calls.push(cookies);
    },
  };
  return { context, calls };
}

describe("seedAuthMarkerCookie", () => {
  it("adds the marker cookie to the context for the smoke's origin", async () => {
    const { context, calls } = recordingContext();

    await seedAuthMarkerCookie(context, "https://qontinui.io/");

    expect(calls).toEqual([
      [
        {
          name: "qontinui_auth",
          value: "1",
          url: "https://qontinui.io",
          sameSite: "Lax",
        },
      ],
    ]);
  });

  it("scopes the cookie to the origin, dropping any path in the base URL", async () => {
    const { context, calls } = recordingContext();

    await seedAuthMarkerCookie(
      context,
      "https://preview.example.com/some/path"
    );

    expect(calls[0][0].url).toBe("https://preview.example.com");
  });

  it("uses the cookie name middleware.ts gates protected routes on", () => {
    const middleware = readFileSync(
      join(__dirname, "../../src/middleware.ts"),
      "utf8"
    );

    expect(middleware).toContain(
      `request.cookies.get("${AUTH_MARKER_COOKIE}")`
    );
  });

  it("matches the name the app's token storage writes", () => {
    const tokenStorage = readFileSync(
      join(__dirname, "../../src/services/auth/token-storage.ts"),
      "utf8"
    );

    expect(tokenStorage).toContain(
      `AUTH_MARKER_COOKIE = "${AUTH_MARKER_COOKIE}"`
    );
  });
});

describe("the smokes seed the cookie on the context before navigating", () => {
  // Source-level, because the smokes are scripts run against production and
  // have no harness to drive here. What matters is the ORDER: the context
  // seed must come before the first `page.goto`.
  for (const script of [
    "verify-deploy-authed-smoke.ts",
    "verify-operator-smoke.ts",
  ]) {
    it(script, () => {
      const source = readFileSync(join(__dirname, script), "utf8");
      const seed = source.indexOf("await seedAuthMarkerCookie(context,");
      const firstGoto = source.indexOf("page.goto(");

      expect(seed).toBeGreaterThan(-1);
      expect(firstGoto).toBeGreaterThan(-1);
      expect(seed).toBeLessThan(firstGoto);
    });
  }
});
