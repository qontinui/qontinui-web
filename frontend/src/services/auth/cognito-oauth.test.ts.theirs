import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  buildLoginState,
  verifyStateAndExtractNext,
  isLinkModeState,
  refreshCognitoTokens,
  CognitoRefreshError,
  COGNITO_CLIENT_ID,
} from "./cognito-oauth";

/**
 * Tests for the Cognito OAuth `state` round-trip — the "/login?next=… email
 * sign-in always fails with OAuth state mismatch" fix.
 *
 * The state packs an optional post-login `next` path as `<csrf>.<base64url>`.
 * Base64url output (A-Za-z0-9-_) + the `.` separator contain NO `%xx`
 * sequences, so the whole state is byte-stable under percent-decode — which is
 * exactly what the hosted-UI email (form-POST) return path applies an extra
 * round of. The old `encodeURIComponent` packing was NOT decode-idempotent
 * (e.g. `%2Fco-pilot` → `/co-pilot`), breaking the strict-equality CSRF check.
 *
 * `buildLoginState` is the pure state-builder used by `startCognitoLogin`;
 * `verifyStateAndExtractNext` reads the stored state from sessionStorage and
 * compares it against the returned one. jsdom provides sessionStorage.
 */

const PKCE_STATE_KEY = "cognito_oauth_state";

// Mirror how /auth/callback consumes a return: the state Cognito hands back is
// stored verbatim before redirect, then verified against what comes back.
function storeState(state: string): void {
  sessionStorage.setItem(PKCE_STATE_KEY, state);
}

const CSRF = "abc123CsrfToken-_";

describe("buildLoginState + verifyStateAndExtractNext round-trip", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a simple next path", () => {
    const state = buildLoginState(CSRF, "/co-pilot");
    storeState(state);
    expect(verifyStateAndExtractNext(state)).toBe("/co-pilot");
  });

  it("round-trips a next with pre-encoded chars and a query string", () => {
    const next = "/co-pilot?a=b%2Fc&x=1";
    const state = buildLoginState(CSRF, next);
    storeState(state);
    expect(verifyStateAndExtractNext(state)).toBe(next);
  });

  it("round-trips a unicode path segment", () => {
    const next = "/proyectos/café/正在/workflows";
    const state = buildLoginState(CSRF, next);
    storeState(state);
    expect(verifyStateAndExtractNext(state)).toBe(next);
  });

  it("decode-idempotence regression: state has no %xx sequences (the prod bug)", () => {
    // The hosted-UI email form-POST path applies one extra percent-decode to
    // `state`. Base64url + `.` + base64url CSRF contain no `%`, so the state is
    // byte-stable: decodeURIComponent is a no-op and strict equality still holds.
    for (const next of [
      "/co-pilot",
      "/co-pilot?a=b%2Fc&x=1",
      "/proyectos/café/正在/workflows",
      "/a/b/c?d=e+f&g=%20h",
    ]) {
      const state = buildLoginState(CSRF, next);
      expect(decodeURIComponent(state)).toBe(state);
      // Survives the extra decode the email path applies, end to end.
      storeState(state);
      expect(verifyStateAndExtractNext(decodeURIComponent(state))).toBe(next);
    }
  });

  it("returns null for a bare-csrf state (no next) and still verifies", () => {
    const state = buildLoginState(CSRF);
    expect(state).toBe(CSRF);
    storeState(state);
    expect(verifyStateAndExtractNext(state)).toBeNull();
  });

  it("throws on a mismatch (returned != stored)", () => {
    storeState(buildLoginState(CSRF, "/co-pilot"));
    expect(() =>
      verifyStateAndExtractNext(buildLoginState("other", "/co-pilot"))
    ).toThrow(/state mismatch/i);
  });

  it("throws when no state was stored", () => {
    expect(() =>
      verifyStateAndExtractNext(buildLoginState(CSRF, "/co-pilot"))
    ).toThrow(/state mismatch/i);
  });

  it("throws when the returned state is null", () => {
    storeState(buildLoginState(CSRF, "/co-pilot"));
    expect(() => verifyStateAndExtractNext(null)).toThrow(/state mismatch/i);
  });

  it("open-redirect guard: rejects an absolute http(s) next", () => {
    const state = buildLoginState(CSRF, "https://evil.com");
    storeState(state);
    // CSRF passes (state matches), but the decoded next is not a same-origin
    // path, so it is not honoured.
    expect(verifyStateAndExtractNext(state)).toBeNull();
  });

  it("open-redirect guard: rejects a protocol-relative //evil.com next", () => {
    const state = buildLoginState(CSRF, "//evil.com");
    storeState(state);
    expect(verifyStateAndExtractNext(state)).toBeNull();
  });
});

describe("link-mode state", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("isLinkModeState detects the link: prefix and is false for null/login states", () => {
    expect(isLinkModeState(`link:${CSRF}`)).toBe(true);
    expect(isLinkModeState(CSRF)).toBe(false);
    expect(isLinkModeState(buildLoginState(CSRF, "/co-pilot"))).toBe(false);
    expect(isLinkModeState(null)).toBe(false);
  });

  it("a link-mode state verifies (CSRF passes) and yields no next, without throwing", () => {
    const state = `link:${CSRF}`;
    storeState(state);
    expect(() => verifyStateAndExtractNext(state)).not.toThrow();
    // No `.` separator → no next path.
    expect(verifyStateAndExtractNext(state)).toBeNull();
  });
});

/**
 * The `grant_type=refresh_token` exchange behind silent session renewal.
 *
 * Cognito's refresh grant takes only `client_id` + `refresh_token` (no
 * `redirect_uri`, no `code_verifier` — PKCE binds the AUTHORIZATION CODE, not
 * the refresh token) and returns NO new refresh token, so the caller keeps the
 * one it holds.
 */
describe("refreshCognitoTokens", () => {
  interface CapturedRequest {
    url: string;
    method: string | undefined;
    headers: Record<string, string>;
    body: URLSearchParams;
  }

  /** Stub fetch with the given response, capturing the outgoing request. */
  function stubTokenEndpoint(
    status: number,
    payload: unknown
  ): { current: CapturedRequest | null } {
    const captured: { current: CapturedRequest | null } = { current: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        captured.current = {
          url,
          method: init?.method,
          headers: (init?.headers as Record<string, string>) ?? {},
          body: new URLSearchParams(String(init?.body ?? "")),
        };
        return new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    return captured;
  }

  const OK_PAYLOAD = {
    id_token: "new.id.token",
    access_token: "new.access.token",
    expires_in: 10800,
    token_type: "Bearer",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs a form-encoded refresh grant to the token endpoint", async () => {
    const captured = stubTokenEndpoint(200, OK_PAYLOAD);

    await expect(refreshCognitoTokens("rt-xyz")).resolves.toEqual(OK_PAYLOAD);

    const req = captured.current!;
    expect(req.url).toMatch(/\/oauth2\/token$/);
    expect(req.method).toBe("POST");
    expect(req.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(req.body.get("grant_type")).toBe("refresh_token");
    expect(req.body.get("client_id")).toBe(COGNITO_CLIENT_ID);
    expect(req.body.get("refresh_token")).toBe("rt-xyz");
  });

  it("sends no client secret, redirect_uri or code_verifier (public client, code-grant-only PKCE)", async () => {
    const captured = stubTokenEndpoint(200, OK_PAYLOAD);

    await refreshCognitoTokens("rt-xyz");

    const req = captured.current!;
    expect(req.body.get("client_secret")).toBeNull();
    expect(req.body.get("redirect_uri")).toBeNull();
    expect(req.body.get("code_verifier")).toBeNull();
    expect(req.headers["Authorization"]).toBeUndefined();
  });

  /**
   * Failure CLASSIFICATION. The proactive renewal fires six minutes before the
   * bearer's `exp`, while it is still valid, so "the exchange failed" and "the
   * session is dead" must not be the same thing: only a verdict from Cognito
   * (`invalid_grant` / 401) may cost the user their session.
   */
  it("classifies a revoked refresh token as AUTHORITATIVE, surfacing Cognito's error_description", async () => {
    stubTokenEndpoint(400, {
      error: "invalid_grant",
      error_description: "Refresh Token has been revoked",
    });

    const error = await refreshCognitoTokens("dead").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CognitoRefreshError);
    expect((error as CognitoRefreshError).kind).toBe("authoritative");
    expect((error as CognitoRefreshError).oauthError).toBe("invalid_grant");
    expect((error as Error).message).toMatch(/Refresh Token has been revoked/);
  });

  it("classifies a 401 as AUTHORITATIVE", async () => {
    stubTokenEndpoint(401, { error: "invalid_client" });

    const error = await refreshCognitoTokens("rt-xyz").catch(
      (e: unknown) => e
    );
    expect((error as CognitoRefreshError).kind).toBe("authoritative");
  });

  it("classifies a 502 with a non-JSON body as TRANSIENT (falling back to the status code)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>gateway</html>", { status: 502 })
      )
    );

    const error = await refreshCognitoTokens("rt-xyz").catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(CognitoRefreshError);
    // A gateway error is NOT Cognito saying the refresh token is bad.
    expect((error as CognitoRefreshError).kind).toBe("transient");
    expect((error as CognitoRefreshError).status).toBe(502);
    expect((error as Error).message).toMatch(/502/);
  });

  it("classifies a network failure as TRANSIENT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const error = await refreshCognitoTokens("rt-xyz").catch(
      (e: unknown) => e
    );
    expect((error as CognitoRefreshError).kind).toBe("transient");
    expect((error as CognitoRefreshError).status).toBeNull();
  });

  it("classifies a 429 and a non-invalid_grant 400 as TRANSIENT", async () => {
    stubTokenEndpoint(429, { error: "slow_down" });
    await expect(
      refreshCognitoTokens("rt-xyz").catch(
        (e: CognitoRefreshError) => e.kind
      )
    ).resolves.toBe("transient");

    stubTokenEndpoint(400, { error: "temporarily_unavailable" });
    await expect(
      refreshCognitoTokens("rt-xyz").catch(
        (e: CognitoRefreshError) => e.kind
      )
    ).resolves.toBe("transient");
  });

  it("classifies an unreadable 200 body as TRANSIENT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 }))
    );

    const error = await refreshCognitoTokens("rt-xyz").catch(
      (e: unknown) => e
    );
    expect((error as CognitoRefreshError).kind).toBe("transient");
  });
});
