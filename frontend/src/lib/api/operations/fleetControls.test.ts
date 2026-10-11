import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `fleetControls` function's exact request: the RELATIVE URL as a
 * LITERAL, the method, the body and the retry policy the route walker cannot
 * see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchFleetDispatchRoles,
  fetchFleetDrain,
  fetchFleetWorktreeCap,
  fetchFleetWorktreeSlots,
  postFleetDrain,
  postFleetUndrain,
  postFleetWorktreeCap,
  postFleetWorktreeCapClear,
  putFleetDispatchRole,
} = (await import("./fleetControls")) as Record<
  string,
  (...args: unknown[]) => Promise<unknown>
>;

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("fleetControls", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it.each([
    ["fetchFleetDrain", fetchFleetDrain, "/api/v1/operations/fleet/drain"],
    [
      "fetchFleetWorktreeCap",
      fetchFleetWorktreeCap,
      "/api/v1/operations/fleet/worktree-cap",
    ],
    [
      "fetchFleetDispatchRoles",
      fetchFleetDispatchRoles,
      "/api/v1/operations/fleet/dispatch-roles",
    ],
  ])("%s GETs its poll route with no client retries", async (_n, fn, url) => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await fn();
    expect(fetchMock.mock.calls[0]).toEqual([
      url,
      { method: "GET", maxRetries: 0 },
    ]);
  });

  it.each([
    ["postFleetDrain", postFleetDrain, "/api/v1/operations/fleet/drain"],
    ["postFleetUndrain", postFleetUndrain, "/api/v1/operations/fleet/undrain"],
    [
      "postFleetWorktreeCap",
      postFleetWorktreeCap,
      "/api/v1/operations/fleet/worktree-cap",
    ],
    [
      "postFleetWorktreeCapClear",
      postFleetWorktreeCapClear,
      "/api/v1/operations/fleet/worktree-cap/clear",
    ],
  ])("%s POSTs the JSON body once, default retries", async (_n, fn, url) => {
    fetchMock.mockResolvedValueOnce(answer({ changed: true }));
    await fn({ device_id: "d1", reason: "r" });
    expect(fetchMock.mock.calls[0]).toEqual([
      url,
      {
        method: "POST",
        body: JSON.stringify({ device_id: "d1", reason: "r" }),
      },
    ]);
  });

  it("putFleetDispatchRole PUTs with no client retries", async () => {
    fetchMock.mockResolvedValueOnce(answer({ changed: true }));
    await putFleetDispatchRole({ dispatch_role: "ci", reason: "r" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/dispatch-role",
      {
        method: "PUT",
        body: JSON.stringify({ dispatch_role: "ci", reason: "r" }),
        maxRetries: 0,
      },
    ]);
  });

  it("fetchFleetWorktreeSlots parses the body and sends no client retries", async () => {
    const body = { tenant_id: "t", devices: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchFleetWorktreeSlots()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/worktree-slots",
      { method: "GET", maxRetries: 0 },
    ]);
  });

  it("fetchFleetWorktreeSlots rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 503 }));
    const err = await fetchFleetWorktreeSlots().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/fleet/worktree-slots failed: 503 - boom"
    );
    expect(httpStatusOf(err)).toBe(503);
  });
});
