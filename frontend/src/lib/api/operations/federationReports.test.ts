import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchFederationReports } = await import("./federationReports");

describe("federationReports", () => {
  afterEach(() => fetchMock.mockReset());

  it("GETs /federation/reports with no retries", async () => {
    const body = { reports: [] };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(
      fetchFederationReports(new URLSearchParams({ limit: "200" }))
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/federation/reports?limit=200",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 503 }));
    const err = await fetchFederationReports(new URLSearchParams()).catch(
      (e: unknown) => e
    );
    expect(httpStatusOf(err)).toBe(503);
  });
});
