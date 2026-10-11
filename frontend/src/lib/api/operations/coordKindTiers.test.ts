import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request of each `coordKindTiers` function. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { deleteKindTier, fetchKindTiers, putKindTier } =
  await import("./coordKindTiers");

const BASE = "/api/v1/operations/coord/prompt-document-kind-tiers";

describe("coordKindTiers", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchKindTiers GETs the list", async () => {
    const body = {
      kinds: [],
      vocabulary: [],
      notification_enforced: true,
      warning: "",
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(fetchKindTiers()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      BASE,
      { method: "GET", idempotent: true },
    ]);
  });

  it("putKindTier PUTs {tier} to the encoded kind", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await putKindTier("product_intent", "allow");
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/product_intent`,
      { method: "PUT", body: '{"tier":"allow"}', idempotent: true },
    ]);
  });

  it("deleteKindTier tolerates a 204 with no body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteKindTier("a b")).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/a%20b`,
      { method: "DELETE", idempotent: true },
    ]);
  });

  it("rejects a non-2xx in httpClient's error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("floor", { status: 409 }));
    const err = await putKindTier("k", "deny").catch((e: unknown) => e);
    expect((err as Error).message).toBe(`PUT ${BASE}/k failed: 409 - floor`);
  });
});
