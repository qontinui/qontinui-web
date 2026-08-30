/**
 * The `/plans` health strip's derivation — R1 (derived from the rows already
 * on the page) and the absence-is-not-zero rule that goes with it.
 *
 * Added by plan `2026-08-16-coord-console-ui-unification-pipeline-style.md`
 * Phase 3 Wave 1.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthStrip } from "@/components/console";
import { derivePlansHealth } from "./plansHealth";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";

const rows: CoordPlanRow[] = [
  { slug: "a", status: "shipped" },
  { slug: "b", status: "in_progress" },
  { slug: "c", status: "blocked" },
  { slug: "d", status: "weird_new_state" },
];

function renderBadges(loaded: boolean, plans: CoordPlanRow[] = rows) {
  const h = derivePlansHealth(plans, loaded);
  render(
    <HealthStrip
      level={h.level}
      headline={h.headline}
      detail={h.detail}
      badges={h.badges}
      data-testid="strip"
    />
  );
  return h;
}

describe("derivePlansHealth", () => {
  it("renders every count as `–` before coord has answered — never `0`", () => {
    const h = renderBadges(false, []);
    expect(h.headline).toMatch(/Waiting for coord/);
    // The load-bearing clause: an unloaded page must not claim "0 blocked".
    const strip = screen.getByTestId("strip");
    expect(strip).toHaveTextContent("plans –");
    expect(strip).toHaveTextContent("blocked –");
    expect(strip).not.toHaveTextContent("blocked 0");
  });

  it("goes red on a blocked plan, because nothing downstream clears one", () => {
    const h = derivePlansHealth(rows, true);
    expect(h.level).toBe("red");
    expect(h.headline).toBe("1 plan blocked on a human");
  });

  it("goes amber — not green — when a status has no label in this build", () => {
    const h = derivePlansHealth(
      [{ slug: "d", status: "weird_new_state" }],
      true
    );
    expect(h.level).toBe("amber");
    expect(h.detail).toMatch(/no label for/);
  });

  it("is green on a loaded, unblocked, fully-recognised window", () => {
    const h = derivePlansHealth(
      [
        { slug: "a", status: "shipped" },
        { slug: "b", status: "in_progress" },
      ],
      true
    );
    expect(h.level).toBe("green");
    expect(h.headline).toBe("No plan is blocked");
  });

  it("says the window is empty rather than that nothing is blocked", () => {
    expect(derivePlansHealth([], true).headline).toBe(
      "No work units in this window"
    );
  });

  describe("a failed read (R6 — 'not fetched' includes 'fetched and FAILED')", () => {
    it("is UNKNOWN, not 'waiting', when it left nothing behind", () => {
      const h = derivePlansHealth([], false, true);
      // A first load that errors leaves `loaded` false as well, so the failure
      // arm has to be checked first or the page promises an arrival that is
      // never coming.
      expect(h.headline).toMatch(/unknown, not empty/);
      expect(h.headline).not.toMatch(/Waiting for coord/);
      render(
        <HealthStrip
          level={h.level}
          headline={h.headline}
          detail={h.detail}
          badges={h.badges}
          data-testid="failed-strip"
        />
      );
      const strip = screen.getByTestId("failed-strip");
      expect(strip).toHaveTextContent("plans –");
      expect(strip).toHaveTextContent("blocked –");
      expect(strip).not.toHaveTextContent("blocked 0");
    });

    it("does NOT flip a coord-confirmed empty window to unknown", () => {
      // `/plans?status=blocked` with nothing blocked is a real, fetched zero.
      // Keying UNKNOWN on `plans.length === 0` would flap it to amber
      // "unknown, not empty" on every blipped poll and back on the next.
      const h = derivePlansHealth([], true, true);
      expect(h.headline).not.toMatch(/unknown/i);
      // The COUNTS survive — that zero was really fetched — and the badges
      // below still render it rather than a dash. What does not survive is the
      // present-tense headline: "No work units in this window" is a claim
      // about now, off a read that is currently failing.
      expect(h.badges.map((b) => b.key)).toContain("total");
      expect(h.headline).toBe("Last refresh failed — these counts are not current");
      expect(h.detail).toMatch(/^Last refresh failed/);
    });

    it("does not leave 'No plan is blocked' unqualified over a stale list", () => {
      const h = derivePlansHealth(
        [{ slug: "a", status: "shipped" }],
        true,
        true
      );
      // A stale verdict is not a green verdict. The all-clear is the sentence
      // that tells an operator to stop looking, and it may only be painted off
      // a read that both landed AND is current — so `readFailed` reaches the
      // level and the headline, not just the detail line. Qualifying it in one
      // line of small print under a pulsing green dot is not qualifying it.
      expect(h.headline).not.toBe("No plan is blocked");
      expect(h.level).toBe("amber");
      expect(h.detail).toMatch(/^Last refresh failed — these counts are stale\./);
    });

    it("keeps the all-clear green while the read is current", () => {
      // The other half of the pin: the stale arm must not swallow the real
      // green state, or the fix would be indistinguishable from breaking it.
      const h = derivePlansHealth([{ slug: "a", status: "shipped" }], true, false);
      expect(h.level).toBe("green");
      expect(h.headline).toBe("No plan is blocked");
    });

    it("still outranks staleness with a blocked plan", () => {
      // Red is about a row, not about the window's age: a blocked plan stays
      // red whether or not the last refresh landed.
      const h = derivePlansHealth([{ slug: "a", status: "blocked" }], true, true);
      expect(h.level).toBe("red");
      expect(h.headline).toMatch(/1 plan blocked on a human/);
    });

    it("keeps a retained blocked plan red rather than dashing it", () => {
      // Stale is not unknown — the row is real and still actionable.
      const h = derivePlansHealth(
        [{ slug: "c", status: "blocked" }],
        true,
        true
      );
      expect(h.level).toBe("red");
      expect(h.headline).toBe("1 plan blocked on a human");
    });
  });
});
