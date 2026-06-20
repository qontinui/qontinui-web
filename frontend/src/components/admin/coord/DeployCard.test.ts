import { describe, it, expect } from "vitest";

import {
  MANAGED_HEAD_FORK_SUBCLASS,
  isManagedPredictedHeadFork,
  verdictChipVariant,
  verdictChipLabel,
} from "./DeployCard";
import type { BadgeVariant, DimensionVerdict } from "./LandCard";

/**
 * Anti-drift guard for the schema/migration predicted-head-fork verdict
 * rendering on /admin/coord/deploys (Layer 2). Contract:
 *
 *   drift_subclass = "schema:predicted_head_fork_managed"
 *       → AMBER (warning) badge, label "auto-managed"
 *         (coord auto-resolves it — neither red failure nor green pass)
 *
 *   drift_subclass = "schema:predicted_head_fork" (unmanaged)
 *       → unchanged: colored by its `outcome` (red Contradiction/Failure)
 *
 * If this matrix drifts, a fork coord is auto-resolving would re-appear as a
 * scary red Contradiction (false alarm) or a managed fork would lose its amber.
 */

const verdict = (over: Partial<DimensionVerdict>): DimensionVerdict => ({
  dimension: "schema",
  ...over,
});

describe("isManagedPredictedHeadFork", () => {
  it("true only for the managed subclass", () => {
    expect(
      isManagedPredictedHeadFork(
        verdict({ drift_subclass: MANAGED_HEAD_FORK_SUBCLASS })
      )
    ).toBe(true);
  });
  it("false for the unmanaged (conflicting) fork subclass", () => {
    expect(
      isManagedPredictedHeadFork(
        verdict({ drift_subclass: "schema:predicted_head_fork" })
      )
    ).toBe(false);
  });
  it("false when no subclass / null / undefined verdict", () => {
    expect(isManagedPredictedHeadFork(verdict({}))).toBe(false);
    expect(isManagedPredictedHeadFork(null)).toBe(false);
    expect(isManagedPredictedHeadFork(undefined)).toBe(false);
  });
});

describe("verdictChipVariant — managed fork forced amber", () => {
  it("managed fork → warning (amber) even when outcome is Failure", () => {
    expect(
      verdictChipVariant(
        verdict({
          drift_subclass: MANAGED_HEAD_FORK_SUBCLASS,
          outcome: "Failure",
        })
      )
    ).toBe<BadgeVariant>("warning");
  });
  it("managed fork → warning even when outcome is contradiction", () => {
    expect(
      verdictChipVariant(
        verdict({
          drift_subclass: MANAGED_HEAD_FORK_SUBCLASS,
          outcome: "contradiction",
        })
      )
    ).toBe<BadgeVariant>("warning");
  });
  it("unmanaged predicted_head_fork stays red (destructive) via outcome", () => {
    expect(
      verdictChipVariant(
        verdict({
          drift_subclass: "schema:predicted_head_fork",
          outcome: "contradiction",
        })
      )
    ).toBe<BadgeVariant>("destructive");
  });
  it("ordinary verdicts fall through to the outcome color ladder", () => {
    expect(verdictChipVariant(verdict({ outcome: "confirmed" }))).toBe<BadgeVariant>(
      "success"
    );
    expect(verdictChipVariant(verdict({ outcome: "failure" }))).toBe<BadgeVariant>(
      "destructive"
    );
    expect(verdictChipVariant(verdict({ outcome: null }))).toBe<BadgeVariant>(
      "outline"
    );
  });
});

describe("verdictChipLabel — friendly managed-fork label", () => {
  it("managed fork reads 'auto-managed' (not its raw outcome)", () => {
    expect(
      verdictChipLabel(
        verdict({
          drift_subclass: MANAGED_HEAD_FORK_SUBCLASS,
          outcome: "Failure",
        })
      )
    ).toBe("auto-managed");
  });
  it("unmanaged fork shows its raw outcome unchanged", () => {
    expect(
      verdictChipLabel(
        verdict({
          drift_subclass: "schema:predicted_head_fork",
          outcome: "contradiction",
        })
      )
    ).toBe("contradiction");
  });
  it("ordinary verdict shows its outcome; missing → em dash", () => {
    expect(verdictChipLabel(verdict({ outcome: "confirmed" }))).toBe("confirmed");
    expect(verdictChipLabel(verdict({ outcome: null }))).toBe("—");
  });
});
