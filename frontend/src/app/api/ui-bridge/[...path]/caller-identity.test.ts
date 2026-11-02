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
import {
  bodyWithoutCallerIdentity,
  registrationBodyWithCallerId,
  urlWithoutCallerIdentity,
} from "./_caller-identity";

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

describe("urlWithoutCallerIdentity", () => {
  const BASE = "https://qontinui.io/api/ui-bridge/control/snapshot";

  it("returns null when the query names no caller", () => {
    expect(urlWithoutCallerIdentity(`${BASE}?recency=any&tabId=t1`)).toBeNull();
    expect(urlWithoutCallerIdentity(BASE)).toBeNull();
  });

  it("drops both spellings and keeps every other parameter", () => {
    const out = new URL(
      urlWithoutCallerIdentity(
        `${BASE}?recency=any&__callerUserId=victim&tabId=t1&callerUserId=victim`
      ) as string
    );
    expect([...out.searchParams.entries()]).toEqual([
      ["recency", "any"],
      ["tabId", "t1"],
    ]);
  });

  it("drops every occurrence of a repeated key", () => {
    const out = new URL(
      urlWithoutCallerIdentity(
        `${BASE}?callerUserId=a&callerUserId=b&__callerUserId=c&__callerUserId=d`
      ) as string
    );
    expect(out.searchParams.toString()).toBe("");
  });

  it("matches the decoded name, as the SDK reads it", () => {
    const out = new URL(
      urlWithoutCallerIdentity(
        `${BASE}?%5F%5FcallerUserId=victim&caller%55serId=victim`
      ) as string
    );
    expect(out.searchParams.has("__callerUserId")).toBe(false);
    expect(out.searchParams.has("callerUserId")).toBe(false);
  });

  it("leaves other spellings alone: the SDK reads exact names only", () => {
    expect(
      urlWithoutCallerIdentity(
        `${BASE}?CallerUserId=x&caller_user_id=y&_callerUserId=z`
      )
    ).toBeNull();
  });
});

describe("bodyWithoutCallerIdentity", () => {
  it("returns null for a body that names no caller, or is not a JSON object", () => {
    expect(bodyWithoutCallerIdentity({ text: "Save" })).toBeNull();
    expect(bodyWithoutCallerIdentity([{ callerUserId: "victim" }])).toBeNull();
    expect(bodyWithoutCallerIdentity("callerUserId")).toBeNull();
    expect(bodyWithoutCallerIdentity(null)).toBeNull();
    expect(bodyWithoutCallerIdentity(undefined)).toBeNull();
  });

  it("drops both top-level spellings and keeps every other field", () => {
    expect(
      bodyWithoutCallerIdentity({
        text: "Save",
        callerUserId: "victim",
        __callerUserId: "victim",
      })
    ).toEqual({ text: "Save" });
  });

  it("drops __callerUserId from the nested request object, where the relay also reads it", () => {
    expect(
      bodyWithoutCallerIdentity({
        id: "e1",
        request: { action: "click", __callerUserId: "victim" },
      })
    ).toEqual({ id: "e1", request: { action: "click" } });
  });

  it("leaves fields the SDK does not read as a caller identity", () => {
    expect(
      bodyWithoutCallerIdentity({
        request: { callerUserId: "x" },
        params: { __callerUserId: "x" },
        CallerUserId: "x",
      })
    ).toBeNull();
  });

  it("never mutates the parsed body", () => {
    const body = {
      callerUserId: "victim",
      request: { __callerUserId: "victim" },
    };
    bodyWithoutCallerIdentity(body);
    expect(body).toEqual({
      callerUserId: "victim",
      request: { __callerUserId: "victim" },
    });
  });
});
