/**
 * Two distinctions these tests exist to pin.
 *
 * `null` vs `undefined` on `wsConnectedAt`: both are falsy, so any
 * implementation that reaches for a truthiness check collapses them — and the
 * collapsed answer ("the runner has never registered") is a confident claim
 * made on a failed coord lookup.
 *
 * Status vs `detail`: these requests cross a rewrite and a CDN, so a 503 or a
 * 404 is not by itself evidence the relay handler ran. Answering a CDN's 503
 * with a runner diagnosis invents a runner fault out of a backend outage.
 */

import { describe, expect, it } from "vitest";
import {
  explainRelayFailure,
  sharesRelayCause,
} from "./relay-error-presentation";
import { RunnerRelayError } from "./runner-relay";

const NOW = new Date("2026-08-31T12:00:00Z");
const NOT_CONNECTED = "runner not connected";
const NOT_OWNED = "device not found or not owned by caller";

/** A 503 as the relay handler actually emits it. */
const relay503 = (
  d: Partial<ConstructorParameters<typeof RunnerRelayError>[2]>
) => new RunnerRelayError("boom", 503, { detail: NOT_CONNECTED, ...d });

describe("explainRelayFailure — the 503 arm", () => {
  it("reports a NULL ws_connected_at as never registered", () => {
    const out = explainRelayFailure(
      relay503({ wsConnectedAt: null, requestId: "req-1" }),
      "spec pages",
      NOW
    );

    expect(out.cause).toContain("never registered");
    expect(out.requestId).toBe("req-1");
  });

  it("reports an ABSENT ws_connected_at as unknown, not as never registered", () => {
    // The backend omits the key when its coord read failed. Rounding that off
    // to "never registered" is the wrong-but-plausible answer.
    const out = explainRelayFailure(
      relay503({ requestId: "req-2" }),
      "spec pages",
      NOW
    );

    expect(out.cause).toContain("unknown");
    expect(out.cause).not.toContain("never registered");
  });

  it("does not guess WHY the clock is unknown", () => {
    // There is more than one way to reach `undefined` — a failed coord read,
    // an older backend. Naming one of them is the same overclaim this module
    // exists to stop, displaced a layer up.
    const out = explainRelayFailure(relay503({}), "spec pages", NOW);

    expect(out.cause).not.toContain("could not read");
    expect(out.cause).not.toContain("coord");
  });

  it("reports a present ws_connected_at as flapping, with the age", () => {
    const out = explainRelayFailure(
      relay503({ wsConnectedAt: "2026-08-31T11:58:00Z" }),
      "spec pages",
      NOW
    );

    expect(out.cause).toContain("flapping");
    expect(out.cause).toContain("2 minutes ago");
  });

  it("still reports flapping when the timestamp will not parse", () => {
    const out = explainRelayFailure(
      relay503({ wsConnectedAt: "not-a-date" }),
      "spec pages",
      NOW
    );

    expect(out.cause).toContain("flapping");
    expect(out.cause).not.toContain("Invalid");
  });

  it("adds the heartbeat clock when the WS clock cannot carry the story", () => {
    // `last_seen_at` is a different fact and the only one left when the WS
    // claim clock is NULL — a device can heartbeat while never registering.
    const out = explainRelayFailure(
      relay503({ wsConnectedAt: null, lastSeenAt: "2026-08-31T11:45:00Z" }),
      "spec pages",
      NOW
    );

    expect(out.cause).toContain("never registered");
    expect(out.cause).toContain("last checked in 15 minutes ago");
  });

  it("omits the heartbeat sentence when there is no heartbeat to report", () => {
    const out = explainRelayFailure(
      relay503({ wsConnectedAt: null }),
      "spec pages",
      NOW
    );
    expect(out.cause).not.toContain("checked in");
  });
});

describe("explainRelayFailure — a status alone is not a relay verdict", () => {
  it("does not diagnose the runner on a 503 that is not the relay's", () => {
    // A CDN or rewrite 503 (origin down) has an HTML body, so `detail` is
    // undefined. The runner may be perfectly healthy; the backend never ran.
    const out = explainRelayFailure(
      new RunnerRelayError("boom", 503),
      "spec pages",
      NOW
    );

    expect(out.cause).toBe("The relay answered HTTP 503.");
    expect(out.cause).not.toContain("runner");
  });

  it("does not blame the pairing on a 404 that is not the relay's", () => {
    const out = explainRelayFailure(
      new RunnerRelayError("boom", 404),
      "spec pages",
      NOW
    );

    expect(out.cause).toBe("The relay answered HTTP 404.");
    expect(out.cause).not.toContain("Re-pair");
  });

  it("names a stale pairing only on the relay's own 404", () => {
    const out = explainRelayFailure(
      new RunnerRelayError("boom", 404, {
        detail: NOT_OWNED,
        requestId: "req-3",
      }),
      "a snapshot",
      NOW
    );

    expect(out.headline).toBe("Could not load a snapshot.");
    expect(out.cause).toContain("stale");
    expect(out.requestId).toBe("req-3");
  });

  it("names the rejected device id, which the UI shows nowhere else", () => {
    const out = explainRelayFailure(
      new RunnerRelayError("boom", 404, {
        detail: NOT_OWNED,
        deviceId: "dev-stale",
      }),
      "a snapshot",
      NOW
    );

    expect(out.cause).toContain("dev-stale");
  });
});

describe("explainRelayFailure — the other arms", () => {
  it("passes through detail on an unmodelled status", () => {
    const err = new RunnerRelayError("boom", 502, { detail: "upstream_error" });
    expect(explainRelayFailure(err, "specs", NOW).cause).toBe(
      "The relay answered HTTP 502: upstream_error."
    );
  });

  it("uses the transport message when there was no response at all", () => {
    const out = explainRelayFailure(
      new RunnerRelayError("network down"),
      "specs",
      NOW
    );

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

describe("sharesRelayCause", () => {
  it("groups two queries that failed the same way", () => {
    // The dominant case: one runner, several queries, one outage. Each is its
    // own HTTP request, so the request ids DIFFER and must not split them.
    const a = relay503({ wsConnectedAt: null, requestId: "req-a" });
    const b = relay503({ wsConnectedAt: null, requestId: "req-b" });

    expect(sharesRelayCause(a, b, NOW)).toBe(true);
  });

  it("keeps failures with different diagnoses apart", () => {
    const notConnected = relay503({ wsConnectedAt: null });
    const flapping = relay503({ wsConnectedAt: "2026-08-31T11:58:00Z" });

    expect(sharesRelayCause(notConnected, flapping, NOW)).toBe(false);
  });

  it("does not group a relay 503 with an unrelated failure", () => {
    expect(
      sharesRelayCause(
        relay503({ wsConnectedAt: null }),
        new Error("nope"),
        NOW
      )
    ).toBe(false);
  });
});
