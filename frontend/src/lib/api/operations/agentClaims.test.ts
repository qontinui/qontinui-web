import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `agentClaims` function's exact request: the RELATIVE URL written out as a
 * LITERAL (so a change to the shared base cannot move every expectation with
 * it), the method, the body, and the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => fetchMock.mockReset());

const m = await import("./agentClaims");

describe("agentClaims", () => {
  it("every read states maxRetries 0 on a relative URL", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(answer({})));
    await m.fetchAgentStatus();
    await m.fetchActiveClaims("phase", "");
    await m.fetchActiveClaims("file_glob", "src/");
    await m.fetchRecentClaimConflicts(50);
    await m.fetchRecentClaimSteals(50);
    await m.fetchClaimGates();
    const read = { method: "GET", idempotent: true, maxRetries: 0 };
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/agent-status", read],
      ["/api/v1/operations/claims/list?kind=phase", read],
      ["/api/v1/operations/claims/list?kind=file_glob&prefix=src%2F", read],
      ["/api/v1/operations/claims/recent-conflicts?limit=50", read],
      ["/api/v1/operations/claims/steals?limit=50", read],
      ["/api/v1/operations/gates/list", read],
    ]);
  });

  it("approve and reject POST the gate and resolve on a 2xx with an empty body", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response("", { status: 200 }))
    );
    await expect(m.approveClaimGate("g1")).resolves.toBeNull();
    await m.rejectClaimGate("g1");
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/gates/g1/approve", { method: "POST" }],
      ["/api/v1/operations/gates/g1/reject", { method: "POST" }],
    ]);
  });

  it("a non-2xx rejects in the helpers error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer("denied", 403));
    const err = await m.approveClaimGate("g1").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'POST /api/v1/operations/gates/g1/approve failed: 403 - "denied"'
    );
    expect(httpStatusOf(err)).toBe(403);
  });
});
