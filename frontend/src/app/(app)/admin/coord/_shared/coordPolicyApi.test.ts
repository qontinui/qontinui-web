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
 * tenant row with an empty `repo` is ranked in its OWN band, above every other
 * tenant row, by the clearance resolver this console mirrors
 * (`gateClearance.ts` `bandRank`). A truthiness check would silently turn that
 * narrow query into a wide one.
 *
 * There is deliberately NO test for listing the disabled arm, because there is
 * deliberately no caller: coord's DELETE is a soft delete onto `enabled`
 * (`policies/routes.rs::delete_soft`) and `coord.policy_rules` has no tombstone
 * column, so `enabled = false` cannot distinguish "turned off" from "deleted".
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const get = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { COORD_POLICIES_API } from "./coordPolicies";
import { listCoordPolicies } from "./coordPolicyApi";

const BASE = COORD_POLICIES_API;

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ policies: [], total: 0 });
});

describe("listCoordPolicies query string", () => {
  it("sends no query string when unfiltered", async () => {
    await listCoordPolicies();
    // Every production caller takes this path, so it must stay byte-identical
    // to the pre-filter request: coord then applies its own `enabled = true`.
    expect(get).toHaveBeenCalledWith(BASE);
  });

  it("sends no query string for an empty filter object", async () => {
    await listCoordPolicies({});
    expect(get).toHaveBeenCalledWith(BASE);
  });

  it("forwards kind and repo", async () => {
    await listCoordPolicies({ kind: "terminal_auto_response", repo: "web" });
    expect(get).toHaveBeenCalledWith(
      `${BASE}?kind=terminal_auto_response&repo=web`
    );
  });

  it("forwards an EMPTY repo rather than dropping it", async () => {
    // `?repo=` selects the degenerate empty-repo rows. Dropping it would widen
    // the query and answer a question the caller never asked.
    await listCoordPolicies({ repo: "" });
    expect(get).toHaveBeenCalledWith(`${BASE}?repo=`);
  });

  it("serializes enabled in both directions", async () => {
    await listCoordPolicies({ enabled: true });
    expect(get).toHaveBeenCalledWith(`${BASE}?enabled=true`);
    await listCoordPolicies({ enabled: false });
    expect(get).toHaveBeenCalledWith(`${BASE}?enabled=false`);
  });

  it("percent-encodes a value that would otherwise break the query", async () => {
    await listCoordPolicies({ repo: "a&b=c" });
    expect(get).toHaveBeenCalledWith(`${BASE}?repo=a%26b%3Dc`);
  });
});
