import { describe, it, expect, beforeEach } from "vitest";

import {
  buildLoginState,
  verifyStateAndExtractNext,
  isLinkModeState,
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
