import { describe, expect, it } from "vitest";
import {
  NO_CONNECTION_MESSAGE,
  REQUEST_TIMEOUT_MESSAGE,
} from "@/services/http-client";
import {
  outcomeUnknownReason,
  PROXY_NOT_REACHABLE_DETAIL,
  PROXY_ROUTE_ABSENT_PREFIX,
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

  it("reads the deploy-order 502 as not applied, by its prefix", () => {
    // `_coord_request_deploy_order_aware`: coord answered an empty 404.
    const detail =
      "coord does not serve PUT /coord/agent-registry/{agent_name} yet — " +
      "deploy qontinui-coord first";
    expect(detail.startsWith(PROXY_ROUTE_ABSENT_PREFIX)).toBe(true);
    expect(isOutcomeUnknownStatus(502, detail)).toBe(false);
    // Only on a 502, and only at the start.
    expect(isOutcomeUnknownStatus(504, detail)).toBe(true);
    expect(isOutcomeUnknownStatus(502, `upstream: ${detail}`)).toBe(true);
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
      JSON.stringify({
        error: "BAD_GATEWAY",
        message:
          "coord does not serve /coord/x yet — deploy qontinui-coord first",
      }),
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

describe("outcomeUnknownReason", () => {
  const failed = (status: number, body: string) =>
    new Error(`PUT /api/v1/x failed: ${status} - ${body}`);
  const typed = (message: string, status: number, detailServed: boolean) =>
    Object.assign(new Error(message), { status, detailServed });

  it("never invites a retry or says the write failed for the client's own texts", () => {
    for (const err of [
      new Error(REQUEST_TIMEOUT_MESSAGE),
      new TypeError("Failed to fetch"),
      failed(503, "<html>Service Unavailable</html>"),
      failed(500, ""),
      typed("Failed to save the tenant default", 502, false),
    ]) {
      const reason = outcomeUnknownReason(err);
      expect(reason, String(err)).not.toMatch(/fail|try again|retry/i);
    }
  });

  it("names the status when the server gave no readable reason", () => {
    expect(outcomeUnknownReason(failed(503, "<html/>"))).toBe(
      "HTTP 503 with no readable reason"
    );
    expect(
      outcomeUnknownReason(
        typed("Failed to save the tenant default", 502, false)
      )
    ).toBe("HTTP 502 with no readable reason");
    expect(outcomeUnknownReason(new Error(REQUEST_TIMEOUT_MESSAGE))).toBe(
      "no answer came back within the client's time limit"
    );
    expect(outcomeUnknownReason(new TypeError("Failed to fetch"))).toBe(
      "no answer reached the browser"
    );
  });

  it("quotes a reason the server gave, and coord's forwarded JSON by its field", () => {
    expect(
      outcomeUnknownReason(
        failed(504, JSON.stringify({ message: "timeout waiting for coord" }))
      )
    ).toBe("timeout waiting for coord");
    expect(
      outcomeUnknownReason(
        failed(
          503,
          JSON.stringify({
            error: "SERVICE_UNAVAILABLE",
            message: JSON.stringify({
              error: "auto_fix_pr_column_unavailable",
              written: null,
            }),
          })
        )
      )
    ).toBe("auto_fix_pr_column_unavailable");
    expect(outcomeUnknownReason(typed("busy", 503, true))).toBe("busy");
  });
});
