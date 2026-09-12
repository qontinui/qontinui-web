/**
 * `VerdictChips` — the per-dimension verdict cluster, and the R3 clause that
 * governs the colours it mints.
 *
 * **This file exists to close a coverage loss that shipped knowingly.** Phase 3
 * Wave 2 (qontinui-web#1033) moved the per-dimension colour ladder out of
 * `landTypes.dimensionOutcomeVariant` and into `VerdictChips`'s
 * `outcomeGlyph` / `glyphClass`, and deleted that ladder's only oracle in the
 * same commit. Its own PR body named the result: *"`VerdictChips.tsx:37-55` is
 * the one real coverage loss … untested … recorded as a follow-up."* This is
 * that follow-up.
 *
 * Why the shared audit could not cover it: `paletteDisagreements`
 * (`console/attention.ts`) binds a surface's `badgeClass` table to its
 * `ATTENTION_BY_KIND` table, and this cluster has neither — it paints chips
 * directly rather than rendering `<StatusBadge>`. So R3's red ⇔ `✕` clause is
 * asserted here, over the exported glyph vocabulary, in the same shape the
 * audit asserts it everywhere else.
 *
 * See `frontend/docs/console-ui-style-guide.md` §2 R3 and §4.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import {
  glyphClass,
  outcomeGlyph,
  VerdictChips,
  VerdictDetail,
  VERDICT_GLYPHS,
} from "./VerdictChips";
import type { DimensionVerdict } from "./landTypes";

const verdict = (v: Partial<DimensionVerdict> = {}): DimensionVerdict => ({
  dimension: "git",
  outcome: "confirmed",
  ...v,
});

// ----------------------------------------------------------------------------
// outcomeGlyph — the outcome vocabulary, and its ignorance floor
// ----------------------------------------------------------------------------

describe("outcomeGlyph", () => {
  it.each([
    ["confirmed", "✓"],
    ["failure", "✕"],
    ["contradiction", "✕"],
    ["surprise", "!"],
    ["partial", "~"],
  ])("maps %s to %s", (outcome, glyph) => {
    expect(outcomeGlyph(outcome)).toBe(glyph);
  });

  it("reads coord's token case- and whitespace-insensitively", () => {
    // coord's `composed_outcome` is a serde enum today, but these rows are
    // rendered defensively everywhere else in the module (see `landTypes`),
    // and a `Confirmed` that silently fell to `?` would read as "unobserved"
    // on a dimension that passed.
    expect(outcomeGlyph("Confirmed")).toBe("✓");
    expect(outcomeGlyph("  FAILURE ")).toBe("✕");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a token from a newer coord", "quarantined"],
  ])("floors %s at `?`, never a blank and never a pass", (_label, outcome) => {
    // The whole point of the floor: a blank chip reads as a pass, and an
    // unobserved dimension is UNKNOWN. Same discipline as R6's `–`.
    const glyph = outcomeGlyph(outcome);
    expect(glyph).toBe("?");
    expect(glyph).not.toBe("");
    expect(glyph).not.toBe("✓");
  });

  it("only ever returns a glyph the class ladder knows", () => {
    const outcomes = [
      "confirmed",
      "failure",
      "contradiction",
      "surprise",
      "partial",
      "",
      "kind-from-the-future",
      null,
      undefined,
    ];
    for (const o of outcomes) {
      expect(VERDICT_GLYPHS).toContain(outcomeGlyph(o));
    }
  });
});

// ----------------------------------------------------------------------------
// glyphClass — R3 over the glyph vocabulary
// ----------------------------------------------------------------------------

describe("glyphClass (R3)", () => {
  it("paints `✕` red — and paints NOTHING else red", () => {
    // The clause `paletteDisagreements` enforces for every badge palette in
    // the console, asserted here because this cluster is outside that audit's
    // reach. Both directions, so a future glyph cannot join the red family
    // without joining `✕`.
    expect(glyphClass("✕")).toContain("text-red-300");
    for (const glyph of VERDICT_GLYPHS) {
      if (glyph === "✕") continue;
      expect(glyphClass(glyph)).not.toContain("red-");
    }
  });

  it("gives every glyph in the vocabulary a distinct class", () => {
    // A kind with no class of its own renders as another kind — the same
    // failure `paletteDisagreements`' "has no badge class" clause catches.
    const classes = VERDICT_GLYPHS.map(glyphClass);
    expect(new Set(classes).size).toBe(VERDICT_GLYPHS.length);
    for (const cls of classes) expect(cls.trim()).not.toBe("");
  });

  it("treats `?` as provisional, not as calm", () => {
    // Dashed is the console's "we cannot say" vocabulary (`draft`,
    // `UNKNOWN_AMBER`'s dashed sibling). A solid muted border would read as a
    // settled, unremarkable verdict.
    expect(glyphClass("?")).toContain("border-dashed");
  });

  it("falls an UNRECOGNISED glyph to the same provisional treatment", () => {
    // `glyphFor` lets a surface mint its own glyph (`/deploys` does). One this
    // ladder has never seen must not borrow green or red.
    const cls = glyphClass("☃");
    expect(cls).toBe(glyphClass("?"));
    expect(cls).not.toContain("green-");
    expect(cls).not.toContain("red-");
  });
});

// ----------------------------------------------------------------------------
// The rendered cluster
// ----------------------------------------------------------------------------

describe("VerdictChips", () => {
  it("renders one chip per verdict, carrying dimension and glyph", () => {
    render(
      <VerdictChips
        verdicts={[
          verdict({ dimension: "git", outcome: "confirmed" }),
          verdict({ dimension: "ci", outcome: "failure" }),
        ]}
        data-testid="coord-land-verdicts"
        chipTestId="chip"
        outcomeTestId="outcome"
      />
    );
    const chips = screen.getAllByTestId("chip");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAttribute("data-dimension", "git");
    expect(within(chips[0]).getByTestId("outcome")).toHaveTextContent("✓");
    expect(within(chips[1]).getByTestId("outcome")).toHaveTextContent("✕");
  });

  it("renders NOTHING when there are no verdicts", () => {
    // Not an empty container: the row's slot order (R2) would otherwise carry
    // a zero-width element between the label and the status badge.
    const { container } = render(
      <VerdictChips verdicts={[]} data-testid="v" chipTestId="chip" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is never hidden below a breakpoint", () => {
    // `coord-land-verdicts` is a frozen Spec-CI criterion asserted in a STATIC
    // state. A `hidden md:inline-flex` would make that spec's pass depend on
    // the CI viewport width — the module doc says so; this pins it.
    render(
      <VerdictChips
        verdicts={[verdict()]}
        data-testid="coord-land-verdicts"
        chipTestId="chip"
      />
    );
    expect(screen.getByTestId("coord-land-verdicts").className).not.toMatch(
      /\bhidden\b/
    );
  });

  it("puts the dimension, the outcome, the drift class and the detail in the title", () => {
    render(
      <VerdictChips
        verdicts={[
          verdict({
            dimension: "cascade",
            outcome: "partial",
            drift_class: "cascade:late",
            detail: "two repos still settling",
          }),
        ]}
        data-testid="v"
        chipTestId="chip"
      />
    );
    expect(screen.getByTestId("chip")).toHaveAttribute(
      "title",
      "cascade: partial — drift cascade:late — two repos still settling"
    );
  });

  it("says `not observed` rather than leaving the title blank", () => {
    render(
      <VerdictChips
        verdicts={[verdict({ dimension: "release", outcome: null })]}
        data-testid="v"
        chipTestId="chip"
      />
    );
    expect(screen.getByTestId("chip")).toHaveAttribute(
      "title",
      "release: not observed"
    );
  });

  it("honours the per-verdict label and glyph overrides", () => {
    // `/deploys` uses both so a managed predicted head-fork reads
    // "auto-managed" with its own glyph rather than borrowing `Failure`'s red.
    render(
      <VerdictChips
        verdicts={[verdict({ dimension: "schema", outcome: "failure" })]}
        data-testid="v"
        chipTestId="chip"
        outcomeTestId="outcome"
        labelFor={() => "auto-managed"}
        glyphFor={() => "~"}
      />
    );
    const chip = screen.getByTestId("chip");
    expect(within(chip).getByTestId("outcome")).toHaveTextContent("~");
    expect(chip).toHaveAttribute("title", "schema: auto-managed");
    // The override must reach the COLOUR too, not just the glyph — otherwise
    // the row reads "auto-managed" in red.
    expect(chip.className).not.toContain("red-");
  });

  it("keeps two verdicts on the same dimension distinguishable", () => {
    // coord may report a dimension twice across re-verification passes; the
    // React key carries the index for exactly that reason.
    render(
      <VerdictChips
        verdicts={[
          verdict({ dimension: "ci", outcome: "failure" }),
          verdict({ dimension: "ci", outcome: "confirmed" }),
        ]}
        data-testid="v"
        chipTestId="chip"
        outcomeTestId="outcome"
      />
    );
    const chips = screen.getAllByTestId("chip");
    expect(chips).toHaveLength(2);
    expect(within(chips[0]).getByTestId("outcome")).toHaveTextContent("✕");
    expect(within(chips[1]).getByTestId("outcome")).toHaveTextContent("✓");
  });
});

// ----------------------------------------------------------------------------
// The expanded form
// ----------------------------------------------------------------------------

describe("VerdictDetail", () => {
  it("says an empty verdict list is UNKNOWN, not clean", () => {
    render(<VerdictDetail verdicts={[]} testId="detail" />);
    expect(screen.getByText(/unknown, not clean/i)).toBeInTheDocument();
    expect(screen.queryByTestId("detail")).not.toBeInTheDocument();
  });

  it("names each dimension with its outcome, drift class and detail", () => {
    render(
      <VerdictDetail
        verdicts={[
          verdict({
            dimension: "git",
            outcome: "surprise",
            drift_class: "git:fast-forward",
            detail: "coord replayed the branch",
          }),
        ]}
        testId="detail"
      />
    );
    const detail = screen.getByTestId("detail");
    expect(detail).toHaveTextContent("git");
    expect(detail).toHaveTextContent("surprise");
    expect(detail).toHaveTextContent("git:fast-forward");
    expect(detail).toHaveTextContent("coord replayed the branch");
  });

  it("renders `not observed` for a missing outcome", () => {
    render(
      <VerdictDetail verdicts={[verdict({ outcome: null })]} testId="detail" />
    );
    expect(screen.getByTestId("detail")).toHaveTextContent("not observed");
  });
});
