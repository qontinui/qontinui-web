import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins the exact request of each pullDecisions function: RELATIVE URL literal, method, body. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchPullDecisions } = await import("./pullDecisions");

describe("pullDecisions", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("GETs /coord/pull-decisions with the caller's suffix", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );
    await expect(fetchPullDecisions("?repo=r")).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/pull-decisions?repo=r",
      { method: "GET" },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 502 }));
    const err = await fetchPullDecisions("").catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(502);
  });
});
