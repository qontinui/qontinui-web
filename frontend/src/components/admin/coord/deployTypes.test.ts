import { describe, it, expect } from "vitest";

import {
  MANAGED_HEAD_FORK_SUBCLASS,
  isManagedPredictedHeadFork,
  verdictChipLabel,
} from "./deployTypes";
import type { DimensionVerdict } from "./landTypes";

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

/*
 * The `verdictChipVariant` describe block that stood here was DELETED in Phase
 * 3 Wave 2 with the function it covered. `<DeployRow>` renders per-dimension
 * verdicts through `<VerdictChips>`, which encodes the outcome as a
 * colourblind-safe GLYPH rather than a `BadgeVariant`, so nothing called it —
 * and the block described the managed head-fork as "forced amber", which is no
 * longer what the surface does (it renders the calm `~`). The managed-fork
 * contract itself is still pinned, by the `isManagedPredictedHeadFork` and
 * `verdictChipLabel` blocks either side of this note.
 */

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
