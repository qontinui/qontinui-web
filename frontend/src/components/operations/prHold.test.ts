import { describe, expect, it } from "vitest";
import {
  canOfferRelease,
  describeHoldError,
  holdKindLabel,
  holdViewOf,
  holderLabel,
  splitOwnerRepo,
} from "./prHold";

const HOLD = {
  held_by: "operator:abcdef12-0000-4000-8000-000000000000",
  reason: "r",
  kind: "manual",
  since: "2026-10-16T12:00:00Z",
};

describe("holdViewOf", () => {
  it("absent key is UNKNOWN, never not-held", () => {
    expect(holdViewOf({}).state).toBe("unknown");
  });
  it("hold_unknown wins over a null hold", () => {
    expect(holdViewOf({ hold: null, hold_unknown: true }).state).toBe(
      "unknown"
    );
  });
  it("null is a confident not-held", () => {
    expect(holdViewOf({ hold: null })).toEqual({ state: "not_held" });
  });
  it("a malformed hold is UNKNOWN", () => {
    expect(
      holdViewOf({ hold: { held_by: 1 } as unknown as typeof HOLD }).state
    ).toBe("unknown");
  });
  it("a hold whose `since` is missing or not a string is UNKNOWN", () => {
    const { since: _drop, ...noSince } = HOLD;
    void _drop;
    expect(holdViewOf({ hold: noSince as unknown as typeof HOLD }).state).toBe(
      "unknown"
    );
    expect(
      holdViewOf({ hold: { ...HOLD, since: 5 } as unknown as typeof HOLD })
        .state
    ).toBe("unknown");
    expect(holdViewOf({ hold: { ...HOLD, since: null } }).state).toBe("held");
  });
  it("a held row carries the hold and its foreignness", () => {
    const v = holdViewOf({ hold: HOLD });
    expect(v).toEqual({ state: "held", hold: HOLD, foreign: false });
    expect(canOfferRelease(v)).toBe(true);
    const f = holdViewOf({ hold: { ...HOLD, held_by: "another_tenant" } });
    expect(f.state === "held" && f.foreign).toBe(true);
    expect(canOfferRelease(f)).toBe(false);
  });
});

describe("labels", () => {
  it("names known kinds and passes unknown ones through", () => {
    expect(holdKindLabel("security_tier")).toBe("security review");
    expect(holdKindLabel("brand_new")).toBe("brand_new");
  });
  it("shortens actor keys", () => {
    expect(holderLabel(HOLD.held_by)).toBe("operator abcdef12");
    expect(holderLabel("coord")).toBe("coord");
    expect(holderLabel("another_tenant")).toBe("another tenant");
  });
});

describe("describeHoldError", () => {
  it("carries code and message, unwrapping `detail`", () => {
    expect(
      describeHoldError(
        403,
        JSON.stringify({
          detail: { error: "security_tier_operator_only", message: "m" },
        })
      )
    ).toBe("HTTP 403 — security_tier_operator_only — m");
  });
  it("reads coord's code from the envelope the web backend serves", () => {
    // The `/hold` proxy uses `structured_errors=True`, so the app's
    // http_exception_handler splices coord's object into the top level.
    expect(
      describeHoldError(
        403,
        JSON.stringify({
          error: "not_holder",
          message: "only the holder or an operator may release this hold",
          timestamp: 1,
          path: "/api/v1/operations/prs/o/r/1/hold",
        })
      )
    ).toBe(
      "HTTP 403 — not_holder — only the holder or an operator may release this hold"
    );
  });
  it("falls back to the raw body, then the bare status", () => {
    expect(describeHoldError(502, "bad gateway")).toBe(
      "HTTP 502 — bad gateway"
    );
    expect(describeHoldError(500, "")).toBe("HTTP 500");
  });
});

describe("splitOwnerRepo", () => {
  it("accepts owner/name only", () => {
    expect(splitOwnerRepo("a/b")).toEqual(["a", "b"]);
    expect(splitOwnerRepo("a")).toBeNull();
    expect(splitOwnerRepo("a/b/c")).toBeNull();
    expect(splitOwnerRepo("/b")).toBeNull();
  });
});
