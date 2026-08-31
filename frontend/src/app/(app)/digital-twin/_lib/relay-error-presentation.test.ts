/**
 * The distinction these tests exist to pin is `null` vs `undefined` on
 * `wsConnectedAt`. Both are falsy, so any implementation that reaches for a
 * truthiness check collapses them — and the collapsed answer ("the runner has
 * never registered") is a confident claim made on a failed coord lookup.
 */

import { describe, expect, it } from "vitest";
import { explainRelayFailure } from "./relay-error-presentation";
import { RunnerRelayError } from "./runner-relay";

const NOW = new Date("2026-08-31T12:00:00Z");

describe("explainRelayFailure — the 503 arm", () => {
  it("reports a NULL ws_connected_at as never registered", () => {
    const err = new RunnerRelayError("boom", 503, {
      wsConnectedAt: null,
      requestId: "req-1",
    });
    const out = explainRelayFailure(err, "spec pages", NOW);

    expect(out.cause).toContain("never registered");
    expect(out.requestId).toBe("req-1");
  });

  it("reports an ABSENT ws_connected_at as unknown, not as never registered", () => {
    // The backend omits the key when its coord read failed. Rounding that off
    // to "never registered" is the wrong-but-plausible answer.
    const err = new RunnerRelayError("boom", 503, { requestId: "req-2" });
    const out = explainRelayFailure(err, "spec pages", NOW);

    expect(out.cause).toContain("unknown");
    expect(out.cause).not.toContain("never registered");
  });

  it("reports a present ws_connected_at as flapping, with the age", () => {
    const err = new RunnerRelayError("boom", 503, {
      wsConnectedAt: "2026-08-31T11:58:00Z",
    });
    const out = explainRelayFailure(err, "spec pages", NOW);

    expect(out.cause).toContain("flapping");
    expect(out.cause).toContain("2 minutes ago");
  });

  it("still reports flapping when the timestamp will not parse", () => {
    const err = new RunnerRelayError("boom", 503, {
      wsConnectedAt: "not-a-date",
    });
    const out = explainRelayFailure(err, "spec pages", NOW);

    expect(out.cause).toContain("flapping");
    expect(out.cause).not.toContain("Invalid");
  });
});

describe("explainRelayFailure — the other arms", () => {
  it("names a stale pairing on 404", () => {
    const err = new RunnerRelayError("boom", 404, { requestId: "req-3" });
    const out = explainRelayFailure(err, "a snapshot", NOW);

    expect(out.headline).toBe("Could not load a snapshot.");
    expect(out.cause).toContain("stale");
    expect(out.requestId).toBe("req-3");
  });

  it("passes through detail on an unmodelled status", () => {
    const err = new RunnerRelayError("boom", 502, {
      detail: "upstream_error",
    });
    expect(explainRelayFailure(err, "specs", NOW).cause).toBe(
      "The relay answered HTTP 502: upstream_error."
    );
  });

  it("uses the transport message when there was no response at all", () => {
    const err = new RunnerRelayError("network down");
    const out = explainRelayFailure(err, "specs", NOW);

    expect(out.cause).toBe("network down");
    expect(out.requestId).toBeUndefined();
  });

  it("claims no cause for a non-Error throw", () => {
    const out = explainRelayFailure("nope", "specs", NOW);

    expect(out.headline).toBe("Could not load specs.");
    expect(out.cause).toBeUndefined();
  });

  it("reports a foreign Error's message without inventing a relay cause", () => {
    const out = explainRelayFailure(new Error("query cancelled"), "specs", NOW);
    expect(out.cause).toBe("query cancelled");
  });
});
