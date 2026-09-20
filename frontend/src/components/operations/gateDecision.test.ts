/**
 * gateDecision — the honesty derivation, and the join the 2026-09-19 pipeline
 * redesign is built on.
 *
 * The honesty half was module-private in `MergeTrain.tsx` and therefore only
 * reachable through a rendered row, so its degraded branches were asserted by
 * reading badge text. They are pure and total; they are tested as such here.
 *
 * The join half is new, and it is the thing that lets the page-level "Gate
 * decisions" section go away: a decision about a PR in the list is evidence
 * inside that PR's row, and only the remainder is audit residue.
 */

import { describe, expect, it } from "vitest";
import {
  gateBlockKey,
  gateFirstSeenDay,
  gateProvenanceTitle,
  gateRepeatCount,
  honestyLabel,
  indexGateBlocks,
  unattachedGateBlocks,
} from "./gateDecision";
import type { BlastRadiusBlock } from "./mergeTypes";

function block(overrides: Partial<BlastRadiusBlock> = {}): BlastRadiusBlock {
  return {
    repo: "qontinui/qontinui-coord",
    pr_number: 1516,
    tenant_id: "t-1",
    removed_export_name: "SUBCLASS_ORPHAN",
    file: "crates/coord/src/worktree_observer.rs",
    referenced_by: [],
    evaluation_latency_secs: 0.2,
    at: "2026-09-19T12:00:00.000Z",
    block_reason_code: "removes-referenced-export",
    ...overrides,
  };
}

describe("honestyLabel", () => {
  it("calls a full-coverage run authoritative — and ONLY that combination", () => {
    expect(honestyLabel(block({ coverage: 1, graph_available: true }))).toEqual({
      text: "full coverage",
      tone: "ok",
    });
  });

  it("names a partial mirror with its percentage", () => {
    expect(
      honestyLabel(block({ coverage: 0.42, graph_available: true }))
    ).toEqual({ text: "partial coverage (42%)", tone: "degraded" });
  });

  it("refuses to treat a graph-less run as a verdict", () => {
    const l = honestyLabel(block({ coverage: 1, graph_available: false }));
    expect(l.tone).toBe("degraded");
    expect(l.text).toContain("non-authoritative");
  });

  it("distinguishes 'the gate did not run' from 'the gate passed'", () => {
    // No `block_reason_code` means the blast-radius tier never ran on this PR.
    // Rendering that as a passing or a full-coverage decision is the specific
    // false-clear this label exists to prevent.
    expect(honestyLabel(block({ block_reason_code: null }))).toEqual({
      text: "gate did not run",
      tone: "unknown",
    });
    expect(honestyLabel(block({ block_reason_code: undefined }))).toEqual({
      text: "gate did not run",
      tone: "unknown",
    });
  });

  it("says 'not reported' rather than claiming coverage it cannot back", () => {
    // An older coord that never plumbed the two fields through. The tempting
    // default is "full coverage"; it is unsupported, so it is not taken.
    const l = honestyLabel(block());
    expect(l).toEqual({ text: "coverage not reported", tone: "unknown" });
    // Half-reported is still not reported.
    expect(honestyLabel(block({ coverage: 1 })).tone).toBe("unknown");
    expect(honestyLabel(block({ graph_available: true })).tone).toBe("unknown");
  });
});

describe("gateRepeatCount", () => {
  it("floors at 1 — a row is at minimum the one evaluation it records", () => {
    // `×0` would claim the decision never happened, which is the opposite of
    // what the row proves. Every unusable value lands on 1, not on 0.
    for (const repeat_count of [undefined, null, 0, -5, NaN, Infinity]) {
      expect(gateRepeatCount(block({ repeat_count }))).toBe(1);
    }
  });

  it("truncates a fractional count rather than rounding it up", () => {
    expect(gateRepeatCount(block({ repeat_count: 547 }))).toBe(547);
    expect(gateRepeatCount(block({ repeat_count: 2.9 }))).toBe(2);
  });
});

describe("gateFirstSeenDay", () => {
  it("returns the UTC day", () => {
    expect(gateFirstSeenDay("2026-09-19T23:59:59.000Z")).toBe("2026-09-19");
  });

  it("returns null for absent AND for unparseable — both are unknown", () => {
    // Deliberately NOT distinguished by the caller's copy: substituting `at`
    // for a malformed `first_seen_at` would silently claim a zero-length run.
    expect(gateFirstSeenDay(null)).toBeNull();
    expect(gateFirstSeenDay(undefined)).toBeNull();
    expect(gateFirstSeenDay("")).toBeNull();
    expect(gateFirstSeenDay("not-a-date")).toBeNull();
  });
});

describe("indexGateBlocks", () => {
  it("keys on repo AND number, so two repos' #1 do not collide", () => {
    const a = block({ repo: "qontinui/qontinui-web", pr_number: 1 });
    const b = block({ repo: "qontinui/qontinui-coord", pr_number: 1 });
    const idx = indexGateBlocks([a, b]);
    expect(idx.size).toBe(2);
    expect(idx.get(gateBlockKey("qontinui/qontinui-web", 1))).toBe(a);
    expect(idx.get(gateBlockKey("qontinui/qontinui-coord", 1))).toBe(b);
  });

  it("keeps the NEWEST decision when coord returns more than one per PR", () => {
    // Coord coalesces to one row per PR, so a duplicate means an older coord
    // or two replicas answering. Showing the stale one in a row would say the
    // PR is held for a reason it was released from.
    const old = block({ at: "2026-09-18T00:00:00.000Z" });
    const fresh = block({
      at: "2026-09-19T00:00:00.000Z",
      block_reason_code: "newer-reason",
    });
    expect(indexGateBlocks([fresh, old])?.get(gateBlockKey(old.repo, 1516))).toBe(
      fresh
    );
    expect(indexGateBlocks([old, fresh])?.get(gateBlockKey(old.repo, 1516))).toBe(
      fresh
    );
  });

  it("orders CHRONOLOGICALLY, not lexicographically, across fraction widths", () => {
    // The discriminating case, and the reason the day-apart test above is not
    // enough on its own: it passes under any comparator that is not outright
    // inverted. `'Z'` (0x5A) sorts ABOVE every digit, so under a string
    // compare `…00Z` reads as LATER than `…00.000500Z` — half a millisecond
    // earlier in fact. The duplicate-key case this function exists for is
    // exactly the two-producer case that mixes these widths.
    const zeroFraction = block({
      at: "2026-09-19T12:00:00Z",
      block_reason_code: "older",
    });
    const microFraction = block({
      at: "2026-09-19T12:00:00.000500Z",
      block_reason_code: "newer",
    });
    const key = gateBlockKey(zeroFraction.repo, 1516);
    for (const order of [
      [zeroFraction, microFraction],
      [microFraction, zeroFraction],
    ]) {
      const won = indexGateBlocks(order)?.get(key);
      // `Date.parse` truncates to milliseconds, so these two compare EQUAL
      // rather than ordering — a stable "keep what is already held", which is
      // a safe degradation. What must NOT happen is the string compare's
      // answer, where `zeroFraction` wins regardless of input order.
      expect(won).toBe(order[0]);
    }
    // The same pair a full millisecond apart IS discriminated, and the string
    // compare gets it backwards.
    const later = block({ at: "2026-09-19T12:00:00.002Z", block_reason_code: "newer" });
    expect(indexGateBlocks([zeroFraction, later])?.get(key)).toBe(later);
    expect(indexGateBlocks([later, zeroFraction])?.get(key)).toBe(later);
    expect("2026-09-19T12:00:00Z" > "2026-09-19T12:00:00.002Z").toBe(true);
  });

  it("handles the `+00:00` offset form coord's to_rfc3339() actually emits", () => {
    // chrono's `to_rfc3339()` (blast_radius_monitor.rs) uses a `+00:00`
    // offset, not `Z`. That family happens to be safe under string compare —
    // which is precisely why the bug survives review by inspection. It must
    // order correctly here too, and mixed against a `Z` producer.
    const a = block({ at: "2026-09-19T12:00:00+00:00" });
    const b = block({ at: "2026-09-19T12:00:05+00:00", block_reason_code: "newer" });
    const key = gateBlockKey(a.repo, 1516);
    expect(indexGateBlocks([b, a])?.get(key)).toBe(b);
    const zMixed = block({ at: "2026-09-19T12:00:09Z", block_reason_code: "newest" });
    expect(indexGateBlocks([a, b, zMixed])?.get(key)).toBe(zMixed);
  });

  it("treats a null read as empty rather than throwing", () => {
    expect(indexGateBlocks(null).size).toBe(0);
  });
});

describe("unattachedGateBlocks", () => {
  const listed = block({ repo: "qontinui/qontinui-web", pr_number: 10 });
  const unlisted = block({ repo: "qontinui/qontinui-web", pr_number: 99 });
  const present = new Set([gateBlockKey("qontinui/qontinui-web", 10)]);

  it("returns only the decisions with no PR on the page", () => {
    expect(unattachedGateBlocks([listed, unlisted], present)).toEqual([
      unlisted,
    ]);
  });

  it("is empty when every decision found its row", () => {
    // The ordinary healthy case, and the one the disclosure's copy describes:
    // everything coord returned is shown inside a row.
    expect(unattachedGateBlocks([listed], present)).toEqual([]);
  });

  it("orders newest-first, because it is an audit log", () => {
    const older = block({ pr_number: 1, at: "2026-09-01T00:00:00.000Z" });
    const newer = block({ pr_number: 2, at: "2026-09-19T00:00:00.000Z" });
    expect(unattachedGateBlocks([older, newer], new Set())).toEqual([
      newer,
      older,
    ]);
  });
});

describe("gateProvenanceTitle", () => {
  it("claims the count is decisions ONLY when coord split the two", () => {
    const t = gateProvenanceTitle(8, 1899);
    expect(t).toContain("decisions, not audit rows");
    // The raw volume is named, not dropped — it is the write amplification the
    // decision count correctly excludes.
    expect(t).toContain("1899");
  });

  it("omits the eval clause when it would add nothing", () => {
    expect(gateProvenanceTitle(8, 8)).not.toContain("raw evaluation");
  });

  it("admits UNKNOWN provenance against a pre-Phase-2 coord", () => {
    // The degraded arm: `total_blocks` there is a raw `pr_events` COUNT(*),
    // measured 2026-08-20 at 1899 rows for 8 held PRs. Calling that "8
    // decisions" would be an asserted falsehood.
    const t = gateProvenanceTitle(1899, null);
    expect(t).toContain("has not reported");
    expect(t).not.toContain("decisions, not audit rows");
  });
});
