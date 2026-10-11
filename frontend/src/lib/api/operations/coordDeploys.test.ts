import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins `coordDeploys`' exact request: literal relative URL and fetch options. */

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchDeploys } = await import("./coordDeploys");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordDeploys", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchDeploys GETs /deploys with the trimmed service and limit, one request", async () => {
    const body = { deploys: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchDeploys("  coord ", 25)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/deploys?service=coord&limit=25",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchDeploys omits a blank service", async () => {
    fetchMock.mockResolvedValueOnce(answer({ deploys: null }));
    await fetchDeploys("   ", 25);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/operations/deploys?limit=25"
    );
  });

  it("fetchDeploys rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "no" }, 504));
    const err = await fetchDeploys("", 25).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/deploys?limit=25 failed: 504 - {"detail":"no"}'
    );
    expect(httpStatusOf(err)).toBe(504);
  });
});
