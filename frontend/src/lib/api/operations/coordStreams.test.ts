import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins each `coordStreams` / `coordGates` function's exact request: the
 * RELATIVE URL as a literal, `encodeURIComponent` of every path parameter and
 * the `httpClient.fetch` options (method, body, retry policy).
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const streams = await import("./coordStreams");
const gates = await import("./coordGates");

const ID = "a/b #1";
const ENC = "a%2Fb%20%231";
const POLL = { maxRetries: 0 };

afterEach(() => fetchMock.mockReset());

describe("coordStreams", () => {
  it("reads: literal relative URLs, caller options forwarded", async () => {
    await streams.getDeviceStatus(POLL);
    await streams.getCiStatus(POLL);
    await streams.getSymbolClaims(POLL);
    await streams.getFleetVolumes(POLL);
    await streams.getRecentDevActions(50, POLL);
    await streams.getDevActionDetail(ID, POLL);
    await streams.getDeviceVolumes(ID, POLL);
    await streams.getMigrationsQueue("o/r x", POLL);
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/device-status", POLL],
      ["/api/v1/operations/ci-status", POLL],
      ["/api/v1/operations/symbol-claims", POLL],
      ["/api/v1/operations/fleet/volumes", POLL],
      ["/api/v1/operations/dev-actions/recent?limit=50", POLL],
      [`/api/v1/operations/dev-actions/${ENC}`, POLL],
      [`/api/v1/operations/devices/${ENC}/volumes`, POLL],
      ["/api/v1/operations/migrations/queue?repo=o%2Fr+x", POLL],
    ]);
  });

  it("writes: method, body and retry policy", async () => {
    await streams.postCiStatusNotifyWhenGreen({ repo: "o/r", head_sha: "abc" });
    await streams.patchMachineName(ID, "box");
    await streams.postPrDraftState("o w", "r/x", 7, true);
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/ci-status/notify-when-green",
        {
          method: "POST",
          body: '{"repo":"o/r","head_sha":"abc"}',
          idempotent: false,
        },
      ],
      [
        `/api/v1/operations/fleet/machines/${ENC}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: '{"name":"box"}',
          idempotent: true,
        },
      ],
      [
        "/api/v1/operations/prs/o%20w/r%2Fx/7/draft-state",
        { method: "POST", body: '{"draft":true}' },
      ],
    ]);
  });
});

describe("coordGates", () => {
  it("each action hits its literal URL with the right method and body", async () => {
    const body = { reason: "r" };
    await gates.postGateApprove(ID);
    await gates.postGateReopen(ID);
    await gates.patchGateAudience(ID, { body: { audience: "agent" } });
    await gates.postGateMute(ID);
    await gates.postGateUnmute(ID);
    await gates.postGateSnooze(ID, { body: { until: "t" } });
    await gates.postGateReject(ID, { body });
    await gates.postGateForceClear(ID, { body });
    await gates.postGateContinuationCancel(ID, { body });
    const seen = fetchMock.mock.calls.map(([url, o]) => [
      url,
      o.method,
      o.body,
    ]);
    const base = `/api/v1/operations/gates/${ENC}`;
    expect(seen).toEqual([
      [`${base}/approve`, "POST", "{}"],
      [`${base}/reopen`, "POST", "{}"],
      [`${base}/audience`, "PATCH", '{"audience":"agent"}'],
      [`${base}/mute`, "POST", "{}"],
      [`${base}/unmute`, "POST", "{}"],
      [`${base}/snooze`, "POST", '{"until":"t"}'],
      [`${base}/reject`, "POST", '{"reason":"r"}'],
      [`${base}/force-clear`, "POST", '{"reason":"r"}'],
      [`${base}/continuation-cancel`, "POST", '{"reason":"r"}'],
    ]);
  });
});
