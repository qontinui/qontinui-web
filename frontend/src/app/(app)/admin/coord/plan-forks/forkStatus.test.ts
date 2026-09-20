/**
 * `forkStatus` — two forks, reported side by side and never conflated.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4b.
 * The KIND-fork half is the one a consumer loses first: grouping by
 * `(kind, slug)` structurally cannot see a fork whose whole distinguishing
 * feature is that the kinds differ, so a page that renders `groups` and stops
 * has silently dropped an entire failure class.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import {
  FORK_ATTENTION_BY_KIND,
  FORK_PALETTE,
  VARIANT_ORDER_CAVEAT,
  type DivergentResponse,
  type DivergentVariant,
  deriveForkCensus,
  deriveForkHealth,
  describeContentFork,
  describeKindFork,
  orderVariants,
  shortDigest,
  variantOrigin,
} from "./forkStatus";

function variant(over: Partial<DivergentVariant> = {}): DivergentVariant {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "plan",
    kind_locked: false,
    content_sha256: "abcdef0123456789abcdef0123456789",
    source_repo: "qontinui-dev-notes/plans",
    source_path: "2026-09-05-a.md",
    title: "A plan",
    status: "vetted",
    current_version: 3,
    updated_at: "2026-09-10T00:00:00Z",
    ...over,
  };
}

const RESPONSE: DivergentResponse = {
  groups: [
    {
      kind: "plan",
      slug: "2026-09-05-a",
      variant_count: 2,
      variants: [
        variant(),
        variant({
          id: "22222222-2222-2222-2222-222222222222",
          content_sha256: "9999999999999999",
          source_repo: "qontinui-web/docs",
          updated_at: "2026-09-18T00:00:00Z",
        }),
      ],
    },
  ],
  total: 1,
  kind_forks: [
    {
      slug: "2026-08-01-b",
      source_repo: "qontinui-dev-notes/plans",
      kinds: ["plan", "report"],
      variant_count: 2,
      resolvable: false,
      variants: [
        variant({ id: "33333333-3333-3333-3333-333333333333", kind: "plan" }),
        variant({ id: "44444444-4444-4444-4444-444444444444", kind: "report" }),
      ],
    },
  ],
  kind_fork_total: 1,
};

describe("the palette agrees with its attention table (R3)", () => {
  it("has no disagreement", () => {
    expect(paletteDisagreements(FORK_ATTENTION_BY_KIND, FORK_PALETTE)).toEqual(
      []
    );
  });
});

describe("the kind-fork half — the one a (kind, slug) grouping cannot see", () => {
  it("is carried separately from the content groups", () => {
    const census = deriveForkCensus(RESPONSE);
    expect(census.groups).toHaveLength(1);
    expect(census.kindForks).toHaveLength(1);
    expect(census.kindForkTotal).toBe(1);
    expect(census.contentTotal).toBe(1);
  });

  it("reads an unresolvable fork as one only a person settles", () => {
    const status = describeKindFork(RESPONSE.kind_forks![0]);
    expect(status.kind).toBe("kind_operator");
    expect(status.attention).toBe("author");
    expect(status.reason).toMatch(/409/);
    expect(status.reason).toMatch(/PATCH/);
  });

  it("reads a resolvable fork as one the SCANNER heals, and waits", () => {
    const status = describeKindFork({
      ...RESPONSE.kind_forks![0],
      resolvable: true,
    });
    expect(status.kind).toBe("kind_self_healing");
    expect(status.attention).toBe("waiting");
    expect(status.label).toMatch(/scanner/i);
    // Still a fork until the scan runs — the badge must not say "resolved".
    expect(status.reason).toMatch(/until it runs/i);
  });

  it("forwards `resolvable` rather than recomputing it from the variants", () => {
    // A payload whose locked count disagrees with the flag must follow the
    // FLAG: the route computed it over the variants it selected, and a second
    // spelling here is how two rules drift apart.
    const status = describeKindFork({
      ...RESPONSE.kind_forks![0],
      resolvable: true,
      variants: [
        variant({ kind_locked: true }),
        variant({ kind_locked: true }),
      ],
    });
    expect(status.kind).toBe("kind_self_healing");
  });

  it("counts kind forks in the strip even when there is no content fork", () => {
    const health = deriveForkHealth(
      deriveForkCensus({ ...RESPONSE, groups: [], total: 0 }),
      true,
      false
    );
    expect(health.badges.find((b) => b.key === "kind")?.label).toBe(
      "kind forks 1"
    );
    expect(health.level).toBe("red"); // one of them needs an operator
  });

  it("is amber, not red, when every kind fork can heal itself", () => {
    const health = deriveForkHealth(
      deriveForkCensus({
        groups: [],
        total: 0,
        kind_forks: [{ ...RESPONSE.kind_forks![0], resolvable: true }],
        kind_fork_total: 1,
      }),
      true,
      false
    );
    expect(health.level).toBe("amber");
    expect(health.headline).toMatch(/scanner can heal/i);
  });
});

describe("a content fork is always the operator's call", () => {
  it("never offers a self-healing arm", () => {
    const status = describeContentFork(RESPONSE.groups![0]);
    expect(status.kind).toBe("content");
    expect(status.attention).toBe("author");
    expect(status.reason).toMatch(/content judgement/i);
  });
});

describe("a clean read is a measurement; a failed one is not", () => {
  it("calls both-empty-and-both-zero a measured clean", () => {
    const census = deriveForkCensus({
      groups: [],
      total: 0,
      kind_forks: [],
      kind_fork_total: 0,
    });
    expect(census.measuredClean).toBe(true);
    const health = deriveForkHealth(census, true, false);
    expect(health.level).toBe("green");
    expect(health.detail).toMatch(/fresh zero/i);
  });

  it("does NOT call an unserved total a clean read", () => {
    const census = deriveForkCensus({ groups: [], kind_forks: [] });
    expect(census.measuredClean).toBe(false);
    expect(census.contentTotal).toBeNull();
    expect(census.kindForkTotal).toBeNull();
  });

  it("dashes both counts on an unread page — never a zero", () => {
    const health = deriveForkHealth(null, false, true);
    expect(health.headline).toMatch(/unknown, not clean/i);
    expect(health.badges.map((b) => b.label)).toEqual([
      "content forks –",
      "kind forks –",
    ]);
  });

  it("dashes an unserved total on a loaded page too", () => {
    const health = deriveForkHealth(
      deriveForkCensus({ groups: [], kind_forks: [] }),
      true,
      false
    );
    expect(health.badges.find((b) => b.key === "content")?.label).toBe(
      "content forks –"
    );
  });
});

describe("variant presentation makes no ranking claim", () => {
  it("orders newest touched first and SAYS that is temporal only", () => {
    const ordered = orderVariants(RESPONSE.groups![0].variants);
    expect(ordered[0].updated_at).toBe("2026-09-18T00:00:00Z");
    expect(VARIANT_ORDER_CAVEAT).toMatch(/not a ranking/i);
    expect(VARIANT_ORDER_CAVEAT).toMatch(/last TOUCHED/);
  });

  it("puts an unparseable timestamp last rather than at the top", () => {
    const ordered = orderVariants([
      variant({ id: "x", updated_at: "not a date" }),
      variant({ id: "y", updated_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(ordered.map((v) => v.id)).toEqual(["y", "x"]);
  });

  it("states a missing source rather than blanking it", () => {
    expect(
      variantOrigin(variant({ source_repo: null, source_path: null }))
    ).toBe("no source recorded");
    expect(
      variantOrigin(variant({ source_repo: null, source_path: "a.md" }))
    ).toMatch(/no source repo recorded/);
  });

  it("shortens a digest without losing an absent one", () => {
    expect(shortDigest("abcdef0123456789")).toBe("abcdef012345");
    expect(shortDigest(null)).toBe("no digest");
  });
});
