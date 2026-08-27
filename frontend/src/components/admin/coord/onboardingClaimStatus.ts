/**
 * onboardingClaimStatus — the four states of the GitHub-App claim on
 * `/admin/coord/onboarding-status`, and R3's audited severity table for them.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 3. `/onboarding-status` is one of the plan's **form/dialog routes**,
 * which take R9 (chrome) and R3 (palette) only — there is no record list here
 * and no expand-in-place to add.
 *
 * The reason this file exists rather than four hand-picked hues in the page's
 * JSX is the style guide's own §4.2 contract: a console surface with statuses
 * ships its own kind→attention table, one documented row per kind, and a unit
 * test asserting the palette agrees with it. Four literal `<Card>` banners with
 * ad-hoc colours is exactly the shape that table exists to replace, and it had
 * already drifted once here — see `recover` below.
 *
 * The phase union deliberately does NOT include the page's `null` (no claim in
 * flight). `null` renders no banner at all, so there is nothing to colour and
 * nothing to be total over.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  CI_YELLOW,
  rowAccentClass,
} from "@/components/console/statusRow";

/** The four states the claim callback can be in. Mirrors the page's own union. */
export type ClaimPhase = "claiming" | "success" | "error" | "recover";

/**
 * The audited kind → attention table. TOTAL over {@link ClaimPhase}, one row
 * per phase with the reason it lands there:
 *
 * | phase | attention | why |
 * |---|---|---|
 * | `claiming` | `none` | The POST is in flight. Nobody is blocked and nothing decays; it resolves itself in a second or two. Calm — this is R3's "work running" band. |
 * | `success` | `none` | Done. The account is bound and the repos are enrolling; the checklist below reports the rest. |
 * | `error` | `author` | The claim failed and NOTHING retries it. The operator has to read the message and act — that is the definition of `author`. |
 * | `recover` | `author` | **Corrected here.** The callback arrived with no usable `connect_state`, so the connect must be STARTED AGAIN by a human. It was rendered muted, beside a muted refresh icon, which reads as "in progress" — the one thing it is not. Nothing self-clears it, so amber would be a false promise (R3, "amber's contract is self-clearing") and calm would understate a dead end. |
 *
 * Neither `author` phase is the R3 ignorance floor: we know exactly what state
 * the claim is in in both cases, so `UNKNOWN_AMBER` does not apply.
 */
export const CLAIM_ATTENTION_BY_PHASE: Record<ClaimPhase, Attention> = {
  claiming: "none",
  success: "none",
  error: "author",
  recover: "author",
};

export const CLAIM_PHASE_CLASS: Record<ClaimPhase, string> = {
  // In-flight work nobody is blocked on — the same yellow the merge pipeline
  // paints a running check with.
  claiming: CI_YELLOW,
  // The merge pipeline's `merged` green: this surface's "done".
  success: "bg-green-500/15 text-green-200 border-green-500/30",
  error: AUTHOR_RED,
  recover: AUTHOR_RED,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` phases, derived. */
export const CLAIM_AUTHOR_GLYPH_PHASES: ReadonlySet<ClaimPhase> = new Set(
  (Object.keys(CLAIM_ATTENTION_BY_PHASE) as ClaimPhase[]).filter(
    (p) => CLAIM_ATTENTION_BY_PHASE[p] === "author"
  )
);

export const CLAIM_STATUS_PALETTE: StatusPalette<ClaimPhase> = {
  badgeClass: CLAIM_PHASE_CLASS,
  authorGlyphKinds: CLAIM_AUTHOR_GLYPH_PHASES,
  doneGlyphKinds: new Set<ClaimPhase>(["success"]),
};

const LABEL_BY_PHASE: Record<ClaimPhase, string> = {
  claiming: "connecting",
  success: "connected",
  error: "connect failed",
  recover: "connect incomplete",
};

/**
 * The banner's status. `reason` is the one-line "why", in the operator's
 * words — the full message stays in the banner body where it can wrap.
 */
export function deriveClaimStatus(phase: ClaimPhase): RowStatus<ClaimPhase> {
  return {
    kind: phase,
    label: LABEL_BY_PHASE[phase],
    reason:
      phase === "recover"
        ? "start the connect again — nothing will retry this for you"
        : phase === "error"
          ? "coord could not complete the claim"
          : undefined,
    attention: CLAIM_ATTENTION_BY_PHASE[phase],
  };
}

/**
 * The banner container's chrome, DERIVED from the phase's attention (R4) —
 * not a table of literals that merely claims to be.
 *
 * The first cut of this was a hand-written `Record<ClaimPhase, string>`, and
 * it went wrong in all three of the ways this file exists to prevent:
 *
 * 1. It spelled `border-l-2 border-l-red-500/80` verbatim — a copy of
 *    {@link rowAccentClass}'s own output, which was importable all along.
 * 2. It spelled the border tint `border-red-500/40`, which matches NO exported
 *    constant: {@link AUTHOR_RED} ends `/35`. That is exactly the tint drift
 *    `statusRow.tsx` documents (the `planStatus.blocked` `/30`-vs-`/35` case),
 *    reintroduced at a third value — and `paletteDisagreements` cannot catch
 *    tint drift, which is why it has to be structurally impossible instead.
 * 3. It sat OUTSIDE {@link CLAIM_STATUS_PALETTE}, so nothing audited it. Its
 *    doc said "keyed off the phase's attention" and nothing enforced that:
 *    flipping `recover` to `none` would have left the banner red with every
 *    test green.
 *
 * Deriving it fixes all three at once. There is now exactly one place that
 * decides what `author` looks like, the accent comes from the shared function,
 * and the attention table is the only input — so the doc's claim is true by
 * construction rather than by assertion.
 */
export function claimBannerBorder(phase: ClaimPhase): string {
  const attention = CLAIM_ATTENTION_BY_PHASE[phase];
  // The accent is `rowAccentClass`'s, unmodified. The ring tint is taken from
  // the same family literal the badge uses, so the two can never disagree:
  // `AUTHOR_RED` already carries `border-red-500/35`.
  const accent = rowAccentClass({ attention });
  if (attention === "author") return `border-red-500/35 ${accent}`;
  if (attention === "waiting") return `border-amber-500/30 ${accent}`;
  // Calm. `success` keeps a green ring because "done" is a real signal and R3
  // reserves only red and amber; everything else may use a calm hue.
  return phase === "success" ? "border-green-500/30" : "border-border";
}
