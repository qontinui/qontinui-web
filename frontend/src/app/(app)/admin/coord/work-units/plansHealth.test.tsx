/**
 * The `/admin/coord/work-units` + `/admin/coord/spawn` health strip's
 * derivation — R1 (derived from the rows already on the page) and the
 * absence-is-not-zero rule that goes with it.
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

function renderBadges(
  loaded: boolean,
  plans: CoordPlanRow[] = rows,
  readFailed = false
) {
  const h = derivePlansHealth(plans, loaded, readFailed);
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
    // The verdict, not the measurement: the count lives in the `blocked N`
    // badge, the one place a number sits in EVERY arm of this strip.
    expect(h.headline).toBe("A plan is blocked on a human");
  });

  it("pluralises the blocked verdict without restating the count", () => {
    const h = derivePlansHealth(
      [
        { slug: "c", status: "blocked" },
        { slug: "e", status: "blocked" },
      ],
      true
    );
    expect(h.headline).toBe("Plans are blocked on a human");
  });

  it("goes amber — not green — when a status has no label in this build", () => {
    const h = derivePlansHealth(
      [{ slug: "d", status: "weird_new_state" }],
      true
    );
    expect(h.level).toBe("amber");
    // The explanation survives de-duplication; the number moves to the
    // `unlabelled N` badge.
    expect(h.detail).toBe(
      "A status this build has no label for is shown verbatim."
    );
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
      const h = renderBadges(true, [], true);
      expect(h.headline).not.toMatch(/unknown/i);
      // The COUNTS survive — that zero was really fetched — so this asserts
      // the RENDERED value, not merely that a `total` badge exists. Every
      // non-unknown return carries that key, dashed ones included, so a
      // key-only check would pass on exactly the rendering it means to reject.
      const strip = screen.getByTestId("strip");
      expect(strip).toHaveTextContent("plans 0");
      expect(strip).not.toHaveTextContent("plans –");
      // What does NOT survive is the present-tense headline: "No work units in
      // this window" is a claim about now, off a read that is failing now.
      expect(h.headline).toBe(
        "Last refresh failed — these counts are not current"
      );
      // The headline IS the failure sentence here, so the detail line does not
      // say it a second time — and has nothing else left to say.
      expect(h.detail).toBeUndefined();
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
      expect(h.headline).toBe(
        "Last refresh failed — these counts are not current"
      );
      expect(h.level).toBe("amber");
      expect(h.detail).toBeUndefined();
    });

    it("keeps the all-clear green while the read is current", () => {
      // The other half of the pin: the stale arm must not swallow the real
      // green state, or the fix would be indistinguishable from breaking it.
      const h = derivePlansHealth(
        [{ slug: "a", status: "shipped" }],
        true,
        false
      );
      expect(h.level).toBe("green");
      expect(h.headline).toBe("No plan is blocked");
    });

    it("still outranks staleness with a blocked plan", () => {
      // Red is about a row, not about the window's age: a blocked plan stays
      // red whether or not the last refresh landed.
      const h = derivePlansHealth(
        [{ slug: "a", status: "blocked" }],
        true,
        true
      );
      expect(h.level).toBe("red");
      expect(h.headline).toBe("A plan is blocked on a human");
      // The blocked headline says nothing about the read, so the staleness
      // qualifier has to be in the detail line — the one arm where deleting
      // that line would render the counts unqualified.
      expect(h.detail).toBe("Last refresh failed — these counts are stale.");
    });

    it("keeps a retained blocked plan red rather than dashing it", () => {
      // Stale is not unknown — the row is real and still actionable.
      const h = derivePlansHealth(
        [{ slug: "c", status: "blocked" }],
        true,
        true
      );
      expect(h.level).toBe("red");
      expect(h.headline).toBe("A plan is blocked on a human");
    });

    it("keeps the unlabelled explanation under a failure headline, without its count", () => {
      const h = derivePlansHealth(
        [{ slug: "d", status: "weird_new_state" }],
        true,
        true
      );
      expect(h.headline).toBe(
        "Last refresh failed — these counts are not current"
      );
      expect(h.detail).toBe(
        "A status this build has no label for is shown verbatim."
      );
    });

    it("qualifies the unlabelled explanation as stale under a blocked headline", () => {
      const h = derivePlansHealth(
        [
          { slug: "c", status: "blocked" },
          { slug: "d", status: "weird_new_state" },
        ],
        true,
        true
      );
      expect(h.detail).toBe(
        "Last refresh failed — these counts are stale. A status this build has no label for is shown verbatim."
      );
    });
  });

  /**
   * F5 of the review of plan
   * `2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost`:
   * after a partial walk (or a full single page) the strip derived its numbers
   * from the rows fetched SO FAR while only the fetch-window badge said
   * INCOMPLETE — so a partial read rendered as a whole-corpus verdict, in
   * bigger type and with a green dot.
   */
  describe("an incomplete list is not a whole-corpus verdict", () => {
    const clean: CoordPlanRow[] = [
      { slug: "a", status: "shipped" },
      { slug: "b", status: "in_progress" },
    ];

    it("scopes the all-clear to the rows that were read, and is not green", () => {
      const h = derivePlansHealth(clean, true, false, { incomplete: true });
      expect(h.headline).toBe(
        "No plan is blocked in the part of the list that was read"
      );
      expect(h.level).toBe("amber");
      // The headline is doing the scoping here, so the detail line does not
      // say it a second time — the same de-duplication the stale arm uses.
      expect(h.detail).toBeUndefined();
    });

    it("carries the caveat in the badge cluster, which is always on screen", () => {
      renderBadges(true, clean, false);
      expect(screen.getByTestId("strip")).not.toHaveTextContent("INCOMPLETE");
      const h = derivePlansHealth(clean, true, false, { incomplete: true });
      render(
        <HealthStrip
          level={h.level}
          headline={h.headline}
          detail={h.detail}
          badges={h.badges}
          data-testid="incomplete-strip"
        />
      );
      const strip = screen.getByTestId("incomplete-strip");
      expect(strip).toHaveTextContent("list INCOMPLETE");
      // The counts still render — those rows were really fetched.
      expect(strip).toHaveTextContent("plans 2");
    });

    it("says it in the detail line when the headline is owned by something else", () => {
      const blockedTooDetail = derivePlansHealth(
        [{ slug: "c", status: "blocked" }],
        true,
        false,
        { incomplete: true }
      );
      expect(blockedTooDetail.headline).toBe("A plan is blocked on a human");
      expect(blockedTooDetail.level).toBe("red");
      expect(blockedTooDetail.detail).toBe(
        "These counts cover an incomplete list, not the whole corpus."
      );

      const stale = derivePlansHealth(clean, true, true, { incomplete: true });
      expect(stale.headline).toBe(
        "Last refresh failed — these counts are not current"
      );
      expect(stale.detail).toBe(
        "These counts cover an incomplete list, not the whole corpus."
      );

      const both = derivePlansHealth(
        [
          { slug: "c", status: "blocked" },
          { slug: "d", status: "weird_new_state" },
        ],
        true,
        true,
        { incomplete: true }
      );
      expect(both.detail).toBe(
        "Last refresh failed — these counts are stale. These counts cover an incomplete list, not the whole corpus. A status this build has no label for is shown verbatim."
      );
    });

    it("changes nothing for a caller that read one whole window", () => {
      // Both shipped callers pass the flag now (`/spawn` too — it reads one
      // bounded page and derives it from a full page). The default is kept for
      // a caller that really does hold the whole list, and it must be inert.
      const defaulted = derivePlansHealth(clean, true, false);
      const explicit = derivePlansHealth(clean, true, false, {
        incomplete: false,
      });
      expect(defaulted.level).toBe("green");
      expect(defaulted.level).toBe(explicit.level);
      expect(defaulted.headline).toBe(explicit.headline);
      expect(defaulted.detail).toBe(explicit.detail);
      expect(defaulted.badges.map((b) => b.key)).toEqual(
        explicit.badges.map((b) => b.key)
      );
      expect(defaulted.badges.some((b) => b.key === "incomplete")).toBe(false);
    });
  });

  /**
   * F2 of plan `2026-09-09-coord-plans-page-controls-do-not-acknowledge-or-name-themselves`:
   * the strip used to say four numbers twice — once in the detail line or the
   * headline, and once in the badge beside it. Each count is now rendered ONCE,
   * in the badge cluster. Asserted on the RENDERED strip, the text an operator
   * reads, in every arm that carries counts, with counts chosen to be distinct
   * so a stray duplicate cannot hide behind a coincidence.
   */
  describe("each count is rendered exactly once", () => {
    const unblocked: CoordPlanRow[] = [
      { slug: "s1", status: "shipped" },
      { slug: "s2", status: "shipped" },
      { slug: "s3", status: "shipped" },
      { slug: "p1", status: "in_progress" },
      { slug: "p2", status: "in_progress" },
    ];
    const recognised: CoordPlanRow[] = [
      ...unblocked,
      { slug: "b1", status: "blocked" },
    ];
    const withUnlabelled: CoordPlanRow[] = [
      ...recognised,
      { slug: "u1", status: "weird_new_state" },
      { slug: "u2", status: "weird_new_state" },
      { slug: "u3", status: "weird_new_state" },
      { slug: "u4", status: "weird_new_state" },
    ];

    const occurrences = (text: string, needle: RegExp) =>
      (text.match(needle) ?? []).length;

    // Every headline arm that carries counts: blocked (red), the all-clear,
    // and the read-failed sentence.
    it.each([
      ["current, blocked", recognised, false, 1, false],
      ["stale, blocked", recognised, true, 1, false],
      ["current, unblocked", unblocked, false, 0, false],
      ["stale, unblocked", unblocked, true, 0, false],
      ["current, with unlabelled rows", withUnlabelled, false, 1, true],
      ["stale, with unlabelled rows", withUnlabelled, true, 1, true],
    ] as const)("%s", (_name, plans, readFailed, blocked, hasUnlabelled) => {
      const h = renderBadges(true, [...plans], readFailed);
      const text = screen.getByTestId("strip").textContent ?? "";

      // No number outside the badge cluster.
      expect(h.headline).not.toMatch(/\d/);
      expect(h.detail ?? "").not.toMatch(/\d/);

      // Each badge's number, once, in the whole strip. Badges concatenate in
      // `textContent` with no separator ("in progress 2shipped 3"), so a digit
      // is matched by lookaround, not a word boundary.
      const digit = (n: number) => new RegExp(`(?<!\\d)${n}(?!\\d)`, "g");
      expect(text).toContain(`plans ${plans.length}`);
      expect(text).toContain(`blocked ${blocked}`);
      expect(text).toContain("in progress 2");
      expect(occurrences(text, /in progress/g)).toBe(1);
      expect(text).toContain("shipped 3");
      expect(occurrences(text, /shipped/g)).toBe(1);
      expect(occurrences(text, digit(2))).toBe(1);
      expect(occurrences(text, digit(3))).toBe(1);
      if (hasUnlabelled) {
        expect(text).toContain("unlabelled 4");
        expect(occurrences(text, digit(4))).toBe(1);
      }
    });
  });
});

/**
 * The caller states what one row IS. Phase 3 of plan
 * `2026-09-20-the-operator-plans-page-reads-the-wrong-store`: the two callers
 * no longer share a population, so a badge reading `plans N` over coord's
 * work units — 39% of which are its own merge escalations — is the mislabel
 * the move exists to fix, restated one level down.
 */
describe("derivePlansHealth noun", () => {
  const noun = { one: "work unit", many: "work units" };

  it("defaults to plan/plans, so /spawn's wording is unchanged", () => {
    const h = derivePlansHealth([{ slug: "c", status: "blocked" }], true);
    expect(h.headline).toBe("A plan is blocked on a human");
  });

  it("labels the badge with the caller's plural", () => {
    const h = derivePlansHealth(rows, true, false, { noun });
    render(
      <HealthStrip
        level={h.level}
        headline={h.headline}
        detail={h.detail}
        badges={h.badges}
        data-testid="noun-strip"
      />
    );
    const strip = screen.getByTestId("noun-strip");
    expect(strip).toHaveTextContent("work units 4");
    expect(strip).not.toHaveTextContent("plans 4");
  });

  it("dashes the caller's plural before coord has answered", () => {
    const h = derivePlansHealth([], false, false, { noun });
    render(
      <HealthStrip
        level={h.level}
        headline={h.headline}
        detail={h.detail}
        badges={h.badges}
        data-testid="noun-unfetched"
      />
    );
    const strip = screen.getByTestId("noun-unfetched");
    expect(strip).toHaveTextContent("work units –");
    expect(strip).not.toHaveTextContent("work units 0");
  });

  it("uses the caller's noun in both blocked headlines and the all-clear", () => {
    expect(
      derivePlansHealth([{ slug: "c", status: "blocked" }], true, false, {
        noun,
      }).headline
    ).toBe("A work unit is blocked on a human");
    expect(
      derivePlansHealth(
        [
          { slug: "c", status: "blocked" },
          { slug: "d", status: "blocked" },
        ],
        true,
        false,
        { noun }
      ).headline
    ).toBe("Work units are blocked on a human");
    expect(
      derivePlansHealth([{ slug: "a", status: "shipped" }], true, false, {
        noun,
      }).headline
    ).toBe("No work unit is blocked");
  });

  it("composes with `incomplete` — the scoped all-clear carries the caller's noun", () => {
    const h = derivePlansHealth(
      [{ slug: "a", status: "shipped" }],
      true,
      false,
      { noun, incomplete: true }
    );
    expect(h.headline).toBe(
      "No work unit is blocked in the part of the list that was read"
    );
    expect(h.level).toBe("amber");
    expect(h.badges.some((b) => b.key === "incomplete")).toBe(true);
  });
});
