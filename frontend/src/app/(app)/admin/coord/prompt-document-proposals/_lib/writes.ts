/**
 * Ordering and marking for the landed-write feed (plan
 * `2026-08-27-tenant-level-agent-authorable-stores.md`, Phase 4).
 *
 * ## The `loosening` mark, and why it is OPTIONAL all the way down
 *
 * Coord classifies a policy write's DIRECTION against the autonomy-tier
 * ordering. A write that grants or widens authority is a **loosening**; under
 * the tenant's `policy_write` dial at `full` such a write LANDS rather than
 * being held as a proposal, notification-only. That is the write an operator
 * most wants at the top of this list — an agent editing the rules it is judged
 * by.
 *
 * The flag is served by a coord change that lands separately from this page.
 * Until it does, `loosening` is simply **absent** from every row. Absent is not
 * `false`: it means "this coord build does not classify landed writes", which
 * is a statement about the server, not about the write. So:
 *
 * * the field is `boolean | null | undefined` — the type says it may not be there;
 * * only an explicit `true` marks and promotes a row;
 * * anything else — `false`, `null`, absent — renders as an unmarked ordinary
 *   row, never as an error and never as a badge asserting "not a loosening".
 *
 * The distinction is preserved rather than collapsed so the surface can say
 * "nothing on this page is flagged" only when the field was actually served.
 */

import type { PromptDocumentWrite } from "../types";

/** An explicit classification arrived and said this write widened authority. */
export function isLoosening(
  write: Pick<PromptDocumentWrite, "loosening">
): boolean {
  return write.loosening === true;
}

/**
 * A verdict ARRIVED for this write — `true` or `false`, as opposed to absent.
 *
 * The counterpart to `isLoosening`, and a different question: that one asks
 * which way coord classified a write, this one asks whether coord classified it
 * at all. Mirrors the backend's `_has_verdict` (`operations.py`), which is
 * likewise spelled `is True or is False` rather than as a membership test —
 * a served `null` is forwarded verbatim by the proxy and is explicitly NOT a
 * verdict.
 */
export function hasLooseningVerdict(
  write: Pick<PromptDocumentWrite, "loosening">
): boolean {
  return write.loosening === true || write.loosening === false;
}

/**
 * How many rows coord actually classified — the denominator of any sentence
 * this page makes about direction.
 *
 * A page-scoped sentence still has to say WHICH writes it is scoped to. "None
 * of the writes on this page is a widening" names every row; the licence to say
 * it only covers the classified ones, and during a partial classifier rollout
 * those are two different sets. See `_limited_caveat`, which draws its own
 * corpus-scoped sentence from the same count.
 */
export function countLooseningVerdicts(
  writes: ReadonlyArray<Pick<PromptDocumentWrite, "loosening">>
): number {
  return writes.reduce((n, w) => n + (hasLooseningVerdict(w) ? 1 : 0), 0);
}

/**
 * True when at least one row carries the field at all — the discriminator
 * between "coord classified these and none was a loosening" and "coord never
 * classified them".
 *
 * Deliberately not `writes.some(isLoosening)`: a feed of ordinary writes from a
 * classifier-aware coord and a feed from a coord that has never heard of the
 * flag look identical if you only ask "is anything flagged".
 *
 * Derived from `countLooseningVerdicts` rather than spelling the predicate a
 * second time: the count and the boolean answer the same question, and a page
 * that says "none of the N classified writes" off one predicate while deciding
 * whether to speak at all off another can only disagree with itself.
 */
export function looseningClassificationPresent(
  writes: ReadonlyArray<Pick<PromptDocumentWrite, "loosening">>
): boolean {
  return countLooseningVerdicts(writes) > 0;
}

/**
 * Loosenings first, everything else after, **newest-first order preserved
 * inside each group**.
 *
 * A stable partition rather than a comparator: the ordering by `created_at`
 * descending is the SERVER's, and re-deriving it on a timestamp here would
 * shuffle rows whose `created_at` is unparseable into an arbitrary place.
 * Partitioning touches only the axis this function is about.
 *
 * **The backend now partitions too.** This used to say the feed arrives "sorted
 * by `created_at` descending", which stopped being true: `operations.py`
 * `_promote_flagged` lifts classified loosenings above the recency order BEFORE
 * the page slice, so a loosening older than the newest `limit` writes is not
 * dropped server-side. What arrives is therefore already loosenings-first, and
 * this partition is idempotent over it — including over the component's
 * filtered subset, since `Array.prototype.filter` preserves relative order.
 *
 * The ONE reason it still earns its place: a qontinui-web deploy predating that
 * change serves an unpromoted feed, and this keeps the page correct on it. The
 * two predicates are deliberately the same rule (`isLoosening`'s `=== true`,
 * `_is_flagged`'s `is True`) — two languages and two files with no shared
 * source, so that agreement is a convention each side documents, not something
 * either can enforce on the other.
 */
export function sortWritesForFeed<T extends Pick<PromptDocumentWrite, "loosening">>(
  writes: ReadonlyArray<T>
): T[] {
  const flagged: T[] = [];
  const rest: T[] = [];
  for (const write of writes) (isLoosening(write) ? flagged : rest).push(write);
  return [...flagged, ...rest];
}

/**
 * The console deep link that reaches a landed write's reasoning.
 *
 * `notification_ref` is carried into the emitted notification's payload by
 * coord, so the operator reaches the author's stated reasoning instead of
 * correlating two surfaces by timestamp. It points into the EXISTING
 * `/admin/coord/notifications` feed — there is no second notification view —
 * using the same `?<param>=<id>` deep-link shape `/admin/coord/gates?gate=<id>`
 * already uses from the outstanding-work ledger.
 *
 * Returns `null` for an absent ref, which is what makes the link optional: no
 * ref means no link, not a broken one.
 */
export function notificationHref(
  ref: string | null | undefined
): string | null {
  const trimmed = (ref ?? "").trim();
  if (!trimmed) return null;
  return `/admin/coord/notifications?ref=${encodeURIComponent(trimmed)}`;
}

/** The document address, used as a stable React key and testid suffix. */
export function writeKey(
  write: Pick<PromptDocumentWrite, "kind" | "name" | "version_number">
): string {
  return `${write.kind}/${write.name}/${write.version_number}`;
}

/**
 * The badge class for a flagged (loosening) landed write.
 *
 * **Purple, not amber, and that is R3 not taste.** The console's colour rule is
 * that hue encodes WHO MUST ACT: red = the operator must act now, amber =
 * waiting on something else (or we do not know), calm = nobody is blocked. A
 * landed loosening blocks nobody — it already landed, and this surface's whole
 * design target is that nothing waits on the operator. Amber would say the
 * opposite, and `WAITING_AMBER` is reserved for exactly that meaning. R3's
 * third case covers this one: a real decision that blocks nobody is CALM, with
 * the ask written in words (the badge title, here).
 *
 * Named here rather than typed inline so the class string is one thing to
 * change and is visibly not an anonymous inline fork. The AMPLITUDES are the
 * console's own purple — `bg-purple-500/15` over `border-purple-500/30`,
 * matching `statusRow.tsx`'s entry for that hue; only the TEXT is spelled in
 * this route's light/dark banner dialect (`-800 dark:-200`) instead of
 * `statusRow`'s dark-only `-200`, because the rest of this page renders in both
 * themes and a dark-only tint would be unreadable on the light one. Diverging
 * on the amplitudes as well would have made it a silent fork that
 * `paletteDisagreements` cannot see.
 */
export const LOOSENING_BADGE_CLASS =
  "border-purple-500/30 bg-purple-500/15 text-purple-800 dark:text-purple-200";
