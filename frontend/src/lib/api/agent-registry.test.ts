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

const {
  AgentPrefError,
  isWriteOutcomeUnknown,
  listAgentRegistry,
  listAdminAgentRegistry,
  putAgentRegistryDefaults,
} = await import("./agent-registry");

function respondWith(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
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
  ])(
    "throws rather than claiming an empty registry on %s",
    async (_label, body) => {
      respondWith(body);
      // `?? []` returned [] for every one of these, and the page then stated
      // "No agents are registered for your tenant yet."
      await expect(listAgentRegistry()).rejects.toBeInstanceOf(AgentPrefError);
    }
  );

  it("still surfaces the backend's own error text on a non-2xx", async () => {
    // The 502s #1042 added carry coord's reason in `detail`; the page renders
    // it verbatim in its error card, so it must survive this path unchanged.
    respondWith(
      {
        detail: "coord returned a non-list `agents` on the effective registry",
      },
      502
    );
    await expect(listAgentRegistry()).rejects.toThrow(/non-list `agents`/);
  });
});

/**
 * The ADMIN twin. `listAdminAgentRegistry` shipped with the `?? []` that
 * `listAgentRegistry` had already had removed — the same defect on a function
 * added afterwards. An admin reading an empty registry concludes the tenant
 * has no agents to configure, and that page's whole job is a tenant-wide
 * consent decision.
 */
describe("listAdminAgentRegistry", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  const adminRow = {
    agent_name: "code-reviewer",
    purpose: "Reviews code changes.",
    trigger_condition: "before opening a PR",
    spawn_path: "in_session_subagent",
    model: null,
    effort: null,
    default_enabled: false,
    policy_required: true,
    allowed_dispositions: ["block", "degrade", "warn_proceed"],
    fanout_bound: 15,
    pref_count: 0,
    pref_differs_from_default_count: 0,
  };

  it("returns the rows the backend served", async () => {
    respondWith({ agents: [adminRow] });
    await expect(listAdminAgentRegistry()).resolves.toEqual([adminRow]);
  });

  it("passes an empty registry through as an empty list", async () => {
    respondWith({ agents: [] });
    await expect(listAdminAgentRegistry()).resolves.toEqual([]);
  });

  it.each([
    ["no agents key", {}],
    ["a null agents key", { agents: null }],
    ["an object agents key", { agents: { "code-reviewer": adminRow } }],
    ["a bare array body", [adminRow]],
  ])(
    "throws rather than claiming an empty registry on %s",
    async (_l, body) => {
      respondWith(body);
      await expect(listAdminAgentRegistry()).rejects.toBeInstanceOf(
        AgentPrefError
      );
    }
  );
});

describe("what a failed write says", () => {
  afterEach(() => fetchMock.mockReset());

  const failure = async (body: unknown, status: number) => {
    respondWith(body, status);
    return putAgentRegistryDefaults("code-reviewer", {
      default_enabled: true,
    }).catch((e: unknown) => e);
  };

  it("reads the backend's production envelope, not only FastAPI's detail", async () => {
    // What `error_handler.py` serves: without this the door's own sentence is
    // dropped for the client's fallback.
    const err = await failure(
      {
        error: "GATEWAY_TIMEOUT",
        message: "timeout waiting for coord",
        timestamp: 1,
        path: "/x",
      },
      504
    );
    expect(err).toBeInstanceOf(AgentPrefError);
    expect((err as Error).message).toBe("timeout waiting for coord");
    expect(isWriteOutcomeUnknown(err)).toBe(true);
  });

  it("still reads detail, as a string and as an object", async () => {
    expect(((await failure({ detail: "no" }, 400)) as Error).message).toBe(
      "no"
    );
    expect(
      ((await failure({ detail: { message: "nested" } }, 400)) as Error).message
    ).toBe("nested");
  });

  it("recognises the door's connect failure through the envelope, and only that 502", async () => {
    expect(
      isWriteOutcomeUnknown(
        await failure(
          { error: "BAD_GATEWAY", message: "coord is not reachable" },
          502
        )
      )
    ).toBe(false);
    expect(
      isWriteOutcomeUnknown(
        await failure({ detail: "coord is not reachable" }, 502)
      )
    ).toBe(false);
    expect(
      isWriteOutcomeUnknown(await failure({ message: "Bad Gateway" }, 502))
    ).toBe(true);
  });

  it("does not take a 4xx for an open outcome, and takes a statusless failure for one", () => {
    expect(isWriteOutcomeUnknown(new AgentPrefError("no", null, 403))).toBe(
      false
    );
    expect(isWriteOutcomeUnknown(new TypeError("Failed to fetch"))).toBe(true);
    expect(isWriteOutcomeUnknown(new Error("PUT /x failed: 503 - busy"))).toBe(
      true
    );
  });
});
