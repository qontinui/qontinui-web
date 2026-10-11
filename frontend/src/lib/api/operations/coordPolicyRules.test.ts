import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins each `coordPolicyRules` function's exact request. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const {
  deleteCoordPolicyRow,
  deleteCoordPolicySystemRuleOverride,
  fetchCoordPolicies,
  patchCoordPolicyRow,
  postCoordPolicy,
  postCoordPolicyRestoreDefault,
  putCoordPolicySystemRuleOverride,
} = await import("./coordPolicyRules");

const BASE = "/api/v1/operations/coord/policies";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordPolicyRules", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchCoordPolicies GETs the bare route, or with the query when given", async () => {
    fetchMock.mockImplementation(async () =>
      answer({ policies: [], total: 0 })
    );
    await fetchCoordPolicies("");
    await fetchCoordPolicies("repo=");
    expect(fetchMock.mock.calls).toEqual([
      [BASE, { method: "GET" }],
      [`${BASE}?repo=`, { method: "GET" }],
    ]);
  });

  it("postCoordPolicy POSTs the body, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ policy_id: "p" }));
    await expect(postCoordPolicy({ name: "n" })).resolves.toEqual({
      policy_id: "p",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      BASE,
      { method: "POST", body: '{"name":"n"}' },
    ]);
  });

  it("patchCoordPolicyRow PATCHes the encoded id and is safe to re-issue", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await patchCoordPolicyRow("a/b", { enabled: false });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/a%2Fb`,
      { method: "PATCH", body: '{"enabled":false}', idempotent: true },
    ]);
  });

  it("deleteCoordPolicyRow DELETEs and tolerates an empty 2xx body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteCoordPolicyRow("p1")).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/p1`,
      { method: "DELETE" },
    ]);
  });

  it("postCoordPolicyRestoreDefault POSTs an empty object", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await postCoordPolicyRestoreDefault("p1");
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/p1/restore-default`,
      { method: "POST", body: "{}" },
    ]);
  });

  it("the system-override pair hit /system/:id/override", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await putCoordPolicySystemRuleOverride("s1", { disabled: true });
    await deleteCoordPolicySystemRuleOverride("s1");
    expect(fetchMock.mock.calls).toEqual([
      [
        `${BASE}/system/s1/override`,
        { method: "PUT", body: '{"disabled":true}' },
      ],
      [`${BASE}/system/s1/override`, { method: "DELETE" }],
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    const err = await postCoordPolicy({}).catch((e: unknown) => e);
    expect((err as Error).message).toBe(`POST ${BASE} failed: 403 - nope`);
    expect(httpStatusOf(err)).toBe(403);
  });
});
