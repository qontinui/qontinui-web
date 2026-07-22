/**
 * Integration tests for the THREE-STATE auth gate on the
 * /api/ui-bridge/[...path] route handler (remediation item W1).
 *
 * The bug this locks out: every non-2xx from the identity backend used to be
 * collapsed into a `401 UNAUTHENTICATED`. So a 429 (the backend rate-limiting
 * the relay) or a 5xx (the backend falling over) was reported to the caller as
 * an AUTH FAILURE — telling an operator holding a perfectly valid token that
 * their token was bad, and sending anyone debugging a backend outage after the
 * wrong bug entirely.
 *
 * An upstream error is not an auth verdict. These tests assert the route
 * distinguishes the two end-to-end, through `wrapHandler`:
 *
 *   - backend says "no" (401)  → 401 UNAUTHENTICATED   (the only real 401)
 *   - backend says nothing (429) → 429, `Retry-After` preserved
 *   - backend says nothing (5xx) → the real 5xx, NEVER a 401
 *
 * The unit-level contract lives in `_auth.test.ts`; this file proves the route
 * actually surfaces it on the wire rather than flattening it on the way out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { __resetAuthCache } from "./_auth";

/**
 * The route handler instantiates a CommandRelay at module load that tries to
 * dial Redis for the relay bus. Mock the module so the import is
 * side-effect-free and the route gets a no-op relay it can call without
 * touching the network. (Same shape as `route.audit-rl.test.ts` — the two
 * files keep their own mocks on purpose: independent unit boundaries.)
 */
vi.mock("@/lib/ui-bridge/relay", () => {
  const fakeHandler = async () =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return {
    relay: {
      hasCommandListeners: () => true,
      getWebSocketClientCount: () => 1,
    },
    handlers: {
      GET: fakeHandler,
      POST: fakeHandler,
      PUT: fakeHandler,
      DELETE: fakeHandler,
    },
    getRelayBusStatus: () => "in-memory",
  };
});

vi.mock("@qontinui/ui-bridge/server", () => {
  const fakeHandler = async () =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return {
    createNextRouteHandlers: () => ({
      GET: fakeHandler,
      POST: fakeHandler,
      PUT: fakeHandler,
      DELETE: fakeHandler,
    }),
    createRedisRelayBus: async () => null,
    CommandRelay: class {
      hasCommandListeners() {
        return true;
      }
      getWebSocketClientCount() {
        return 1;
      }
    },
    createRelayHandlers: () => ({}),
    SSEManager: class {},
    UI_BRIDGE_ROUTES: [{ method: "GET", path: "/tabs" }],
  };
});

// Import the route AFTER the mocks are declared so they take effect.
import * as route from "./route";

const BACKEND_URL = "http://backend.test";

/** `GET /tabs` — the read the remediation report hammers to trip the 429. */
function tabsRequest(): NextRequest {
  return new NextRequest("http://localhost/api/ui-bridge/tabs", {
    method: "GET",
    headers: {
      authorization: "Bearer a-perfectly-good-token",
      origin: "https://qontinui.io",
    },
  });
}

function tabsContext(): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path: ["tabs"] }) };
}

describe("route.ts — upstream auth errors keep their real status (W1)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetAuthCache();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("BACKEND_URL", BACKEND_URL);
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a bad token → 401 UNAUTHENTICATED", async () => {
    // Both verify paths render a real verdict of "no". This is the ONE case
    // that legitimately produces a 401.
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await route.GET(tabsRequest(), tabsContext());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("upstream 429 → 429 with Retry-After preserved (NOT a 401)", async () => {
    // Hammering /tabs rate-limits the relay's own calls to the identity
    // backend. The caller must see a real 429 + Retry-After so its backoff
    // works — not a 401 that would make it discard a valid token.
    fetchMock.mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": "42" } }),
    );

    const res = await route.GET(tabsRequest(), tabsContext());

    expect(res.status).toBe(429);
    expect(res.status).not.toBe(401);
    expect(res.headers.get("Retry-After")).toBe("42");
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_RATE_LIMITED");
    expect(body.code).not.toBe("UNAUTHENTICATED");
  });

  it("upstream 500 → 5xx (NOT a 401)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    const res = await route.GET(tabsRequest(), tabsContext());

    expect(res.status).toBe(500);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).not.toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(body.code).not.toBe("UNAUTHENTICATED");
  });

  it("upstream 503 → 503 (NOT a 401)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    const res = await route.GET(tabsRequest(), tabsContext());

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(401);
  });

  it("an unreachable backend → 503 (NOT a 401)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await route.GET(tabsRequest(), tabsContext());

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("a valid token still passes through to the SDK handler (200)", async () => {
    // Guardrail: the three-state refactor must not have broken the happy path.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "user-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await route.GET(tabsRequest(), tabsContext());

    expect(res.status).toBe(200);
  });
});
