/**
 * policyAutonomyStatus — the derived state of one tenant's autonomous
 * next-step opt-in, and R3's audited severity table for it.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 4 (Family C, D2). Derivation lives in a pure, unit-tested module rather
 * than inline in JSX (R8).
 *
 * ## The interesting row is `inert`, and it is R3's third case
 *
 * The fleet table has two independent facts per tenant: the `autonomy_level`
 * the tenant CHOSE, and whether that choice is `effective` — which it is not
 * while the platform master flag (`COORD_NEXT_STEP_AUTODISPATCH_ENABLED`) is
 * off. The pre-migration table rendered those as two unrelated badges (a green
 * "Yes" / outline "No"), so the one state worth naming — *this tenant believes
 * it opted into autonomous dispatch and coord will not dispatch for it* — had
 * to be assembled by the reader from two cells.
 *
 * The instinct is to paint that amber. **Do not**, and the style guide's third
 * case says why: nothing is blocked and nothing degrades while it waits. The
 * master flag is off because an operator turned it off; that is a working
 * feature in its off position, not a defect and not a pending resolution.
 * `clearanceRuleStatus`'s `disabled` kind reaches the same verdict for the
 * same reason. **So it is CALM, and the ask goes in the row detail, in words**
 * — which is exactly what §4.2 clause 4 requires of a calm kind that is
 * nonetheless owed something.
 *
 * This surface therefore mints no red and no amber at all, and that is a
 * claim, not an omission: there is no state here on which an operator must act
 * now, and none that something else will clear.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import { INERT } from "@/components/console/statusRow";

/** Coord's tenant autonomy vocabulary, as it arrives on the wire. */
export type AutonomyLevel =
  | "always_escalate"
  | "guidance_only"
  | "auto_decide";

/** The vocabulary the ROW renders — level crossed with effectiveness. */
export type PolicyAutonomyKind =
  | "dispatching"
  | "guidance"
  | "escalating"
  | "inert";

/**
 * The audited kind → attention table. TOTAL over
 * {@link PolicyAutonomyKind}, one documented row each:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `dispatching` | `none` | `auto_decide` and effective — coord decides next steps for this tenant. Working as configured; nobody's move. |
 * | `guidance` | `none` | `guidance_only` — coord proposes, a human disposes. That IS the configured behaviour, not a queue. |
 * | `escalating` | `none` | `always_escalate` — coord's default. A tenant that never opted in owes nothing. |
 * | `inert` | `none` | The tenant opted into a non-default level and it is NOT effective, because the platform master flag is off. Calm on purpose: an off switch that is off is a CHOICE, nothing degrades while it stays off, and nothing but a human turning the flag on would change it. The ask is carried in words by {@link INERT_EXPLANATION} — R3's third case, and §4.2 clause 4. |
 *
 * None of these is the ignorance floor: `effective` is a boolean coord sends
 * and `autonomy_level` is a closed enum, so a row we cannot read at all
 * does not arise. A level outside the enum is handled by
 * {@link derivePolicyAutonomyStatus} falling back to `escalating`, coord's own
 * default, rather than by inventing an `unknown` kind that never renders.
 */
export const POLICY_ATTENTION_BY_KIND: Record<PolicyAutonomyKind, Attention> = {
  dispatching: "none",
  guidance: "none",
  escalating: "none",
  inert: "none",
};

export const POLICY_KIND_CLASS: Record<PolicyAutonomyKind, string> = {
  dispatching: "bg-green-500/15 text-green-200 border-green-500/30",
  guidance: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  escalating: INERT,
  // Calm but visibly provisional — the dashed "deliberately not in play"
  // treatment `draft` and `clearanceRuleStatus.disabled` already use.
  inert: "bg-transparent text-muted-foreground border-border border-dashed",
};

/** Red ⇔ `✕`. No kind is red here, so this set is empty — and stays empty. */
export const POLICY_AUTHOR_GLYPH_KINDS: ReadonlySet<PolicyAutonomyKind> =
  new Set(
    (Object.keys(POLICY_ATTENTION_BY_KIND) as PolicyAutonomyKind[]).filter(
      (k) => POLICY_ATTENTION_BY_KIND[k] === "author"
    )
  );

export const POLICY_STATUS_PALETTE: StatusPalette<PolicyAutonomyKind> = {
  badgeClass: POLICY_KIND_CLASS,
  authorGlyphKinds: POLICY_AUTHOR_GLYPH_KINDS,
  doneGlyphKinds: new Set<PolicyAutonomyKind>(["dispatching"]),
};

/** The words the calm `inert` row owes its reader (§4.2 clause 4). */
export const INERT_EXPLANATION =
  "opted in, but platform autonomous dispatch is off — coord will not dispatch for this tenant until the master flag is enabled";

const LABEL_BY_KIND: Record<PolicyAutonomyKind, string> = {
  dispatching: "dispatching",
  guidance: "guidance only",
  escalating: "always escalates",
  inert: "opt-in not in effect",
};

/** The one fact per tenant this derivation needs. */
export interface PolicyAutonomyInput {
  autonomy_level: AutonomyLevel | string;
  effective: boolean;
}

function isOptIn(level: string): boolean {
  return level === "auto_decide" || level === "guidance_only";
}

/**
 * The row's status.
 *
 * Precedence is effectiveness-first for the two OPT-IN levels only: an
 * `always_escalate` tenant is `escalating` whatever `effective` says, because
 * it never opted into anything the master flag could switch off. Getting that
 * backwards would file every default tenant as "opt-in not in effect", which
 * is a sentence about an opt-in that does not exist.
 */
export function derivePolicyAutonomyStatus(
  t: PolicyAutonomyInput
): RowStatus<PolicyAutonomyKind> {
  const level = t.autonomy_level;
  let kind: PolicyAutonomyKind;
  if (isOptIn(level) && !t.effective) {
    kind = "inert";
  } else if (level === "auto_decide") {
    kind = "dispatching";
  } else if (level === "guidance_only") {
    kind = "guidance";
  } else {
    // `always_escalate`, and anything outside the enum: coord's own default is
    // to escalate, so that is what we say rather than guessing louder.
    kind = "escalating";
  }
  return {
    kind,
    label: LABEL_BY_KIND[kind],
    reason: kind === "inert" ? INERT_EXPLANATION : undefined,
    attention: POLICY_ATTENTION_BY_KIND[kind],
  };
}
