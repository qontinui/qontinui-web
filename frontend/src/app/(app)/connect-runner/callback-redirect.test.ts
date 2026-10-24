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
  it("reports a validation 422 as an invalid link, not a coord refusal", () => {
    const message = pairConfirmErrorMessage(
      {
        detail: [
          {
            loc: ["body", "state"],
            msg: "String should have at least 8 characters",
          },
        ],
      },
      422
    );
    expect(message).toBe(
      "This pairing link is invalid (HTTP 422: String should have at least 8 characters). Start pairing again from your device."
    );
    expect(message).not.toContain("coord");
  });
  it("reports the app handler's VALIDATION_ERROR envelope as an invalid link", () => {
    expect(
      pairConfirmErrorMessage(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid request data",
          details: [
            {
              field: "body.state",
              message: "String should have at least 8 characters",
              type: "string_too_short",
            },
          ],
        },
        422
      )
    ).toBe(
      "This pairing link is invalid (HTTP 422: String should have at least 8 characters). Start pairing again from your device."
    );
  });
  it("maps a refusal the app handler spread to the top level, ignoring its generic message", () => {
    // What production sends: http_exception_handler lifts the detail's
    // fields beside `error` / `message` instead of nesting them.
    expect(
      pairConfirmErrorMessage(
        {
          error: "BAD_GATEWAY",
          message:
            "Coord refused pairing (HTTP 403: device_owned_by_other_user).",
          coord_status: 403,
          coord_body: "{}",
          coord_code: "device_owned_by_other_user",
          timestamp: 1,
          path: "/api/v1/devices/pair-confirm",
        },
        502
      )
    ).toBe("This device is already paired to a different account.");
  });
  it("relays a top-level coord outage message verbatim", () => {
    expect(
      pairConfirmErrorMessage(
        {
          error: "SERVICE_UNAVAILABLE",
          message: "Coord is restarting; retry.",
        },
        503
      )
    ).toBe("Coord is restarting; retry.");
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
  it("maps coord's refusal code instead of assuming membership", () => {
    expect(
      pairConfirmErrorMessage(
        { detail: { coord_status: 403, coord_code: "probe_failed" } },
        502
      )
    ).toBe("Coord hit a temporary error while pairing. Try again shortly.");
    expect(
      pairConfirmErrorMessage(
        {
          detail: {
            coord_status: 403,
            coord_code: "device_owned_by_other_user",
          },
        },
        502
      )
    ).toBe("This device is already paired to a different account.");
    expect(
      pairConfirmErrorMessage(
        {
          detail: {
            coord_status: 403,
            coord_code: "tenant_membership_required",
          },
        },
        502
      )
    ).toBe(
      "This account isn't a member of the workspace this device asked to join."
    );
  });
  it("names an unmapped coord code rather than guessing", () => {
    expect(
      pairConfirmErrorMessage(
        {
          detail: {
            coord_status: 403,
            coord_code: "credential_not_pairing_capable",
          },
        },
        502
      )
    ).toBe(
      "Pairing was refused (coord HTTP 403: credential_not_pairing_capable)."
    );
  });
  it("says to restart pairing when coord used up the request", () => {
    expect(
      pairConfirmErrorMessage(
        {
          detail: {
            coord_status: 403,
            coord_code: "no_tenant_authorized",
            coord_hint: "restart pairing",
          },
        },
        502
      )
    ).toBe(
      "None of the workspaces this device asked to join could be paired. Start pairing again from your device."
    );
  });
  it("derives a batch refusal's message from its per-tenant reasons", () => {
    const batch = (reasons: string[]) =>
      pairConfirmErrorMessage(
        {
          detail: {
            coord_status: 403,
            coord_code: "no_tenant_authorized",
            coord_skip_reasons: reasons,
          },
        },
        502
      );
    expect(batch(["not_a_member"])).toBe(
      "This account isn't a member of any of the workspaces this device asked to join."
    );
    expect(batch(["not_a_member", "probe_failed"])).toBe(
      "Coord hit a temporary error while pairing. Try again shortly."
    );
    expect(batch(["not_a_member", "user_not_provisioned"])).toMatch(
      /single sign-on/
    );
    expect(batch(["not_a_member", "user_mismatch"])).toBe(
      "None of the workspaces this device asked to join could be paired."
    );
  });
  it("tells the user to restart after an expired or reused request", () => {
    expect(
      pairConfirmErrorMessage(
        { detail: { coord_status: 401, coord_code: "unknown_state" } },
        502
      )
    ).toBe(
      "This pairing request has expired or was already used. Start pairing again from your device."
    );
  });
  it("names another coord status", () => {
    expect(
      pairConfirmErrorMessage({ detail: { coord_status: 500 } }, 502)
    ).toBe("Pairing was refused (coord HTTP 500).");
  });
  it("keeps a coord outage's retry advice", () => {
    expect(
      pairConfirmErrorMessage(
        {
          detail: {
            error: "SERVICE_UNAVAILABLE",
            message: "Coord is temporarily unavailable; retry shortly.",
          },
        },
        503
      )
    ).toBe("Coord is temporarily unavailable; retry shortly.");
  });
  it("falls back to message, then the HTTP status", () => {
    expect(pairConfirmErrorMessage({ message: "m" }, 500)).toBe("m");
    expect(pairConfirmErrorMessage(null, 500)).toBe(
      "Pair-confirm failed (HTTP 500)"
    );
  });
});
