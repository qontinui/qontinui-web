/**
 * The dev-ops captions' claims, pinned against what coord's code does (plan
 * `2026-10-23-console-presentation-spaces` Phase 7).
 *
 * A caption is a claim about the product made to the reader who is judging it
 * (style guide §6.5, `audience_profile/external-evaluator`: "Is it
 * controlled?"). Four sentences once claimed more than coord does — a shared
 * placement verdict, a complete audit trail, an isolated copy for every agent,
 * a share of problems agents fix. Each test below pins the load-bearing claim
 * the corrected sentence makes and forbids the claim it replaced, so an edit
 * that brings one back fails here. The code each claim rests on is cited
 * beside the caption in `devOpsCaptions.ts`.
 */

import { describe, expect, it } from "vitest";
import { captionSegments, type CaptionText } from "./captionTypes";
import { DEV_OPS_CAPTIONS } from "./devOpsCaptions";

type DevOpsKey = keyof typeof DEV_OPS_CAPTIONS;

function plain(text: CaptionText): string {
  return captionSegments(text)
    .map((s) => (typeof s === "string" ? s : (s.text ?? s.term)))
    .join("");
}

/** What the reader is told: the one-liner and why it matters. */
function copyOf(key: DevOpsKey): string {
  const entry = DEV_OPS_CAPTIONS[key];
  return `${plain(entry.oneLiner)} ${plain(entry.whyItMatters)}`;
}

describe("dev-ops.resources — the measurement is shared, the verdict is not", () => {
  it("claims one load formula and coord's preference for the least-loaded machine", () => {
    const text = copyOf("dev-ops.resources");
    expect(text).toMatch(/measure load with one formula/);
    expect(text).toMatch(/prefers the least-loaded machine/);
  });

  it("never claims the dashboard's grade is what places work, or that the two cannot disagree", () => {
    // Coord ranks by the measurement and "only prefers"; its admission gates
    // refuse in a band the grade calls a warning, by design.
    const text = copyOf("dev-ops.resources");
    expect(text).not.toMatch(/cannot disagree/i);
    expect(text).not.toMatch(/same (one|verdict)/i);
    expect(text).not.toMatch(/decide[sd]? where new work goes/i);
    expect(text).not.toMatch(/whether it will accept/i);
  });
});

describe("dev-ops.audit — no completeness the best-effort writer does not give", () => {
  it("promises no 'every', 'nothing … without a trace' or 'all'", () => {
    const text = copyOf("dev-ops.audit");
    expect(text).not.toMatch(/\bevery\b/i);
    expect(text).not.toMatch(/without a trace/i);
    expect(text).not.toMatch(/\ball\b/i);
    expect(text).not.toMatch(/\bnothing\b/i);
  });

  it("says a row that lacks its author or reach says so", () => {
    expect(copyOf("dev-ops.audit")).toMatch(
      /author or reach was not recorded says so/
    );
  });
});

describe("dev-ops.worktree-slots — isolation is the usual case, and the cap is a count", () => {
  it("says agents USUALLY get their own copy, and that the limit caps copies", () => {
    const text = copyOf("dev-ops.worktree-slots");
    expect(text).toMatch(/\busually\b/);
    expect(text).toMatch(/caps how many such copies one machine holds/);
  });

  it("never claims every agent is isolated, or that the cap prevents overload", () => {
    const text = copyOf("dev-ops.worktree-slots");
    expect(text).not.toMatch(/\bevery agent\b/i);
    expect(text).not.toMatch(/overload/i);
  });
});

describe("dev-ops.conditions — what the panel counts, not how much agents fix", () => {
  it("names what is counted separately from everything else still open", () => {
    expect(copyOf("dev-ops.conditions")).toMatch(
      /separately from everything else still open/
    );
  });

  it("claims no unmeasured share of problems agents fix, and no 'only what is left over'", () => {
    const text = copyOf("dev-ops.conditions");
    expect(text).not.toMatch(/\bmost\b/i);
    expect(text).not.toMatch(/left over/i);
  });
});
