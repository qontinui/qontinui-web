import { describe, it, expect } from "vitest";

import { pullSafetyClass, type PullSafetyClass } from "./TreeCard";

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
