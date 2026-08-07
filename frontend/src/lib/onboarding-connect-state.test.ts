/**
 * The `state` wire format and the two client-side guards around it.
 *
 * Plan `2026-07-26-coord-onboarding-claim-caller-tenant-binding` §4 P2. The
 * token is a FOURTH segment appended to `<flow>~<login>~<nonce>` — substituting
 * it for the whole value (the obvious reading of "use the token as the state")
 * would drop the bind-only marker and the claim target.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    get: vi.fn(),
  },
}));

import {
  beginConnectState,
  consumeNonce,
  isValidLogin,
  isValidRunnerState,
  mintConnectState,
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
  fetchMock.mockReset();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The JSON body of the last mint request, as actually sent. */
function lastMintBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("no connect-state mint was requested");
  return JSON.parse(String((call[1] as { body?: string }).body ?? "{}"));
}

describe("mintConnectState", () => {
  it("always sends the flow, and no target when none is known", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ connect_state: TOKEN }));

    await expect(mintConnectState({ flow: "runner-clone" })).resolves.toBe(
      TOKEN
    );
    expect(lastMintBody()).toEqual({ flow: "runner-clone" });
  });

  it("sends a target when the caller knows one before the GitHub hop", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ connect_state: TOKEN }));

    await mintConnectState({
      flow: "connect",
      targetLogin: "  acme-org  ",
      targetInstallationId: 4242,
    });

    expect(lastMintBody()).toEqual({
      flow: "connect",
      target_login: "acme-org",
      target_installation_id: 4242,
    });
  });

  it("omits an empty target rather than sending a blank one", async () => {
    // Coord distinguishes "this flow named no target" (skip the assertion)
    // from "this flow named a target" (assert it). A blank string would be a
    // third state with no meaning.
    fetchMock.mockResolvedValue(jsonResponse({ connect_state: TOKEN }));

    await mintConnectState({ flow: "connect", targetLogin: "   " });

    expect(lastMintBody()).toEqual({ flow: "connect" });
  });

  it("omits a non-finite installation id instead of emitting null", async () => {
    // `JSON.stringify({a: NaN})` is `{"a":null}` — a computed-and-failed id
    // (`Number(param)`) would otherwise emit exactly the explicit null the
    // omit-vs-null convention exists to avoid.
    fetchMock.mockResolvedValue(jsonResponse({ connect_state: TOKEN }));

    await mintConnectState({ flow: "connect", targetInstallationId: NaN });

    expect(lastMintBody()).toEqual({ flow: "connect" });
  });
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
      runnerState: null,
    });
  });
});

describe("runner return-nonce (P2 slot 5)", () => {
  const RUNNER_NONCE = "a".repeat(64);

  it("appends slot 5 and round-trips it alongside the connect-state token", () => {
    const state = beginConnectState(
      "runner-clone",
      "acme-org",
      TOKEN,
      RUNNER_NONCE
    );
    expect(state.split("~")).toHaveLength(5);

    expect(parseConnectState(state)).toMatchObject({
      flow: "runner-clone",
      login: "acme-org",
      connectState: TOKEN,
      runnerState: RUNNER_NONCE,
    });
  });

  it("keeps the exact 4-field shape when no runner nonce is supplied", () => {
    // A browser-only connect must be byte-compatible with the pre-P2 format,
    // so a callback in flight across the deploy still parses.
    for (const absent of [undefined, null, ""]) {
      const state = beginConnectState("connect", "acme", TOKEN, absent);
      expect(state.split("~")).toHaveLength(4);
      expect(parseConnectState(state)?.runnerState).toBeNull();
    }
  });

  it("drops a runner nonce that isn't runner-minted hex, rather than propagating it", () => {
    // This value is later interpolated into a `qontinui://` deep link, so a
    // non-hex value must never survive either ingress.
    for (const bad of ["not-hex", "aa", "a".repeat(200), "<script>"]) {
      expect(isValidRunnerState(bad)).toBe(false);
      // Outbound: refused at mint, so the state keeps the 4-field shape.
      expect(beginConnectState("runner-clone", "", TOKEN, bad).split("~"))
        .toHaveLength(4);
      // Inbound: a crafted 5-segment state parses to a null runnerState.
      const crafted = ["runner-clone", "acme", "f".repeat(32), TOKEN, bad].join(
        "~"
      );
      expect(parseConnectState(crafted)?.runnerState).toBeNull();
    }
  });

  it("drops a login that fails the GitHub-login shape", () => {
    // The login also flows into the deep link and the claim body.
    const crafted = [
      "connect",
      "bad login/../x",
      "f".repeat(32),
      TOKEN,
    ].join("~");
    expect(parseConnectState(crafted)?.login).toBeNull();
    expect(isValidLogin("acme-org")).toBe(true);
    expect(isValidLogin("-leading")).toBe(false);
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
