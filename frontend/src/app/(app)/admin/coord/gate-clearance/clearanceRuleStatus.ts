/**
 * clearanceRuleStatus — the derived state of one gate-clearance rule, and R3's
 * audited severity table for it.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 5. Status derivation lives in a pure, unit-tested module rather than
 * inline in JSX (R8), the shape `alertStatus.ts` established.
 *
 * ## A census correction, recorded because it changes what the plan asked for
 *
 * That plan's §4 correction files `/gate-clearance` as **Family C — a table**,
 * and prescribes D2: keep the table, add a clickable row expanding a
 * full-width `<tr><td colspan>`. Read against the code that is **half right**.
 * The route has TWO surfaces:
 *
 * - `EffectiveAuthorityMatrix` **is** a shadcn `<Table>` — D2 applies to it
 *   exactly as written, and that is what it got.
 * - `ClearanceRuleList` is **not** a table. It renders `<div>` rows
 *   (`clearance-rule-row`) at `px-3 py-3` with a name line, a
 *   priority/rationale line and an inert-explanation line — a Family-B fat
 *   row wearing no `<Card>`, the same shape as `ProposalCard` and the same
 *   reason a `<Card>`-keyed audit missed it. It got R2/R5 instead.
 *
 * ## The R3 reading, kind by kind
 *
 * The interesting question here is which "inactive" rules are a DEFECT and
 * which are a CHOICE, because `inertReason` returns both from one function and
 * the list painted them identically (one amber `inactive` badge).
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import { AUTHOR_RED, INERT } from "@/components/console/statusRow";
import type { CoordPolicyRow } from "../_shared/coordPolicies";
import { INERT_EXPLANATIONS, inertReason } from "./gateClearance";

/** The vocabulary the ROW renders. */
export type ClearanceRuleKind =
  | "active"
  | "disabled"
  | "expired"
  | "misconfigured";

/**
 * The audited kind → attention table. TOTAL over {@link ClearanceRuleKind},
 * one documented row each:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `active` | `none` | The rule is a live candidate in coord's resolution. Nothing is owed. |
 * | `disabled` | `none` | `enabled = false` is a state the operator CHOSE. An off switch that is off is not a defect, and painting it loud spends the vocabulary on a working feature. The row says "disabled" in words. |
 * | `expired` | `none` | Same: the expiry that lapsed is the one the operator set. A rule doing exactly what it was told to do at the time it was told to do it. |
 * | `misconfigured` | `author` | `repo-scoped`, `no-class` or `unknown-authority` — the operator wrote a rule that coord's resolver **can never match**. Nothing clears it but a human, and meanwhile the class is silently decided by some other band: the operator believes a rule is governing that is not. That is the definition of `author`. |
 *
 * None of these is the R3 ignorance floor. `unknown-authority` looks like a
 * candidate and is not: we are not failing to understand coord's vocabulary,
 * we are reading a payload that is definitively outside it. We know the state.
 */
export const CLEARANCE_ATTENTION_BY_KIND: Record<ClearanceRuleKind, Attention> =
  {
    active: "none",
    disabled: "none",
    expired: "none",
    misconfigured: "author",
  };

export const CLEARANCE_RULE_CLASS: Record<ClearanceRuleKind, string> = {
  active: "bg-green-500/5 text-green-300 border-green-500/25",
  // Calm but visibly provisional — the dashed "deliberately not in play"
  // treatment `draft` uses. Distinct from `active` without being an alarm.
  disabled: "bg-transparent text-muted-foreground border-border border-dashed",
  expired: INERT,
  misconfigured: AUTHOR_RED,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds, derived. */
export const CLEARANCE_AUTHOR_GLYPH_KINDS: ReadonlySet<ClearanceRuleKind> =
  new Set(
    (Object.keys(CLEARANCE_ATTENTION_BY_KIND) as ClearanceRuleKind[]).filter(
      (k) => CLEARANCE_ATTENTION_BY_KIND[k] === "author"
    )
  );

export const CLEARANCE_STATUS_PALETTE: StatusPalette<ClearanceRuleKind> = {
  badgeClass: CLEARANCE_RULE_CLASS,
  authorGlyphKinds: CLEARANCE_AUTHOR_GLYPH_KINDS,
  doneGlyphKinds: new Set<ClearanceRuleKind>(["active"]),
};

const LABEL_BY_KIND: Record<ClearanceRuleKind, string> = {
  active: "in play",
  disabled: "disabled",
  expired: "expired",
  misconfigured: "cannot match",
};

/**
 * The row's status, derived from the SAME `inertReason` the list already used
 * — so the badge and the explanation beneath it can never disagree about why a
 * rule is not in play.
 */
export function deriveClearanceRuleStatus(
  rule: CoordPolicyRow,
  now?: number
): RowStatus<ClearanceRuleKind> {
  const inert = inertReason(rule, now);
  const kind: ClearanceRuleKind =
    inert === null
      ? "active"
      : inert === "disabled"
        ? "disabled"
        : inert === "expired"
          ? "expired"
          : "misconfigured";
  return {
    kind,
    label: LABEL_BY_KIND[kind],
    // The explanation is coord-accurate prose that already exists; reusing it
    // keeps the row's one-line "why" identical to the detail's full sentence.
    reason: inert === null ? undefined : INERT_EXPLANATIONS[inert],
    attention: CLEARANCE_ATTENTION_BY_KIND[kind],
  };
}
