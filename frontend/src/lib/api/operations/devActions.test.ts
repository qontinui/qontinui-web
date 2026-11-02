import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `devActions` function's exact request: the RELATIVE URL as a
 * LITERAL, the method, and the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchDevActionDetail, fetchRecentDevActions } = await import(
  "./devActions"
);

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("devActions", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchRecentDevActions GETs /dev-actions/recent?limit=N with no client retries and parses the body", async () => {
    const body = { actions: [], count: 0 };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchRecentDevActions(50)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/dev-actions/recent?limit=50",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchRecentDevActions rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const err = await fetchRecentDevActions(50).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/dev-actions/recent?limit=50 failed: 500 - boom"
    );
    expect(httpStatusOf(err)).toBe(500);
  });

  it("fetchDevActionDetail percent-encodes the action id into one path segment", async () => {
    const body = { action: { action_id: "a/b c" }, outcomes: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchDevActionDetail("a/b c")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/dev-actions/a%2Fb%20c",
      { method: "GET", idempotent: true },
    ]);
  });
});
