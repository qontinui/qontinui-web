import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins the exact request of each `coordSessionCompliance` function. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchComplianceOutstanding,
  fetchComplianceSessions,
  fetchSessionComplianceConfig,
  fetchSessionComplianceConfigVersions,
  putSessionComplianceConfig,
} = await import("./coordSessionCompliance");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const GET = { method: "GET", idempotent: true };
const BASE = "/api/v1/operations/coord/session-compliance";

describe("coordSessionCompliance", () => {
  afterEach(() => fetchMock.mockReset());

  it("the reads GET their literal URLs", async () => {
    fetchMock.mockImplementation(async () => answer({}));
    await fetchSessionComplianceConfig();
    await fetchSessionComplianceConfigVersions();
    await fetchComplianceOutstanding();
    await fetchComplianceSessions(
      new URLSearchParams({ limit: "25", verdict: "fail" })
    );
    expect(fetchMock.mock.calls).toEqual([
      [`${BASE}/config`, GET],
      [`${BASE}/config/versions`, GET],
      [`${BASE}/outstanding`, GET],
      [`${BASE}/sessions?limit=25&verdict=fail`, GET],
    ]);
  });

  it("putSessionComplianceConfig PUTs the patch and returns the saved row", async () => {
    fetchMock.mockResolvedValueOnce(answer({ current_version: 4 }));
    await expect(
      putSessionComplianceConfig({ enabled: true } as never)
    ).resolves.toEqual({ current_version: 4 });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/config`,
      { method: "PUT", body: '{"enabled":true}', idempotent: true },
    ]);
  });

  it("a 404 keeps its status readable for the route-unavailable check", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nf", { status: 404 }));
    const err = await fetchSessionComplianceConfig().catch((e: unknown) => e);
    expect((err as Error).message).toBe(`GET ${BASE}/config failed: 404 - nf`);
    expect(httpStatusOf(err)).toBe(404);
  });
});
