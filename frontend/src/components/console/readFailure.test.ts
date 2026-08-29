/**
 * The console's read-failure predicates.
 *
 * `isNotFoundError` is the load-bearing one: it decides whether a detail route
 * says "not found" or "unknown", and an earlier cut of this module's callers
 * had that backwards — every genuine 404 rendered as an infrastructure fault.
 * It parses a message, so it gets a test that pins the exact string
 * `httpClient` formats rather than a paraphrase of it.
 */

import { describe, expect, it } from "vitest";
import { isNotFoundError, readIsUnknown, staleDetail } from "./readFailure";

/** Byte-for-byte the shape `HttpClient.get` throws (`http-client.ts:548`). */
function httpError(status: number, body = "{}"): Error {
  return new Error(
    `GET /api/v1/operations/plans/a-slug failed: ${status} - ${body}`
  );
}

describe("isNotFoundError", () => {
  it("is true for coord's own 404 — it answered, and the answer was no", () => {
    expect(
      isNotFoundError(httpError(404, '{"error":"work_unit_not_found"}'))
    ).toBe(true);
  });

  it("is false for every other status, which are all 'we could not read'", () => {
    for (const status of [400, 401, 403, 500, 502, 503]) {
      expect(isNotFoundError(httpError(status))).toBe(false);
    }
  });

  it("is false for a transport failure, which carries no status at all", () => {
    // The case the whole distinction exists for: nothing answered.
    expect(isNotFoundError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isNotFoundError(new Error("coord unreachable"))).toBe(false);
  });

  it("does not match a 404 that is only part of the URL or the body", () => {
    // The separator the template emits is the anchor, so a status-shaped
    // number elsewhere in the message cannot masquerade as the status.
    expect(
      isNotFoundError(
        new Error("GET /api/v1/operations/plans/404 failed: 500 - boom")
      )
    ).toBe(false);
    expect(
      isNotFoundError(httpError(500, '{"detail":"upstream said failed: 404"}'))
    ).toBe(false);
  });

  it("survives a non-Error throw without claiming a 404", () => {
    expect(isNotFoundError("something odd")).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
  });
});

describe("readIsUnknown", () => {
  it("is true only when a read failed AND coord has never answered", () => {
    expect(readIsUnknown(false, true)).toBe(true);
  });

  it("is false once coord has answered, however empty the answer was", () => {
    // The anti-flap clause: a fetched zero is data, not ignorance.
    expect(readIsUnknown(true, true)).toBe(false);
  });

  it("is false while a first read is merely in flight", () => {
    // Not-yet-arrived is the `!loaded` "waiting" arm's business, not this one.
    expect(readIsUnknown(false, false)).toBe(false);
    expect(readIsUnknown(true, false)).toBe(false);
  });
});

describe("staleDetail", () => {
  it("leads with the failure, because the headline it qualifies may be green", () => {
    expect(staleDetail("4 rows in the fetched window")).toBe(
      "Last refresh failed — these counts are stale. 4 rows in the fetched window"
    );
  });
});
