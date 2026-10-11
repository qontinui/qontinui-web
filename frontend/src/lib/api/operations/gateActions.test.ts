import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins each `gateActions` function's exact request: the RELATIVE URL as a
 * LITERAL (the gate id percent-encoded into one segment), the method and the
 * body.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const gates = await import("./gateActions");

describe("gateActions", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it.each([
    ["postGateApprove", gates.postGateApprove, "POST", "approve"],
    ["postGateReopen", gates.postGateReopen, "POST", "reopen"],
    ["patchGateAudience", gates.patchGateAudience, "PATCH", "audience"],
    ["postGateMute", gates.postGateMute, "POST", "mute"],
    ["postGateUnmute", gates.postGateUnmute, "POST", "unmute"],
    ["postGateSnooze", gates.postGateSnooze, "POST", "snooze"],
    ["postGateReject", gates.postGateReject, "POST", "reject"],
    ["postGateForceClear", gates.postGateForceClear, "POST", "force-clear"],
    [
      "postGateContinuationCancel",
      gates.postGateContinuationCancel,
      "POST",
      "continuation-cancel",
    ],
  ])("%s sends %s to /gates/{id}/%s", async (_n, fn, method, verb) => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const res = await fn("g/1 x", { reason: "why" });
    expect(res).toBeInstanceOf(Response);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/gates/g%2F1%20x/${verb}`,
      { method, body: JSON.stringify({ reason: "why" }) },
    ]);
  });
});
