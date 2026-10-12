/**
 * The wording contract for coord-proxied Dev Ops polls (plan
 * `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`, D2/D4).
 *
 * A 503 deadline must read as UNKNOWN with the budget named, a 404
 * `route_disabled` as "disabled by operator", and neither may be triggered by
 * a body that merely MENTIONS the code, or by the right body under the wrong
 * status.
 */

import { describe, expect, it } from "vitest";
import {
  classifyCoordError,
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "./coordPollError";
import { volumesFetchFromFailure } from "./fleetVolumes";
import { httpBodyOf } from "@/components/admin/coord/httpStatus";

/** The exact rejection `httpClient.get` throws. */
const rejection = (status: number, body: string) =>
  new Error(
    `GET /api/v1/operations/fleet/worktree-slots failed: ${status} - ${body}`
  );

const NOT_SHIPPED = "route not shipped";

describe("classifyCoordError / describeCoordPollError", () => {
  it("names the budget on a 503 deadline", () => {
    expect(
      describeCoordPollError(
        rejection(503, '{"error":"deadline","budget_ms":4000}')
      )
    ).toBe("coord read deadline (4000 ms) exceeded — unknown");
  });

  it("still reads UNKNOWN when the deadline body omits the budget", () => {
    expect(describeCoordPollError(rejection(503, '{"error":"deadline"}'))).toBe(
      "coord read deadline (its budget) exceeded — unknown"
    );
  });

  it("reads a route_disabled 404 as disabled by operator", () => {
    expect(
      describeCoordPollError(rejection(404, '{"error":"route_disabled"}'), {
        routeUnavailableText: NOT_SHIPPED,
      })
    ).toBe("disabled by operator");
  });

  it("keeps the not-shipped wording for a 404/405/501 without that body", () => {
    for (const [status, body] of [
      [404, '{"detail":"Not Found"}'],
      [404, "not found"],
      [405, ""],
      [501, "{}"],
    ] as const) {
      expect(
        describeCoordPollError(rejection(status, body), {
          routeUnavailableText: NOT_SHIPPED,
        }),
        `${status} ${body}`
      ).toBe(NOT_SHIPPED);
    }
  });

  it("does not match a body that only mentions the code, or the wrong status", () => {
    expect(classifyCoordError(503, '"deadline"').kind).toBe("other");
    expect(classifyCoordError(503, '{"message":"deadline"}').kind).toBe(
      "other"
    );
    expect(
      classifyCoordError(500, '{"error":"deadline","budget_ms":1}').kind
    ).toBe("other");
    expect(classifyCoordError(503, '{"error":"route_disabled"}').kind).toBe(
      "other"
    );
    expect(classifyCoordError(null, '{"error":"deadline"}').kind).toBe("other");
  });

  it("passes any other failure through as the raw message", () => {
    const err = rejection(504, '{"error":"GATEWAY_TIMEOUT"}');
    expect(describeCoordPollError(err)).toBe(err.message);
    expect(describeCoordPollError(new TypeError("Failed to fetch"))).toBe(
      "Failed to fetch"
    );
  });

  it("polls with exactly one request", () => {
    expect(COORD_DASHBOARD_POLL_OPTIONS.maxRetries).toBe(0);
  });
});

describe("httpBodyOf", () => {
  it("returns the body after the anchored status", () => {
    expect(httpBodyOf(rejection(503, '{"a": "b - c"}'))).toBe('{"a": "b - c"}');
  });
  it("returns null for anything that is not a status rejection", () => {
    expect(httpBodyOf(new Error("boom - {}"))).toBeNull();
    expect(httpBodyOf(new TypeError("Failed to fetch"))).toBeNull();
  });
});

describe("volumesFetchFromFailure", () => {
  it("renders a deadline as unavailable naming the budget", () => {
    const read = volumesFetchFromFailure(
      503,
      '{"error":"deadline","budget_ms":4000}'
    );
    expect(read.state).toBe("unavailable");
    expect(read.state === "unavailable" && read.reason).toContain(
      "coord read deadline (4000 ms) exceeded — unknown"
    );
  });
  it("renders route_disabled as disabled by operator", () => {
    const read = volumesFetchFromFailure(404, '{"error":"route_disabled"}');
    expect(read.state === "unavailable" && read.reason).toContain(
      "disabled by operator"
    );
  });
  it("keeps the existing wording for any other status", () => {
    const read = volumesFetchFromFailure(504, null);
    expect(read.state === "unavailable" && read.reason).toContain(
      "returned HTTP 504"
    );
  });
});
