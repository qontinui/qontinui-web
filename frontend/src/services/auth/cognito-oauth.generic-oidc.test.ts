import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Generic OpenID Connect mode of the Authorization Code + PKCE flow.
 *
 * With `NEXT_PUBLIC_OIDC_ISSUER` set the flow must find its endpoints through
 * the issuer's discovery document (refusing one that names another issuer),
 * talk only to the generic client id, never send Cognito's
 * `identity_provider` hint, keep a rotated refresh token, and log out through
 * the discovered `end_session_endpoint`.
 *
 * The module reads its env at import time, so each test stubs the env and
 * imports a fresh copy.
 */

const ISSUER = "https://idp.example.test/realms/acme";
const CLIENT_ID = "qontinui-web-spa";
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;

const DOC = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
  token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
  end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
  jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
};

interface Captured {
  url: string;
  method: string | undefined;
  body: URLSearchParams;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Serve discovery + token endpoint; record every request. */
function stubIssuer(
  doc: Record<string, unknown> = DOC,
  tokenPayload: unknown = {
    id_token: "id.token",
    access_token: "access.token",
    refresh_token: "rotated-rt",
    expires_in: 300,
    token_type: "Bearer",
  }
): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        method: init?.method,
        body: new URLSearchParams(String(init?.body ?? "")),
      });
      if (url === DISCOVERY) return json(doc);
      if (url === DOC.token_endpoint) return json(tokenPayload);
      return json({ error: "not_found" }, 404);
    })
  );
  return requests;
}

async function loadGeneric(
  env: Record<string, string> = {}
): Promise<typeof import("./cognito-oauth")> {
  vi.stubEnv("NEXT_PUBLIC_OIDC_ISSUER", `${ISSUER}/`);
  vi.stubEnv("NEXT_PUBLIC_OIDC_CLIENT_ID", CLIENT_ID);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return import("./cognito-oauth");
}

const ORIGIN = "https://app.example.test";
const originalLocation = window.location;

describe("generic OIDC mode", () => {
  let assigned: string[];

  beforeEach(() => {
    sessionStorage.clear();
    assigned = [];
    Object.defineProperty(window, "location", {
      value: {
        ...originalLocation,
        origin: ORIGIN,
        assign: (url: string | URL) => {
          assigned.push(String(url));
        },
      },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is off without NEXT_PUBLIC_OIDC_ISSUER (Cognito hosted UI)", async () => {
    vi.resetModules();
    const mod = await import("./cognito-oauth");
    expect(mod.isGenericOidc()).toBe(false);
    const endpoints = await mod.resolveOAuthEndpoints();
    expect(endpoints.mode).toBe("cognito");
    expect(endpoints.authorize).toMatch(/\/oauth2\/authorize$/);
  });

  it("authorizes at the DISCOVERED endpoint with PKCE and no identity_provider", async () => {
    const requests = stubIssuer();
    const mod = await loadGeneric();
    expect(mod.isGenericOidc()).toBe(true);

    await mod.startCognitoLogin("Google", "/admin/coord");

    expect(requests.map((r) => r.url)).toEqual([DISCOVERY]);
    expect(assigned).toHaveLength(1);
    const url = new URL(assigned[0]);
    expect(`${url.origin}${url.pathname}`).toBe(DOC.authorization_endpoint);
    const params = url.searchParams;
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("scope")).toBe("openid email profile offline_access");
    expect(params.has("identity_provider")).toBe(false);
    expect(params.get("state")).toBe(
      sessionStorage.getItem("cognito_oauth_state")
    );
  });

  it("signup goes to the same authorize endpoint (OIDC has no signup screen)", async () => {
    stubIssuer();
    const mod = await loadGeneric();
    await mod.startCognitoSignup();
    expect(assigned[0].startsWith(DOC.authorization_endpoint)).toBe(true);
  });

  it("refuses a discovery document that names another issuer", async () => {
    stubIssuer({ ...DOC, issuer: "https://evil.example.test" });
    const mod = await loadGeneric();
    await expect(mod.startCognitoLogin()).rejects.toThrow(/different issuer/);
    expect(assigned).toHaveLength(0);
  });

  it("refuses a plain-http endpoint under an https issuer", async () => {
    stubIssuer({
      ...DOC,
      authorization_endpoint: "http://idp.example.test/auth",
    });
    const mod = await loadGeneric();
    await expect(mod.startCognitoLogin()).rejects.toThrow(
      /authorization_endpoint/
    );
  });

  it("refuses a plain-http issuer that is not localhost", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv(
      "NEXT_PUBLIC_OIDC_ISSUER",
      "http://idp.example.test/realms/acme"
    );
    vi.stubEnv("NEXT_PUBLIC_OIDC_CLIENT_ID", CLIENT_ID);
    vi.resetModules();
    const mod = await import("./cognito-oauth");
    await expect(mod.startCognitoLogin()).rejects.toThrow(
      /must be an https URL/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a plain-http localhost issuer and its localhost endpoints", async () => {
    const local = "http://127.0.0.1:8771";
    const doc = {
      issuer: local,
      authorization_endpoint: `${local}/auth`,
      token_endpoint: `${local}/token`,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(doc))
    );
    vi.stubEnv("NEXT_PUBLIC_OIDC_ISSUER", local);
    vi.stubEnv("NEXT_PUBLIC_OIDC_CLIENT_ID", CLIENT_ID);
    vi.resetModules();
    const mod = await import("./cognito-oauth");
    await expect(mod.resolveOAuthEndpoints()).resolves.toMatchObject({
      authorize: `${local}/auth`,
      logout: null,
    });
  });

  it("refuses a plain-http non-localhost endpoint even under a localhost issuer", async () => {
    const local = "http://localhost:8771";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          issuer: local,
          authorization_endpoint: "http://idp.example.test/auth",
          token_endpoint: `${local}/token`,
        })
      )
    );
    vi.stubEnv("NEXT_PUBLIC_OIDC_ISSUER", local);
    vi.stubEnv("NEXT_PUBLIC_OIDC_CLIENT_ID", CLIENT_ID);
    vi.resetModules();
    const mod = await import("./cognito-oauth");
    await expect(mod.resolveOAuthEndpoints()).rejects.toThrow(
      /authorization_endpoint/
    );
  });

  it("refuses an https issuer's endpoint downgraded to localhost http", async () => {
    stubIssuer({ ...DOC, token_endpoint: "http://127.0.0.1:9999/token" });
    const mod = await loadGeneric();
    await expect(mod.resolveOAuthEndpoints()).rejects.toThrow(/token_endpoint/);
  });

  it("treats a refresh response without id_token as a failed refresh", async () => {
    stubIssuer(DOC, {
      access_token: "access.only",
      refresh_token: "rotated",
      expires_in: 300,
      token_type: "Bearer",
    });
    const mod = await loadGeneric();
    const error = await mod.refreshCognitoTokens("rt").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(mod.CognitoRefreshError);
    expect((error as InstanceType<typeof mod.CognitoRefreshError>).kind).toBe(
      "transient"
    );
    expect(
      (error as InstanceType<typeof mod.CognitoRefreshError>)
        .rotatedRefreshToken
    ).toBe("rotated");
  });

  it("isLoopbackHost recognises only this machine", async () => {
    const { isLoopbackHost } = await loadGeneric();
    for (const host of [
      "localhost",
      "app.localhost",
      "127.0.0.1",
      "127.4.5.6",
      "[::1]",
      "::1",
    ]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of [
      "idp.example.test",
      "localhost.evil.test",
      "10.0.0.1",
      "128.0.0.1",
    ]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it("requires a client id", async () => {
    stubIssuer();
    const mod = await loadGeneric({ NEXT_PUBLIC_OIDC_CLIENT_ID: "" });
    await expect(mod.startCognitoLogin()).rejects.toThrow(/CLIENT_ID/);
  });

  it("retries discovery after a failure instead of caching it", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls === 1 ? json({}, 503) : json(DOC);
      })
    );
    const mod = await loadGeneric();
    await expect(mod.resolveOAuthEndpoints()).rejects.toThrow(/HTTP 503/);
    await expect(mod.resolveOAuthEndpoints()).resolves.toMatchObject({
      mode: "oidc",
      token: DOC.token_endpoint,
    });
  });

  it("exchanges the code at the discovered token endpoint with the generic client", async () => {
    const requests = stubIssuer();
    const mod = await loadGeneric();
    sessionStorage.setItem("cognito_pkce_verifier", "verifier-123");

    const tokens = await mod.exchangeCodeForTokens("code-abc");

    expect(tokens.id_token).toBe("id.token");
    const tokenCall = requests.find((r) => r.url === DOC.token_endpoint);
    expect(tokenCall?.method).toBe("POST");
    expect(tokenCall?.body.get("grant_type")).toBe("authorization_code");
    expect(tokenCall?.body.get("client_id")).toBe(CLIENT_ID);
    expect(tokenCall?.body.get("code_verifier")).toBe("verifier-123");
    expect(tokenCall?.body.has("client_secret")).toBe(false);
  });

  it("returns a rotated refresh token from the refresh grant", async () => {
    stubIssuer();
    const mod = await loadGeneric();
    const tokens = await mod.refreshCognitoTokens("old-rt");
    expect(tokens.refresh_token).toBe("rotated-rt");
  });

  it("classifies an unreachable discovery document on refresh as TRANSIENT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const mod = await loadGeneric();
    const error = await mod.refreshCognitoTokens("rt").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(mod.CognitoRefreshError);
    expect((error as InstanceType<typeof mod.CognitoRefreshError>).kind).toBe(
      "transient"
    );
  });

  it("logs out through end_session_endpoint with id_token_hint", async () => {
    stubIssuer();
    const mod = await loadGeneric();
    await mod.startCognitoLogout("the.id.token");

    const url = new URL(assigned[0]);
    expect(`${url.origin}${url.pathname}`).toBe(DOC.end_session_endpoint);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("id_token_hint")).toBe("the.id.token");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(
      `${ORIGIN}/login`
    );
    expect(url.searchParams.has("logout_uri")).toBe(false);
  });

  it("signs out locally when the issuer advertises no end-session endpoint", async () => {
    const { end_session_endpoint: _omit, ...withoutLogout } = DOC;
    stubIssuer(withoutLogout);
    const mod = await loadGeneric();
    await mod.startCognitoLogout("the.id.token");
    expect(assigned).toEqual([`${ORIGIN}/login`]);
  });
});
