import { describe, expect, it } from "vitest";
import {
  buildCallbackRedirect,
  pairConfirmErrorMessage,
} from "./callback-redirect";

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

describe("pairConfirmErrorMessage", () => {
  it("uses a string detail verbatim", () => {
    expect(pairConfirmErrorMessage({ detail: "nope" }, 400)).toBe("nope");
  });
  it("explains a coord 403 for single- and multi-tenant flows alike", () => {
    expect(
      pairConfirmErrorMessage(
        { detail: { coord_status: 403, coord_body: "{}" } },
        502
      )
    ).toBe(
      "This account isn't a member of the workspace(s) this device asked to join."
    );
  });
  it("names another coord status", () => {
    expect(
      pairConfirmErrorMessage({ detail: { coord_status: 500 } }, 502)
    ).toBe("Pairing was refused (coord HTTP 500).");
  });
  it("falls back to message, then the HTTP status", () => {
    expect(pairConfirmErrorMessage({ message: "m" }, 500)).toBe("m");
    expect(pairConfirmErrorMessage(null, 500)).toBe(
      "Pair-confirm failed (HTTP 500)"
    );
  });
});
