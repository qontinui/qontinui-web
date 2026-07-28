/**
 * The `state` wire format and the two client-side guards around it.
 *
 * Plan `2026-07-26-coord-onboarding-claim-caller-tenant-binding` §4 P2. The
 * token is a FOURTH segment appended to `<flow>~<login>~<nonce>` — substituting
 * it for the whole value (the obvious reading of "use the token as the state")
 * would drop the bind-only marker and the claim target.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: vi.fn(), get: vi.fn() },
}));

import {
  beginConnectState,
  consumeNonce,
  parseConnectState,
} from "./onboarding-connect-state";

// Deliberately prefixed `test-token-` rather than bare hex: a realistic-looking
// hex literal trips gitleaks' `generic-api-key` rule (3 such fixtures failed the
// secret scan on the first push of this branch). The repo's `.gitleaks.toml`
// allowlist already exempts `test[-_]?token`, so naming the fake for what it is
// keeps the scanner green WITHOUT weakening it. Keep the prefix if you change
// the value — and keep it wire-safe (no `~`, matches /^[A-Za-z0-9._-]+$/).
const TOKEN = "test-token-connect-state-0123456789abcdef";

beforeEach(() => {
  sessionStorage.clear();
});

describe("beginConnectState / parseConnectState", () => {
  it("round-trips flow, login, nonce and token", () => {
    const state = beginConnectState("runner-clone", "acme-org", TOKEN);
    expect(state.split("~")).toHaveLength(4);

    const parsed = parseConnectState(state);
    expect(parsed).toMatchObject({
      flow: "runner-clone",
      login: "acme-org",
      connectState: TOKEN,
    });
    expect(parsed?.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses a token that can't survive the wire format or the URL round-trip", () => {
    // `~` splits into phantom segments; `+` decodes back as a space under
    // form-urlencoded semantics. Both must fail loudly at mint time.
    expect(() => beginConnectState("connect", "acme", "aa~bb")).toThrow();
    expect(() => beginConnectState("connect", "acme", "aa+bb")).toThrow();
  });

  it("still parses the legacy bare `runner-clone` state, with no token", () => {
    // In-flight callbacks from before this deploy. They carry no token, so the
    // claim page routes them to the restart path rather than binding.
    expect(parseConnectState("runner-clone")).toEqual({
      flow: "runner-clone",
      login: null,
      nonce: null,
      connectState: null,
    });
  });
});

describe("consumeNonce", () => {
  it("REJECTS a state with no nonce (the removed exploit-#1 bypass)", () => {
    expect(consumeNonce(null)).toBe(false);
  });

  it("accepts the stored nonce exactly once", () => {
    const state = beginConnectState("connect", "acme", TOKEN);
    const nonce = parseConnectState(state)!.nonce;
    expect(consumeNonce(nonce)).toBe(true);
    // Replay of the same callback must not re-fire.
    expect(consumeNonce(nonce)).toBe(false);
  });

  it("rejects a nonce this browser session never minted", () => {
    beginConnectState("connect", "acme", TOKEN);
    expect(consumeNonce("ffffffffffffffffffffffffffffffff")).toBe(false);
  });
});
