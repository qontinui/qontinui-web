/**
 * Tests for the UI Bridge relay auth gate.
 *
 * Locks the property that:
 *   - When `UI_BRIDGE_REQUIRE_AUTH=1` is OFF, the route runs the legacy
 *     unauth'd path (covered indirectly — this module is only invoked
 *     when the gate is on, so it's tested in isolation here).
 *   - When ON, an absent/invalid Bearer fails closed with 401.
 *   - When ON, a valid Bearer that the backend accepts succeeds and the
 *     positive result is cached for 30s.
 *   - The cookie path was removed (Bearer-only; CSRF-resistant by
 *     construction). An access_token cookie alone authenticates nothing.
 *   - Origin allowlist accepts qontinui.io, *.qontinui.io, *.vercel.app.
 *   - Non-production additionally accepts localhost / 127.0.0.1.
 *   - **Auth is three-state**: an upstream 429/5xx/unreachable backend is an
 *     `upstream_error`, NEVER an `unauthenticated` verdict. See the
 *     "upstream errors are not auth verdicts" describe block.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.1, §4.3.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  __resetAuthCache,
  authenticateBridgeRequest,
  isAllowedOrigin,
  isAuthGateEnabled,
  originForbiddenResponse,
  unauthenticatedResponse,
  upstreamErrorResponse,
} from "./_auth";

function makeRequest(init?: {
  headers?: Record<string, string>;
  cookie?: string;
  query?: string;
}): NextRequest {
  const headers = new Headers(init?.headers ?? {});
  if (init?.cookie) headers.set("cookie", init.cookie);
  const url = `http://localhost/api/ui-bridge/control/snapshot${
    init?.query ? `?${init.query}` : ""
  }`;
  return new NextRequest(url, { headers });
}

describe("isAuthGateEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is true when UI_BRIDGE_REQUIRE_AUTH=1", () => {
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "1");
    expect(isAuthGateEnabled()).toBe(true);
  });

  it("is false when UI_BRIDGE_REQUIRE_AUTH is unset (default off)", () => {
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "");
    expect(isAuthGateEnabled()).toBe(false);
  });

  it("is false for any value other than '1'", () => {
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "true");
    expect(isAuthGateEnabled()).toBe(false);
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "yes");
    expect(isAuthGateEnabled()).toBe(false);
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "0");
    expect(isAuthGateEnabled()).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows null origin (server-to-server fetch)", () => {
    expect(isAllowedOrigin(null)).toBe(true);
  });

  it("allows qontinui.io exactly", () => {
    expect(isAllowedOrigin("https://qontinui.io")).toBe(true);
  });

  it("allows *.qontinui.io subdomains", () => {
    expect(isAllowedOrigin("https://app.qontinui.io")).toBe(true);
    expect(isAllowedOrigin("https://demo.staging.qontinui.io")).toBe(true);
    expect(isAllowedOrigin("https://coord.qontinui.io")).toBe(true);
  });

  it("allows *.vercel.app (Vercel preview/prod deploys)", () => {
    expect(
      isAllowedOrigin("https://qontinui-web-git-foo-qontinui.vercel.app"),
    ).toBe(true);
    expect(isAllowedOrigin("https://anything.vercel.app")).toBe(true);
  });

  it("rejects unrelated origins", () => {
    expect(isAllowedOrigin("https://example.com")).toBe(false);
    expect(isAllowedOrigin("https://qontinui.io.evil.com")).toBe(false);
    expect(isAllowedOrigin("https://attacker.org/qontinui.io")).toBe(false);
  });

  it("rejects malformed origin strings", () => {
    expect(isAllowedOrigin("not a url")).toBe(false);
    expect(isAllowedOrigin("javascript:alert(1)")).toBe(false);
  });

  it("allows localhost / 127.0.0.1 in non-production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isAllowedOrigin("http://localhost:3001")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8000")).toBe(true);
  });

  it("rejects localhost / 127.0.0.1 in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isAllowedOrigin("http://localhost:3001")).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1:8000")).toBe(false);
  });
});

describe("unauthenticatedResponse", () => {
  it("returns 401 with the documented envelope", async () => {
    const r = unauthenticatedResponse();
    expect(r.status).toBe(401);
    expect(r.headers.get("Content-Type")).toBe("application/json");
    const body = await r.json();
    expect(body).toEqual({
      success: false,
      code: "UNAUTHENTICATED",
      message: expect.stringContaining("session token"),
    });
  });
});

describe("originForbiddenResponse", () => {
  it("returns 403 with the documented envelope", async () => {
    const r = originForbiddenResponse();
    expect(r.status).toBe(403);
    expect(r.headers.get("Content-Type")).toBe("application/json");
    const body = await r.json();
    expect(body).toEqual({
      success: false,
      code: "ORIGIN_NOT_ALLOWED",
      message: expect.stringContaining("origin"),
    });
  });
});

describe("authenticateBridgeRequest", () => {
  // Hold a handle to the fetch mock so each test can override it.
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetAuthCache();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Default backend URL so route construction is deterministic.
    vi.stubEnv("BACKEND_URL", "http://backend.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects requests with no Bearer header", async () => {
    const req = makeRequest();
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unauthenticated");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a valid Bearer token verified by the backend", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "user-abc" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const req = makeRequest({
      headers: { authorization: "Bearer good-token" },
    });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("user");
      expect(result.userId).toBe("user-abc");
    }
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test/api/v1/auth/users/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer good-token" },
      }),
    );
    // User path succeeded → device path must NOT be consulted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects requests authenticated only via access_token cookie (Bearer-only)", async () => {
    // The cookie path was removed (CSRF resistance). Cookies alone =
    // anonymous, even if the user has an HttpOnly access_token set by
    // the backend. SDK transports MUST attach Authorization: Bearer.
    const req = makeRequest({ cookie: "access_token=cookie-token" });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unauthenticated");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a Bearer that both backend verify paths return 401 for", async () => {
    // User path 401, then the device-path fallback also 401 → anonymous.
    // A 401 from the backend IS a verdict, so this is `unauthenticated` —
    // the one failure mode that legitimately becomes an HTTP 401.
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const req = makeRequest({ headers: { authorization: "Bearer bad" } });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unauthenticated");
    // Both disjoint verify paths were attempted.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://backend.test/api/v1/auth/users/me",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://backend.test/api/v1/devices/me",
      expect.anything(),
    );
  });

  it("rejects when the user path returns 200 with no id and device path 401s", async () => {
    // No `id` on the user response → not a user; device fallback 401s → anonymous.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const req = makeRequest({ headers: { authorization: "Bearer weird" } });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
  });

  it("rejects when the user path returns a non-string id and device path 401s", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 42 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const req = makeRequest({ headers: { authorization: "Bearer odd" } });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
  });

  it("rejects when both verify paths return an unparseable body", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockResolvedValueOnce(new Response("not json", { status: 200 }));
    const req = makeRequest({ headers: { authorization: "Bearer t" } });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
  });

  it("fails closed as an UPSTREAM ERROR (not a 401) when both verify paths hit a network error", async () => {
    // Fails closed — `ok:false` grants nothing. But an unreachable backend
    // rendered no verdict on the token, so it must NOT be reported as an
    // auth failure: the token may be perfectly valid.
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const req = makeRequest({ headers: { authorization: "Bearer t" } });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("upstream_error");
      if (result.reason === "upstream_error") {
        expect(result.status).toBe(503);
      }
    }
  });

  it("caches a positive result for 30s (second call does not hit backend)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "user-cached" }), { status: 200 }),
    );
    const req1 = makeRequest({ headers: { authorization: "Bearer same" } });
    const req2 = makeRequest({ headers: { authorization: "Bearer same" } });
    const r1 = await authenticateBridgeRequest(req1);
    const r2 = await authenticateBridgeRequest(req2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.userId).toBe(r2.userId);
      // tokenKeyHash is a SHA-256 hex digest; same token → same hash.
      expect(r1.tokenKeyHash).toBe(r2.tokenKeyHash);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache negative results", async () => {
    // Call 1: user path 401, device fallback 401 → anonymous (NOT cached).
    // Call 2: token now valid on the user path → success on a fresh round-trip.
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "user-rotated" }), { status: 200 }),
      );
    const r1 = await authenticateBridgeRequest(
      makeRequest({ headers: { authorization: "Bearer rotating" } }),
    );
    const r2 = await authenticateBridgeRequest(
      makeRequest({ headers: { authorization: "Bearer rotating" } }),
    );
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(true);
    // 2 (failed user+device) on call 1, 1 (successful user) on call 2.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("Bearer header authenticates even when an unrelated access_token cookie is present", async () => {
    // The cookie path is no longer consulted at all; a present cookie
    // must not affect the Bearer flow in any way.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "user-from-bearer" }), {
        status: 200,
      }),
    );
    const req = makeRequest({
      headers: { authorization: "Bearer header-token" },
      cookie: "access_token=cookie-token",
    });
    await authenticateBridgeRequest(req);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { Authorization: "Bearer header-token" },
      }),
    );
  });

  it("ignores the legacy _auth query parameter (SDK ≥ 0.11.0 sends the token as a header)", async () => {
    // The pre-0.11.0 SDK rode the JWT in the URL as `_auth=<jwt>` because
    // EventSource couldn't set headers. That branch was deleted to keep
    // bearer tokens out of request logs. A request that ONLY presents
    // the query token must NOT authenticate — it's treated as anonymous.
    const req = makeRequest({ query: "_auth=legacy-token" });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the device path when the user path 401s, resolving the paired operator", async () => {
    // User path rejects a device-JWT (401); device path resolves it.
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_id: "device-1",
            user_id: "operator-7",
            tenant_id: "tenant-9",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const req = makeRequest({
      headers: { authorization: "Bearer device-jwt" },
    });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("device");
      if (result.kind === "device") {
        expect(result.deviceId).toBe("device-1");
        // userId is the PAIRED operator (so the device sees its tabs).
        expect(result.userId).toBe("operator-7");
        expect(result.tenantId).toBe("tenant-9");
      }
    }
    // Order: user path first, device path second, both with the same bearer.
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://backend.test/api/v1/auth/users/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer device-jwt" },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://backend.test/api/v1/devices/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer device-jwt" },
      }),
    );
  });

  it("rejects a device-path 200 missing required fields", async () => {
    // Partial /devices/me body (no tenant_id) → not a valid device principal.
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ device_id: "device-1", user_id: "operator-7" }),
          { status: 200 },
        ),
      );
    const req = makeRequest({
      headers: { authorization: "Bearer partial-device" },
    });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
  });

  it("caches a device principal for 30s (second call does not hit backend)", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_id: "device-cached",
            user_id: "operator-cached",
            tenant_id: "tenant-cached",
          }),
          { status: 200 },
        ),
      );
    const req1 = makeRequest({
      headers: { authorization: "Bearer dev-same" },
    });
    const req2 = makeRequest({
      headers: { authorization: "Bearer dev-same" },
    });
    const r1 = await authenticateBridgeRequest(req1);
    const r2 = await authenticateBridgeRequest(req2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok && r1.kind === "device" && r2.kind === "device") {
      expect(r1.deviceId).toBe(r2.deviceId);
      expect(r1.userId).toBe(r2.userId);
      expect(r1.tenantId).toBe(r2.tenantId);
    }
    // Two fetches on the first call (user 401 + device 200), zero on the
    // second (served from the positive cache).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* ---------------------------------------------------------------------- */
/* W1 — upstream errors are not auth verdicts                             */
/* ---------------------------------------------------------------------- */

describe("authenticateBridgeRequest — upstream errors are NOT auth verdicts", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetAuthCache();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("BACKEND_URL", "http://backend.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports an upstream 429 as upstream_error/429, preserving Retry-After", async () => {
    // The identity backend is rate-limiting US. It never looked at the token,
    // so the caller must not be told their token is bad.
    const rateLimited = () =>
      new Response(null, { status: 429, headers: { "Retry-After": "42" } });
    fetchMock
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(rateLimited());

    const result = await authenticateBridgeRequest(
      makeRequest({ headers: { authorization: "Bearer perfectly-good" } }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("upstream_error");
      if (result.reason === "upstream_error") {
        expect(result.status).toBe(429);
        expect(result.retryAfter).toBe("42");
      }
    }
  });

  it("reports an upstream 500 as upstream_error/500 — NOT a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const result = await authenticateBridgeRequest(
      makeRequest({ headers: { authorization: "Bearer valid-token" } }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toBe("unauthenticated");
      expect(result.reason).toBe("upstream_error");
      if (result.reason === "upstream_error") {
        expect(result.status).toBe(500);
        expect(result.status).toBeGreaterThanOrEqual(500);
        expect(result.retryAfter).toBeNull();
      }
    }
  });

  it.each([502, 503, 504])(
    "passes an upstream %i through with its real status",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValueOnce(new Response(null, { status }));

      const result = await authenticateBridgeRequest(
        makeRequest({ headers: { authorization: "Bearer t" } }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "upstream_error") {
        expect(result.status).toBe(status);
      } else {
        throw new Error(`expected upstream_error, got ${JSON.stringify(result)}`);
      }
    },
  );

  it("still authenticates a valid device-JWT when the USER path 5xxs (no short-circuit)", async () => {
    // Availability: /auth/users/me and /devices/me can fail independently.
    // A transient 500 on the user probe must not lock out a good device token.
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_id: "device-1",
            user_id: "operator-7",
            tenant_id: "tenant-9",
          }),
          { status: 200 },
        ),
      );

    const result = await authenticateBridgeRequest(
      makeRequest({ headers: { authorization: "Bearer device-jwt" } }),
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "device") {
      expect(result.userId).toBe("operator-7");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prefers the 429 (which carries Retry-After) when the two paths error differently", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "7" } }),
      );

    const result = await authenticateBridgeRequest(
      makeRequest({ headers: { authorization: "Bearer t" } }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "upstream_error") {
      expect(result.status).toBe(429);
      expect(result.retryAfter).toBe("7");
    } else {
      throw new Error("expected an upstream_error result");
    }
  });

  it("a 403 from both paths is still a plain unauthenticated verdict (not an upstream error)", async () => {
    // 4xx-other-than-429 is the backend ANSWERING. Only 429/5xx mean it
    // never answered. This is the boundary that keeps the disjoint-path
    // fallback (and the flat 401) intact.
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));

    const result = await authenticateBridgeRequest(
      makeRequest({ headers: { authorization: "Bearer nope" } }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unauthenticated");
  });

  it("does NOT cache an upstream error (next call re-probes and can succeed)", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "user-recovered" }), { status: 200 }),
      );

    const r1 = await authenticateBridgeRequest(
      makeRequest({ headers: { authorization: "Bearer flaky" } }),
    );
    const r2 = await authenticateBridgeRequest(
      makeRequest({ headers: { authorization: "Bearer flaky" } }),
    );

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.userId).toBe("user-recovered");
  });
});

describe("upstreamErrorResponse", () => {
  it("returns 429 with Retry-After preserved and a non-UNAUTHENTICATED code", async () => {
    const r = upstreamErrorResponse({ status: 429, retryAfter: "42" });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("42");
    const body = await r.json();
    expect(body.code).toBe("UPSTREAM_RATE_LIMITED");
    expect(body.code).not.toBe("UNAUTHENTICATED");
    expect(body.success).toBe(false);
  });

  it("returns the real 5xx status and omits Retry-After when upstream sent none", async () => {
    const r = upstreamErrorResponse({ status: 502, retryAfter: null });
    expect(r.status).toBe(502);
    expect(r.headers.get("Retry-After")).toBeNull();
    const body = await r.json();
    expect(body.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("clamps an out-of-class status to 502 rather than throwing", () => {
    // Defensive totality: the helper must never RangeError out of the
    // request path, whatever it is handed.
    expect(upstreamErrorResponse({ status: 401, retryAfter: null }).status).toBe(
      502,
    );
    expect(upstreamErrorResponse({ status: 700, retryAfter: null }).status).toBe(
      502,
    );
  });
});
