import { afterEach, describe, expect, it, vi } from "vitest";
import { describeCoordPollError } from "@/components/operations/coordPollError";

/**
 * Pins every `agentLogs.ts` request: the RELATIVE URL (plan D6, literal here)
 * on `httpClient.fetch` — the pages used `httpClient.get`, which prefixed the
 * absolute base — the caller's options kept, the read declared `idempotent`,
 * and a rejection in `httpClient.get`'s own shape, which
 * `describeCoordPollError` still reads.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchAgentLogsByAgent, fetchRecentAgentLogs } = await import(
  "./agentLogs"
);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("agentLogs client", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchRecentAgentLogs GETs /agent-logs/recent?limit=, keeping the caller's options", async () => {
    const body = { logs: [] };
    fetchMock.mockResolvedValueOnce(json(body));
    await expect(fetchRecentAgentLogs(200, { maxRetries: 0 })).resolves.toEqual(
      body
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-logs/recent?limit=200",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchAgentLogsByAgent GETs /agent-logs/by-agent/{id} with the id encoded", async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    await fetchAgentLogsByAgent("a/1", { limit: 500 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agent-logs/by-agent/a%2F1?limit=500",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchAgentLogsByAgent sends since only when given", async () => {
    fetchMock.mockResolvedValueOnce(json({ logs: [] }));
    await fetchAgentLogsByAgent("a1", {
      limit: 500,
      since: "2026-10-10T00:00:00.000Z",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/operations/agent-logs/by-agent/a1?limit=500&since=2026-10-10T00%3A00%3A00.000Z"
    );
  });

  it("a non-2xx rejects in the shape describeCoordPollError reads", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "deadline", budget_ms: 4000 }, 503)
    );
    const err = await fetchRecentAgentLogs(200).catch((e: unknown) => e);
    expect(describeCoordPollError(err)).toBe(
      "coord read deadline (4000 ms) exceeded — unknown"
    );
  });
});
