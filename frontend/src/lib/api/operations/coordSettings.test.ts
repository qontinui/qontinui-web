import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each coord tenant-settings client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchNextStepSettings,
  putNextStepSettings,
  fetchNextStepSettingsFleet,
  fetchPrioritySets,
  fetchCompositionRules,
  createPrioritySet,
  updatePrioritySet,
  deletePrioritySet,
} = await import("./coordSettings");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordSettings", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchNextStepSettings GETs /coord/next-step-settings and parses", async () => {
    const body = { master_enabled: true, can_edit: true, domains: [] };
    fetchMock.mockResolvedValueOnce(json(body));
    await expect(fetchNextStepSettings()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/next-step-settings",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchNextStepSettings keeps the caller's retry budget", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ master_enabled: true, can_edit: true, domains: [] })
    );
    await fetchNextStepSettings({ maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/next-step-settings",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("putNextStepSettings PUTs {domains}, declared non-idempotent", async () => {
    fetchMock.mockResolvedValueOnce(json({ domains: [] }));
    await putNextStepSettings([
      { decision_domain: "pr_fix", autonomy_level: "auto_decide" },
    ]);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/next-step-settings",
      {
        method: "PUT",
        body: '{"domains":[{"decision_domain":"pr_fix","autonomy_level":"auto_decide"}]}',
        idempotent: false,
      },
    ]);
  });

  it("fetchNextStepSettingsFleet keeps the caller's retry budget", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ master_enabled: true, tenants: [] })
    );
    await fetchNextStepSettingsFleet({ maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/next-step-settings/fleet",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchNextStepSettingsFleet rejects in the httpClient.get shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"deadline","budget_ms":800}', { status: 503 })
    );
    await expect(fetchNextStepSettingsFleet()).rejects.toThrow(
      'GET /api/v1/operations/coord/next-step-settings/fleet failed: 503 - {"error":"deadline","budget_ms":800}'
    );
  });

  it("fetchPrioritySets and fetchCompositionRules GET their envelopes", async () => {
    fetchMock.mockResolvedValueOnce(json({ priority_sets: [], total: 0 }));
    fetchMock.mockResolvedValueOnce(json({ composition_rules: [], total: 0 }));
    await expect(fetchPrioritySets()).resolves.toEqual({
      priority_sets: [],
      total: 0,
    });
    await fetchCompositionRules();
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/coord/priority-sets",
        { method: "GET", idempotent: true },
      ],
      [
        "/api/v1/operations/coord/composition-rules",
        { method: "GET", idempotent: true },
      ],
    ]);
  });

  it("createPrioritySet POSTs the input and is never retried", async () => {
    const input = {
      set_name: "s",
      repo: null,
      ordering: ["a"],
      non_factors: [],
    };
    fetchMock.mockResolvedValueOnce(json({ id: "1" }));
    await createPrioritySet(input);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/priority-sets",
      { method: "POST", body: JSON.stringify(input), idempotent: false },
    ]);
  });

  it("createPrioritySet keeps coord's refusal code in the rejection", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"duplicate_set_name"}', { status: 409 })
    );
    await expect(
      createPrioritySet({
        set_name: "s",
        repo: null,
        ordering: [],
        non_factors: [],
      })
    ).rejects.toThrow(
      'POST /api/v1/operations/coord/priority-sets failed: 409 - {"error":"duplicate_set_name"}'
    );
  });

  it("updatePrioritySet PATCHes the diff onto the encoded id", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "1" }));
    await updatePrioritySet("a/b", { enabled: false });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/priority-sets/a%2Fb",
      { method: "PATCH", body: '{"enabled":false}', idempotent: false },
    ]);
  });

  it("deletePrioritySet DELETEs and resolves undefined on 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deletePrioritySet("p/1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/priority-sets/p%2F1",
      { method: "DELETE", idempotent: false },
    ]);
  });
});
