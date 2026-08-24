import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The agent-registry client must not launder a missing agent list into an
 * empty registry.
 *
 * `/settings/agents` renders an empty list as **"No agents are registered for
 * your tenant yet."** — a claim about the tenant's authorization
 * configuration, not a shrug. The backend removed exactly this laundering on
 * its own side of the wire (qontinui-web #1042 replaced
 * `payload.get("agents") or []` in `_effective_rows` with a 502), but
 * `listAgentRegistry` still ended in `return body.agents ?? []`, so a 2xx
 * carrying no agent list — a proxy error page, a rewritten body, a future
 * envelope change — produced that same confident claim one layer up.
 *
 * An empty ARRAY stays a legitimate answer: a tenant really can have no
 * agents, and the two cases must not be conflated in either direction.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { AgentPrefError, listAgentRegistry } = await import("./agent-registry");

function respondWith(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const sampleAgent = {
  agent_name: "code-reviewer",
  purpose: "Reviews code changes.",
  spawn_path: "in_session_subagent",
  model: null,
  effort: null,
  policy_required: true,
  fanout_bound: 15,
  enabled: true,
  disposition: "degrade",
  source: "default",
};

describe("listAgentRegistry", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("returns the agents the backend served", async () => {
    respondWith({ agents: [sampleAgent] });
    await expect(listAgentRegistry()).resolves.toEqual([sampleAgent]);
  });

  it("passes an empty registry through as an empty list", async () => {
    // A tenant with no agents is a legitimate answer and must NOT be turned
    // into an error — the guard below is about a MISSING list, not an empty
    // one. Without this, throwing on everything would pass the class.
    respondWith({ agents: [] });
    await expect(listAgentRegistry()).resolves.toEqual([]);
  });

  it.each([
    ["no agents key", {}],
    ["a null agents key", { agents: null }],
    ["an object agents key", { agents: { "code-reviewer": sampleAgent } }],
    ["a string agents key", { agents: "code-reviewer" }],
    ["a bare array body", [sampleAgent]],
  ])("throws rather than claiming an empty registry on %s", async (_label, body) => {
    respondWith(body);
    // `?? []` returned [] for every one of these, and the page then stated
    // "No agents are registered for your tenant yet."
    await expect(listAgentRegistry()).rejects.toBeInstanceOf(AgentPrefError);
  });

  it("still surfaces the backend's own error text on a non-2xx", async () => {
    // The 502s #1042 added carry coord's reason in `detail`; the page renders
    // it verbatim in its error card, so it must survive this path unchanged.
    respondWith(
      { detail: "coord returned a non-list `agents` on the effective registry" },
      502,
    );
    await expect(listAgentRegistry()).rejects.toThrow(/non-list `agents`/);
  });
});
