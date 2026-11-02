/**
 * What a failed read may say in each mode (plan
 * `2026-10-23-console-presentation-spaces` D3.3): the operator reads the
 * error's message; an evaluator reads its HTTP status and nothing the
 * upstream response wrote.
 */

import { describe, expect, it } from "vitest";
import { failureStatus, failureTail, statusSuffix } from "./failure-text";
import { RunnerRelayError } from "./runner-relay";

/** An httpClient rejection whose body names a host nobody outside may see. */
const LEAKY = new Error(
  "GET /api/v1/digital-twin/catalog failed: 502 - upstream https://coord.internal.acme-corp.example:8443 refused the connection"
);

describe("failureStatus", () => {
  it("reads an httpClient rejection's status field, never its body", () => {
    expect(failureStatus(LEAKY)).toBe(502);
    // A status-looking string in the BODY of a 500 is not the status.
    expect(
      failureStatus(new Error("GET /x failed: 500 - upstream failed: 404 -"))
    ).toBe(500);
  });

  it("reads a relay error's own status", () => {
    expect(failureStatus(new RunnerRelayError("refused", 403))).toBe(403);
    expect(failureStatus(new RunnerRelayError("no status"))).toBeNull();
  });

  it("is null for a failure that carries no status", () => {
    expect(failureStatus(new TypeError("Failed to fetch"))).toBeNull();
    expect(failureStatus("not an error")).toBeNull();
  });
});

describe("statusSuffix", () => {
  it("is the status in parentheses, or nothing", () => {
    expect(statusSuffix(LEAKY)).toBe(" (HTTP 502)");
    expect(statusSuffix(new TypeError("Failed to fetch"))).toBe("");
  });
});

describe("failureTail", () => {
  it("gives the operator the whole message", () => {
    expect(failureTail(LEAKY, false)).toBe(`: ${LEAKY.message}`);
    expect(failureTail("a string throw", false)).toBe("");
  });

  it("gives an evaluator the status alone — no URL, no body, no host", () => {
    expect(failureTail(LEAKY, true)).toBe(" (HTTP 502)");
    expect(failureTail(new TypeError("coord.internal down"), true)).toBe("");
  });
});
