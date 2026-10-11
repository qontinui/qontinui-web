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
  httpClient: { fetch: (...a: unknown[]) => fetchMock(...a) },
}));

import { listCoordPolicies } from "./coordPolicyApi";

const BASE = "/api/v1/operations/coord/policies";

/** `expectGet(url)` — a GET of `url`. */
function expectGet(url: string) {
  expect(fetchMock).toHaveBeenCalledWith(url, { method: "GET" });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ policies: [], total: 0 }), { status: 200 })
  );
});

describe("listCoordPolicies query string", () => {
  it("sends no query string when unfiltered", async () => {
    await listCoordPolicies();
    // Every production caller takes this path, so it must stay byte-identical
    // to the pre-filter request: coord then applies its own `enabled = true`.
    expectGet(BASE);
  });

  it("sends no query string for an empty filter object", async () => {
    await listCoordPolicies({});
    expectGet(BASE);
  });

  it("forwards kind and repo", async () => {
    await listCoordPolicies({ kind: "terminal_auto_response", repo: "web" });
    expectGet(`${BASE}?kind=terminal_auto_response&repo=web`);
  });

  it("forwards an EMPTY repo rather than dropping it", async () => {
    // `?repo=` selects the degenerate empty-repo rows. Dropping it would widen
    // the query and answer a question the caller never asked.
    await listCoordPolicies({ repo: "" });
    expectGet(`${BASE}?repo=`);
  });

  it("serializes enabled in both directions", async () => {
    await listCoordPolicies({ enabled: true });
    expectGet(`${BASE}?enabled=true`);
    await listCoordPolicies({ enabled: false });
    expectGet(`${BASE}?enabled=false`);
  });

  it("percent-encodes a value that would otherwise break the query", async () => {
    await listCoordPolicies({ repo: "a&b=c" });
    expectGet(`${BASE}?repo=a%26b%3Dc`);
  });
});
