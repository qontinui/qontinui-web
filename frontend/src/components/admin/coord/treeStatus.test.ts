import { describe, it, expect } from "vitest";

import { paletteDisagreements } from "@/components/console/attention";
import {
  deriveTreeStatus,
  deriveTreesHealth,
  pullSafetyClass,
  staleBand,
  verdictTestId,
  TREE_ATTENTION_BY_KIND,
  TREE_BADGE_CLASS,
  TREE_STATUS_PALETTE,
  type PullSafetyClass,
  type TreeStatusKind,
} from "./treeStatus";

/**
 * Anti-drift guard for the client-side pull-safety ladder.
 *
 * `pullSafetyClass` MUST mirror the Rust source of truth
 * `policies::decide::pull_safety_verdict`
 * (`qontinui-coord/src/policies/decide.rs:800`) exactly. This matrix is the same
 * 6-case ladder the Rust verdict tests assert, plus the precedence cases that
 * make the case order load-bearing. If this test fails, the two ladders have
 * drifted and one must be reconciled with the other.
 */
describe("pullSafetyClass — mirror of decide.rs:800 pull_safety_verdict", () => {
  // Case 1: behind_count <= 0 → up_to_date.
  it("up_to_date when behind_count <= 0", () => {
    expect(
      pullSafetyClass({
        behind_count: 0,
        head_detached: false,
        branch: "main",
        dirty: false,
        local_ahead: 0,
      })
    ).toEqual<PullSafetyClass>({ kind: "up_to_date" });
  });

  it("up_to_date even on a feature branch / dirty / ahead when not behind", () => {
    // Case 1 short-circuits before any of the unsafe checks.
    expect(
      pullSafetyClass({
        behind_count: 0,
        head_detached: true,
        branch: "feature/x",
        dirty: true,
        local_ahead: 5,
      })
    ).toEqual<PullSafetyClass>({ kind: "up_to_date" });
  });

  it("treats missing behind_count as 0 → up_to_date", () => {
    expect(pullSafetyClass({})).toEqual<PullSafetyClass>({
      kind: "up_to_date",
    });
  });

  // Case 2: head_detached → hold/detached.
  it("hold:detached when behind and head_detached", () => {
    expect(
      pullSafetyClass({
        behind_count: 3,
        head_detached: true,
        branch: "main",
        dirty: false,
        local_ahead: 0,
      })
    ).toEqual<PullSafetyClass>({ kind: "hold", reason: "detached" });
  });

  // Case 3: feature branch → default_ref_sync.
  it("default_ref_sync on a feature branch", () => {
    expect(
      pullSafetyClass({
        behind_count: 2,
        head_detached: false,
        branch: "feature/x",
        dirty: false,
        local_ahead: 0,
      })
    ).toEqual<PullSafetyClass>({ kind: "default_ref_sync" });
  });

  it("default_ref_sync (conservative) when branch missing/empty and behind", () => {
    expect(
      pullSafetyClass({
        behind_count: 2,
        head_detached: false,
        branch: null,
        dirty: false,
        local_ahead: 0,
      })
    ).toEqual<PullSafetyClass>({ kind: "default_ref_sync" });
    expect(
      pullSafetyClass({
        behind_count: 2,
        head_detached: false,
        branch: "",
        dirty: false,
        local_ahead: 0,
      })
    ).toEqual<PullSafetyClass>({ kind: "default_ref_sync" });
  });

  it("master is treated as a default branch (not feature)", () => {
    expect(
      pullSafetyClass({
        behind_count: 1,
        head_detached: false,
        branch: "master",
        dirty: false,
        local_ahead: 0,
      })
    ).toEqual<PullSafetyClass>({ kind: "pull" });
  });

  // Case 4: default + dirty → hold/wip_on_default.
  it("hold:wip_on_default when behind, on default, and dirty", () => {
    expect(
      pullSafetyClass({
        behind_count: 4,
        head_detached: false,
        branch: "main",
        dirty: true,
        local_ahead: 0,
      })
    ).toEqual<PullSafetyClass>({ kind: "hold", reason: "wip_on_default" });
  });

  // Case 5: default + clean + local_ahead > 0 → diverged.
  it("diverged when behind, on clean default, with local_ahead > 0", () => {
    expect(
      pullSafetyClass({
        behind_count: 4,
        head_detached: false,
        branch: "main",
        dirty: false,
        local_ahead: 2,
      })
    ).toEqual<PullSafetyClass>({ kind: "diverged" });
  });

  // Case 6: default + clean + not ahead → pull.
  it("pull when behind, on clean default, not ahead", () => {
    expect(
      pullSafetyClass({
        behind_count: 1,
        head_detached: false,
        branch: "main",
        dirty: false,
        local_ahead: 0,
      })
    ).toEqual<PullSafetyClass>({ kind: "pull" });
  });

  // Precedence: detached (case 2) outranks feature-branch (case 3).
  it("detached outranks feature-branch", () => {
    expect(
      pullSafetyClass({
        behind_count: 3,
        head_detached: true,
        branch: "feature/x",
        dirty: false,
        local_ahead: 0,
      })
    ).toEqual<PullSafetyClass>({ kind: "hold", reason: "detached" });
  });

  // Precedence: detached also outranks dirty.
  it("detached outranks dirty", () => {
    expect(
      pullSafetyClass({
        behind_count: 3,
        head_detached: true,
        branch: "main",
        dirty: true,
        local_ahead: 5,
      })
    ).toEqual<PullSafetyClass>({ kind: "hold", reason: "detached" });
  });

  // Precedence: dirty-on-default (case 4) outranks diverged (case 5).
  it("dirty default outranks diverged (hold wins over diverged)", () => {
    expect(
      pullSafetyClass({
        behind_count: 3,
        head_detached: false,
        branch: "main",
        dirty: true,
        local_ahead: 4,
      })
    ).toEqual<PullSafetyClass>({ kind: "hold", reason: "wip_on_default" });
  });
});

/**
 * The console contract, added by Phase 3 Wave 1 alongside the migration of
 * `/trees` onto `components/console`.
 */
describe("trees palette agrees with TREE_ATTENTION_BY_KIND (R3)", () => {
  it("is red iff coord has stopped for a human, calm otherwise", () => {
    expect(
      paletteDisagreements(TREE_ATTENTION_BY_KIND, TREE_STATUS_PALETTE)
    ).toEqual([]);
  });

  it("has an attention for every verdict kind (the table is TOTAL)", () => {
    for (const kind of Object.keys(TREE_BADGE_CLASS) as TreeStatusKind[]) {
      expect(TREE_ATTENTION_BY_KIND[kind]).toBeTruthy();
    }
  });

  it("keeps the verdict testid the derived spec asserts", () => {
    expect(verdictTestId("pull")).toBe("coord-tree-verdict-pull");
    expect(verdictTestId("up_to_date")).toBe("coord-tree-verdict-up_to_date");
    expect(verdictTestId("hold")).toBe("coord-tree-verdict-hold");
    expect(verdictTestId("diverged")).toBe("coord-tree-verdict-diverged");
    expect(verdictTestId("default_ref_sync")).toBe(
      "coord-tree-verdict-default_ref_sync"
    );
  });
});

describe("staleBand", () => {
  const hoursBack = (h: number) =>
    new Date(Date.now() - h * 3_600_000).toISOString();

  it("is none for a CLEAN tree however long since it was seen", () => {
    // An idle clean checkout is not at risk; only uncommitted work is.
    expect(
      staleBand({
        repo: "r",
        primary_path: "p",
        dirty: false,
        last_seen: hoursBack(1000),
      })
    ).toBe("none");
  });

  it("prefers wip_last_modified over last_seen when coord recorded one", () => {
    expect(
      staleBand({
        repo: "r",
        primary_path: "p",
        dirty: true,
        wip_last_modified: hoursBack(1),
        last_seen: hoursBack(1000),
      })
    ).toBe("none");
  });

  it("bands at 24h and 72h", () => {
    const at = (h: number) =>
      staleBand({
        repo: "r",
        primary_path: "p",
        dirty: true,
        wip_last_modified: hoursBack(h),
      });
    expect(at(23)).toBe("none");
    expect(at(25)).toBe("warning");
    expect(at(73)).toBe("critical");
  });

  it("is none when there is no timestamp at all — unknown, not stale", () => {
    expect(staleBand({ repo: "r", primary_path: "p", dirty: true })).toBe(
      "none"
    );
  });
});

describe("deriveTreeStatus escalation", () => {
  const hoursBack = (h: number) =>
    new Date(Date.now() - h * 3_600_000).toISOString();

  it("escalates a calm verdict when the WIP clock has run out", () => {
    // up_to_date is `none` by verdict, but 72h of untouched WIP needs a human.
    const s = deriveTreeStatus({
      repo: "r",
      primary_path: "p",
      behind_count: 0,
      dirty: true,
      wip_last_modified: hoursBack(100),
    });
    expect(s.kind).toBe("up_to_date");
    expect(s.attention).toBe("author");
  });

  it("never DE-escalates a held verdict on a fresh clock", () => {
    const s = deriveTreeStatus({
      repo: "r",
      primary_path: "p",
      behind_count: 3,
      branch: "main",
      dirty: true,
      wip_last_modified: hoursBack(1),
    });
    expect(s.kind).toBe("hold");
    expect(s.attention).toBe("author");
  });

  it("leaves a clean pullable tree calm", () => {
    const s = deriveTreeStatus({
      repo: "r",
      primary_path: "p",
      behind_count: 3,
      branch: "main",
      dirty: false,
      local_ahead: 0,
    });
    expect(s.kind).toBe("pull");
    expect(s.attention).toBe("none");
  });
});

describe("deriveTreesHealth", () => {
  it("reports UNKNOWN-free counts derived from the rows on the page", () => {
    const h = deriveTreesHealth([
      { repo: "a", primary_path: "pa", behind_count: 0, dirty: false },
      {
        repo: "b",
        primary_path: "pb",
        behind_count: 2,
        branch: "main",
        local_ahead: 2,
      },
    ]);
    expect(h.held).toBe(1);
    expect(h.dirty).toBe(0);
    expect(h.level).toBe("red");
  });

  it("is green with no trees held and none dirty", () => {
    expect(
      deriveTreesHealth([
        { repo: "a", primary_path: "pa", behind_count: 0, dirty: false },
      ]).level
    ).toBe("green");
  });
});
