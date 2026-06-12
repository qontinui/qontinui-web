/**
 * Unit contract for the browser-required short-circuit — the deterministic
 * home of what `tests/e2e/ui-bridge-search.spec.ts` used to assert via a
 * live POST. In the E2E dev server, `enableRemoteCommands` defaults to
 * true and tabs auto-attach to the relay, so "no relay client attached"
 * is not a guaranteeable premise there (the E2E version was order/timing
 * flaky: an attached-but-unresponsive tab sent discover down the
 * relay-wait path and past the test timeout). Here the route set and the
 * NO_BROWSER_CONNECTED envelope are pinned with zero environment.
 */

import { describe, it, expect } from "vitest";
import {
  isBrowserRequiredRoute,
  isKnownRoute,
  noBrowserResponse,
  unknownRouteResponse,
} from "./_browser-required";

describe("isBrowserRequiredRoute", () => {
  it("claims the registry-backed routes (class 1)", () => {
    expect(isBrowserRequiredRoute("/control/components", "GET")).toBe(true);
    expect(isBrowserRequiredRoute("/control/snapshot", "GET")).toBe(true);
    expect(isBrowserRequiredRoute("/control/discover", "POST")).toBe(true);
  });

  it("claims the id-lookup-backed route (class 2)", () => {
    expect(isBrowserRequiredRoute("/control/element/btn-42", "GET")).toBe(
      true,
    );
  });

  it("claims the relay-backed routes (class 3)", () => {
    expect(isBrowserRequiredRoute("/ai/wait-for-element", "POST")).toBe(true);
    expect(isBrowserRequiredRoute("/ai/idle-status", "GET")).toBe(true);
  });

  it("does not claim the same paths under the wrong method", () => {
    expect(isBrowserRequiredRoute("/control/discover", "GET")).toBe(false);
    expect(isBrowserRequiredRoute("/control/components", "POST")).toBe(false);
    expect(isBrowserRequiredRoute("/ai/idle-status", "POST")).toBe(false);
  });

  it("does not claim server-side-populated routes", () => {
    // Transport diagnostics, app metadata, and spec discovery answer
    // meaningfully with no browser attached — they must never be added
    // to the browser-required set.
    expect(isBrowserRequiredRoute("/health", "GET")).toBe(false);
    expect(isBrowserRequiredRoute("/app-info", "GET")).toBe(false);
    expect(isBrowserRequiredRoute("/specs", "GET")).toBe(false);
    expect(isBrowserRequiredRoute("/tabs", "GET")).toBe(false);
  });

  it("anchors the element route to exactly one id segment", () => {
    expect(isBrowserRequiredRoute("/control/element/a/state", "GET")).toBe(
      false,
    );
    expect(isBrowserRequiredRoute("/control/element/", "GET")).toBe(false);
  });
});

describe("noBrowserResponse", () => {
  it("returns the canonical NO_BROWSER_CONNECTED 503 envelope", async () => {
    const res = noBrowserResponse("/control/discover");
    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("NO_BROWSER_CONNECTED");
    expect(body.message).toContain("/control/discover");
  });
});

describe("isKnownRoute", () => {
  it("does not claim /ai/forms — there is no such route in the SDK contract", () => {
    expect(isKnownRoute("/ai/forms", "GET")).toBe(false);
    expect(isKnownRoute("/ai/forms", "POST")).toBe(false);
  });

  it("claims the real forms routes so they still proxy to the SDK", () => {
    expect(isKnownRoute("/control/forms", "GET")).toBe(true);
    expect(isKnownRoute("/control/forms/snapshot", "POST")).toBe(true);
    expect(isKnownRoute("/control/forms/diff", "POST")).toBe(true);
  });

  it("claims SDK-manifest routes and relay-transport routes alike", () => {
    expect(isKnownRoute("/control/discover", "POST")).toBe(true);
    expect(isKnownRoute("/control/element/btn-42", "GET")).toBe(true);
    // Relay-transport set (not in UI_BRIDGE_ROUTES):
    expect(isKnownRoute("/tabs", "GET")).toBe(true);
    expect(isKnownRoute("/commands/stream", "GET")).toBe(true);
  });

  it("rejects known paths under the wrong method", () => {
    expect(isKnownRoute("/control/forms", "POST")).toBe(false);
    expect(isKnownRoute("/commands", "GET")).toBe(false);
  });
});

describe("unknownRouteResponse", () => {
  it("returns an honest UNKNOWN_ROUTE 404, distinct from NO_BROWSER_CONNECTED", async () => {
    const res = unknownRouteResponse("/control/no-such-route");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("UNKNOWN_ROUTE");
    expect(body.message).toContain("/control/no-such-route");
  });

  it("points /ai/forms callers at the real route, GET /control/forms", async () => {
    const res = unknownRouteResponse("/ai/forms");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("UNKNOWN_ROUTE");
    expect(body.message).toContain("GET /control/forms");
  });
});
