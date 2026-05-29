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
 *   - The cookie path (`access_token`) works the same as Bearer for
 *     same-origin deploys.
 *   - Origin allowlist accepts qontinui.io, *.qontinui.io, *.vercel.app.
 *   - Non-production additionally accepts localhost / 127.0.0.1.
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
    vi.stubEnv("API_URL", "http://backend.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects requests with no Bearer header and no access_token cookie", async () => {
    const req = makeRequest();
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
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
    if (result.ok) expect(result.userId).toBe("user-abc");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test/api/v1/auth/users/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer good-token" },
      }),
    );
  });

  it("accepts an access_token cookie when no Bearer header is present", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "user-cookie" }), { status: 200 }),
    );
    const req = makeRequest({ cookie: "access_token=cookie-token" });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.userId).toBe("user-cookie");
  });

  it("rejects a Bearer that the backend returns 401 for", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const req = makeRequest({ headers: { authorization: "Bearer bad" } });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
  });

  it("rejects when the backend returns 200 with no id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const req = makeRequest({ headers: { authorization: "Bearer weird" } });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
  });

  it("rejects when the backend returns 200 with a non-string id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 42 }), { status: 200 }),
    );
    const req = makeRequest({ headers: { authorization: "Bearer odd" } });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
  });

  it("rejects when the backend body is unparseable", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("not json", { status: 200 }),
    );
    const req = makeRequest({ headers: { authorization: "Bearer t" } });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
  });

  it("fails closed on a backend network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const req = makeRequest({ headers: { authorization: "Bearer t" } });
    const result = await authenticateBridgeRequest(req);
    expect(result.ok).toBe(false);
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
    fetchMock
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Bearer header takes precedence over access_token cookie", async () => {
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
});
