/**
 * Tests for the UI Bridge web surface's permanently-forbidden-route boundary.
 *
 * The relay route handler short-circuits these paths with 403
 * ROUTE_FORBIDDEN_ON_WEB before consulting the SDK route table. These tests
 * lock the property so a future SDK upgrade that adds e.g.
 * `/control/page/evaluate` to web's UI_BRIDGE_ROUTES manifest cannot silently
 * re-enable arbitrary code execution in a logged-in user's browser.
 *
 * Cross-link: `plans/2026-05-28-production-safe-ui-bridge-design.md` §4.7.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDeployedWebSurface,
  isForbiddenWebRoute,
  isWebRouteRejected,
  forbiddenWebRouteResponse,
} from "./web-forbidden-routes";

describe("isForbiddenWebRoute", () => {
  it("forbids /control/page/evaluate", () => {
    expect(isForbiddenWebRoute("/control/page/evaluate")).toBe(true);
  });

  it("allows ordinary SDK control routes", () => {
    expect(isForbiddenWebRoute("/control/snapshot")).toBe(false);
    expect(isForbiddenWebRoute("/control/elements")).toBe(false);
    expect(isForbiddenWebRoute("/control/element/btn-1/action")).toBe(false);
    expect(isForbiddenWebRoute("/control/page/navigate")).toBe(false);
    expect(isForbiddenWebRoute("/control/page/refresh")).toBe(false);
  });

  it("does not match by substring", () => {
    // Subtle: a substring match would re-enable evaluate via path
    // smuggling. The Set lookup is exact-match-only and these must
    // all stay allowed.
    expect(isForbiddenWebRoute("/control/page/evaluate-something")).toBe(false);
    expect(isForbiddenWebRoute("/something/control/page/evaluate")).toBe(false);
    expect(isForbiddenWebRoute("/control/page/evaluate/")).toBe(false);
  });

  it("is case-sensitive", () => {
    // Next.js routes are case-sensitive by default; the forbidden set
    // matches that contract. Documents the property — if we ever switch
    // to case-insensitive routing, this test catches the divergence.
    expect(isForbiddenWebRoute("/Control/Page/Evaluate")).toBe(false);
    expect(isForbiddenWebRoute("/CONTROL/PAGE/EVALUATE")).toBe(false);
  });

  it("returns false for empty and root paths", () => {
    expect(isForbiddenWebRoute("")).toBe(false);
    expect(isForbiddenWebRoute("/")).toBe(false);
  });
});

describe("forbiddenWebRouteResponse", () => {
  it("returns HTTP 403", () => {
    const response = forbiddenWebRouteResponse("/control/page/evaluate");
    expect(response.status).toBe(403);
  });

  it("sets Content-Type to application/json", () => {
    const response = forbiddenWebRouteResponse("/control/page/evaluate");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("carries the documented envelope shape", async () => {
    const response = forbiddenWebRouteResponse("/control/page/evaluate");
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      code: "ROUTE_FORBIDDEN_ON_WEB",
      message: "/control/page/evaluate is not available on the web UI Bridge surface",
    });
  });

  it("echoes the path in the message", async () => {
    // The message field embeds the requested path so callers can
    // distinguish which forbidden route they hit if the set ever grows
    // beyond one entry.
    const response = forbiddenWebRouteResponse("/some/other/forbidden/path");
    const body = await response.json();
    expect(body.message).toContain("/some/other/forbidden/path");
    expect(body.code).toBe("ROUTE_FORBIDDEN_ON_WEB");
  });
});

describe("isDeployedWebSurface", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is true on a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDeployedWebSurface()).toBe(true);
  });

  it("is false under local next dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDeployedWebSurface()).toBe(false);
  });

  it("is false in the test environment", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(isDeployedWebSurface()).toBe(false);
  });
});

describe("isWebRouteRejected", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects /control/page/evaluate ONLY on a deployed surface", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isWebRouteRejected("/control/page/evaluate")).toBe(true);
  });

  it("allows /control/page/evaluate under local next dev (full UI Bridge power)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isWebRouteRejected("/control/page/evaluate")).toBe(false);
  });

  it("never rejects ordinary control routes, in any environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isWebRouteRejected("/control/snapshot")).toBe(false);
    expect(isWebRouteRejected("/control/page/navigate")).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(isWebRouteRejected("/control/snapshot")).toBe(false);
  });
});
