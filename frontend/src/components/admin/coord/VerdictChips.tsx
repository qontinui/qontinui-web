"use client";

/**
 * VerdictChips — the per-dimension D3 verdict cluster, compact enough to ride
 * on a record row.
 *
 * Created by plan `2026-08-16-coord-console-ui-unification-pipeline-style.md`
 * Phase 3 Wave 2, shared by `<LandRow>` and `<DeployRow>`.
 *
 * ## Why this is on the ROW at all
 *
 * R2 would rather it were not: four (lands) to six (deploys) chips is the
 * widest thing on the line. It stays because
 * `specs/pages/coord-lands/state-machine.derived.json` asserts
 * `coord-land-verdicts` in a STATIC state — that spec has no transitions, so
 * every criterion is evaluated on page load with nothing expanded — and the
 * derived specs are frozen (D4b; Spec-CI is not runnable in this session, so
 * re-derivation is not available either). `<DeployRow>` renders the same
 * cluster for consistency: a record must look the same on every page of the
 * console, and one of the two being forced is not a reason for the other to
 * differ.
 *
 * So it is rendered at the smallest honest size instead of moved: the
 * DIMENSION plus a colourblind-safe outcome glyph, with the drift class, the
 * full outcome token and coord's `detail` text in the `title` and, in full, in
 * the expanded `<RecordDetail>`. Colour is never the only channel here —
 * that is the same discipline `statusRow`'s `✕` exists for.
 */

import type { ReactNode } from "react";
import type { DimensionVerdict } from "@/components/admin/coord/landTypes";

/**
 * The glyph vocabulary, loudest first. EXPORTED because it is the domain of
 * {@link glyphClass}: a test can enumerate it and assert the R3 clause below
 * over every member, which a hand-written list of `it(...)` cases cannot
 * promise to keep total.
 *
 * `"?"` is deliberately IN the set. It is the ignorance floor, not the absence
 * of a glyph — see {@link outcomeGlyph}.
 */
export const VERDICT_GLYPHS = ["✕", "!", "~", "✓", "?"] as const;

export type VerdictGlyph = (typeof VERDICT_GLYPHS)[number];

/**
 * Outcome → colourblind-safe glyph. The glyph carries the verdict for a reader
 * who cannot use the hue, and it is the reason this cluster can be this small.
 *
 * EXPORTED as of the Wave 2 follow-up. It was module-private, and the cost of
 * that was two copies: `DeployRow.deployGlyph` re-spelled this ladder verbatim
 * to prepend one carve-out, so the surface that renders the *same* cluster
 * derived its glyphs from a second implementation nothing compared to this
 * one. `deployGlyph` now delegates here and keeps only its carve-out.
 */
export function outcomeGlyph(outcome?: string | null): VerdictGlyph {
  const o = (outcome ?? "").trim().toLowerCase();
  if (o === "confirmed") return "✓";
  if (o === "failure" || o === "contradiction") return "✕";
  if (o === "surprise") return "!";
  if (o === "partial") return "~";
  // Not "nothing": an unobserved dimension is unknown, and a blank chip would
  // read as a pass. Same discipline as R6's `–`.
  return "?";
}

/**
 * Glyph → the hue family it is allowed to use (R3).
 *
 * **The one red is `✕`, and it is the only one.** That is the same clause
 * `paletteDisagreements` enforces for every badge palette in the console
 * (`console/attention.ts`, clause 4: red ⇔ `✕`); this cluster paints its own
 * chips rather than going through `StatusBadge`, so the audit table cannot
 * reach it and the invariant is asserted directly in `VerdictChips.test.tsx`
 * instead. An unknown glyph falls to the dashed-provisional treatment — the
 * same "we cannot say" vocabulary `draft` and `UNKNOWN_AMBER` use — never to a
 * calm or a green.
 *
 * EXPORTED for that test. Wave 2 shipped this function and `outcomeGlyph`
 * untested while deleting the per-dimension ladder's only other oracle, which
 * that PR recorded as its one real coverage loss.
 */
export function glyphClass(glyph: string): string {
  if (glyph === "✕") return "text-red-300 border-red-500/35";
  if (glyph === "✓") return "text-green-300 border-green-500/30";
  if (glyph === "!") return "text-violet-200 border-violet-500/30";
  if (glyph === "~") return "text-blue-200 border-blue-500/30";
  return "text-muted-foreground border-border border-dashed";
}

export interface VerdictChipsProps {
  verdicts: DimensionVerdict[];
  /** Container testid — `coord-land-verdicts` / `coord-deploy-verdicts`. */
  "data-testid": string;
  /** Per-chip testid — `coord-land-verdict-chip` / `coord-deploy-verdict-chip`. */
  chipTestId: string;
  /** Testid for the glyph itself, where a surface authored one. */
  outcomeTestId?: string;
  /**
   * Per-verdict label override. `/deploys` uses it so a managed predicted
   * head-fork reads "auto-managed" rather than its raw `Failure` outcome.
   */
  labelFor?: (v: DimensionVerdict) => string;
  /** Per-verdict glyph override, for the same reason. */
  glyphFor?: (v: DimensionVerdict) => string;
}

export function VerdictChips({
  verdicts,
  "data-testid": testId,
  chipTestId,
  outcomeTestId,
  labelFor,
  glyphFor,
}: VerdictChipsProps): ReactNode {
  if (verdicts.length === 0) return null;
  return (
    <span
      // ALWAYS rendered visible, never `hidden md:inline-flex`. A
      // `display:none` element is in the DOM but not in a UI-Bridge snapshot,
      // and `coord-land-verdicts` is a frozen Spec-CI criterion — hiding it
      // below a breakpoint would make the spec's pass depend on the CI
      // viewport width, which is exactly the kind of invisible coupling a
      // frozen spec is supposed to be free of. The row's label truncates
      // instead (R2: truncation, never wrapping).
      className="inline-flex items-center gap-1 shrink-0"
      data-testid={testId}
    >
      {verdicts.map((v, i) => {
        const glyph = glyphFor ? glyphFor(v) : outcomeGlyph(v.outcome);
        const shown = labelFor ? labelFor(v) : (v.outcome ?? "not observed");
        return (
          <span
            key={`${v.dimension}-${i}`}
            className={[
              "inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10px] uppercase tracking-wide",
              glyphClass(glyph),
            ].join(" ")}
            title={[
              `${v.dimension}: ${shown}`,
              v.drift_class ? `drift ${v.drift_class}` : null,
              v.detail ?? null,
            ]
              .filter(Boolean)
              .join(" — ")}
            data-testid={chipTestId}
            data-dimension={v.dimension}
          >
            {v.dimension}
            <span data-testid={outcomeTestId}>{glyph}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * The same verdicts, expanded: one named line each, with the drift class and
 * coord's own `detail` text. This is where the cluster above sends a reader
 * who needs more than a glyph.
 */
export function VerdictDetail({
  verdicts,
  labelFor,
  testId,
}: {
  verdicts: DimensionVerdict[];
  labelFor?: (v: DimensionVerdict) => string;
  testId: string;
}): ReactNode {
  if (verdicts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No per-dimension verdicts recorded. That is unknown, not clean — the
        verifier writes one row per dimension it managed to observe.
      </p>
    );
  }
  return (
    <dl
      className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs"
      data-testid={testId}
    >
      {verdicts.map((v, i) => (
        <div key={`${v.dimension}-${i}`} className="contents">
          <dt className="font-medium uppercase text-muted-foreground">
            {v.dimension}
          </dt>
          <dd className="text-foreground/90">
            {labelFor ? labelFor(v) : (v.outcome ?? "not observed")}
            {v.drift_class && (
              <span className="text-muted-foreground"> · {v.drift_class}</span>
            )}
            {v.detail && (
              <span className="text-muted-foreground"> — {v.detail}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
