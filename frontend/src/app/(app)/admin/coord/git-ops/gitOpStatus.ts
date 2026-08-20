/**
 * gitOpStatus — the git-op feed's kind vocabulary, and R3's audited severity
 * table for it.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 4 (Family C, D2). Derivation lives in a pure, unit-tested module rather
 * than inline in JSX (R8).
 *
 * ## This table is entirely calm, and that is the finding — not a shortcut
 *
 * The palette this replaces (`page.tsx`'s `OP_KIND_VARIANT`) painted `reset`
 * **destructive red** and `merge` / `rebase` **warning amber**, chosen — as its
 * own comment said — "so the feed reads at a glance". That is precisely the
 * bug R3 exists to prevent, stated in the style guide as *colour encodes who
 * must act, not how alarming the word sounds*: a red badge on a state that
 * needs nobody is what trains the eye to ignore red.
 *
 * Run the two-part test on this surface honestly. Every row here is a
 * **receipt for a git operation that already happened**, observed after the
 * fact by a runner's `GitOpBridge`. There is no row on which an operator can
 * act, because there is nothing in flight: the reset is done, the rebase
 * landed. So:
 *
 * - **Nothing is red.** No kind is anybody's move — the console cannot undo a
 *   recorded operation and nothing here is waiting on one.
 * - **Nothing is amber.** Amber promises *something else will clear this*, and
 *   there is nothing to clear.
 *
 * What the hues do instead is what R3 leaves them for: distinguishing families
 * of motion within the calm band (green = something was created, blue = the
 * tree moved, purple = history was rewritten, muted = housekeeping). That is a
 * legend, not a severity ladder, and losing the red is the point.
 *
 * ## The unrecognised kind is CALM here, not the ignorance floor
 *
 * `attentionOf`'s default floor is `"waiting"` — amber — because an
 * unrecognised kind is normally a statement about our knowledge. That floor
 * does not fit this surface, and the style guide says exactly when it does
 * not: the amber-is-wrong test is two-part, *you cannot name what clears the
 * row* **and** *you actually know what the row's state is*. On a feed of
 * completed operations we DO know the state — a finished git op, recorded,
 * terminal — we merely lack a hue for its label. Painting that amber would
 * claim something is pending when nothing is. So an op kind coord adds later
 * lands on {@link GIT_OP_OTHER} with attention `none`, and the label still
 * renders verbatim so the operator reads the real word.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import { INERT } from "@/components/console/statusRow";

/**
 * The closed kind union. It mirrors the op kinds coord emits today plus an
 * explicit bucket for the ones it adds tomorrow — a total table is what stops
 * a new kind from rendering with no declared severity at all.
 */
export type GitOpKind =
  | "push"
  | "commit"
  | "checkout"
  | "branch_create"
  | "merge"
  | "rebase"
  | "reset"
  | "remote_update"
  | "other";

/** Where an op kind this build has no entry for lands. See the module doc. */
export const GIT_OP_OTHER: GitOpKind = "other";

/**
 * The audited kind → attention table. TOTAL over {@link GitOpKind}, and every
 * row is `none` for the one reason given in the module doc: each row is a
 * receipt for a completed operation, so no row is anybody's move.
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `push` | `none` | Already pushed. |
 * | `commit` | `none` | Already committed. |
 * | `checkout` | `none` | The working tree already moved. |
 * | `branch_create` | `none` | The branch already exists. |
 * | `merge` | `none` | Already merged. Amber here would promise a resolution that has already happened. |
 * | `rebase` | `none` | Already rebased — same reading as `merge`. |
 * | `reset` | `none` | **The one that used to be red.** A reset is destructive to a working tree, but it is destructive in the PAST and this console cannot undo it. Loud is not the same as actionable. |
 * | `remote_update` | `none` | Housekeeping. |
 * | `other` | `none` | An op kind this build has no hue for. Calm, not the ignorance floor — we know it is a finished operation; see the module doc. |
 */
export const GIT_OP_ATTENTION_BY_KIND: Record<GitOpKind, Attention> = {
  push: "none",
  commit: "none",
  checkout: "none",
  branch_create: "none",
  merge: "none",
  rebase: "none",
  reset: "none",
  remote_update: "none",
  other: "none",
};

/**
 * The calm-band legend. No red and no amber appears here BY CONSTRUCTION, and
 * `paletteDisagreements` proves it: with every attention `none`, clause 2 and
 * clause 3 forbid both families outright.
 */
export const GIT_OP_KIND_CLASS: Record<GitOpKind, string> = {
  push: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  commit: "bg-green-500/15 text-green-200 border-green-500/30",
  checkout: "bg-sky-500/10 text-sky-200 border-sky-500/25",
  branch_create: "bg-green-500/5 text-green-300 border-green-500/25",
  merge: "bg-purple-500/15 text-purple-200 border-purple-500/30",
  rebase: "bg-purple-500/10 text-purple-200 border-purple-500/25",
  // Was `destructive`. Now the "history was rewritten" hue, one step from
  // rebase, because that is what it IS — not an alarm.
  reset: "bg-purple-500/15 text-purple-200 border-purple-500/35",
  remote_update: INERT,
  other: INERT,
};

/** Red ⇔ `✕`. No kind is red here, so this set is empty — and stays empty. */
export const GIT_OP_AUTHOR_GLYPH_KINDS: ReadonlySet<GitOpKind> = new Set(
  (Object.keys(GIT_OP_ATTENTION_BY_KIND) as GitOpKind[]).filter(
    (k) => GIT_OP_ATTENTION_BY_KIND[k] === "author"
  )
);

export const GIT_OP_STATUS_PALETTE: StatusPalette<GitOpKind> = {
  badgeClass: GIT_OP_KIND_CLASS,
  authorGlyphKinds: GIT_OP_AUTHOR_GLYPH_KINDS,
};

/** Is `raw` an op kind this build has a declared severity for? */
export function isKnownGitOpKind(raw: string): raw is GitOpKind {
  return Object.prototype.hasOwnProperty.call(GIT_OP_ATTENTION_BY_KIND, raw);
}

/**
 * The row's status. The LABEL is always coord's own `op_kind` string, even
 * when it falls through to `other` — the operator must read the real word;
 * only the hue is bucketed.
 */
export function deriveGitOpStatus(opKind: string): RowStatus<GitOpKind> {
  const kind = isKnownGitOpKind(opKind) ? opKind : GIT_OP_OTHER;
  return {
    kind,
    label: opKind,
    attention: GIT_OP_ATTENTION_BY_KIND[kind],
  };
}
