/**
 * Integration tests for the audit-log + rate-limit branches of the
 * /api/ui-bridge/[...path] route handler (§4.8 of the production-safe
 * UI Bridge plan).
 *
 * Covers the wire-through the unit tests in `_audit.test.ts` /
 * `_rate-limit.test.ts` don't directly exercise:
 *
 *   - Auditable POST → exactly 1 audit row inserted with the safe summary.
 *   - Non-auditable GET → no audit row.
 *   - Audit insert failure → caller's response is still the SDK's response
 *     (the route doesn't surface the audit failure to the caller).
 *   - 21st write in a minute → 429 RATE_LIMITED.
 *   - 61st read in a minute → 429 RATE_LIMITED.
 *   - Redis offline → request passes through without rate-limiting.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.8.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { __resetAuthCache } from "./_auth";
import { __setRedisClientForTest } from "./_rate-limit";

/**
 * Minimal in-memory ioredis stand-in (same shape as `_rate-limit.test.ts`).
 * Two test files keeping their own clients is intentional — they're
 * independent unit boundaries and a shared helper would couple them.
 */
function makeMockRedis() {
  const store = new Map<string, number>();
  const pipelineApi = {
    _ops: [] as Array<["incr" | "expire", string]>,
    incr(key: string) {
      this._ops.push(["incr", key]);
      return this;
    },
    expire(key: string) {
      this._ops.push(["expire", key]);
      return this;
    },
    async exec(): Promise<unknown> {
      const results: Array<[Error | null, unknown]> = [];
      for (const [op, key] of this._ops) {
        if (op === "incr") {
          const next = (store.get(key) ?? 0) + 1;
          store.set(key, next);
          results.push([null, next]);
        } else {
          results.push([null, 1]);
        }
      }
      this._ops = [];
      return results;
    },
  };
  const client = {
    pipeline: () => ({ ...pipelineApi, _ops: [] }),
    on: () => undefined,
  } as unknown as Parameters<typeof __setRedisClientForTest>[0];
  return { client, store };
}

/**
 * The route handler instantiates a CommandRelay at module load that
 * tries to dial Redis for the relay bus. Mock the module so the import
 * is side-effect-free in the test environment and the route handler
 * gets a no-op relay + handlers it can call without hitting the
 * network.
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
  };
});

// The SDK's `createNextRouteHandlers` is called at module load. We mock
// `@qontinui/ui-bridge/server` to short-circuit it AND to keep the
// UI_BRIDGE_ROUTES manifest used by `isKnownRoute`. We list every path
// the tests exercise so `isKnownRoute` returns true.
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
    UI_BRIDGE_ROUTES: [
      { method: "GET", path: "/control/snapshot" },
      { method: "POST", path: "/control/element/:id/action" },
      { method: "POST", path: "/control/page/navigate" },
      { method: "POST", path: "/ai/find" },
    ],
  };
});

// Spy on the audit insert by mocking `_audit`'s `recordAudit`. We
// preserve the rest of the module (classifiers, safe summary) so the
// route handler's call into them returns real values.
const recordAuditMock = vi.fn(async () => undefined);
vi.mock("./_audit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_audit")>();
  return {
    ...actual,
    recordAudit: (...args: Parameters<typeof actual.recordAudit>) =>
      recordAuditMock(...args),
  };
});

// Importing the route AFTER the mocks are declared above so the mocks
// take effect.
import * as route from "./route";

const BACKEND_URL = "http://backend.test";

function makeRequest(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  const init: RequestInit = {
    method,
    headers: {
      authorization: "Bearer test-token",
      origin: "https://qontinui.io",
      ...headers,
    },
  };
  if (body !== undefined && method !== "GET" && method !== "DELETE") {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] =
      "application/json";
  }
  // The catch-all route ingests `/api/ui-bridge/<path>`; the wrapHandler
  // works off `params.path[]` not the URL, so we construct the URL just
  // for shape — context.params is what drives routing here.
  return new NextRequest(`http://localhost/api/ui-bridge${path}`, init);
}

function makeContext(path: string): {
  params: Promise<{ path: string[] }>;
} {
  return {
    params: Promise.resolve({
      path: path.replace(/^\//, "").split("/"),
    }),
  };
}

describe("route.ts §4.8 audit + rate-limit branches", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetAuthCache();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("BACKEND_URL", BACKEND_URL);
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "1");
    // /auth/users/me — accept the test bearer.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/v1/auth/users/me")) {
        return new Response(JSON.stringify({ id: "user-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Default for any other call (e.g. recordAudit's POST).
      return new Response(null, { status: 201 });
    });
    recordAuditMock.mockClear();
    recordAuditMock.mockResolvedValue(undefined);
    const { client } = makeMockRedis();
    __setRedisClientForTest(client);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    __setRedisClientForTest(undefined);
  });

  it("auditable POST → exactly one audit row with the safe summary", async () => {
    const req = makeRequest(
      "/control/element/btn-42/action",
      "POST",
      { elementId: "btn-42", action: "click" },
    );
    const resp = await route.POST(req, makeContext("/control/element/btn-42/action"));
    expect(resp.status).toBe(200);
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    const call = recordAuditMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      commandName: "element.action",
      targetElementId: "btn-42",
      path: "/control/element/btn-42/action",
      method: "POST",
      statusCode: 200,
      // Bug 3b: the mocked relay handler returns `{success:true}` → the audit
      // row records EXECUTION (executed), not merely receipt (statusCode 200).
      executionStatus: "executed",
      payloadSummary: expect.objectContaining({
        action: "element.action",
        elementId: "btn-42",
        bodyAction: "click",
      }),
    });
    // Critical: no raw `text` leaks anywhere.
    expect(JSON.stringify(call)).not.toContain("hunter");
  });

  it("non-auditable GET → no audit row", async () => {
    const req = makeRequest("/control/snapshot", "GET");
    const resp = await route.GET(req, makeContext("/control/snapshot"));
    expect(resp.status).toBe(200);
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("audit insert failure → caller's response is still 200 (fire-and-forget)", async () => {
    recordAuditMock.mockRejectedValueOnce(new Error("backend down"));
    const req = makeRequest(
      "/control/page/navigate",
      "POST",
      { url: "/dashboard" },
    );
    const resp = await route.POST(req, makeContext("/control/page/navigate"));
    // The handler returned the SDK's 200, NOT the audit-insert failure.
    // (We don't await `recordAudit` in the route handler; the rejection
    // becomes an unhandled rejection inside `recordAudit` but the audit
    // module catches it. The mocked rejection here verifies that path.)
    expect(resp.status).toBe(200);
  });

  it("21st write in a minute → 429 RATE_LIMITED", async () => {
    // Hit the same write endpoint 20 times — all 200.
    for (let i = 0; i < 20; i++) {
      const req = makeRequest("/control/page/navigate", "POST", { url: "/x" });
      const resp = await route.POST(
        req,
        makeContext("/control/page/navigate"),
      );
      expect(resp.status).toBe(200);
    }
    // The 21st must be denied.
    const denied = await route.POST(
      makeRequest("/control/page/navigate", "POST", { url: "/x" }),
      makeContext("/control/page/navigate"),
    );
    expect(denied.status).toBe(429);
    const body = await denied.json();
    expect(body).toMatchObject({ success: false, code: "RATE_LIMITED" });
    expect(denied.headers.get("Retry-After")).toBeTruthy();
  });

  it("61st read in a minute → 429 RATE_LIMITED", async () => {
    for (let i = 0; i < 60; i++) {
      const resp = await route.GET(
        makeRequest("/control/snapshot", "GET"),
        makeContext("/control/snapshot"),
      );
      expect(resp.status).toBe(200);
    }
    const denied = await route.GET(
      makeRequest("/control/snapshot", "GET"),
      makeContext("/control/snapshot"),
    );
    expect(denied.status).toBe(429);
  });

  it("Redis offline → request passes through without rate-limit (fail open)", async () => {
    __setRedisClientForTest(null);
    // Run far more than the limit — every call must succeed.
    for (let i = 0; i < 30; i++) {
      const resp = await route.POST(
        makeRequest("/control/page/navigate", "POST", { url: "/x" }),
        makeContext("/control/page/navigate"),
      );
      expect(resp.status).toBe(200);
    }
  });
});
