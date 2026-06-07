/**
 * caller-identity.test.ts
 *
 * Unit tests for `registrationBodyWithCallerId` — the relay route's
 * server-authoritative rewrite of `registrationMetadata.userId`.
 *
 * Regression context: the SDK relay keys tab OWNERSHIP on register/heartbeat by
 * the browser-supplied `registrationMetadata.userId` (= `JWT.sub`) but FILTERS
 * on list by the server-verified `X-Caller-User-Id` (the backend user id). For
 * a Cognito bearer / email-linked account those ids diverge, so the tab
 * registers under one id and the lookup queries another → invisible tab → the
 * co-pilot reports "no connected tab". This rewrite forces ownership to the
 * verified id so the two always agree.
 */

import { describe, expect, it } from "vitest";
import { registrationBodyWithCallerId } from "./_caller-identity";

const VERIFIED = "933aeebe-7bea-42c5-b6a0-144a0347a27b"; // backend user id
const SUB = "c408d428-0000-4000-8000-000000000000"; // a divergent JWT.sub

describe("registrationBodyWithCallerId", () => {
  it("forces registrationMetadata.userId to the verified id when they differ", () => {
    const out = registrationBodyWithCallerId(
      { type: "heartbeat", registrationMetadata: { userId: SUB, sessionId: "s1" } },
      VERIFIED,
    );
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out as string);
    expect(parsed.registrationMetadata.userId).toBe(VERIFIED);
    // other fields preserved
    expect(parsed.type).toBe("heartbeat");
    expect(parsed.registrationMetadata.sessionId).toBe("s1");
  });

  it("returns null (no rewrite) when the userId already matches", () => {
    expect(
      registrationBodyWithCallerId(
        { registrationMetadata: { userId: VERIFIED } },
        VERIFIED,
      ),
    ).toBeNull();
  });

  it("returns null when there is no registrationMetadata", () => {
    expect(
      registrationBodyWithCallerId({ action: "click", payload: {} }, VERIFIED),
    ).toBeNull();
    expect(registrationBodyWithCallerId({}, VERIFIED)).toBeNull();
  });

  it("returns null for non-object bodies (GET / empty / malformed)", () => {
    expect(registrationBodyWithCallerId(null, VERIFIED)).toBeNull();
    expect(registrationBodyWithCallerId(undefined, VERIFIED)).toBeNull();
    expect(registrationBodyWithCallerId("not-json", VERIFIED)).toBeNull();
    expect(
      registrationBodyWithCallerId({ registrationMetadata: "nope" }, VERIFIED),
    ).toBeNull();
  });

  it("preserves unrelated registrationMetadata fields while overriding userId", () => {
    const out = registrationBodyWithCallerId(
      {
        registrationMetadata: { userId: SUB, appName: "copilot", tabId: "t9" },
      },
      VERIFIED,
    );
    const parsed = JSON.parse(out as string);
    expect(parsed.registrationMetadata).toEqual({
      userId: VERIFIED,
      appName: "copilot",
      tabId: "t9",
    });
  });
});
