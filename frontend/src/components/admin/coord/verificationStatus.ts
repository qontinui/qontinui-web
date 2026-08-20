/**
 * Composed D3 verification → operator-facing status, shared by
 * `/admin/coord/lands` and `/admin/coord/deploys`.
 *
 * Created by plan `2026-08-16-coord-console-ui-unification-pipeline-style.md`
 * Phase 3 Wave 2. ONE module for both surfaces, deliberately: they already
 * share the composed-outcome colour ladder (`DeployCard` imported
 * `composedOutcomeVariant` straight out of `LandCard` precisely so the two
 * could not drift), and shipping two attention tables over one vocabulary
 * would re-create that drift on the axis that matters most.
 *
 * ## What the status kind IS
 *
 * The composed outcome, plus one kind for "declared, nothing has verified it
 * yet". `settled` is NOT folded in — it stays its own chip on the row, because
 * the two answer different questions ("what did we conclude?" vs "is the
 * conclusion final?") and because `coord-land-settled-badge` /
 * `coord-deploy-settled-badge` are frozen authored testids on a separate
 * element (D4a).
 *
 * ## The two hues this changes, and why (R3)
 *
 * The card ladder was `confirmed→green, surprise→AMBER, partial→blue,
 * failure/contradiction→red, anything else→outline`. Two of those do not
 * survive R3 as the style guide now states it:
 *
 * - **`surprise` was amber. It is now calm.** Amber's contract is
 *   *self-clearing*: "name the thing that clears the row". Nothing clears a
 *   surprise — it is a settled observation that the effect differed from the
 *   prediction. What it needs is a calibration decision, and *nothing is
 *   blocked while it waits*. That is exactly the guide's third case ("a real
 *   decision that is not blocking anyone"): CALM, with the ask stated **in
 *   words** in the row detail. {@link OWED_REVIEW} is that ask, rendered by
 *   `<LandRow>` / `<DeployRow>` as `coord-land-review-owed` /
 *   `coord-deploy-review-owed` — the same shape `<GapRow>`'s
 *   `coord-gap-review-owed` set. Spending amber on something that is not
 *   waiting on anything is how amber stops meaning what it says.
 * - **An unrecognised / absent outcome was `outline` (neutral grey). It is now
 *   amber.** R3's ignorance floor: `attentionOf` floors an unknown kind at
 *   `waiting`, never calm, and `planStatus`/`alertStatus`/`releaseStatus` all
 *   carry it. Painting "we could not read coord's verdict" as calm asserts
 *   nothing is wrong, which is the one thing we do not know.
 *
 * `confirmed`, `partial`, `failure` and `contradiction` keep their hues.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";

/** The verification states a row can be in, composed outcome plus "not yet". */
export type VerificationKind =
  | "confirmed"
  | "partial"
  | "surprise"
  | "failure"
  | "contradiction"
  | "unverified"
  | "unknown";

/** Operator-facing label. Never the raw coord token. */
export const VERIFICATION_LABEL: Record<VerificationKind, string> = {
  confirmed: "confirmed",
  partial: "partial",
  surprise: "surprise",
  failure: "failure",
  contradiction: "contradiction",
  unverified: "not yet verified",
  unknown: "verdict unreadable",
};

export const VERIFICATION_CLASS: Record<VerificationKind, string> = {
  confirmed: "bg-green-500/15 text-green-200 border-green-500/30",
  // Calm-informational: coverage is incomplete, nothing is blocked.
  partial: "bg-blue-500/10 text-blue-200 border-blue-500/30",
  // Calm, and DISTINCT from partial so the two are tellable apart at a glance
  // without either borrowing amber. See the module doc for why not amber.
  surprise: "bg-violet-500/12 text-violet-200 border-violet-500/30",
  failure: "bg-red-500/15 text-red-200 border-red-500/35",
  contradiction: "bg-red-500/15 text-red-200 border-red-500/35",
  // Waiting on the verifier — the one thing here that genuinely clears itself.
  unverified: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  // R3's ignorance floor.
  unknown: "bg-amber-500/10 text-amber-200 border-amber-500/30",
};

/**
 * The audited kind → attention table. TOTAL over {@link VerificationKind},
 * one row per kind with the reason it lands there:
 *
 * - `confirmed` — **`none`**. Predicted and observed agree. Done.
 * - `partial` — **`none`**. Some dimensions were never observed. Worth a look
 *   at the predictor's coverage; nothing is blocked and nothing decays, so the
 *   ask goes in the detail ({@link OWED_REVIEW}), not in the hue.
 * - `surprise` — **`none`**, for the same reason, and see the module doc: the
 *   guide's third case, not amber.
 * - `failure` — **`author`**. The action did not do what it declared. Nothing
 *   downstream retries it and nothing times out; a human decides what happens
 *   to the land / deploy.
 * - `contradiction` — **`author`**. Observations that cannot all be true. No
 *   process reconciles that; it is the loudest thing this surface can say.
 * - `unverified` — **`waiting`**. Amber's contract satisfied literally: the
 *   verifier is the named thing that clears it, on its own, shortly.
 * - `unknown` — **`waiting`**, the ignorance floor. A composed-outcome token
 *   this build has no meaning for. Only a human extending the vocabulary
 *   clears it, so R3's name-the-clearer test would read literally as "not
 *   amber" — and R3 states the exception, because amber on ignorance is a
 *   statement about our knowledge, not a promise about the row.
 */
export const VERIFICATION_ATTENTION_BY_KIND: Record<
  VerificationKind,
  Attention
> = {
  confirmed: "none",
  partial: "none",
  surprise: "none",
  failure: "author",
  contradiction: "author",
  unverified: "waiting",
  unknown: "waiting",
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds. */
export const VERIFICATION_AUTHOR_GLYPH_KINDS: ReadonlySet<VerificationKind> =
  new Set(
    (Object.keys(VERIFICATION_ATTENTION_BY_KIND) as VerificationKind[]).filter(
      (k) => VERIFICATION_ATTENTION_BY_KIND[k] === "author"
    )
  );

export const VERIFICATION_PALETTE: StatusPalette<VerificationKind> = {
  badgeClass: VERIFICATION_CLASS,
  authorGlyphKinds: VERIFICATION_AUTHOR_GLYPH_KINDS,
  doneGlyphKinds: new Set<VerificationKind>(["confirmed"]),
};

/**
 * The calm-but-OWED sentence, per kind (§4.2 clause 4).
 *
 * A kind whose attention is `none` and which nonetheless owes somebody a
 * decision has to SAY SO, in words, in the detail — `paletteDisagreements`
 * proves the hue matches the declared attention and can never prove the
 * declared attention was the right one, and that is the gap both of Wave 1's
 * mis-filings fell through. `null` means nothing is owed.
 */
export const OWED_REVIEW: Record<VerificationKind, string | null> = {
  confirmed: null,
  partial:
    "Owed: some predicted dimensions were never observed. Nothing is blocked — this is a coverage gap in the predictor, and someone should decide whether the missing dimensions are worth instrumenting.",
  surprise:
    "Owed: the effect differed from the prediction without failing. Nothing is blocked and nothing decays — but the predictor's calibration is a real call somebody has to make.",
  failure: null,
  contradiction: null,
  unverified: null,
  unknown: null,
};

/** The composed-outcome tokens coord actually sends. */
const WIRE_OUTCOMES: ReadonlySet<string> = new Set([
  "confirmed",
  "partial",
  "surprise",
  "failure",
  "contradiction",
]);

/**
 * Classify a composed outcome. A `Set` rather than an `in` test against
 * {@link VERIFICATION_LABEL}: `in` walks the prototype chain, so a payload
 * whose outcome was the string `"constructor"` would classify as a known kind
 * and index the palette with it.
 */
export function classifyComposedOutcome(
  outcome?: string | null
): VerificationKind {
  const o = (outcome ?? "").trim().toLowerCase();
  if (!o) return "unknown";
  return WIRE_OUTCOMES.has(o) ? (o as VerificationKind) : "unknown";
}

/** The minimum of a verification row this derivation reads. */
export interface VerificationLike {
  composed_outcome?: string | null;
  settled?: boolean | null;
  coverage?: number | null;
  dimensions_predicted?: number | null;
  dimensions_observed?: number | null;
  rationale?: string | null;
}

/**
 * The row status a land or a deploy renders.
 *
 * A NULL verification is `unverified` — the action declared itself and the
 * verifier has not answered. That is distinct from `unknown`, which is a
 * verifier answer we could not read, and the two must not collapse: one is
 * "not yet", the other is "we cannot tell".
 */
export function deriveVerificationStatus(
  ver: VerificationLike | null | undefined
): RowStatus<VerificationKind> {
  if (!ver) {
    return {
      kind: "unverified",
      label: VERIFICATION_LABEL.unverified,
      reason: "declared, waiting on the verifier",
      attention: VERIFICATION_ATTENTION_BY_KIND.unverified,
    };
  }
  const kind = classifyComposedOutcome(ver.composed_outcome);
  const bits: string[] = [];
  if (typeof ver.coverage === "number") {
    bits.push(`${Math.round(ver.coverage * 100)}% coverage`);
  }
  if (
    typeof ver.dimensions_observed === "number" &&
    typeof ver.dimensions_predicted === "number"
  ) {
    bits.push(`${ver.dimensions_observed}/${ver.dimensions_predicted} dims`);
  }
  if (ver.settled === false) bits.push("still settling");

  return {
    kind,
    label:
      kind === "unknown" && ver.composed_outcome
        ? // Verbatim — the raw token IS the honest label for a verdict we do
          // not recognise, exactly as `planStatus` does for work-unit status.
          String(ver.composed_outcome)
        : VERIFICATION_LABEL[kind],
    reason: bits.length > 0 ? bits.join(", ") : ver.rationale ?? undefined,
    attention: VERIFICATION_ATTENTION_BY_KIND[kind],
  };
}
