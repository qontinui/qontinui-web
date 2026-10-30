import { describe, expect, it } from "vitest";
import { NO_CONNECTION_MESSAGE } from "@/services/http-client";
import {
  PROXY_NOT_REACHABLE_DETAIL,
  isOutcomeUnknownStatus,
  isWriteFailureUnknown,
} from "./writeOutcome";

describe("isOutcomeUnknownStatus", () => {
  it.each([500, 503, 504, 520, 524])("%i is unknown", (status) => {
    expect(isOutcomeUnknownStatus(status, null)).toBe(true);
    // The proxy's words prove something only on a 502.
    expect(isOutcomeUnknownStatus(status, PROXY_NOT_REACHABLE_DETAIL)).toBe(
      true
    );
  });

  it("reads a 502 as not applied only with the proxy's exact connect-failure detail", () => {
    expect(isOutcomeUnknownStatus(502, PROXY_NOT_REACHABLE_DETAIL)).toBe(false);
    expect(isOutcomeUnknownStatus(502, "Bad Gateway")).toBe(true);
    expect(isOutcomeUnknownStatus(502, `${PROXY_NOT_REACHABLE_DETAIL}.`)).toBe(
      true
    );
    expect(isOutcomeUnknownStatus(502, null)).toBe(true);
  });

  it.each([400, 403, 404, 409, 422, 429])("%i is an answer", (status) => {
    expect(isOutcomeUnknownStatus(status, null)).toBe(false);
  });
});

describe("isWriteFailureUnknown", () => {
  const failed = (status: number, body: string) =>
    new Error(`PUT /api/v1/x failed: ${status} - ${body}`);

  it("finds the proxy's detail in the backend's envelope and in FastAPI's own", () => {
    for (const body of [
      JSON.stringify({
        error: "BAD_GATEWAY",
        message: "coord is not reachable",
      }),
      JSON.stringify({
        error: "UPSTREAM",
        message: "coord is not reachable",
        refusal: { code: "upstream_unavailable" },
      }),
      JSON.stringify({ detail: "coord is not reachable" }),
    ]) {
      expect(isWriteFailureUnknown(failed(502, body))).toBe(false);
    }
  });

  it("gives no proof to a 502 with any other body", () => {
    for (const body of [
      "<html>502 Bad Gateway</html>",
      // Not the proxy's shape: the words alone, from whatever sent them.
      "coord is not reachable",
      JSON.stringify({ message: "upstream connect error" }),
      "[]",
      "null",
    ]) {
      expect(isWriteFailureUnknown(failed(502, body))).toBe(true);
    }
  });

  it("does not read a status out of the body", () => {
    // A 400 whose body quotes a 504 is a 400.
    expect(isWriteFailureUnknown(failed(400, "PUT /y failed: 504 - x"))).toBe(
      false
    );
  });

  it("reads a failure with no status as open, unless the browser is offline", () => {
    expect(isWriteFailureUnknown(new TypeError("Failed to fetch"))).toBe(true);
    expect(isWriteFailureUnknown(new Error("Request timeout - PUT /x"))).toBe(
      true
    );
    expect(isWriteFailureUnknown("thrown text")).toBe(true);
    expect(isWriteFailureUnknown(new Error(NO_CONNECTION_MESSAGE))).toBe(false);
  });
});
