import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request the alerts client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchOpenAlertsOfKind } = await import("./alerts");

describe("alerts", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchOpenAlertsOfKind GETs the unresolved alerts of one kind with the caller's retry budget", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([])));
    await expect(
      fetchOpenAlertsOfKind("red_main", { maxRetries: 0 })
    ).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/alerts?include_resolved=false&kind=red_main",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchOpenAlertsOfKind encodes the kind", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ alerts: [] }))
    );
    await fetchOpenAlertsOfKind("a&b");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/alerts?include_resolved=false&kind=a%26b",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchOpenAlertsOfKind rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 504 }));
    await expect(fetchOpenAlertsOfKind("red_main")).rejects.toThrow(
      "GET /api/v1/operations/alerts?include_resolved=false&kind=red_main failed: 504 - down"
    );
  });
});
