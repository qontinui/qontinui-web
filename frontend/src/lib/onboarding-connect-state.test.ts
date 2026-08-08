/**
 * The `state` wire format and the two client-side guards around it.
 *
 * Plan `2026-07-26-coord-onboarding-claim-caller-tenant-binding` §4 P2. The
 * token is a FOURTH segment appended to `<flow>~<login>~<nonce>` — substituting
 * it for the whole value (the obvious reading of "use the token as the state")
 * would drop the bind-only marker and the claim target.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    get: vi.fn(),
  },
}));

import {
  assertNonceStorageAvailable,
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

/**
 * A browser that BLOCKS sessionStorage — Safari private mode, an ITP-partitioned
 * third-party context, a quota error, a storage-blocking extension.
 *
 * Both halves must fail closed, and they must fail closed TOGETHER (plan
 * `2026-08-01-connect-state-residual-hardenings` P1 / F4):
 *
 * - `consumeNonce` used to `return true` here, so `consumeNonce(<anything>)`
 *   passed and the whole same-tab check was bypassed in exactly the contexts
 *   where a crafted callback is cheapest to land.
 * - `beginConnectState` used to swallow the identical failure at the OUTBOUND
 *   end. Fixing only the inbound half would leave that population minting a
 *   nonce it cannot store, failing the callback, landing on the recover card,
 *   and re-entering `beginConnectState` — for ever, spending a fresh OAuth code
 *   and a fresh single-use connect-state token every lap.
 *
 * Hence the third test: the failure must surface BEFORE anything is spent.
 */
describe("storage-blocked browser (fail closed at BOTH ends)", () => {
  /** Make the named sessionStorage accessors throw, as a blocked browser does. */
  function blockStorage(
    accessors: ("getItem" | "setItem" | "removeItem")[]
  ): void {
    for (const accessor of accessors) {
      vi.spyOn(Storage.prototype, accessor).mockImplementation(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      });
    }
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT let the claim proceed when `getItem` throws", () => {
    // Pre-seed a real nonce first, so the ONLY reason this rejects is the throw
    // — not an empty store. This is the exact bypass that used to return true.
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", "f".repeat(32));
    blockStorage(["getItem"]);

    expect(consumeNonce("f".repeat(32))).toBe(false);
    // …and no attacker-chosen value slips through either.
    expect(consumeNonce("whatever-the-attacker-put-in-the-url")).toBe(false);
  });

  it("THROWS from `beginConnectState` when `setItem` throws", () => {
    blockStorage(["setItem"]);

    // Not "returns a state with no nonce" and not "returns one anyway": either
    // would hand GitHub a state this browser can never verify on the way back.
    expect(() => beginConnectState("connect", "acme", TOKEN)).toThrow(
      /session storage/i
    );
  });

  it("spends nothing at all when both throw — the probe fires before the mint", async () => {
    // The no-loop regression, in the order a real entry point runs it. The mint
    // is stubbed to SUCCEED, so if either guard regressed this would go green
    // with a usable `state` in hand — which is the bug, not the fix.
    fetchMock.mockResolvedValue(jsonResponse({ connect_state: TOKEN }));
    blockStorage(["getItem", "setItem"]);

    // 1. The probe throws first, so `mintConnectState` is never reached: no
    //    OAuth code, and no connect-state row against the tenant's quota.
    expect(() => assertNonceStorageAvailable()).toThrow(/session storage/i);
    expect(fetchMock).not.toHaveBeenCalled();

    // 2. The backstop still holds independently, for a call site that somehow
    //    skipped the probe — so the guarantee is not merely a calling
    //    convention. (Reached here only because the test calls it directly.)
    const token = await mintConnectState({ flow: "connect" });
    expect(() => beginConnectState("connect", "acme", token)).toThrow(
      /session storage/i
    );

    // 3. And the inbound half would have refused it anyway — the ends agree,
    //    which is what stops the recover-card loop rather than relocating it.
    expect(consumeNonce("f".repeat(32))).toBe(false);
  });

  it("both guards raise the SAME message, so no caller can fork on them", () => {
    // They are one failure detected at two points. A caller that could tell
    // them apart would be encoding a difference that does not exist.
    blockStorage(["setItem"]);

    let fromProbe = "";
    let fromBegin = "";
    try {
      assertNonceStorageAvailable();
    } catch (e) {
      fromProbe = (e as Error).message;
    }
    try {
      beginConnectState("connect", "acme", TOKEN);
    } catch (e) {
      fromBegin = (e as Error).message;
    }
    expect(fromProbe).not.toBe("");
    expect(fromProbe).toBe(fromBegin);
  });

  it("is a no-op on a healthy browser and leaves no probe key behind", () => {
    // The probe must not become a permanent write, and must not consume the
    // real nonce key — an in-flight connect in this tab has one stored.
    sessionStorage.setItem("qontinui.onboarding_connect_nonce", "a".repeat(32));

    expect(() => assertNonceStorageAvailable()).not.toThrow();

    expect(sessionStorage.getItem("qontinui.onboarding_connect_probe")).toBeNull();
    expect(sessionStorage.getItem("qontinui.onboarding_connect_nonce")).toBe(
      "a".repeat(32)
    );
  });

  it("does NOT fail the connect when only the probe's own cleanup throws", () => {
    // A store that accepted the write but refuses the delete has not told us
    // the nonce write will fail — which is the only thing this probe is asking
    // about. Throwing here would block a connect that can actually complete, so
    // the cleanup is best-effort and the stale scratch byte is the price.
    blockStorage(["removeItem"]);

    expect(() => assertNonceStorageAvailable()).not.toThrow();
  });
});
