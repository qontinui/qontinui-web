/**
 * dev-local-auth handoff tests.
 *
 * Asserts the two load-bearing contracts:
 *   1. Flag OFF  -> strict no-op: setTokens is never called and the localStorage
 *      handoff key is left untouched (real login flow unaffected).
 *   2. Flag ON + token present -> the token is replayed through the real
 *      TokenManager.setTokens path AND the one-shot localStorage key is cleared.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  consumeDevLocalAuthToken,
  DEV_LOCAL_AUTH_TOKEN_KEY,
} from "./dev-local-auth";
import { TokenManager } from "./token-manager";
import { TokenStorage } from "./token-storage";
import { TokenValidator } from "./token-validator";
import { jwtExpiringAt } from "@/test/jwt";

const HOUR_MS = 60 * 60 * 1000;

function makeManager(): TokenManager {
  return new TokenManager(new TokenStorage(), new TokenValidator());
}

describe("consumeDevLocalAuthToken", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a strict no-op when the flag is OFF, even with a token present", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEV_LOCAL_AUTH", "");
    const manager = makeManager();
    const setTokens = vi.spyOn(manager, "setTokens");
    localStorage.setItem(DEV_LOCAL_AUTH_TOKEN_KEY, jwtExpiringAt(Date.now() + HOUR_MS));

    const consumed = consumeDevLocalAuthToken(manager);

    expect(consumed).toBe(false);
    expect(setTokens).not.toHaveBeenCalled();
    // Key left untouched — nothing consumed it.
    expect(localStorage.getItem(DEV_LOCAL_AUTH_TOKEN_KEY)).not.toBeNull();
    expect(manager.getAccessToken()).toBeNull();
  });

  it("is a no-op when the flag is ON but no token is present", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEV_LOCAL_AUTH", "1");
    const manager = makeManager();
    const setTokens = vi.spyOn(manager, "setTokens");

    expect(consumeDevLocalAuthToken(manager)).toBe(false);
    expect(setTokens).not.toHaveBeenCalled();
  });

  it("consumes the token via setTokens and clears the one-shot key when flag is ON", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEV_LOCAL_AUTH", "1");
    const manager = makeManager();
    const setTokens = vi.spyOn(manager, "setTokens");
    const token = jwtExpiringAt(Date.now() + HOUR_MS);
    localStorage.setItem(DEV_LOCAL_AUTH_TOKEN_KEY, token);

    const consumed = consumeDevLocalAuthToken(manager);

    expect(consumed).toBe(true);
    expect(setTokens).toHaveBeenCalledTimes(1);
    expect(setTokens).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: token, token_type: "bearer" })
    );
    // The bearer landed in storage the same way a real login lands it...
    expect(manager.getAccessToken()).toBe(token);
    // ...and the one-shot handoff key is gone so it never re-fires on reload.
    expect(localStorage.getItem(DEV_LOCAL_AUTH_TOKEN_KEY)).toBeNull();
  });
});
