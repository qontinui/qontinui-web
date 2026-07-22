/**
 * TokenRefreshService — silent Cognito refresh tests.
 *
 * BUG: the frontend stored the Cognito refresh token but never spent it, so
 * once the ID token's `exp` passed (the app client's `IdTokenValidity`) every
 * request 401'd and the user was bounced to `/login` — a hard logout roughly
 * every hour.
 *
 * FIX: `refreshAccessToken()` exchanges the stored refresh token on the Cognito
 * token endpoint (`grant_type=refresh_token`) and stores the returned
 * **id_token** as the bearer (the same convention `/auth/callback` uses at
 * login — only the ID token carries the identity claims the backend
 * provisions from). Concurrent callers share one exchange, and a proactive
 * timer renews shortly before `exp` instead of waiting for a 401.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TokenRefreshService } from "./token-refresh-service";
import { TokenValidator } from "./token-validator";
import type { TokenManager } from "./token-manager";
import { jwtExpiringAt } from "@/test/jwt";

const TOKEN_ENDPOINT = "https://auth.qontinui.io/oauth2/token";
const HOUR_MS = 60 * 60 * 1000;

/** Mirrors the service's MIN_PROACTIVE_DELAY_MS floor for a due-now wake-up. */
const MIN_DELAY_MS = 10 * 1000;

/** Mirrors the service's MAX_CONSECUTIVE_TRANSIENT_FAILURES backstop. */
const MAX_TRANSIENT_FAILURES = 5;

/** The real expiry extractor, so the fake TokenManager can't be too generous. */
const validator = new TokenValidator();

/**
 * Override `document.visibilityState`, which jsdom exposes as a prototype
 * getter (so a plain assignment is a no-op). Returns a restore function.
 */
function setVisibility(value: DocumentVisibilityState): () => void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
  return () => {
    delete (document as unknown as Record<string, unknown>).visibilityState;
  };
}

/**
 * A minimal stateful stand-in for TokenManager: enough state that the
 * proactive scheduler's expiry maths are exercised for real, with spies on the
 * mutations the service is expected to make.
 */
function makeTokenManager(opts: {
  refreshToken?: string | null;
  expiry?: number | null;
  authenticated?: boolean;
}) {
  const state = {
    // `??` would swallow an explicit `null` (the "no refresh token" case).
    refreshToken:
      opts.refreshToken === undefined
        ? "stored-refresh-token"
        : opts.refreshToken,
    expiry: opts.expiry === undefined ? Date.now() + HOUR_MS : opts.expiry,
    authenticated: opts.authenticated ?? true,
  };

  const tm = {
    state,
    getRefreshToken: vi.fn(() => state.refreshToken),
    getAccessTokenExpiry: vi.fn(() => state.expiry),
    isAuthenticated: vi.fn(() => state.authenticated),
    getTimeUntilExpiry: vi.fn(() =>
      state.expiry === null ? 0 : Math.max(0, state.expiry - Date.now())
    ),
    isAccessTokenExpiringSoon: vi.fn((thresholdMs: number) => {
      if (state.expiry === null) return false;
      const left = state.expiry - Date.now();
      return left < thresholdMs && left > 0;
    }),
    setTokens: vi.fn((tokens: { access_token: string; expires_in: number }) => {
      // Mirror the REAL TokenManager exactly: the expiry comes from the
      // bearer's own `exp` claim FIRST, `expires_in` only as a fallback. The
      // old stub derived it from `expires_in` alone — more generous than
      // production, and precisely what hid the base64url decoder bug that made
      // every refreshed token yield "no expiry".
      state.expiry =
        validator.extractExpiry(tokens.access_token) ??
        (tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null);
    }),
    clearTokens: vi.fn(() => {
      state.refreshToken = null;
      state.expiry = null;
      state.authenticated = false;
    }),
  };
  return tm;
}

type FakeTokenManager = ReturnType<typeof makeTokenManager>;

function asTokenManager(tm: FakeTokenManager): TokenManager {
  return tm as unknown as TokenManager;
}

interface CapturedCall {
  url: string;
  body: string;
  headers: HeadersInit | undefined;
}

/**
 * Stub fetch with a Cognito refresh-grant success, capturing the request.
 *
 * Mints a REAL decodable JWT per call (Cognito issues a fresh `exp` every
 * time), so the fake TokenManager's expiry maths runs against a production-
 * shaped token instead of a placeholder string. `idToken` pins the value when a
 * test needs to assert on it.
 */
function stubRefreshOk(expiresIn = 10800, idToken?: string): CapturedCall[] {
  const calls: CapturedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: String(init?.body ?? ""),
        headers: init?.headers,
      });
      return new Response(
        JSON.stringify({
          id_token: idToken ?? jwtExpiringAt(Date.now() + expiresIn * 1000),
          access_token: "new.access.token",
          expires_in: expiresIn,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    })
  );
  return calls;
}

/** Stub fetch with Cognito's rejection of a revoked/expired refresh token. */
function stubRefreshRejected() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Refresh Token has been revoked",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
    )
  );
}

/** Stub fetch with a TRANSIENT failure: the network never reached Cognito. */
function stubNetworkFailure(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Stub fetch with a TRANSIENT HTTP failure (5xx / 429 / anything non-verdict). */
function stubHttpFailure(status: number, body = "<html>gateway</html>") {
  const mock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Count `session-expired` window events fired while `run` executes. */
async function countSessionExpired(run: () => Promise<void>): Promise<number> {
  let count = 0;
  const listener = () => {
    count++;
  };
  window.addEventListener("session-expired", listener);
  try {
    await run();
  } finally {
    window.removeEventListener("session-expired", listener);
  }
  return count;
}

describe("TokenRefreshService.refreshAccessToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges the stored refresh token and stores the new ID token as the bearer", async () => {
    const freshIdToken = jwtExpiringAt(Date.now() + 10800 * 1000);
    const calls = stubRefreshOk(10800, freshIdToken);
    const tm = makeTokenManager({ refreshToken: "rt-abc" });
    const service = new TokenRefreshService(asTokenManager(tm));

    await expect(service.refreshAccessToken()).resolves.toBe(true);

    // One form-encoded POST to the Cognito token endpoint, refresh grant.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(TOKEN_ENDPOINT);
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-abc");
    expect(body.get("client_id")).toBeTruthy();
    // Public client — no secret, and PKCE binds the code grant, not this one.
    expect(body.get("client_secret")).toBeNull();
    expect(body.get("code_verifier")).toBeNull();

    // The ID token (not the access token) becomes the bearer, and the existing
    // refresh token is preserved — Cognito does not rotate it on this grant.
    expect(tm.setTokens).toHaveBeenCalledTimes(1);
    expect(tm.setTokens.mock.calls[0]![0]).toMatchObject({
      access_token: freshIdToken,
      refresh_token: "rt-abc",
      expires_in: 10800,
    });
    expect(tm.clearTokens).not.toHaveBeenCalled();
    // The stored expiry comes from the NEW bearer's own `exp` claim.
    expect(tm.state.expiry).toBe(validator.extractExpiry(freshIdToken));
  });

  it("does NOT move the stored refresh-token expiry (that grant returns no new refresh token)", async () => {
    stubRefreshOk();
    const tm = makeTokenManager({});
    const service = new TokenRefreshService(asTokenManager(tm));

    await service.refreshAccessToken();

    // Falsy `refresh_expires_in` => TokenManager skips saveRefreshTokenExpiry.
    expect(tm.setTokens.mock.calls[0]![0]).toMatchObject({
      refresh_expires_in: 0,
    });
  });

  it("single-flights concurrent callers onto ONE token exchange", async () => {
    const calls = stubRefreshOk();
    const tm = makeTokenManager({});
    const service = new TokenRefreshService(asTokenManager(tm));

    const results = await Promise.all([
      service.refreshAccessToken(),
      service.refreshAccessToken(),
      service.refreshAccessToken(),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(calls).toHaveLength(1);
    expect(tm.setTokens).toHaveBeenCalledTimes(1);
    // The mutex releases once settled, so a later refresh still works.
    expect(service.isRefreshing()).toBe(false);
    await service.refreshAccessToken();
    expect(calls).toHaveLength(2);
  });

  it("tears the session down once when Cognito rejects the refresh token", async () => {
    stubRefreshRejected();
    const tm = makeTokenManager({});
    const service = new TokenRefreshService(asTokenManager(tm));

    let result: boolean | undefined;
    const events = await countSessionExpired(async () => {
      result = await service.refreshAccessToken();
    });

    expect(result).toBe(false);
    expect(tm.clearTokens).toHaveBeenCalledTimes(1);
    expect(tm.setTokens).not.toHaveBeenCalled();
    expect(events).toBe(1);
  });

  it("tears the session down without a network call when no refresh token is stored", async () => {
    const calls = stubRefreshOk();
    const tm = makeTokenManager({ refreshToken: null });
    const service = new TokenRefreshService(asTokenManager(tm));

    let result: boolean | undefined;
    const events = await countSessionExpired(async () => {
      result = await service.refreshAccessToken();
    });

    expect(result).toBe(false);
    expect(calls).toHaveLength(0);
    expect(tm.clearTokens).toHaveBeenCalledTimes(1);
    expect(events).toBe(1);
  });

  /**
   * C1 — the proactive timer fires SIX MINUTES BEFORE `exp`, while the bearer
   * is still perfectly valid. Treating a blip there as a dead session throws a
   * working token away and bounces the user to /login six minutes early, once
   * per token cycle. Only an AUTHORITATIVE rejection may tear down.
   */
  describe("transient vs authoritative failure", () => {
    const TRANSIENT_CASES: [string, () => unknown][] = [
      ["a network/fetch failure (offline, DNS, CORS)", () => stubNetworkFailure()],
      ["a Cognito 500", () => stubHttpFailure(500)],
      ["a Cognito 502 with a non-JSON body", () => stubHttpFailure(502)],
      ["a 429 rate-limit", () => stubHttpFailure(429, '{"error":"slow_down"}')],
      [
        "a 400 that is NOT invalid_grant",
        () => stubHttpFailure(400, '{"error":"temporarily_unavailable"}'),
      ],
    ];

    for (const [label, stub] of TRANSIENT_CASES) {
      it(`keeps the session on ${label}`, async () => {
        stub();
        const tm = makeTokenManager({});
        const service = new TokenRefreshService(asTokenManager(tm));

        let result: boolean | undefined;
        const events = await countSessionExpired(async () => {
          result = await service.refreshAccessToken();
        });

        // No usable token, but the session is NOT torn down: the refresh token
        // may well still be good, and the bearer is very likely still valid.
        expect(result).toBe(false);
        expect(tm.clearTokens).not.toHaveBeenCalled();
        expect(events).toBe(0);
        expect(tm.state.refreshToken).toBe("stored-refresh-token");
      });
    }

    it("reports the failure class through refreshWithOutcome()", async () => {
      stubNetworkFailure();
      const tm = makeTokenManager({});
      const service = new TokenRefreshService(asTokenManager(tm));
      await expect(service.refreshWithOutcome()).resolves.toBe("transient");

      stubRefreshRejected();
      const dead = makeTokenManager({});
      const deadService = new TokenRefreshService(asTokenManager(dead));
      await expect(deadService.refreshWithOutcome()).resolves.toBe("expired");
    });

    it("tears down on a 401 (authoritative)", async () => {
      stubHttpFailure(401, '{"error":"invalid_client"}');
      const tm = makeTokenManager({});
      const service = new TokenRefreshService(asTokenManager(tm));

      const events = await countSessionExpired(async () => {
        await service.refreshAccessToken();
      });

      expect(tm.clearTokens).toHaveBeenCalledTimes(1);
      expect(events).toBe(1);
    });

    it("recovers on the next attempt after a transient failure", async () => {
      stubNetworkFailure();
      const tm = makeTokenManager({});
      const service = new TokenRefreshService(asTokenManager(tm));
      expect(await service.refreshAccessToken()).toBe(false);

      // The refresh token survived the blip, so the retry just works.
      stubRefreshOk();
      expect(await service.refreshAccessToken()).toBe(true);
      expect(tm.clearTokens).not.toHaveBeenCalled();
    });

    it("eventually expires after a bounded run of consecutive transient failures", async () => {
      // The backstop against "401ing forever with no recovery": a session that
      // can never be renewed must not stay half-alive indefinitely.
      stubNetworkFailure();
      const tm = makeTokenManager({});
      const service = new TokenRefreshService(asTokenManager(tm));

      const events = await countSessionExpired(async () => {
        for (let i = 0; i < MAX_TRANSIENT_FAILURES - 1; i++) {
          expect(await service.refreshAccessToken()).toBe(false);
          expect(tm.clearTokens).not.toHaveBeenCalled();
        }
        expect(await service.refreshAccessToken()).toBe(false);
      });

      expect(tm.clearTokens).toHaveBeenCalledTimes(1);
      expect(events).toBe(1);
    });

    it("a success resets the consecutive-failure count", async () => {
      const tm = makeTokenManager({});
      const service = new TokenRefreshService(asTokenManager(tm));

      stubNetworkFailure();
      for (let i = 0; i < MAX_TRANSIENT_FAILURES - 1; i++) {
        await service.refreshAccessToken();
      }
      stubRefreshOk();
      expect(await service.refreshAccessToken()).toBe(true);

      // Budget is back to full — one more failure must NOT trip the backstop.
      stubNetworkFailure();
      await service.refreshAccessToken();
      expect(tm.clearTokens).not.toHaveBeenCalled();
    });
  });

  /**
   * M1 — three other 401 handlers (`lib/api-client`, `lib/api-client/client`,
   * `services/workflow-templates-api`) call `refreshAccessToken()` on ANY 401
   * with no fire-once flag of their own, and polling consumers re-enter on
   * every tick. The guard therefore lives here, not in HttpClient.
   */
  it("dispatches session-expired at most ONCE however many callers re-enter after a teardown", async () => {
    stubRefreshRejected();
    const tm = makeTokenManager({});
    const service = new TokenRefreshService(asTokenManager(tm));

    const events = await countSessionExpired(async () => {
      // First 401: the real teardown.
      await service.refreshAccessToken();
      // Every later 401 from an unguarded caller: the refresh token is gone, so
      // this lands in the "no refresh token" branch, which used to re-dispatch.
      for (let i = 0; i < 5; i++) {
        expect(await service.refreshAccessToken()).toBe(false);
      }
    });

    expect(events).toBe(1);
  });
});

describe("TokenRefreshService proactive refresh", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renews shortly BEFORE expiry, then re-arms on the new expiry", async () => {
    // A real, decodable ID token per exchange — exactly what Cognito returns —
    // so the re-arm is driven by the new bearer's own `exp`, the way production
    // derives it. With the old placeholder `id_token` this passed even though
    // production could not read an expiry off the token at all.
    const calls = stubRefreshOk(10800);
    const tm = makeTokenManager({ expiry: Date.now() + HOUR_MS });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    // Nothing yet — the token is nowhere near its expiry.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(calls).toHaveLength(0);

    // Cross into the lead window (renewal is due before `exp`, not after).
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(calls).toHaveLength(1);
    const renewed = tm.setTokens.mock.calls[0]![0] as { access_token: string };
    expect(validator.extractExpiry(renewed.access_token)).toBe(tm.state.expiry);
    expect(tm.state.expiry).toBeGreaterThan(Date.now() + 2 * HOUR_MS);

    // Re-armed against the refreshed 3h expiry: renews again, and the session
    // never lapses.
    await vi.advanceTimersByTimeAsync(3 * HOUR_MS);
    expect(calls).toHaveLength(2);

    service.stop();
  });

  it("arms no timer while signed out", async () => {
    const calls = stubRefreshOk();
    const tm = makeTokenManager({ authenticated: false });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    await vi.advanceTimersByTimeAsync(6 * HOUR_MS);

    expect(calls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    service.stop();
  });

  it("arms no timer while the tab is hidden, and catches up when it becomes visible", async () => {
    const calls = stubRefreshOk();
    const tm = makeTokenManager({ expiry: Date.now() + 60 * 1000 });
    const service = new TokenRefreshService(asTokenManager(tm));

    let restore = setVisibility("hidden");
    try {
      service.start();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2 * HOUR_MS);
      expect(calls).toHaveLength(0);

      // Foreground again: the bearer lapsed while the tab slept, so renew now
      // rather than waiting for a request to 401.
      restore();
      restore = setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));

      await vi.waitFor(() => expect(calls).toHaveLength(1));
    } finally {
      restore();
      service.stop();
    }
  });

  it("stop() disarms the timer and detaches the visibility listener", async () => {
    const calls = stubRefreshOk();
    const tm = makeTokenManager({ expiry: Date.now() + HOUR_MS });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    expect(vi.getTimerCount()).toBe(1);
    service.stop();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(6 * HOUR_MS);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(0);
  });

  it("stops rescheduling once the refresh token is rejected (no retry loop)", async () => {
    stubRefreshRejected();
    // Remaining life (60s) is shorter than the 6-minute lead window, so the
    // scheduler renews at the halfway point rather than instantly.
    const tm = makeTokenManager({ expiry: Date.now() + 60 * 1000 });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    await vi.advanceTimersByTimeAsync(30 * 1000);
    await vi.waitFor(() => expect(tm.clearTokens).toHaveBeenCalledTimes(1));

    // Session is dead — nothing is left armed to hammer the token endpoint.
    expect(vi.getTimerCount()).toBe(0);
    service.stop();
  });

  it("never schedules a wake-up below the floor, even for an already-lapsed token", () => {
    stubRefreshOk();
    // Expired, but the marker still says authenticated (a tab returning after
    // a long sleep). The floor must keep the timer off a zero-delay hot loop.
    const tm = makeTokenManager({ expiry: Date.now() - HOUR_MS });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    expect(vi.getTimerCount()).toBe(1);
    // Nothing has fired yet — the wake-up is at least MIN_DELAY_MS out.
    vi.advanceTimersByTime(MIN_DELAY_MS - 1);
    expect(tm.setTokens).not.toHaveBeenCalled();

    service.stop();
  });

  /**
   * C1, proactive half — the wake-up lands SIX MINUTES BEFORE `exp` on a bearer
   * the backend still accepts. A blip there must cost the user nothing.
   */
  it("keeps the session and retries with backoff when the pre-expiry renewal fails transiently", async () => {
    const failing = stubNetworkFailure();
    // 60s of life left: shorter than the lead window, so the wake-up is at the
    // halfway point (30s) and the bearer is STILL VALID when it fires.
    const tm = makeTokenManager({ expiry: Date.now() + 60 * 1000 });
    const service = new TokenRefreshService(asTokenManager(tm));

    let expiredEvents = 0;
    const onExpired = () => {
      expiredEvents++;
    };
    window.addEventListener("session-expired", onExpired);
    try {
      service.start();
      await vi.advanceTimersByTimeAsync(31 * 1000);

      expect(failing).toHaveBeenCalledTimes(1);
      // The working token was NOT discarded and nobody was logged out.
      expect(tm.clearTokens).not.toHaveBeenCalled();
      expect(expiredEvents).toBe(0);
      // ...and the session is not left unrenewable: a retry is armed.
      expect(vi.getTimerCount()).toBe(1);

      // The backoff retry succeeds and the session carries on.
      const ok = stubRefreshOk();
      await vi.advanceTimersByTimeAsync(31 * 1000);
      expect(ok).toHaveLength(1);
      expect(tm.clearTokens).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("session-expired", onExpired);
      service.stop();
    }
  });

  it("backs off rather than hammering the token endpoint while it keeps failing", async () => {
    const failing = stubNetworkFailure();
    const tm = makeTokenManager({ expiry: Date.now() + 60 * 1000 });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    // Five minutes of a dead token endpoint. Without a backoff the 10s floor
    // would mean ~30 exchanges; the bound is the consecutive-failure backstop.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(failing.mock.calls.length).toBeLessThanOrEqual(
      MAX_TRANSIENT_FAILURES
    );
    service.stop();
  });

  /**
   * C3 — an unresolvable expiry used to make every wake-up look "due", so the
   * scheduler re-armed on its 10-second floor and spent a Cognito token
   * exchange each time (six exchanges in 60s of fake time, forever).
   */
  it("does NOT hot-loop the token endpoint when the refreshed bearer yields no usable expiry", async () => {
    // Cognito hands back something this client cannot read an `exp` from, and
    // no `expires_in` to fall back on.
    const calls = stubRefreshOk(0, "not-a-jwt");
    const tm = makeTokenManager({ expiry: Date.now() - 1000 });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    await vi.advanceTimersByTimeAsync(60 * 1000);

    // One probe, then a long backoff — not one every ten seconds.
    expect(calls.length).toBeLessThanOrEqual(2);
    service.stop();
  });

  it("does not go permanently dead when no expiry is known at all", async () => {
    // The other C3 variant: a first login whose bearer carries no readable
    // expiry left the scheduler silently disarmed for the life of the tab.
    const calls = stubRefreshOk();
    const tm = makeTokenManager({ expiry: null });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    expect(calls.length).toBeGreaterThan(0);
    // ...and having recovered a decodable expiry, it schedules normally again.
    expect(tm.state.expiry).not.toBeNull();
    service.stop();
  });

  it("stays disarmed when there is no refresh token to spend (cookie-restored session)", async () => {
    // No bearer, no expiry, no refresh token — probing could only end in a
    // teardown, which would sign out a perfectly good cookie session.
    const calls = stubRefreshOk();
    const tm = makeTokenManager({ expiry: null, refreshToken: null });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    await vi.advanceTimersByTimeAsync(6 * HOUR_MS);

    expect(calls).toHaveLength(0);
    expect(tm.clearTokens).not.toHaveBeenCalled();
    service.stop();
  });
});
