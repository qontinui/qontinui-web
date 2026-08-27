/**
 * memberStatus — the derived access state of one tenant member, and R3's
 * audited severity table for it.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 4, commit B (`/members`, sequenced last and alone per D7). Derivation
 * lives in a pure, unit-tested module rather than inline in JSX (R8).
 *
 * ## What the row could not previously say
 *
 * The table rendered `roles[]` as a bag of identical grey `secondary` badges,
 * which answers "what grants does this person hold?" but never the question an
 * administrator actually opens this page with: **what can this person
 * currently do?** Those differ in exactly one interesting case — a member with
 * an EMPTY role array, who has been invited or provisioned and can reach
 * nothing. In a bag of badges that person renders as the absence of badges,
 * which is the least legible way to say the most important thing on the row.
 *
 * ## The R3 reading, kind by kind
 *
 * Note what is NOT here: nothing on this surface is red. A member's access
 * level is a CONFIGURATION an administrator chose, not an incident. Painting
 * "this person is only a Developer" red would be the "how alarming does it
 * sound" bug in its purest form — and this page's Grant/Revoke controls mean
 * every state on it is one click from being whatever the administrator wants.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";

/** The vocabulary the ROW renders. */
export type MemberAccessKind = "administrator" | "developer" | "no-access";

/**
 * The audited kind → attention table. TOTAL over {@link MemberAccessKind},
 * one documented row each:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `administrator` | `none` | Holds the `admin` role: full tenant administration. A deliberate grant, working as granted. |
 * | `developer` | `none` | Holds `operator` and not `admin`: read plus the non-administrative actions. Also a deliberate grant. |
 * | `no-access` | `none` | Holds NO role at all — invited or pre-provisioned, and currently unable to reach anything. **Calm on purpose**, and this is the row worth arguing about: somebody probably owes this person a tier, but nothing is blocked, nothing decays while they wait, and no timer resolves it. That is R3's third case exactly, so the hue stays calm and the ask is spelled out in words on the row and in its detail (§4.2 clause 4). |
 *
 * None of these is the ignorance floor. `roles[]` is an array coord always
 * sends; an empty one is a MEASUREMENT ("they hold nothing"), not a gap in our
 * knowledge, so flooring it at amber would misreport certainty as doubt. A
 * role string outside coord's vocabulary is handled by
 * {@link deriveMemberStatus} — see its note.
 */
export const MEMBER_ATTENTION_BY_KIND: Record<MemberAccessKind, Attention> = {
  administrator: "none",
  developer: "none",
  "no-access": "none",
};

export const MEMBER_KIND_CLASS: Record<MemberAccessKind, string> = {
  administrator: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  developer: "bg-green-500/5 text-green-300 border-green-500/25",
  // Calm but visibly provisional — the dashed "nothing in play" treatment
  // `draft`, `clearanceRuleStatus.disabled` and `policyAutonomyStatus.inert`
  // already use, so an administrator scanning the column sees the empty state
  // as a shape rather than as an absence.
  "no-access": "bg-transparent text-muted-foreground border-border border-dashed",
};

/** Red ⇔ `✕`. No kind is red here, so this set is empty — and stays empty. */
export const MEMBER_AUTHOR_GLYPH_KINDS: ReadonlySet<MemberAccessKind> = new Set(
  (Object.keys(MEMBER_ATTENTION_BY_KIND) as MemberAccessKind[]).filter(
    (k) => MEMBER_ATTENTION_BY_KIND[k] === "author"
  )
);

export const MEMBER_STATUS_PALETTE: StatusPalette<MemberAccessKind> = {
  badgeClass: MEMBER_KIND_CLASS,
  authorGlyphKinds: MEMBER_AUTHOR_GLYPH_KINDS,
};

/** The words the calm `no-access` row owes its reader (§4.2 clause 4). */
export const NO_ACCESS_EXPLANATION =
  "holds no role in this tenant — invited or pre-provisioned, and cannot reach anything until an administrator grants a tier";

const LABEL_BY_KIND: Record<MemberAccessKind, string> = {
  administrator: "Administrator",
  developer: "Developer",
  "no-access": "no access",
};

/**
 * The row's status, derived from the role array.
 *
 * `admin` outranks `operator` — coord's roles are additive grants, not a
 * single-valued tier, so a member holding both is an administrator and the row
 * must say the STRONGEST thing they can do, never the first one in the array.
 *
 * A role string outside coord's vocabulary counts as access without naming a
 * tier: the member lands on `developer` (the weaker of the two real tiers)
 * rather than on `no-access`, because reporting "no access" about somebody who
 * demonstrably holds a grant is the more damaging error of the two. The row's
 * detail still lists every raw role verbatim.
 */
export function deriveMemberStatus(roles: readonly string[] | null | undefined): RowStatus<MemberAccessKind> {
  const list = roles ?? [];
  const kind: MemberAccessKind =
    list.includes("admin")
      ? "administrator"
      : list.length > 0
        ? "developer"
        : "no-access";
  return {
    kind,
    label: LABEL_BY_KIND[kind],
    reason: kind === "no-access" ? NO_ACCESS_EXPLANATION : undefined,
    attention: MEMBER_ATTENTION_BY_KIND[kind],
  };
}
