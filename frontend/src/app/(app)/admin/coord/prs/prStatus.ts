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
 * (`prPipeline.UnifiedStatusKind`, including the dwell-expiry escalations
 * and the `behind-held-*` grades, which borrow THIS table's per-token
 * attention for a BEHIND PR held by another block). This page renders coord's `merge_status` **verbatim** — it is
 * a pure passthrough, and that is the page's contract. Two different
 * vocabularies over the same domain, so two tables. What must NOT differ is
 * the READING, and every row below is aligned to its `prPipeline` counterpart
 * by hand, with the counterpart named. Where the two disagreed, `prPipeline`
 * won, because its table is the one with the incident history behind it.
 *
 * The per-token table itself is `PR_ATTENTION_BY_MERGE_STATUS` in
 * `components/operations/prMergeStatus.ts`: `prPipeline` borrows it, and a
 * component must not reach into a route directory for it. It is imported, NOT
 * re-exported, so one table has one declaring module.
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
 * - `behind-base` was `warning` amber and stays amber — the same reading
 *   `prPipeline` gives `needs-rebase`. That amber is NOT a promise: coord's
 *   BEHIND freshen gives up after an attempt ceiling, a content gate can
 *   suppress it and a kill switch can disable it, so the token alone reads
 *   UNKNOWN. When coord serves `freshen` the row reads that instead, through
 *   `readBehindFreshen` (plan
 *   `2026-10-27-behind-main-no-action-needed-is-promised-without-reading-whether-coord-will-act`).
 * - `review-required` was `warning` amber. It becomes **red**: `prPipeline`
 *   files its counterpart `requirements` as `author`, because a required
 *   review that has not been requested is nobody else's move.
 * - `blast-radius-block` was `warning` amber. It becomes **red** for the same
 *   reason — coord parks the PR and waits for a human; nothing times out.
 */

import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  CI_YELLOW,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";
import {
  BEHIND_FRESHEN_ATTENTION_BY_KIND,
  isFreshenPromiseToken,
  PR_ATTENTION_BY_MERGE_STATUS,
  readBehindFreshen,
  type BehindFreshenKind,
} from "@/components/operations/prMergeStatus";
import type { PrFreshen } from "@/components/operations/mergeTypes";
import type { PrMergeStatus } from "@/services/admin-dev-service";

/**
 * What a row on this page can be: coord's token verbatim, or — only on the two
 * tokens that make a freshen promise, and only when coord SERVED a reading
 * that changes who must act — the shared freshen kind.
 */
export type PrRowKind = PrMergeStatus | BehindFreshenKind;

export const PR_MERGE_STATUS_CLASS: Record<PrMergeStatus, string> = {
  ready: "bg-green-500/5 text-green-300 border-green-500/25",
  queued: INERT,
  "ci-pending": CI_YELLOW,
  draft: "bg-transparent text-muted-foreground border-border border-dashed",
  // INERT, the same calm `queued` gets: nothing is owed on this PR.
  "landed-open": INERT,
  // UNKNOWN_AMBER: a row keeps this kind only when coord served no freshen
  // reading (or served `unknown`), so the self-clearing amber would draw a
  // promise nothing observed. A served reading moves to `BEHIND_FRESHEN_CLASS`.
  "behind-base": UNKNOWN_AMBER,
  "awaiting-specialist-review": WAITING_AMBER,
  // A CI red coord exonerates the author from. Same reading as `behind-base`:
  // this kind means no freshen reading was served, so the ignorance floor
  // rather than the self-clearing amber.
  "ci-failed-stale-base": UNKNOWN_AMBER,
  conflicts: AUTHOR_RED,
  "ci-failed": AUTHOR_RED,
  "required-checks-missing": AUTHOR_RED,
  "review-required": AUTHOR_RED,
  "blast-radius-block": AUTHOR_RED,
  "ready-but-unlanded": AUTHOR_RED,
  "repo-unreachable": AUTHOR_RED,
  "dependency-upstream-closed": AUTHOR_RED,
  // The ignorance floor is still amber (never calm) but a step lighter than
  // the self-clearing promise — see `UNKNOWN_AMBER`'s own doc.
  "predicate-blocked": UNKNOWN_AMBER,
  "terminal-proposal-held": UNKNOWN_AMBER,
  // A CI red coord exonerates the author from, with NO self-clearing promise:
  // nothing re-runs a killed job yet, so `WAITING_AMBER` would lie. Same
  // floor as `terminal-proposal-held`, for the same reason. The grade differs
  // from train activity on purpose: there `trainActivity.ts` grades it
  // `blocking` (that axis's "operator action needed"), because the axis is
  // "why is the train paused" and a red no timer clears is a block; here the
  // axis is whose colour the badge wears, and red would name the author.
  "ci-failed-infra-kill": UNKNOWN_AMBER,
  unknown: UNKNOWN_AMBER,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds, derived. */
export const PR_AUTHOR_GLYPH_STATUSES: ReadonlySet<PrMergeStatus> = new Set(
  (Object.keys(PR_ATTENTION_BY_MERGE_STATUS) as PrMergeStatus[]).filter(
    (k) => PR_ATTENTION_BY_MERGE_STATUS[k] === "author"
  )
);

/**
 * The served freshen readings. `behind-freshening` earns the self-clearing
 * amber because coord named itself as the clearer; `behind-freshen-refused` is
 * red because coord said it will not.
 */
export const BEHIND_FRESHEN_CLASS: Record<BehindFreshenKind, string> = {
  "behind-freshening": WAITING_AMBER,
  "behind-freshen-refused": AUTHOR_RED,
};

export const BEHIND_FRESHEN_AUTHOR_GLYPH_KINDS: ReadonlySet<BehindFreshenKind> =
  new Set(
    (
      Object.keys(BEHIND_FRESHEN_ATTENTION_BY_KIND) as BehindFreshenKind[]
    ).filter((k) => BEHIND_FRESHEN_ATTENTION_BY_KIND[k] === "author")
  );

export const PR_STATUS_PALETTE: StatusPalette<PrRowKind> = {
  badgeClass: { ...PR_MERGE_STATUS_CLASS, ...BEHIND_FRESHEN_CLASS },
  authorGlyphKinds: new Set<PrRowKind>([
    ...PR_AUTHOR_GLYPH_STATUSES,
    ...BEHIND_FRESHEN_AUTHOR_GLYPH_KINDS,
  ]),
  doneGlyphKinds: new Set<PrRowKind>(["ready"]),
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
 *
 * The two promise tokens are the exception, and the only one: they read
 * coord's `freshen` block through `readBehindFreshen`, the same function
 * `prPipeline` renders from, so the two pages cannot disagree about whether
 * coord will update a branch. Coord's `blocking_summary` on those tokens says
 * only that the branch needs updating, so it stays in the row's title rather
 * than standing in as the answer.
 */
export function derivePrStatus(pr: {
  merge_status?: string | null;
  blocking_summary?: string | null;
  base_branch?: string | null;
  freshen?: PrFreshen | null;
}): RowStatus<PrRowKind> {
  if (isFreshenPromiseToken(pr.merge_status)) {
    const reading = readBehindFreshen(pr);
    return {
      kind: reading.kind ?? pr.merge_status,
      label: reading.label ?? mergeStatusLabel(pr.merge_status),
      reason: reading.reason,
      attention: reading.attention,
    };
  }
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

/**
 * The `/admin/coord/prs` health-strip counts, from the same `derivePrStatus`
 * the rows render from. A promise-token row whose freshen reading is UNKNOWN
 * (no block served, or `unknown`) is counted on its own and NOT as waiting:
 * nothing observed says the train or coord will move it, so it must not be
 * folded into "nothing needs you".
 */
export interface PrsHealthCounts {
  author: number;
  waiting: number;
  freshenUnknown: number;
}

export function derivePrsHealthCounts(
  prs: ReadonlyArray<Parameters<typeof derivePrStatus>[0]>
): PrsHealthCounts {
  const counts: PrsHealthCounts = { author: 0, waiting: 0, freshenUnknown: 0 };
  for (const p of prs) {
    const status = derivePrStatus(p);
    if (status.attention === "author") counts.author += 1;
    else if (
      isFreshenPromiseToken(p.merge_status) &&
      readBehindFreshen(p).kind === null
    )
      counts.freshenUnknown += 1;
    else if (status.attention === "waiting") counts.waiting += 1;
  }
  return counts;
}

/** The strip's headline. "Nothing needs you" only when nothing is UNKNOWN. */
export function prsHealthHeadline(
  counts: PrsHealthCounts,
  total: number,
  tab: "open" | "merged" | string
): string {
  const { author, waiting, freshenUnknown } = counts;
  const plural = (n: number) => (n === 1 ? "" : "s");
  if (author > 0)
    return `${author} PR${plural(author)} need${author === 1 ? "s" : ""} a human now`;
  if (freshenUnknown > 0)
    return (
      `${freshenUnknown} PR${plural(freshenUnknown)} whose coord update is UNKNOWN` +
      (waiting > 0 ? ` · ${waiting} waiting on the train` : "")
    );
  if (waiting > 0) return `Nothing needs you — ${waiting} waiting on the train`;
  if (total > 0) return "Every open PR is moving on its own";
  return tab === "merged" ? "No PRs merged in the last 24h" : "No open PRs";
}
