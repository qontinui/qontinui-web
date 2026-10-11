/**
 * The coord-policy list read's query grammar.
 *
 * Coord's `GET /coord/policies` takes `kind` / `repo` / `enabled`
 * (`policies/routes.rs::ListPoliciesQuery`), and until the web proxy forwarded
 * a query string none of them were reachable from the browser. These tests pin
 * what actually goes on the wire — in particular that an EMPTY value is
 * forwarded rather than dropped, matching the proxy's own rule so the two
 * halves cannot disagree about what was asked.
 *
 * `repo === ""` is not a pedantic case: coord matches `repo` exactly, and a
 * tenant row with an empty `repo` is a distinct, INERT row — neither
 * tenant-wide nor repo-scoped, so no gate consult resolves it
 * (`gateClearance.ts` `inertReason`, "empty-repo"). Listing exactly those rows
 * is how an operator finds them. A truthiness check would silently turn that
 * narrow query into a wide one.
 *
 * There is deliberately NO test for listing the disabled arm, because there is
 * deliberately no caller: coord's DELETE is a soft delete onto `enabled`
 * (`policies/routes.rs::delete_soft`) and `coord.policy_rules` has no tombstone
 * column, so `enabled = false` cannot distinguish "turned off" from "deleted".
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...a: unknown[]) => fetchMock(...a),
  },
}));

import {
  createCoordPolicy,
  deleteCoordPolicy,
  deleteCoordPolicySystemOverride,
  listCoordPolicies,
  patchCoordPolicy,
  putCoordPolicySystemOverride,
  restoreCoordPolicyDefault,
} from "./coordPolicies";

const BASE = "/api/v1/operations/coord/policies";
const GET = { method: "GET", idempotent: true };

/** The URL the n-th fetch went to. */
function urlOf(n = 0): unknown {
  return fetchMock.mock.calls[n][0];
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ policies: [], total: 0 }))
  );
});

describe("listCoordPolicies query string", () => {
  it("sends no query string when unfiltered", async () => {
    await listCoordPolicies();
    // Every production caller takes this path, so it must stay byte-identical
    // to the pre-filter request: coord then applies its own `enabled = true`.
    expect(fetchMock.mock.calls[0]).toEqual([BASE, GET]);
  });

  it("sends no query string for an empty filter object", async () => {
    await listCoordPolicies({});
    expect(urlOf()).toBe(BASE);
  });

  it("forwards kind and repo", async () => {
    await listCoordPolicies({ kind: "terminal_auto_response", repo: "web" });
    expect(urlOf()).toBe(`${BASE}?kind=terminal_auto_response&repo=web`);
  });

  it("forwards an EMPTY repo rather than dropping it", async () => {
    // `?repo=` selects the degenerate empty-repo rows. Dropping it would widen
    // the query and answer a question the caller never asked.
    await listCoordPolicies({ repo: "" });
    expect(urlOf()).toBe(`${BASE}?repo=`);
  });

  it("serializes enabled in both directions", async () => {
    await listCoordPolicies({ enabled: true });
    expect(urlOf(0)).toBe(`${BASE}?enabled=true`);
    await listCoordPolicies({ enabled: false });
    expect(urlOf(1)).toBe(`${BASE}?enabled=false`);
  });

  it("percent-encodes a value that would otherwise break the query", async () => {
    await listCoordPolicies({ repo: "a&b=c" });
    expect(urlOf()).toBe(`${BASE}?repo=a%26b%3Dc`);
  });
});

describe("coord policy writes", () => {
  it("listCoordPolicies parses the body", async () => {
    const body = { policies: [{ policy_id: "p1" }], total: 1 };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(listCoordPolicies()).resolves.toEqual(body);
  });

  it("listCoordPolicies rejects a non-2xx in the httpClient.get shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 502 }));
    await expect(listCoordPolicies()).rejects.toThrow(
      "GET /api/v1/operations/coord/policies failed: 502 - down"
    );
  });

  it("createCoordPolicy POSTs the body and is never retried", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ policy_id: "new" }))
    );
    await expect(createCoordPolicy({ name: "n" })).resolves.toEqual({
      policy_id: "new",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/policies",
      { method: "POST", body: '{"name":"n"}', idempotent: false },
    ]);
  });

  it("patchCoordPolicy PATCHes the encoded id, declared idempotent", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await patchCoordPolicy("a/b", { enabled: false });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/policies/a%2Fb",
      { method: "PATCH", body: '{"enabled":false}', idempotent: true },
    ]);
  });

  it("deleteCoordPolicy DELETEs the encoded id and resolves undefined on 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteCoordPolicy("a/b")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/policies/a%2Fb",
      { method: "DELETE", idempotent: false },
    ]);
  });

  it("deleteCoordPolicy rejects a non-2xx in the httpClient.delete shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    await expect(deleteCoordPolicy("p1")).rejects.toThrow(
      "DELETE /api/v1/operations/coord/policies/p1 failed: 403 - nope"
    );
  });

  it("restoreCoordPolicyDefault POSTs an empty object, never retried", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await restoreCoordPolicyDefault("p 1");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/policies/p%201/restore-default",
      { method: "POST", body: "{}", idempotent: false },
    ]);
  });

  it("putCoordPolicySystemOverride PUTs the override body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await putCoordPolicySystemOverride("sys/1", { disabled: true });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/policies/system/sys%2F1/override",
      { method: "PUT", body: '{"disabled":true}', idempotent: false },
    ]);
  });

  it("deleteCoordPolicySystemOverride DELETEs the override", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      deleteCoordPolicySystemOverride("sys/1")
    ).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/policies/system/sys%2F1/override",
      { method: "DELETE", idempotent: false },
    ]);
  });
});
