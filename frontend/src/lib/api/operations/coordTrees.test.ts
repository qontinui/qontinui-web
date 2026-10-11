import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins `coordTrees`' exact requests: literal relative URLs, encoding, options. */

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchTreeContention, fetchTreesByDevice } =
  await import("./coordTrees");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordTrees", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchTreesByDevice GETs the encoded device's trees, one request", async () => {
    const body = { device_id: "a/b", trees: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchTreesByDevice("a/b")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/trees/by-device/a%2Fb",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchTreeContention GETs /trees/contention, one request", async () => {
    const body = { overlaps: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchTreeContention()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/trees/contention",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "no" }, 500));
    const err = await fetchTreeContention().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/trees/contention failed: 500 - {"detail":"no"}'
    );
    expect(httpStatusOf(err)).toBe(500);
  });
});
