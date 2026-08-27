/**
 * prStatus — R3's audited severity table for coord's `merge_status`, the
 * "blocking reason" column that is the whole point of `/admin/coord/prs`.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 4 (Family C, D2). Derivation lives in a pure, unit-tested module rather
 * than inline in JSX (R8).
 *
 * ## Why this table and `prPipeline`'s are two tables, not one
 *
 * `/fleet` derives its OWN status kinds from the raw GitHub + coord fields
 * (`prPipeline.UnifiedStatusKind`, 19 kinds including the dwell-expiry
 * escalations). This page renders coord's `merge_status` **verbatim** — it is
 * a pure passthrough, and that is the page's contract. Two different
 * vocabularies over the same domain, so two tables. What must NOT differ is
 * the READING, and every row below is aligned to its `prPipeline` counterpart
 * by hand, with the counterpart named. Where the two disagreed, `prPipeline`
 * won, because its table is the one with the incident history behind it.
 *
 * ## What this replaces
 *
 * `MERGE_STATUS_TONE` inline in `PrsTable.tsx`, whose own comment described
 * the picks as "deliberately LOUD" — i.e. chosen by how alarming the state
 * sounds, which is the bug R3 exists to prevent. Three of its rows were
 * wrong under R3 and one of them is the exact failure the style guide opens
 * with:
 *
 * - `ci-pending` was `info` (calm) — **right**, and preserved.
 * - `unknown` was `outline` (muted, i.e. calm). Under R3 an unrecognised state
 *   is the IGNORANCE FLOOR: amber, never calm. Painting "we cannot tell you
 *   what is blocking this" as calm asserts nothing is wrong, which is
 *   precisely what we do not know.
 * - `awaiting-specialist-review` was `warning` amber. It stays amber, and now
 *   for a stated reason: the specialist review is already dispatched and will
 *   return a verdict.
 * - `behind-base` was `warning` amber and stays amber — coord auto-rebases in
 *   the train, the same reading `prPipeline` gives `needs-rebase`.
 * - `review-required` was `warning` amber. It becomes **red**: `prPipeline`
 *   files its counterpart `requirements` as `author`, because a required
 *   review that has not been requested is nobody else's move.
 * - `blast-radius-block` was `warning` amber. It becomes **red** for the same
 *   reason — coord parks the PR and waits for a human; nothing times out.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  CI_YELLOW,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";
import type { PrMergeStatus } from "@/services/admin-dev-service";

/**
 * The audited kind → attention table. TOTAL over `PrMergeStatus`, one
 * documented row each, with its `prPipeline` counterpart named:
 *
 * | merge_status | attention | `prPipeline` counterpart | why |
 * |---|---|---|---|
 * | `ready` | `none` | `ready` | CLEAN; coord will pick it up. |
 * | `queued` | `none` | `queued` | In coord's queue. |
 * | `ci-pending` | `none` | `checks-pending` | CI is still running. **The original bug was painting this red**; it needs nobody. |
 * | `draft` | `none` | `draft` | Intentionally parked by its author. |
 * | `behind-base` | `waiting` | `needs-rebase` | BEHIND; coord auto-rebases in the train. The train clears it. |
 * | `awaiting-specialist-review` | `waiting` | (escalation arm) | The specialist review is dispatched; a verdict is coming back. That is a nameable clearer, which is what amber requires. |
 * | `conflicts` | `author` | `conflict` / `not-mergeable` | A real merge conflict. Only a human resolves it. |
 * | `ci-failed` | `author` | `checks-failing` | A check reported failure. **The other half of the original bug** — this is the state that genuinely needs a push. |
 * | `required-checks-missing` | `author` | `checks-failing` (same class) | A required check is UNSATISFIED. coord reconciles `required_checks_satisfied` against GitHub's aggregate at hydration, so a surviving `false` may never clear on its own. `trainActivity` grades it `blocking` and names `ci-failed` — not `behind-base` — as its sibling; amber here would promise a clearer that does not exist. |
 * | `review-required` | `author` | `requirements` | A required review or ruleset condition is unmet. Nothing dispatches the reviewer for you. |
 * | `blast-radius-block` | `author` | `requirements` | Over the repo's line budget: coord parks it and waits for a human decision. No timer clears it. |
 * | `ready-but-unlanded` | `author` | `conflict-stranded` (same class) | coord says ready and it has not landed — a wedge. The promise that something else would land it is demonstrably false. |
 * | `repo-unreachable` | `author` | `not-mergeable` | coord cannot clone the repo (deleted/renamed, or App access revoked). Not fixable by a rebase or a re-evaluate; a human must restore access. |
 * | `unknown` | `waiting` | `unknown` | R3's IGNORANCE FLOOR. We cannot say whose move this is, and calm would assert nothing is wrong. |
 */
export const PR_ATTENTION_BY_MERGE_STATUS: Record<PrMergeStatus, Attention> = {
  // --- nobody is blocked → never red or amber -------------------------------
  ready: "none",
  queued: "none",
  "ci-pending": "none",
  draft: "none",
  // --- waiting on something that will clear itself → amber ------------------
  "behind-base": "waiting",
  "awaiting-specialist-review": "waiting",
  // --- someone must act now → red ------------------------------------------
  conflicts: "author",
  "ci-failed": "author",
  // Split out of `review-required`, but it belongs to the CI dimension, not to
  // a reviewer (coord's own `merge_verdict.rs` maps it to `"ci"`). Same
  // attention either way: nothing dispatches the missing check for you.
  "required-checks-missing": "author",
  "review-required": "author",
  "blast-radius-block": "author",
  "ready-but-unlanded": "author",
  "repo-unreachable": "author",
  // --- we do not know → the ignorance floor, amber's lighter sibling --------
  unknown: "waiting",
};

export const PR_MERGE_STATUS_CLASS: Record<PrMergeStatus, string> = {
  ready: "bg-green-500/5 text-green-300 border-green-500/25",
  queued: INERT,
  "ci-pending": CI_YELLOW,
  draft: "bg-transparent text-muted-foreground border-border border-dashed",
  "behind-base": WAITING_AMBER,
  "awaiting-specialist-review": WAITING_AMBER,
  conflicts: AUTHOR_RED,
  "ci-failed": AUTHOR_RED,
  "required-checks-missing": AUTHOR_RED,
  "review-required": AUTHOR_RED,
  "blast-radius-block": AUTHOR_RED,
  "ready-but-unlanded": AUTHOR_RED,
  "repo-unreachable": AUTHOR_RED,
  // The ignorance floor is still amber (never calm) but a step lighter than
  // the self-clearing promise — see `UNKNOWN_AMBER`'s own doc.
  unknown: UNKNOWN_AMBER,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds, derived. */
export const PR_AUTHOR_GLYPH_STATUSES: ReadonlySet<PrMergeStatus> = new Set(
  (Object.keys(PR_ATTENTION_BY_MERGE_STATUS) as PrMergeStatus[]).filter(
    (k) => PR_ATTENTION_BY_MERGE_STATUS[k] === "author"
  )
);

export const PR_STATUS_PALETTE: StatusPalette<PrMergeStatus> = {
  badgeClass: PR_MERGE_STATUS_CLASS,
  authorGlyphKinds: PR_AUTHOR_GLYPH_STATUSES,
  doneGlyphKinds: new Set<PrMergeStatus>(["ready"]),
};

/**
 * Short human label for the merge_status (the badge text).
 *
 * Null-tolerant on purpose. `merge_status` is non-optional in `PrRow`, but the
 * page's degraded path renders whatever the proxy hands back, and a coord that
 * omits the field must produce an honest "we cannot read this" row rather than
 * a blank screen — the whole point of the coord-down envelope this page is
 * built around.
 */
export function mergeStatusLabel(status: string | null | undefined): string {
  if (!status) return "unknown";
  return status.replace(/-/g, " ");
}

/**
 * The row's status.
 *
 * `blocking_summary` is coord's own sentence about the row and becomes the
 * `reason`, so the badge's native `title` answers "why?" on every row — the
 * `StatusBadge` contract. A `merge_status` this build does not know falls to
 * `unknown`, i.e. to the ignorance floor, rather than rendering unstyled.
 */
export function derivePrStatus(pr: {
  merge_status?: string | null;
  blocking_summary?: string | null;
}): RowStatus<PrMergeStatus> {
  const known =
    !!pr.merge_status &&
    Object.prototype.hasOwnProperty.call(
      PR_ATTENTION_BY_MERGE_STATUS,
      pr.merge_status
    );
  const kind = (known ? pr.merge_status : "unknown") as PrMergeStatus;
  return {
    kind,
    // The label is always coord's own word, even when the HUE fell through to
    // the ignorance floor — the operator must read what coord actually said.
    label: mergeStatusLabel(pr.merge_status),
    reason: pr.blocking_summary || undefined,
    attention: PR_ATTENTION_BY_MERGE_STATUS[kind],
  };
}
