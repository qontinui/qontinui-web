import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordSettings` function's exact request: the RELATIVE URL written out as a
 * LITERAL (so a change to the shared base cannot move every expectation with
 * it), the method, the body, and the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => fetchMock.mockReset());

const m = await import("./coordSettings");

describe("coordSettings", () => {
  it("fetchAutoFixPrSettings GETs /pr-merge/settings", async () => {
    const body = { tenant_id: "t", profile: {} };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(m.fetchAutoFixPrSettings()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/settings",
      { method: "GET", idempotent: true },
    ]);
  });

  it("patchAutoFixPr PATCHes only {auto_fix_pr} and is never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ tenant_id: "t", profile: {} }));
    await m.patchAutoFixPr("on");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/settings",
      {
        method: "PATCH",
        body: '{"auto_fix_pr":"on"}',
        idempotent: false,
      },
    ]);
  });

  it("fetchNextStepSettings / putNextStepSettings use /coord/next-step-settings", async () => {
    const body = { master_enabled: true, can_edit: true, domains: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(m.fetchNextStepSettings()).resolves.toEqual(body);
    fetchMock.mockResolvedValueOnce(answer(body));
    await m.putNextStepSettings([
      { decision_domain: "next_step", autonomy_level: "auto_decide" },
    ]);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/next-step-settings",
      { method: "GET", idempotent: true },
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/v1/operations/coord/next-step-settings",
      {
        method: "PUT",
        body: '{"domains":[{"decision_domain":"next_step","autonomy_level":"auto_decide"}]}',
      },
    ]);
  });

  it("the priority-set reads and writes hit /coord/priority-sets and /coord/composition-rules", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(answer({})));
    await m.fetchPrioritySets();
    await m.fetchCompositionRules();
    await m.createPrioritySet({
      set_name: "s",
      repo: null,
      ordering: ["a"],
      non_factors: [],
    });
    await m.updatePrioritySet("id1", { enabled: false });
    expect(
      fetchMock.mock.calls.map((c) => [c[0], (c[1] as RequestInit).method])
    ).toEqual([
      ["/api/v1/operations/coord/priority-sets", "GET"],
      ["/api/v1/operations/coord/composition-rules", "GET"],
      ["/api/v1/operations/coord/priority-sets", "POST"],
      ["/api/v1/operations/coord/priority-sets/id1", "PATCH"],
    ]);
  });

  it("deletePrioritySet resolves undefined on a 204 and rejects a non-2xx in the helpers error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(m.deletePrioritySet("id1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/priority-sets/id1",
      { method: "DELETE" },
    ]);
    fetchMock.mockResolvedValueOnce(answer("system_row_immutable", 409));
    const err = await m.deletePrioritySet("id1").catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(409);
  });
});
