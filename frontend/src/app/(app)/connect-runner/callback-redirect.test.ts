import { describe, expect, it } from "vitest";
import { buildCallbackRedirect } from "./callback-redirect";

const CALLBACK = "http://127.0.0.1:43210/auth/runner-token-callback";
const STATE = "a".repeat(64);
const DEVICE_ID = "00000000-0000-0000-0000-deadbeefcafe";

describe("buildCallbackRedirect", () => {
  it("legacy flow carries state, token and token_id", () => {
    const url = buildCallbackRedirect(CALLBACK, STATE, {
      device_id: DEVICE_ID,
      token: "device-jwt",
      state: STATE,
    });
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.get("token")).toBe("device-jwt");
    expect(url.searchParams.get("token_id")).toBe(DEVICE_ID);
    expect(url.searchParams.has("collect")).toBe(false);
  });

  it("collect mode never puts a token in the URL, even when one is returned", () => {
    const url = buildCallbackRedirect(CALLBACK, STATE, {
      device_id: DEVICE_ID,
      token: "first-tenant-jwt",
      state: STATE,
      collect: true,
    });
    expect(url.origin + url.pathname).toBe(CALLBACK);
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.get("token_id")).toBe(DEVICE_ID);
    expect(url.searchParams.get("collect")).toBe("1");
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.toString()).not.toContain("first-tenant-jwt");
  });

  it("legacy flow without a token is an error, not a tokenless redirect", () => {
    expect(() =>
      buildCallbackRedirect(CALLBACK, STATE, {
        device_id: DEVICE_ID,
        state: STATE,
      })
    ).toThrow(/missing the device token/);
  });
});
