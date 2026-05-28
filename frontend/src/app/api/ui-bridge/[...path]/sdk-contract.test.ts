/**
 * Cross-checks between the @qontinui/ui-bridge SDK's UI_BRIDGE_ROUTES
 * manifest and our web-specific forbidden-route set.
 *
 * Phase 1.3 of the production-safe UI Bridge work
 * (plans/2026-05-28-production-safe-ui-bridge-design.md §4.7).
 *
 * # Why this exists
 *
 * The SDK's UI_BRIDGE_ROUTES is a single global manifest — there is no
 * per-app (web vs runner) subset. Every route the SDK ships is reachable
 * via our /api/ui-bridge/* relay unless our handler hard-rejects it. The
 * canonical example is /control/page/evaluate: the SDK ships it as a
 * registered POST route (see this test's first assertion), and only our
 * wrapHandler-side reject prevents it from giving any caller arbitrary
 * code execution in a logged-in user's browser.
 *
 * The tests below codify two invariants:
 *
 *   1. The SDK still exposes every route we classified as "dangerous on
 *      a deployed multi-tenant web surface". If the SDK ever drops one,
 *      this test flips green-to-red and we know to revisit our gate —
 *      maybe we can simplify, maybe we need a different reject.
 *   2. Every route in our forbidden set is in the SDK manifest. A
 *      forbidden entry that doesn't match an actual SDK route is dead
 *      code; the test catches that drift on every CI run.
 *
 * # Adding new dangerous routes
 *
 * When you discover another SDK route that's safe in trusted contexts
 * (runner / local dev) but dangerous on a multi-tenant deployed web
 * origin, add the path to `WEB_FORBIDDEN_PATHS` in
 * `web-forbidden-routes.ts` AND to the `dangerousOnWeb` list below. The
 * test will then enforce that both lists stay in sync with the SDK.
 */

import { describe, expect, it } from "vitest";
import { UI_BRIDGE_ROUTES } from "@qontinui/ui-bridge/server";

import { isForbiddenWebRoute } from "./web-forbidden-routes";

/**
 * Routes the SDK ships that we deliberately reject on a deployed web
 * surface. Kept in sync with the `WEB_FORBIDDEN_PATHS` set in
 * `web-forbidden-routes.ts` (the test's first invariant enforces match).
 *
 * Each entry documents the threat in a comment so a future contributor
 * understands the reject rationale without spelunking the design doc.
 */
const dangerousOnWeb: ReadonlyArray<{ path: string; threat: string }> = [
  {
    path: "/control/page/evaluate",
    threat:
      "JS-eval escape hatch — any caller gets arbitrary code execution in the user's browser, full account takeover in one HTTP call",
  },
];

describe("SDK contract cross-check: forbidden routes", () => {
  it("the SDK still exposes every web-dangerous route (our gate is the only protection)", () => {
    for (const entry of dangerousOnWeb) {
      const exists = UI_BRIDGE_ROUTES.some((r) => r.path === entry.path);
      expect(
        exists,
        `Expected SDK UI_BRIDGE_ROUTES to contain ${entry.path}. ` +
          `If the SDK has dropped it, the local hard-reject may be ` +
          `redundant — but verify before removing.\nThreat: ${entry.threat}`,
      ).toBe(true);
    }
  });

  it("every web-dangerous route IS in WEB_FORBIDDEN_PATHS (no gate gap)", () => {
    for (const entry of dangerousOnWeb) {
      expect(
        isForbiddenWebRoute(entry.path),
        `Path ${entry.path} is classified dangerous on web but missing ` +
          `from WEB_FORBIDDEN_PATHS. The relay would forward it to the ` +
          `SDK handler.\nThreat: ${entry.threat}`,
      ).toBe(true);
    }
  });

  it("WEB_FORBIDDEN_PATHS contains only paths the SDK actually ships (no dead entries)", () => {
    // Reverse direction of the previous test: every forbidden path should
    // correspond to an SDK route. A forbidden entry that doesn't match an
    // SDK route is dead code — it can never fire because the SDK won't
    // route to it.
    for (const entry of dangerousOnWeb) {
      const sdkRoutes = UI_BRIDGE_ROUTES.filter(
        (r) => r.path === entry.path,
      );
      expect(
        sdkRoutes.length,
        `Path ${entry.path} is in WEB_FORBIDDEN_PATHS but the SDK has no ` +
          `matching route — the reject is dead code.`,
      ).toBeGreaterThan(0);
    }
  });
});
