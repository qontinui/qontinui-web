import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins `fetchDependencyAdvisories`' exact request — the RELATIVE URL on
 * `httpClient.fetch`, the query it builds, the init — and that coord's 503
 * body survives into the rejection, where the hook classifies it.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchDependencyAdvisories } =
  await import("./coordDependencyAdvisories");

describe("fetchDependencyAdvisories", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("GETs /coord/dependency-advisories with include_resolved=false by default", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ available: true, census: [] }))
    );
    await expect(
      fetchDependencyAdvisories({}, { maxRetries: 0 })
    ).resolves.toEqual({ available: true, census: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/dependency-advisories?include_resolved=false",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("forwards repo and include_resolved when set", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await fetchDependencyAdvisories({
      repo: "qontinui/qontinui-coord",
      includeResolved: true,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "/api/v1/operations/coord/dependency-advisories?include_resolved=true&repo=qontinui%2Fqontinui-coord"
    );
  });

  it("rejects coord's 503 with its status and body readable", async () => {
    const body = { error: "dependency_advisories_surface_unavailable" };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 503 })
    );
    const err = await fetchDependencyAdvisories().catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(503);
    expect(JSON.parse(httpBodyOf(err)!)).toEqual(body);
  });
});
