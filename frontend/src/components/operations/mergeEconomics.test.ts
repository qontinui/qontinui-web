import { describe, expect, it } from "vitest";
import { normalizeMergeEconomics } from "./mergeEconomics";

describe("normalizeMergeEconomics", () => {
  it("keys coord's wrapper-with-array answer by repo, not by index", () => {
    // The shape coord's no-repo arm actually serves (economics.rs
    // `compute_merge_economics`). The pipeline's old inline normalizer keyed
    // this by "0", "1", … so every per-repo lookup missed.
    const n = normalizeMergeEconomics({
      window_hours: 24,
      as_of: "2026-10-04T12:00:00Z",
      repo_count: 2,
      repos: [
        { repo: "a/one", candidate_ci_p90_secs: 600 },
        { repo: "a/two", candidate_ci_p90_secs: null },
      ],
    });
    expect(Object.keys(n.byRepo).sort()).toEqual(["a/one", "a/two"]);
    expect(n.byRepo["a/one"].candidate_ci_p90_secs).toBe(600);
    expect(n.asOf).toBe("2026-10-04T12:00:00Z");
  });

  it("accepts a bare array", () => {
    const n = normalizeMergeEconomics([{ repo: "a/one", queue_depth: 2 }]);
    expect(n.byRepo["a/one"].queue_depth).toBe(2);
    expect(n.asOf).toBeNull();
  });

  it("accepts a keyed object, with or without a repos wrapper", () => {
    expect(
      normalizeMergeEconomics({ repos: { "a/one": { queue_depth: 1 } } })
        .byRepo["a/one"].queue_depth
    ).toBe(1);
    const keyed = normalizeMergeEconomics({
      "a/one": { queue_depth: 3 },
      as_of: "x",
    });
    expect(Object.keys(keyed.byRepo)).toEqual(["a/one"]);
  });

  it("the proxy's degraded {} is an empty map with UNKNOWN freshness", () => {
    expect(normalizeMergeEconomics({})).toEqual({ byRepo: {}, asOf: null });
    expect(normalizeMergeEconomics(null)).toEqual({ byRepo: {}, asOf: null });
  });
});
