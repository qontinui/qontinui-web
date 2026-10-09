/**
 * The coord-policy client's wire: the list read's query grammar, and every
 * other function's literal RELATIVE URL (with `encodeURIComponent` of each path
 * parameter) and `httpClient.fetch` options.
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  createCoordPolicy,
  deleteCoordPolicy,
  deleteCoordPolicySystemOverride,
  listCoordPolicies,
  patchCoordPolicy,
  putCoordPolicySystemOverride,
  restoreCoordPolicyDefault,
} = await import("./coordPolicies");

const BASE = "/api/v1/operations/coord/policies";
const GET = { method: "GET", idempotent: true };

/** An id that only survives the trip as one path segment if encoded. */
const ID = "a/b #1";
const ID_ENCODED = "a%2Fb%20%231";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => answer({ policies: [], total: 0 }));
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("listCoordPolicies query string", () => {
  it("sends no query string when unfiltered", async () => {
    await listCoordPolicies();
    // Every production caller takes this path, so it must stay byte-identical
    // to the pre-filter request: coord then applies its own `enabled = true`.
    expect(fetchMock).toHaveBeenCalledWith(BASE, GET);
  });

  it("sends no query string for an empty filter object", async () => {
    await listCoordPolicies({});
    expect(fetchMock).toHaveBeenCalledWith(BASE, GET);
  });

  it("forwards kind and repo", async () => {
    await listCoordPolicies({ kind: "terminal_auto_response", repo: "web" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}?kind=terminal_auto_response&repo=web`,
      GET
    );
  });

  it("forwards an EMPTY repo rather than dropping it", async () => {
    // `?repo=` selects the degenerate empty-repo rows. Dropping it would widen
    // the query and answer a question the caller never asked.
    await listCoordPolicies({ repo: "" });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}?repo=`, GET);
  });

  it("serializes enabled in both directions", async () => {
    await listCoordPolicies({ enabled: true });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}?enabled=true`, GET);
    await listCoordPolicies({ enabled: false });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}?enabled=false`, GET);
  });

  it("percent-encodes a value that would otherwise break the query", async () => {
    await listCoordPolicies({ repo: "a&b=c" });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}?repo=a%26b%3Dc`, GET);
  });
});

describe("coordPolicies client", () => {
  it("listCoordPolicies rejects a non-2xx in the helpers' error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "nope" }, 403));
    const err = await listCoordPolicies().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `GET ${BASE} failed: 403 - {"detail":"nope"}`
    );
    expect(httpStatusOf(err)).toBe(403);
    expect(httpBodyOf(err)).toBe('{"detail":"nope"}');
  });

  it("createCoordPolicy POSTs the body, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ policy_id: "p1" }));
    await expect(createCoordPolicy({ name: "n" })).resolves.toEqual({
      policy_id: "p1",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      BASE,
      { method: "POST", body: '{"name":"n"}', idempotent: false },
    ]);
  });

  it("patchCoordPolicy PATCHes the encoded id, declared idempotent", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await patchCoordPolicy(ID, { enabled: false });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/${ID_ENCODED}`,
      { method: "PATCH", body: '{"enabled":false}', idempotent: true },
    ]);
  });

  it("deleteCoordPolicy DELETEs the encoded id and tolerates an empty 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteCoordPolicy(ID)).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/${ID_ENCODED}`,
      { method: "DELETE", idempotent: true },
    ]);
  });

  it("restoreCoordPolicyDefault POSTs an empty object to the encoded id", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await restoreCoordPolicyDefault(ID);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/${ID_ENCODED}/restore-default`,
      { method: "POST", body: "{}", idempotent: false },
    ]);
  });

  it("putCoordPolicySystemOverride PUTs the encoded system rule id", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await putCoordPolicySystemOverride(ID, { disabled: true });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/system/${ID_ENCODED}/override`,
      { method: "PUT", body: '{"disabled":true}', idempotent: true },
    ]);
  });

  it("deleteCoordPolicySystemOverride DELETEs the encoded system rule id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteCoordPolicySystemOverride(ID);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/system/${ID_ENCODED}/override`,
      { method: "DELETE", idempotent: true },
    ]);
  });
});
