import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `agents` function's exact request: the RELATIVE URL (plan D6) on
 * `httpClient.fetch` (the D6 amendment), the method, and the retry policy the
 * route walker cannot see. The spawn's `idempotent: false` + `maxRetries: 0`
 * is the load-bearing pair — a retried spawn can mint two agents — so the
 * whole options object is compared with `toEqual`, and any change to it has
 * to say so here.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchClaudeAccounts, spawnAgent } = await import("./agents");

describe("agents", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchClaudeAccounts GETs /claude-accounts, declared idempotent", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await fetchClaudeAccounts();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/claude-accounts",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchClaudeAccounts resolves to the parsed body", async () => {
    const body = { accounts: [], table_provisioned: true };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(fetchClaudeAccounts()).resolves.toEqual(body);
  });

  it("fetchClaudeAccounts rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Not authenticated", { status: 401 })
    );
    const err = await fetchClaudeAccounts().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/claude-accounts failed: 401 - Not authenticated"
    );
    expect(httpStatusOf(err)).toBe(401);
  });

  it("spawnAgent POSTs the JSON body once, never retried", async () => {
    const body = { repos: [{ repo: "qontinui-web" }], initial_prompt: "go" };
    await spawnAgent(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/agents/spawn",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        idempotent: false,
        maxRetries: 0,
      },
    ]);
  });

  it("spawnAgent returns the raw Response httpClient.fetch resolved", async () => {
    const res = new Response("not json", { status: 200 });
    fetchMock.mockResolvedValueOnce(res);
    await expect(spawnAgent({})).resolves.toBe(res);
  });
});
