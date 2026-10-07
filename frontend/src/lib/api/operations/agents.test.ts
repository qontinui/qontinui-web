import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins each `agents` function's exact request: the RELATIVE URL (plan D6),
 * the method, and the retry policy the route walker cannot see. The spawn's
 * `idempotent: false` + `maxRetries: 0` is the load-bearing pair — a retried
 * spawn can mint two agents — so the whole options object is compared with
 * `toEqual`, and any change to it has to say so here.
 */

const getMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchClaudeAccounts, spawnAgent } = await import("./agents");

describe("agents", () => {
  afterEach(() => {
    getMock.mockReset();
    fetchMock.mockReset();
  });

  it("fetchClaudeAccounts GETs /claude-accounts, declared idempotent", async () => {
    await fetchClaudeAccounts();
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock.mock.calls[0]).toEqual([
      "/api/v1/operations/claude-accounts",
      { idempotent: true },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetchClaudeAccounts resolves to the parsed body httpClient.get returned", async () => {
    const body = { accounts: [], table_provisioned: true };
    getMock.mockResolvedValueOnce(body);
    await expect(fetchClaudeAccounts()).resolves.toBe(body);
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
    expect(getMock).not.toHaveBeenCalled();
  });

  it("spawnAgent returns the raw Response httpClient.fetch resolved", async () => {
    const res = new Response("not json", { status: 200 });
    fetchMock.mockResolvedValueOnce(res);
    await expect(spawnAgent({})).resolves.toBe(res);
  });
});
