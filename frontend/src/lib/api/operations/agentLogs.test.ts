import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchAgentLogsByAgent } = await import("./agentLogs");

describe("agentLogs", () => {
  afterEach(() => fetchMock.mockReset());

  it("GETs by-agent with an encoded id and no retries", async () => {
    const body = { agent_id: "a/b", logs: [] };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(
      fetchAgentLogsByAgent("a/b", new URLSearchParams({ limit: "500" }))
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-logs/by-agent/a%2Fb?limit=500",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("normalises a bare array to { logs }", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ a: 1 }])));
    await expect(
      fetchAgentLogsByAgent("x", new URLSearchParams())
    ).resolves.toEqual({ logs: [{ a: 1 }] });
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 502 }));
    const err = await fetchAgentLogsByAgent("x", new URLSearchParams()).catch(
      (e: unknown) => e
    );
    expect(httpStatusOf(err)).toBe(502);
  });
});
