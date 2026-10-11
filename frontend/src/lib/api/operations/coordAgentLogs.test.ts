import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins `coordAgentLogs`' exact request: literal relative URL and fetch options. */

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchRecentAgentLogs } = await import("./coordAgentLogs");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordAgentLogs", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchRecentAgentLogs GETs /agent-logs/recent with the limit, one request, and parses the body", async () => {
    const body = { logs: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchRecentAgentLogs(200)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-logs/recent?limit=200",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchRecentAgentLogs resolves a bare list body unchanged", async () => {
    fetchMock.mockResolvedValueOnce(answer([{ id: 1 }]));
    await expect(fetchRecentAgentLogs(5)).resolves.toEqual([{ id: 1 }]);
  });

  it("fetchRecentAgentLogs rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "no" }, 503));
    const err = await fetchRecentAgentLogs(5).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/agent-logs/recent?limit=5 failed: 503 - {"detail":"no"}'
    );
    expect(httpStatusOf(err)).toBe(503);
  });
});
